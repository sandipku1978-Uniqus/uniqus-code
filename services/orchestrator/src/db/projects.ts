import { db } from "./client.js";
import type { DeploymentState } from "./deployments.js";
import { roleAtLeast, type ProjectSkillsTrust, type Role } from "@uniqus/api-types";
import { getOrgRole, getProjectRole, listSharedProjectIds } from "./members.js";

export interface ProjectRecord {
  id: string;
  owner_id: string | null;
  name: string;
  description: string | null;
  icon: string | null;
  created_at: string;
  updated_at: string;
  vercel_project_id?: string | null;
  vercel_project_name?: string | null;
  github_repo_url?: string | null;
  github_repo_full_name?: string | null;
  /** Branch the project is linked to on its remote. Null = unknown (UI falls back to 'main'). */
  linked_branch?: string | null;
  /** Origin remote URL captured on a preserveGit import (P1.1; PAT-free). */
  github_remote_url?: string | null;
  /** State of the most recent deployment row, surfaced in the All Projects view. */
  latest_deploy_state?: DeploymentState | null;
  /** created_at of the most recent deployment row. */
  latest_deploy_at?: string | null;
  /** Attached global design system (null = none). */
  design_system_id?: string | null;
  /** Attached reusable library skills (uuid[]; empty = none). */
  skill_library_ids?: string[] | null;
  /** Trust state for `.uniqus/skills.md` prompt injection. */
  skills_trust?: ProjectSkillsTrust | null;
  /** Supabase project ref linked to this project, if provisioned. */
  supabase_project_ref?: string | null;
  /** Organization (workspace) the project lives in. Null = the owner's personal workspace. */
  org_id?: string | null;
}

async function assertProjectRole(id: string, userId: string, minimum: Role): Promise<void> {
  const role = await getProjectRole(id, userId);
  if (!roleAtLeast(role, minimum)) throw new Error("project access denied");
}

/**
 * Shape of the latest-deployment fields PostgREST embeds via the
 * `deployments(...)` relation. We pull ALL of a project's deployment rows
 * (just state + created_at) and pick the most recent in JS, since PostgREST
 * can't express "the single most recent related row" inline.
 */
type EmbeddedDeploymentRow = { state: DeploymentState; created_at: string };

/**
 * Collapse the embedded `deployments` array onto a project row: find the most
 * recent by created_at and stamp latest_deploy_state/latest_deploy_at. Strips
 * the embedded relation so the returned record matches ProjectRecord exactly.
 */
function withLatestDeploy(
  row: Record<string, unknown> & { deployments?: EmbeddedDeploymentRow[] | null },
): ProjectRecord {
  const { deployments, ...rest } = row;
  let latest: EmbeddedDeploymentRow | null = null;
  for (const d of deployments ?? []) {
    if (!latest || d.created_at > latest.created_at) latest = d;
  }
  return {
    ...(rest as Omit<ProjectRecord, "latest_deploy_state" | "latest_deploy_at">),
    latest_deploy_state: latest?.state ?? null,
    latest_deploy_at: latest?.created_at ?? null,
  };
}

export async function listProjects(ownerId: string): Promise<ProjectRecord[]> {
  // Embed every deployment's state + created_at via the FK relation; the most
  // recent one is collapsed onto latest_deploy_* in withLatestDeploy. `*` also
  // pulls linked_branch.
  const { data, error } = await db()
    .from("projects")
    .select("*, deployments(state, created_at)")
    .eq("owner_id", ownerId)
    .is("org_id", null)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`listProjects failed: ${error.message}`);
  return (data ?? []).map((row) =>
    withLatestDeploy(row as Record<string, unknown> & { deployments?: EmbeddedDeploymentRow[] | null }),
  );
}

/** Fetch projects by id, NOT owner-scoped. For shared-access reads only. */
async function getProjectsByIds(ids: string[]): Promise<ProjectRecord[]> {
  if (!ids.length) return [];
  const { data, error } = await db()
    .from("projects")
    .select("*, deployments(state, created_at)")
    .in("id", ids);
  if (error) throw new Error(`getProjectsByIds failed: ${error.message}`);
  return (data ?? []).map((row) =>
    withLatestDeploy(row as Record<string, unknown> & { deployments?: EmbeddedDeploymentRow[] | null }),
  );
}

/**
 * Projects the user can see on their dashboard: the ones they own PLUS the ones
 * shared with them via project/org membership (P3.2 collaboration). Owned rows
 * come first (newest-first), shared rows appended (newest-first). Degrades to
 * just owned if the membership tables aren't applied yet — listSharedProjectIds
 * is graceful — so single-user installs are unaffected.
 */
