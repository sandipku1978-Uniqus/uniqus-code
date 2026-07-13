import { db } from "./client.js";
import type { SkillLibrary } from "@uniqus/api-types";
import type { AttachedLibrarySkill } from "../agent/skills.js";

/**
 * Global, per-user Skill libraries. Each row is a reusable markdown rule-set the
 * user authors once and attaches to many projects (via projects.skill_library_ids).
 * Attached metadata is advertised to the agent; matching bodies are loaded on
 * demand before the project's own .uniqus/skills.md. All reads/writes are
 * user-scoped — a user can only see and edit their own skills.
 */

const COLS = "id, name, description, body, created_at, updated_at";

function rowToSkill(row: Record<string, unknown>): SkillLibrary {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    body: (row.body as string | null) ?? "",
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export async function listSkillLibraries(userId: string): Promise<SkillLibrary[]> {
  const { data, error } = await db()
    .from("skill_libraries")
    .select(COLS)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`listSkillLibraries failed: ${error.message}`);
  return (data ?? []).map((r) => rowToSkill(r as Record<string, unknown>));
}

export async function getSkillLibrary(userId: string, id: string): Promise<SkillLibrary | null> {
  const { data, error } = await db()
    .from("skill_libraries")
    .select(COLS)
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getSkillLibrary failed: ${error.message}`);
  return data ? rowToSkill(data as Record<string, unknown>) : null;
}

export async function createSkillLibrary(
  userId: string,
  input: { name: string; description?: string | null; body?: string },
): Promise<SkillLibrary> {
  const { data, error } = await db()
    .from("skill_libraries")
    .insert({
      user_id: userId,
      name: input.name,
      description: input.description ?? null,
      body: input.body ?? "",
    })
    .select(COLS)
    .single();
  if (error || !data) throw new Error(`createSkillLibrary failed: ${error?.message}`);
  return rowToSkill(data as Record<string, unknown>);
}

export async function updateSkillLibrary(
  userId: string,
  id: string,
  patch: { name?: string; description?: string | null; body?: string },
): Promise<SkillLibrary | null> {
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.body !== undefined) update.body = patch.body;
  if (Object.keys(update).length === 0) return await getSkillLibrary(userId, id);
  const { data, error } = await db()
    .from("skill_libraries")
    .update(update)
    .eq("user_id", userId)
    .eq("id", id)
    .select(COLS)
    .maybeSingle();
  if (error) throw new Error(`updateSkillLibrary failed: ${error.message}`);
  return data ? rowToSkill(data as Record<string, unknown>) : null;
}

export async function deleteSkillLibrary(userId: string, id: string): Promise<void> {
  const { error } = await db()
    .from("skill_libraries")
    .delete()
    .eq("user_id", userId)
    .eq("id", id);
  if (error) throw new Error(`deleteSkillLibrary failed: ${error.message}`);
}

/**
 * Resolve a project's attached skill-library ids to their markdown bodies, for
 * per-turn prompt injection. Owner-scoped, so a stale/foreign id is silently
 * skipped. Order follows the input ids (the project's attach order). Returns the
 * named bodies so the prompt can label each block.
 */
export async function getAttachedSkillBodies(
  userId: string | null,
  ids: string[] | null | undefined,
): Promise<AttachedLibrarySkill[]> {
  if (!userId || !ids || ids.length === 0) return [];
  const { data, error } = await db()
    .from("skill_libraries")
    .select("id, name, description, body")
    .eq("user_id", userId)
    .in("id", ids);
  if (error) throw new Error(`getAttachedSkillBodies failed: ${error.message}`);
  const byId = new Map<string, AttachedLibrarySkill>();
  for (const r of data ?? []) {
    const row = r as Record<string, unknown>;
    const body = ((row.body as string | null) ?? "").trim();
    if (body) {
      byId.set(row.id as string, {
        id: row.id as string,
        name: (row.name as string) ?? "Skill",
        description: (row.description as string | null) ?? null,
        body,
      });
    }
  }
  // Preserve the project's attach order; drop ids that didn't resolve.
  return ids.map((id) => byId.get(id)).filter((x): x is AttachedLibrarySkill => !!x);
}

/**
 * Validate + dedupe an incoming list of skill ids against the user's library,
 * returning only ids they actually own (mirrors resolveDesignSystemId's ownership
 * check). Used when a project sets its attachments.
 */
export async function resolveOwnedSkillIds(
  userId: string,
  ids: string[] | null | undefined,
): Promise<string[]> {
  if (!ids || ids.length === 0) return [];
  const unique = [...new Set(ids.filter((x) => typeof x === "string" && x))];
  if (unique.length === 0) return [];
  const { data, error } = await db()
    .from("skill_libraries")
    .select("id")
    .eq("user_id", userId)
    .in("id", unique);
  if (error) throw new Error(`resolveOwnedSkillIds failed: ${error.message}`);
  const owned = new Set((data ?? []).map((r) => (r as { id: string }).id));
  return unique.filter((id) => owned.has(id));
}
