import { db } from "./client.js";
import type { Role, Organization, OrgMember, ProjectMember } from "@gate15/api-types";

/**
 * Org + project membership and RBAC (P3.1/P3.2/P3.5).
 *
 * Personal projects use `owner_id` as their implicit owner. Organization-owned
 * projects deliberately ignore `owner_id`: org/project membership is the only
 * authority, so removing a creator from the org revokes access completely.
 *
 * Every membership query degrades gracefully if the new tables haven't been
 * applied yet (the operator runs schema.sql manually) — a missing relation is
 * treated as "no shared members", so the owner path still works.
 */

/** True when a Supabase error means the table doesn't exist yet (pre-migration). */
function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return err.code === "42P01" || /relation .* does not exist|could not find the table/i.test(err.message ?? "");
}

interface ProjectOwnerOrg {
  owner_id: string | null;
  org_id: string | null;
}

async function projectOwnerOrg(projectId: string): Promise<ProjectOwnerOrg | null> {
  const { data, error } = await db()
    .from("projects")
    .select("owner_id, org_id")
    .eq("id", projectId)
    .maybeSingle();
  if (error) {
    // org_id column missing (pre-migration) — fall back to owner_id only.
    if (isMissingTable(error) || /org_id/.test(error.message ?? "")) {
      const fb = await db().from("projects").select("owner_id").eq("id", projectId).maybeSingle();
      if (fb.error || !fb.data) return null;
      return { owner_id: (fb.data as { owner_id: string }).owner_id, org_id: null };
    }
    return null;
  }
  if (!data) return null;
  const row = data as { owner_id: string | null; org_id: string | null };
  return { owner_id: row.owner_id, org_id: row.org_id ?? null };
}

/**
 * The acting user's effective role on a project, or null if they have no access.
 * Owner > explicit project_members row > org-level role (for the project's org).
 */
export async function getProjectRole(projectId: string, userId: string): Promise<Role | null> {
  const po = await projectOwnerOrg(projectId);
  if (!po) return null;
  let projectRole: Role | null = null;

  const pm = await db()
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!pm.error && pm.data) projectRole = (pm.data as { role: Role }).role;
  if (pm.error && !isMissingTable(pm.error)) {
    // A real error (not a missing table) shouldn't silently grant/deny — log it.
    console.error(`[members] project_members lookup failed: ${pm.error.message}`);
  }

  let orgRole: Role | null = null;
  if (po.org_id) {
    const om = await db()
      .from("org_members")
      .select("role")
      .eq("org_id", po.org_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!om.error && om.data) orgRole = (om.data as { role: Role }).role;
  }
  return resolveEffectiveProjectRole({
    orgId: po.org_id,
    ownerId: po.owner_id,
    userId,
    projectRole,
    orgRole,
  });
}

export function resolveEffectiveProjectRole(input: {
  orgId: string | null;
  ownerId: string | null;
  userId: string;
  projectRole: Role | null;
  orgRole: Role | null;
}): Role | null {
  const roles: Role[] = [];
  if (!input.orgId && input.ownerId === input.userId) roles.push("owner");
  if (input.projectRole) roles.push(input.projectRole);
  if (input.orgId && input.orgRole) roles.push(input.orgRole);
  return strongestRole(roles);
}

function strongestRole(roles: readonly Role[]): Role | null {
  const order: Role[] = ["viewer", "editor", "admin", "owner"];
  for (let i = order.length - 1; i >= 0; i -= 1) {
    if (roles.includes(order[i])) return order[i];
  }
  return null;
}

export async function canAccessProject(projectId: string, userId: string): Promise<boolean> {
  return (await getProjectRole(projectId, userId)) !== null;
}

/** Project ids the user can reach via shared membership (NOT their owned ones). */
export async function listSharedProjectIds(userId: string): Promise<string[]> {
  const ids = new Set<string>();
  const pm = await db().from("project_members").select("project_id").eq("user_id", userId);
  if (!pm.error) for (const r of pm.data ?? []) ids.add((r as { project_id: string }).project_id);

  // Org-level: every project belonging to an org the user is a member of.
  const om = await db().from("org_members").select("org_id").eq("user_id", userId);
  if (!om.error && (om.data ?? []).length) {
    const orgIds = (om.data ?? []).map((r) => (r as { org_id: string }).org_id);
    const op = await db().from("projects").select("id").in("org_id", orgIds);
    if (!op.error) for (const r of op.data ?? []) ids.add((r as { id: string }).id);
  }
  return [...ids];
}

interface MemberRow {
  id: string;
  user_id: string;
  role: Role;
  created_at: string;
  users?: { email: string | null; display_name: string | null } | null;
}