export async function listAccessibleProjects(userId: string): Promise<ProjectRecord[]> {
  const owned = await listProjects(userId);
  const ownedIds = new Set(owned.map((p) => p.id));
  const sharedIds = (await listSharedProjectIds(userId)).filter((id) => !ownedIds.has(id));
  const shared = await getProjectsByIds(sharedIds);
  shared.sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
  return [...owned, ...shared];
}

export async function createProject(input: {
  owner_id: string;
  name: string;
  description?: string | null;
  design_system_id?: string | null;
  skill_library_ids?: string[] | null;
  /** Workspace the project is created in. Null/undefined = the owner's personal workspace. */
  org_id?: string | null;
}): Promise<ProjectRecord> {
  // org_id is included only when set so the insert still works against a DB
  // where the column hasn't been migrated yet (personal projects keep working).
  const row: Record<string, unknown> = {
    owner_id: input.owner_id,
    name: input.name,
    description: input.description ?? null,
    design_system_id: input.design_system_id ?? null,
    skill_library_ids: input.skill_library_ids ?? [],
  };
  if (input.org_id) row.org_id = input.org_id;
  const { data, error } = await db().from("projects").insert(row).select("*").single();
  if (error || !data) throw new Error(`createProject failed: ${error?.message}`);
  return data as ProjectRecord;
}

/**
 * Projects in the user's PERSONAL workspace: every project they can reach that
 * isn't in an org. That's their own un-orged projects PLUS any project shared
 * directly with them (P3.2 project_members) that isn't org-scoped — org projects
 * live under their org workspace instead. Built on listAccessibleProjects so the
 * P3.2 sharing path keeps working; org_id rides on each record (select *).
 */
export async function listPersonalProjects(userId: string): Promise<ProjectRecord[]> {
  const all = await listAccessibleProjects(userId);
  return all.filter((p) => !p.org_id);
}

/**
 * Every project belonging to an org (the org workspace view). NOT owner-scoped —
 * the caller must already have verified org membership (collabRoutes does). Newest
 * first. Returns [] if the org_id column isn't migrated yet.
 */
export async function listOrgProjects(orgId: string): Promise<ProjectRecord[]> {
  const { data, error } = await db()
    .from("projects")
    .select("*, deployments(state, created_at)")
    .eq("org_id", orgId)
    .order("updated_at", { ascending: false });
  if (error) {
    if (/org_id/.test(error.message ?? "")) return [];
    throw new Error(`listOrgProjects failed: ${error.message}`);
  }
  return (data ?? []).map((row) =>
    withLatestDeploy(row as Record<string, unknown> & { deployments?: EmbeddedDeploymentRow[] | null }),
  );
}

/**
 * Move a project into an org workspace (orgId) or back to personal (null).
 * Owner-scoped: only the project owner can move it. The route additionally
 * checks the caller is at least an editor on the TARGET org before calling this.
 */
export async function setProjectOrg(
  id: string,
  ownerId: string,
  orgId: string | null,
): Promise<void> {
  await assertProjectRole(id, ownerId, "owner");
  if (orgId) {
    const targetRole = await getOrgRole(orgId, ownerId);
    if (!roleAtLeast(targetRole, "admin")) throw new Error("target organization admin access required");
  }
  const { error } = await db()
    .from("projects")
    .update(orgId ? { org_id: orgId } : { org_id: null, owner_id: ownerId })
    .eq("id", id);
  if (error) throw new Error(`setProjectOrg failed: ${error.message}`);
}

/** Attach (or detach with null) a design system to a project. Owner-scoped. */
export async function setProjectDesignSystem(
  id: string,
  ownerId: string,
  designSystemId: string | null,
): Promise<void> {
  await assertProjectRole(id, ownerId, "admin");
  const { error } = await db()
    .from("projects")
    .update({ design_system_id: designSystemId })
    .eq("id", id);
  if (error) throw new Error(`setProjectDesignSystem failed: ${error.message}`);
}

/** Set the project's attached library skills (uuid[]). Owner-scoped. */
export async function setProjectSkillLibraries(
  id: string,
  ownerId: string,
  skillIds: string[],
): Promise<void> {
  await assertProjectRole(id, ownerId, "admin");
  const { error } = await db()
    .from("projects")
    .update({ skill_library_ids: skillIds })
    .eq("id", id);
  if (error) throw new Error(`setProjectSkillLibraries failed: ${error.message}`);
}

/** Mark whether this project's `.uniqus/skills.md` can be injected as prompt guidance. */
export async function setProjectSkillsTrust(
  id: string,
  trust: ProjectSkillsTrust,
): Promise<void> {
  const { error } = await db().from("projects").update({ skills_trust: trust }).eq("id", id);
  if (!error) return;
  // Keep old, not-yet-migrated control planes usable; schema.sql adds the column.
  if (/skills_trust|schema cache|column/i.test(error.message ?? "")) return;
  throw new Error(`setProjectSkillsTrust failed: ${error.message}`);
}

