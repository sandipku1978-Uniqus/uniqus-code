import { db } from "./client.js";

export interface ProjectRecord {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
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