/** Direct project members; personal projects also synthesize their owner. */
export async function listProjectMembers(projectId: string): Promise<ProjectMember[]> {
  const po = await projectOwnerOrg(projectId);
  const out: ProjectMember[] = [];
  const seen = new Set<string>();

  if (po && !po.org_id && po.owner_id) {
    const ownerUser = await db()
      .from("users")
      .select("email, display_name")
      .eq("id", po.owner_id)
      .maybeSingle();
    out.push({
      id: `owner:${po.owner_id}`,
      project_id: projectId,
      user_id: po.owner_id,
      role: "owner",
      created_at: "",
      email: (ownerUser.data as { email?: string } | null)?.email ?? null,
      display_name: (ownerUser.data as { display_name?: string } | null)?.display_name ?? null,
    });
    seen.add(po.owner_id);
  }

  const { data, error } = await db()
    .from("project_members")
    .select("id, user_id, role, created_at, users(email, display_name)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error) {
    if (isMissingTable(error)) return out;
    throw new Error(`listProjectMembers failed: ${error.message}`);
  }
  for (const r of (data ?? []) as unknown as MemberRow[]) {
    if (seen.has(r.user_id)) continue;
    out.push({
      id: r.id,
      project_id: projectId,
      user_id: r.user_id,
      role: r.role,
      created_at: r.created_at,
      email: r.users?.email ?? null,
      display_name: r.users?.display_name ?? null,
    });
  }
  return out;
}

/** Direct project membership role, including a personal project's implicit owner. */
export async function getDirectProjectMemberRole(
  projectId: string,
  userId: string,
): Promise<Role | null> {
  const po = await projectOwnerOrg(projectId);
  if (!po) return null;
  if (!po.org_id && po.owner_id === userId) return "owner";
  const { data, error } = await db()
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null;
    throw new Error(`getDirectProjectMemberRole failed: ${error.message}`);
  }
  return (data as { role?: Role } | null)?.role ?? null;
}

export async function countDirectProjectOwners(projectId: string): Promise<number> {
  return (await listProjectMembers(projectId)).filter((member) => member.role === "owner").length;
}

export async function findUserByEmail(email: string): Promise<{ id: string } | null> {
  const { data } = await db().from("users").select("id").ilike("email", email.trim()).maybeSingle();
  return (data as { id: string } | null) ?? null;
}

/** Invite a teammate to a project by email. Returns 'no_user' if no account matches. */
export async function addProjectMemberByEmail(
  projectId: string,
  email: string,
  role: Role,
): Promise<{ ok: true; member: ProjectMember } | { ok: false; reason: "no_user" | "exists" | "error"; message?: string }> {
  const user = await findUserByEmail(email);
  if (!user) return { ok: false, reason: "no_user" };
  const { data, error } = await db()
    .from("project_members")
    // Invites create membership only. Existing roles must go through the PATCH
    // path, which checks the caller/target role before changing authority.
    .insert({ project_id: projectId, user_id: user.id, role })
    .select("id, user_id, role, created_at")
    .single();
  if (error?.code === "23505") return { ok: false, reason: "exists" };
  if (error || !data) return { ok: false, reason: "error", message: error?.message };
  const row = data as { id: string; user_id: string; role: Role; created_at: string };
  return {
    ok: true,
    member: { id: row.id, project_id: projectId, user_id: row.user_id, role: row.role, created_at: row.created_at },
  };
}

export async function setProjectMemberRole(projectId: string, userId: string, role: Role): Promise<void> {
  const { error } = await db()
    .from("project_members")
    .update({ role })
    .eq("project_id", projectId)
    .eq("user_id", userId);
  if (error) throw new Error(`setProjectMemberRole failed: ${error.message}`);
}

export async function removeProjectMember(projectId: string, userId: string): Promise<void> {
  const { error } = await db()
    .from("project_members")
    .delete()
    .eq("project_id", projectId)
    .eq("user_id", userId);
  if (error) throw new Error(`removeProjectMember failed: ${error.message}`);
}

// ── Organizations ─────────────────────────────────────────────────────────────

export async function createOrganization(name: string, ownerId: string): Promise<Organization> {
  const { data, error } = await db()
    .rpc("create_organization_with_owner", {
      p_name: name,
      p_owner_id: ownerId,
    })
    .single();
  if (error || !data) throw new Error(`createOrganization failed: ${error?.message}`);
  return data as Organization;
}

export async function listOrganizationsForUser(userId: string): Promise<Organization[]> {
  const om = await db().from("org_members").select("org_id, role").eq("user_id", userId);
  if (om.error) {
    if (isMissingTable(om.error)) return [];
    throw new Error(`listOrganizationsForUser failed: ${om.error.message}`);
  }
  const memberships = (om.data ?? []) as Array<{ org_id: string; role: Role }>;
  const ids = memberships.map((r) => r.org_id);
  if (!ids.length) return [];
  const { data, error } = await db().from("organizations").select("*").in("id", ids).order("created_at");
  if (error) throw new Error(`listOrganizationsForUser failed: ${error.message}`);
  const roles = new Map(memberships.map((membership) => [membership.org_id, membership.role]));
  return ((data ?? []) as Organization[]).map((org) => ({
    ...org,
    effective_role: roles.get(org.id),
  }));
}

