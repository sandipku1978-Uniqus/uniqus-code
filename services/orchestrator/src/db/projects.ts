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
