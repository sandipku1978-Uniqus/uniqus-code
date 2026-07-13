import { db } from "./client.js";
import { DEFAULT_DESIGN_TOKENS, type DesignSystem, type DesignTokens } from "@gate15/api-types";

/**
 * Global, per-user design systems. The `tokens` JSON is the canonical artifact
 * (shape = DesignTokens in @gate15/api-types); it's injected into the agent's
 * system prompt for any project that attaches the system. All reads/writes are
 * user-scoped — a user can only see and edit their own systems.
 */

const COLS = "id, name, tokens, created_at, updated_at";

function rowToDesignSystem(row: Record<string, unknown>): DesignSystem {
  const tokens =
    row.tokens && typeof row.tokens === "object" && !Array.isArray(row.tokens)
      ? (row.tokens as DesignTokens)
      : DEFAULT_DESIGN_TOKENS;
  return {
    id: row.id as string,
    name: row.name as string,
    tokens,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export async function listDesignSystems(userId: string): Promise<DesignSystem[]> {
  const { data, error } = await db()
    .from("design_systems")
    .select(COLS)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`listDesignSystems failed: ${error.message}`);
  return (data ?? []).map((r) => rowToDesignSystem(r as Record<string, unknown>));
}

export async function getDesignSystem(userId: string, id: string): Promise<DesignSystem | null> {
  const { data, error } = await db()
    .from("design_systems")
    .select(COLS)
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getDesignSystem failed: ${error.message}`);
  return data ? rowToDesignSystem(data as Record<string, unknown>) : null;
}

/** Tokens-only accessor for prompt injection. Null when not found / not the owner. */
export async function getDesignSystemTokens(
  userId: string | null,
  id: string,
): Promise<DesignTokens | null> {
  if (!userId) return null;
  const ds = await getDesignSystem(userId, id);
  return ds ? ds.tokens : null;
}

export async function createDesignSystem(
  userId: string,
  input: { name: string; tokens?: DesignTokens },
): Promise<DesignSystem> {
  const { data, error } = await db()
    .from("design_systems")
    .insert({
      user_id: userId,
      name: input.name,
      tokens: input.tokens ?? DEFAULT_DESIGN_TOKENS,
    })
    .select(COLS)
    .single();
  if (error || !data) throw new Error(`createDesignSystem failed: ${error?.message}`);
  return rowToDesignSystem(data as Record<string, unknown>);
}

export async function updateDesignSystem(
  userId: string,
  id: string,
  patch: { name?: string; tokens?: DesignTokens },
): Promise<DesignSystem | null> {
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.tokens !== undefined) update.tokens = patch.tokens;
  if (Object.keys(update).length === 0) return await getDesignSystem(userId, id);
  const { data, error } = await db()
    .from("design_systems")
    .update(update)
    .eq("user_id", userId)
    .eq("id", id)
    .select(COLS)
    .maybeSingle();
  if (error) throw new Error(`updateDesignSystem failed: ${error.message}`);
  return data ? rowToDesignSystem(data as Record<string, unknown>) : null;
}

export async function deleteDesignSystem(userId: string, id: string): Promise<void> {
  const { error } = await db()
    .from("design_systems")
    .delete()
    .eq("user_id", userId)
    .eq("id", id);
  if (error) throw new Error(`deleteDesignSystem failed: ${error.message}`);
}