export async function getOrgRole(orgId: string, userId: string): Promise<Role | null> {
  const { data, error } = await db()
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { role: Role }).role;
}

export async function listOrgMembers(orgId: string): Promise<OrgMember[]> {
  const { data, error } = await db()
    .from("org_members")
    .select("id, org_id, user_id, role, created_at, users(email, display_name)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });
  if (error) {
    if (isMissingTable(error)) return [];
    throw new Error(`listOrgMembers failed: ${error.message}`);
  }
  return ((data ?? []) as unknown as Array<MemberRow & { org_id: string }>).map((r) => ({
    id: r.id,
    org_id: r.org_id,
    user_id: r.user_id,
    role: r.role,
    created_at: r.created_at,
    email: r.users?.email ?? null,
    display_name: r.users?.display_name ?? null,
  }));
}

export async function addOrgMemberByEmail(
  orgId: string,
  email: string,
  role: Role,
): Promise<{ ok: true } | { ok: false; reason: "no_user" | "exists" | "error"; message?: string }> {
  const user = await findUserByEmail(email);
  if (!user) return { ok: false, reason: "no_user" };
  const { error } = await db()
    .from("org_members")
    // Never let the invite endpoint double as an unchecked role mutation. In
    // particular, an admin must not be able to demote an existing owner by
    // inviting the same address again with a lower role.
    .insert({ org_id: orgId, user_id: user.id, role });
  if (error?.code === "23505") return { ok: false, reason: "exists" };
  if (error) return { ok: false, reason: "error", message: error.message };
  return { ok: true };
}

export async function setOrgMemberRole(orgId: string, userId: string, role: Role): Promise<void> {
  const { error } = await db().from("org_members").update({ role }).eq("org_id", orgId).eq("user_id", userId);
  if (error) throw new Error(`setOrgMemberRole failed: ${error.message}`);
}

export async function removeOrgMember(orgId: string, userId: string): Promise<void> {
  const { error } = await db().from("org_members").delete().eq("org_id", orgId).eq("user_id", userId);
  if (error) throw new Error(`removeOrgMember failed: ${error.message}`);
}

export async function renameOrganization(orgId: string, name: string): Promise<void> {
  const { error } = await db().from("organizations").update({ name }).eq("id", orgId);
  if (error) throw new Error(`renameOrganization failed: ${error.message}`);
}

/**
 * Delete an org transactionally. Every org project is first reassigned to the
 * deleting owner as a personal project, avoiding stale historical creators.
 */
export async function deleteOrganization(orgId: string, recoveryOwnerId: string): Promise<void> {
  const { error } = await db().rpc("delete_organization_with_recovery", {
    p_org_id: orgId,
    p_recovery_owner_id: recoveryOwnerId,
  });
  if (error) throw new Error(`deleteOrganization failed: ${error.message}`);
}

/** How many members hold the `owner` role on an org — guards the last-owner case. */
export async function countOrgOwners(orgId: string): Promise<number> {
  const { count, error } = await db()
    .from("org_members")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("role", "owner");
  if (error) throw new Error(`countOrgOwners failed: ${error.message}`);
  return count ?? 0;
}

/** How many projects currently live in an org (for the Usage card). */
export async function countOrgProjects(orgId: string): Promise<number> {
  const { count, error } = await db()
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId);
  if (error) {
    if (isMissingTable(error) || /org_id/.test(error.message ?? "")) return 0;
    throw new Error(`countOrgProjects failed: ${error.message}`);
  }
  return count ?? 0;
}

export async function setOrgBudget(orgId: string, monthlyBudgetUsd: number | null): Promise<void> {
  const { error } = await db()
    .from("organizations")
    .update({ monthly_budget_usd: monthlyBudgetUsd })
    .eq("id", orgId);
  if (error) throw new Error(`setOrgBudget failed: ${error.message}`);
}

export async function getOrganization(orgId: string): Promise<Organization | null> {
  const { data, error } = await db().from("organizations").select("*").eq("id", orgId).maybeSingle();
  if (error) return null;
  return (data as Organization | null) ?? null;
}

/**
 * The org a project belongs to, or null (no org, or the org_id column hasn't
 * been migrated yet). Cheap single-column read for the budget gate (P3.5), which
 * doesn't want the whole owner-scoped ProjectRecord. Degrades to null on any
 * error so the caller's budget check fails open.
 */
export async function getProjectOrgId(projectId: string): Promise<string | null> {
  const { data, error } = await db()
    .from("projects")
    .select("org_id")
    .eq("id", projectId)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { org_id: string | null }).org_id ?? null;
}