export async function getProject(
  id: string,
  ownerId: string,
): Promise<ProjectRecord | null> {
  const { data, error } = await db()
    .from("projects")
    .select("*, deployments(state, created_at)")
    .eq("id", id)
    .eq("owner_id", ownerId)
    .is("org_id", null)
    .maybeSingle();
  if (error) throw new Error(`getProject failed: ${error.message}`);
  if (!data) return null;
  return withLatestDeploy(
    data as Record<string, unknown> & { deployments?: EmbeddedDeploymentRow[] | null },
  );
}

/** Internal project read for background workers that do not have an HTTP actor. */
export async function getProjectById(id: string): Promise<ProjectRecord | null> {
  const { data, error } = await db()
    .from("projects")
    .select("*, deployments(state, created_at)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getProjectById failed: ${error.message}`);
  if (!data) return null;
  return withLatestDeploy(
    data as Record<string, unknown> & { deployments?: EmbeddedDeploymentRow[] | null },
  );
}

/**
 * Membership-aware project read for the HTTP/WS layer (P3.2 collaboration).
 *
 * Returns the project iff the acting user holds at least `minRole` on it — the
 * a personal owner is implicit; shared access comes from `project_members` /
 * org membership via getProjectRole. `minRole` defaults to `"owner"`, so a bare
 * call is identical to owner-only getProject and any route that doesn't opt into
 * a lower role stays owner-only (fail-safe: a missed route is under-permissive,
 * never an escalation).
 *
 * Authorization always resolves the effective role first. This is load-bearing
 * for org projects, where the historical creator column is not authority.
 */
export async function getProjectForUser(
  id: string,
  userId: string,
  minRole: Role = "owner",
): Promise<ProjectRecord | null> {
  const role = await getProjectRole(id, userId);
  if (!roleAtLeast(role, minRole)) return null;
  return getProjectById(id);
}

export async function touchProject(id: string): Promise<void> {
  await db().from("projects").update({}).eq("id", id);
}

/**
 * Patch any subset of user-editable project fields. Only `name`,
 * `description`, and `icon` are mutable here; `owner_id`, timestamps, and
 * the Vercel link are managed by their own code paths.
 *
 * Validates ownership server-side via the chained `.eq("owner_id", ...)`
 * — without that, a user could rename someone else's project by guessing
 * the UUID.
 */
export async function updateProject(
  id: string,
  ownerId: string,
  patch: { name?: string; description?: string | null; icon?: string | null },
): Promise<ProjectRecord> {
  await assertProjectRole(id, ownerId, "admin");
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.icon !== undefined) update.icon = patch.icon;
  if (Object.keys(update).length === 0) {
    throw new Error("updateProject called with no patch fields");
  }
  const { data, error } = await db()
    .from("projects")
    .update(update)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) throw new Error(`updateProject failed: ${error?.message}`);
  return data as ProjectRecord;
}

/**
 * Hard-delete a project row. Used to roll back an import (GitHub or zip) that
 * failed after the row was created — without this, the user is left with an
 * empty project they have to manually delete before they can retry.
 *
 * The schema has ON DELETE CASCADE on messages/projects, so this also clears
 * any messages that may have been seeded for the doomed project.
 */
export async function deleteProject(id: string, ownerId: string): Promise<void> {
  await assertProjectRole(id, ownerId, "owner");
  const { error } = await db()
    .from("projects")
    .delete()
    .eq("id", id);
  if (error) throw new Error(`deleteProject failed: ${error.message}`);
}

/**
 * Stamp the GitHub repo link onto the row after the user creates one through
 * the workspace topbar. Surfaced in the All Projects view's card so the user
 * can jump back to the repo on github.com without remembering the URL.
 */
export async function setGithubRepo(
  id: string,
  ownerId: string,
  url: string,
  fullName: string,
): Promise<void> {
  await assertProjectRole(id, ownerId, "admin");
  const { error } = await db()
    .from("projects")
    .update({
      github_repo_url: url,
      github_repo_full_name: fullName,
    })
    .eq("id", id);
  if (error) throw new Error(`setGithubRepo failed: ${error.message}`);
}

/**
 * Record git tracking metadata captured by a preserveGit import (P1.1): the
 * checked-out branch and the (PAT-free) origin URL. Owner-scoped. Either field
 * may be null when it couldn't be determined.
 */
