import { db } from "./client.js";
import type { DeploymentState } from "./deployments.js";

export interface ProjectRecord {
  id: string;
  owner_id: string;
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
  /** State of the most recent deployment row, surfaced in the All Projects view. */
  latest_deploy_state?: DeploymentState | null;
  /** created_at of the most recent deployment row. */
  latest_deploy_at?: string | null;
  /** Attached global design system (null = none). */
  design_system_id?: string | null;
  /** Attached reusable library skills (uuid[]; empty = none). */
  skill_library_ids?: string[] | null;
  /** Supabase project ref linked to this project, if provisioned. */
  supabase_project_ref?: string | null;
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
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`listProjects failed: ${error.message}`);
  return (data ?? []).map((row) =>
    withLatestDeploy(row as Record<string, unknown> & { deployments?: EmbeddedDeploymentRow[] | null }),
  );
}

export async function createProject(input: {
  owner_id: string;
  name: string;
  description?: string | null;
  design_system_id?: string | null;
  skill_library_ids?: string[] | null;
}): Promise<ProjectRecord> {
  const { data, error } = await db()
    .from("projects")
    .insert({
      owner_id: input.owner_id,
      name: input.name,
      description: input.description ?? null,
      design_system_id: input.design_system_id ?? null,
      skill_library_ids: input.skill_library_ids ?? [],
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`createProject failed: ${error?.message}`);
  return data as ProjectRecord;
}

/** Attach (or detach with null) a design system to a project. Owner-scoped. */
export async function setProjectDesignSystem(
  id: string,
  ownerId: string,
  designSystemId: string | null,
): Promise<void> {
  const { error } = await db()
    .from("projects")
    .update({ design_system_id: designSystemId })
    .eq("id", id)
    .eq("owner_id", ownerId);
  if (error) throw new Error(`setProjectDesignSystem failed: ${error.message}`);
}

/** Set the project's attached library skills (uuid[]). Owner-scoped. */
export async function setProjectSkillLibraries(
  id: string,
  ownerId: string,
  skillIds: string[],
): Promise<void> {
  const { error } = await db()
    .from("projects")
    .update({ skill_library_ids: skillIds })
    .eq("id", id)
    .eq("owner_id", ownerId);
  if (error) throw new Error(`setProjectSkillLibraries failed: ${error.message}`);
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
    .maybeSingle();
  if (error) throw new Error(`getProject failed: ${error.message}`);
  if (!data) return null;
  return withLatestDeploy(
    data as Record<string, unknown> & { deployments?: EmbeddedDeploymentRow[] | null },
  );
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
    .eq("owner_id", ownerId)
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
  const { error } = await db()
    .from("projects")
    .delete()
    .eq("id", id)
    .eq("owner_id", ownerId);
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
  const { error } = await db()
    .from("projects")
    .update({
      github_repo_url: url,
      github_repo_full_name: fullName,
    })
    .eq("id", id)
    .eq("owner_id", ownerId);
  if (error) throw new Error(`setGithubRepo failed: ${error.message}`);
}

/**
 * Clear the GitHub repo link from a project. Used by the workspace topbar's
 * "Disconnect repo" action — e.g. after the user deleted the repo on GitHub and
 * is otherwise stuck pointing at a now-404 URL with no way to relink. Nulls both
 * columns so the create-repo path (which 409s when a repo is already linked) is
 * available again.
 */
export async function clearGithubRepo(id: string, ownerId: string): Promise<void> {
  const { error } = await db()
    .from("projects")
    .update({
      github_repo_url: null,
      github_repo_full_name: null,
    })
    .eq("id", id)
    .eq("owner_id", ownerId);
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
  const { error } = await db()
    .from("projects")
    .update({
      vercel_project_id: vercelProjectId,
      vercel_project_name: vercelProjectName,
    })
    .eq("id", id)
    .eq("owner_id", ownerId);
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
  const { error } = await db()
    .from("projects")
    .update({
      supabase_project_ref: link.ref,
      supabase_project_name: link.name,
      supabase_org_id: link.orgId,
    })
    .eq("id", id)
    .eq("owner_id", ownerId);
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
    .select("id");
  if (error) throw new Error(`reassignProjectsOwner failed: ${error.message}`);
  return (data ?? []).length;
}
