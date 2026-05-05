import { db } from "./client.js";

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
}

export async function listProjects(ownerId: string): Promise<ProjectRecord[]> {
  const { data, error } = await db()
    .from("projects")
    .select("*")
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`listProjects failed: ${error.message}`);
  return (data ?? []) as ProjectRecord[];
}

export async function createProject(input: {
  owner_id: string;
  name: string;
  description?: string | null;
}): Promise<ProjectRecord> {
  const { data, error } = await db()
    .from("projects")
    .insert({
      owner_id: input.owner_id,
      name: input.name,
      description: input.description ?? null,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`createProject failed: ${error?.message}`);
  return data as ProjectRecord;
}

export async function getProject(
  id: string,
  ownerId: string,
): Promise<ProjectRecord | null> {
  const { data, error } = await db()
    .from("projects")
    .select("*")
    .eq("id", id)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw new Error(`getProject failed: ${error.message}`);
  return (data ?? null) as ProjectRecord | null;
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