export async function setProjectGitMeta(
  id: string,
  ownerId: string,
  meta: { branch?: string | null; remoteUrl?: string | null },
): Promise<void> {
  await assertProjectRole(id, ownerId, "editor");
  const patch: Record<string, string | null> = {};
  if (meta.branch !== undefined) patch.linked_branch = meta.branch;
  if (meta.remoteUrl !== undefined) patch.github_remote_url = meta.remoteUrl;
  if (Object.keys(patch).length === 0) return;
  const { error } = await db().from("projects").update(patch).eq("id", id);
  if (error) throw new Error(`setProjectGitMeta failed: ${error.message}`);
}

/** Update just the tracked branch for a project (P1.2 branch switcher). Owner-scoped. */
export async function updateProjectLinkedBranch(id: string, ownerId: string, branch: string): Promise<void> {
  await assertProjectRole(id, ownerId, "editor");
  const { error } = await db().from("projects").update({ linked_branch: branch }).eq("id", id);
  if (error) throw new Error(`updateProjectLinkedBranch failed: ${error.message}`);
}

/**
 * Clear the GitHub repo link from a project. Used by the workspace topbar's
 * "Disconnect repo" action — e.g. after the user deleted the repo on GitHub and
 * is otherwise stuck pointing at a now-404 URL with no way to relink. Nulls both
 * columns so the create-repo path (which 409s when a repo is already linked) is
 * available again.
 */
export async function clearGithubRepo(id: string, ownerId: string): Promise<void> {
  await assertProjectRole(id, ownerId, "admin");
  const { error } = await db()
    .from("projects")
    .update({
      github_repo_url: null,
      github_repo_full_name: null,
    })
    .eq("id", id);
  if (error) throw new Error(`clearGithubRepo failed: ${error.message}`);
}

/**
 * Stamp the Vercel project link onto the row after the first successful deploy.
 * Subsequent deploys hit the same project so the dashboard URL stays stable
 * and Vercel doesn't create per-deploy projects.
 */
export async function setVercelProject(
  id: string,
  ownerId: string,
  vercelProjectId: string,
  vercelProjectName: string,
): Promise<void> {
  await assertProjectRole(id, ownerId, "editor");
  const { error } = await db()
    .from("projects")
    .update({
      vercel_project_id: vercelProjectId,
      vercel_project_name: vercelProjectName,
    })
    .eq("id", id);
  if (error) throw new Error(`setVercelProject failed: ${error.message}`);
}

/**
 * Link a Supabase project (ref + name + org) onto a uniqus project after the
 * agent provisions or attaches one. The keys/connection string live in
 * project_secrets, not here. ownerId-scoped so a connector can only touch the
 * acting user's own project row.
 */
export async function setSupabaseProject(
  id: string,
  ownerId: string,
  link: { ref: string; name: string; orgId: string | null },
): Promise<void> {
  await assertProjectRole(id, ownerId, "editor");
  const { error } = await db()
    .from("projects")
    .update({
      supabase_project_ref: link.ref,
      supabase_project_name: link.name,
      supabase_org_id: link.orgId,
    })
    .eq("id", id);
  if (error) throw new Error(`setSupabaseProject failed: ${error.message}`);
}

/**
 * Move every project owned by `fromOwnerId` to `toOwnerId`. This is the core
 * of guest→WorkOS conversion: the guest's projects — and, via their unchanged
 * project_id FKs, all their messages, chat sessions, secrets and audit events
 * — become the real account's, with nothing lost. Returns the count moved.
 */
export async function reassignProjectsOwner(
  fromOwnerId: string,
  toOwnerId: string,
): Promise<number> {
  const { data, error } = await db()
    .from("projects")
    .update({ owner_id: toOwnerId })
    .eq("owner_id", fromOwnerId)
    .is("org_id", null)
    .select("id");
  if (error) throw new Error(`reassignProjectsOwner failed: ${error.message}`);
  return (data ?? []).length;
}

/** Internal rollback primitive for a project created by the same request. */
export async function deleteProjectByIdForRollback(id: string): Promise<void> {
  const { error } = await db().from("projects").delete().eq("id", id);
  if (error) throw new Error(`deleteProjectByIdForRollback failed: ${error.message}`);
}

/** Transfer a personal project to another existing account. */
export async function transferPersonalProjectOwnership(
  id: string,
  currentOwnerId: string,
  nextOwnerId: string,
): Promise<void> {
  const { data, error } = await db()
    .from("projects")
    .update({ owner_id: nextOwnerId })
    .eq("id", id)
    .eq("owner_id", currentOwnerId)
    .is("org_id", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`transferPersonalProjectOwnership failed: ${error.message}`);
  if (!data) throw new Error("personal project owner access required");
  await db().from("project_members").delete().eq("project_id", id).eq("user_id", nextOwnerId);
}
