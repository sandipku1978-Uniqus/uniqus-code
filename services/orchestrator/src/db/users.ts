import { randomUUID } from "node:crypto";
import { db } from "./client.js";
import { decryptToken, encryptToken } from "../auth/encrypt.js";

/** Columns that make up a UserRecord — shared by every query that returns one. */
const USER_COLUMNS = "id, workos_id, email, display_name, account_type, converted_at";

export interface UserRecord {
  id: string;
  /** NULL for guest accounts — they have no WorkOS identity. */
  workos_id: string | null;
  email: string;
  display_name: string | null;
  account_type: "standard" | "guest";
  /** Set when a guest signs in with Google and their projects move across. */
  converted_at: string | null;
}

export interface GithubLink {
  login: string;
  connected_at: string;
}

export interface VercelLink {
  user_id: string;
  user_login: string;
  team_id: string | null;
  connected_at: string;
}

/**
 * Look up a user by their WorkOS ID; create the row if it doesn't exist.
 * Called on every authenticated WS connection.
 */
export async function upsertUser(input: {
  workos_id: string;
  email: string;
  display_name?: string | null;
}): Promise<UserRecord> {
  const { data, error } = await db()
    .from("users")
    .upsert(
      {
        workos_id: input.workos_id,
        email: input.email,
        display_name: input.display_name ?? null,
        // WorkOS-identity rows are always standard accounts — be explicit
        // rather than relying on the column default.
        account_type: "standard",
      },
      { onConflict: "workos_id" },
    )
    .select(USER_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(`upsertUser failed: ${error?.message ?? "no row returned"}`);
  }
  return data as UserRecord;
}

/**
 * Persist a GitHub access token for a user. The token is encrypted at rest
 * with the orchestrator's key — Supabase only ever sees ciphertext.
 */
export async function setGithubToken(
  userId: string,
  token: string,
  login: string,
): Promise<void> {
  const ciphertext = encryptToken(token);
  const { error } = await db()
    .from("users")
    .update({
      github_access_token: ciphertext,
      github_login: login,
      github_connected_at: new Date().toISOString(),
    })
    .eq("id", userId);
  if (error) throw new Error(`setGithubToken failed: ${error.message}`);
}

export async function clearGithubToken(userId: string): Promise<void> {
  const { error } = await db()
    .from("users")
    .update({
      github_access_token: null,
      github_login: null,
      github_connected_at: null,
    })
    .eq("id", userId);
  if (error) throw new Error(`clearGithubToken failed: ${error.message}`);
}

export async function getGithubLink(userId: string): Promise<GithubLink | null> {
  const { data, error } = await db()
    .from("users")
    .select("github_login, github_connected_at, github_access_token")
    .eq("id", userId)
    .single();
  if (error || !data) return null;
  if (!data.github_login || !data.github_access_token) return null;
  return {
    login: data.github_login as string,
    connected_at: data.github_connected_at as string,
  };
}

// ── Vercel ────────────────────────────────────────────────────────────────────

export async function setVercelToken(
  userId: string,
  token: string,
  vercelUser: { id: string; username: string },
  teamId: string | null,
): Promise<void> {
  const ciphertext = encryptToken(token);
  const { error } = await db()
    .from("users")
    .update({
      vercel_access_token: ciphertext,
      vercel_user_id: vercelUser.id,
      vercel_user_login: vercelUser.username,
      vercel_team_id: teamId,
      vercel_connected_at: new Date().toISOString(),
    })
    .eq("id", userId);
  if (error) throw new Error(`setVercelToken failed: ${error.message}`);
}

export async function clearVercelToken(userId: string): Promise<void> {
  const { error } = await db()
    .from("users")
    .update({
      vercel_access_token: null,
      vercel_user_id: null,
      vercel_user_login: null,
      vercel_team_id: null,
      vercel_connected_at: null,
    })
    .eq("id", userId);
  if (error) throw new Error(`clearVercelToken failed: ${error.message}`);
}

export async function getVercelLink(userId: string): Promise<VercelLink | null> {
  const { data, error } = await db()
    .from("users")
    .select(
      "vercel_user_id, vercel_user_login, vercel_team_id, vercel_connected_at, vercel_access_token",
    )
    .eq("id", userId)
    .single();
  if (error || !data) return null;
  if (!data.vercel_user_id || !data.vercel_access_token) return null;
  return {
    user_id: data.vercel_user_id as string,
    user_login: (data.vercel_user_login as string) ?? "",
    team_id: (data.vercel_team_id as string | null) ?? null,
    connected_at: data.vercel_connected_at as string,
  };
}

export async function getVercelToken(userId: string): Promise<string | null> {
  const { data, error } = await db()
    .from("users")
    .select("vercel_access_token")
    .eq("id", userId)
    .single();
  if (error || !data?.vercel_access_token) return null;
  try {
    return decryptToken(data.vercel_access_token as string);
  } catch (err) {
    console.error(`getVercelToken decrypt failed for user ${userId}:`, err);
    return null;
  }
}

/**
 * Decrypt and return the user's GitHub access token, or null if not connected.
 * Caller must be the orchestrator on behalf of the authenticated user.
 */
export async function getGithubToken(userId: string): Promise<string | null> {
  const { data, error } = await db()
    .from("users")
    .select("github_access_token")
    .eq("id", userId)
    .single();
  if (error || !data?.github_access_token) return null;
  try {
    return decryptToken(data.github_access_token as string);
  } catch (err) {
    // A decrypt failure typically means the encryption key was rotated
    // without re-encrypting old rows. Treat as "not connected" so the user
    // can re-link, rather than throwing and crashing the request.
    console.error(`getGithubToken decrypt failed for user ${userId}:`, err);
    return null;
  }
}

// ── Account settings (custom prompt + default skills) ──────────────────────────

export interface AccountSettingsRecord {
  /** Account-wide system-prompt addition, injected into the agent every turn. */
  custom_prompt: string;
  /** Skills markdown seeded into `.uniqus/skills.md` of every new project. */
  default_skills: string;
}

/**
 * Read the account-wide agent customization. Returns empty strings (not null)
 * when unset, so callers can treat it as plain text without null checks.
 */
export async function getAccountSettings(
  userId: string,
): Promise<AccountSettingsRecord> {
  const { data, error } = await db()
    .from("users")
    .select("custom_prompt, default_skills")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`getAccountSettings failed: ${error.message}`);
  return {
    custom_prompt: (data?.custom_prompt as string | null) ?? "",
    default_skills: (data?.default_skills as string | null) ?? "",
  };
}

/**
 * Update one or both account settings. Only the keys present in `patch` are
 * written, so the UI can save the custom prompt and default skills
 * independently. Returns the persisted values.
 */
export async function setAccountSettings(
  userId: string,
  patch: Partial<AccountSettingsRecord>,
): Promise<AccountSettingsRecord> {
  const update: Record<string, string> = {};
  if (patch.custom_prompt !== undefined) update.custom_prompt = patch.custom_prompt;
  if (patch.default_skills !== undefined) update.default_skills = patch.default_skills;

  const { data, error } = await db()
    .from("users")
    .update(update)
    .eq("id", userId)
    .select("custom_prompt, default_skills")
    .single();
  if (error || !data) {
    throw new Error(`setAccountSettings failed: ${error?.message ?? "no row returned"}`);
  }
  return {
    custom_prompt: (data.custom_prompt as string | null) ?? "",
    default_skills: (data.default_skills as string | null) ?? "",
  };
}

// ── Guest / education accounts ────────────────────────────────────────────────

/**
 * Look up any user by primary key. Used by the guest auth path in
 * authenticate() — the guest cookie carries the users.id and we resolve the
 * row from it (the WorkOS path uses upsertUser keyed on workos_id instead).
 */
export async function getUserById(id: string): Promise<UserRecord | null> {
  const { data, error } = await db()
    .from("users")
    .select(USER_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getUserById failed: ${error.message}`);
  return (data ?? null) as UserRecord | null;
}

/**
 * Create a fresh guest account. Guests have no WorkOS identity and no real
 * email — the email column is NOT NULL, so we store a synthetic .invalid
 * address (never shown; display_name is what the UI renders). The recovery
 * code arrives already hashed (for the restore lookup) and encrypted (for
 * re-display) from auth/guest.ts.
 */
export async function createGuestUser(input: {
  display_name: string;
  recovery_hash: string;
  recovery_code_enc: string;
}): Promise<UserRecord> {
  const id = randomUUID();
  const { data, error } = await db()
    .from("users")
    .insert({
      id,
      workos_id: null,
      email: `guest-${id}@guest.invalid`,
      display_name: input.display_name,
      account_type: "guest",
      guest_recovery_hash: input.recovery_hash,
      guest_recovery_code_enc: input.recovery_code_enc,
      last_active_at: new Date().toISOString(),
    })
    .select(USER_COLUMNS)
    .single();
  if (error || !data) throw new Error(`createGuestUser failed: ${error?.message}`);
  return data as UserRecord;
}

/**
 * Resolve a guest account from the sha256 of its recovery code. Returns null
 * for an unknown code, a non-guest row, or a guest that has already converted
 * (convert nulls the recovery columns, but guard converted_at too).
 */
export async function getGuestByRecoveryHash(
  hash: string,
): Promise<UserRecord | null> {
  const { data, error } = await db()
    .from("users")
    .select(USER_COLUMNS)
    .eq("guest_recovery_hash", hash)
    .maybeSingle();
  if (error) throw new Error(`getGuestByRecoveryHash failed: ${error.message}`);
  if (!data) return null;
  const user = data as UserRecord;
  if (user.account_type !== "guest" || user.converted_at) return null;
  return user;
}

/**
 * Bump last_active_at so the inactivity sweeper doesn't reap an account that's
 * actually in use. Called fire-and-forget from authenticate() on every guest
 * request. Also clears grace_started_at so a guest who returns during the
 * grace window is pulled back out of the deletion queue.
 */
export async function touchUserActivity(id: string): Promise<void> {
  const { error } = await db()
    .from("users")
    .update({ last_active_at: new Date().toISOString(), grace_started_at: null })
    .eq("id", id);
  if (error) throw new Error(`touchUserActivity failed: ${error.message}`);
}

/**
 * Mark a guest account converted: its projects have just been reassigned to a
 * WorkOS account. Null the recovery columns so the dead account can never be
 * re-claimed with the old code.
 */
export async function markGuestConverted(guestId: string): Promise<void> {
  const { error } = await db()
    .from("users")
    .update({
      converted_at: new Date().toISOString(),
      guest_recovery_hash: null,
      guest_recovery_code_enc: null,
    })
    .eq("id", guestId)
    .eq("account_type", "guest");
  if (error) throw new Error(`markGuestConverted failed: ${error.message}`);
}

/**
 * Decrypt and return a guest's own recovery code so the "Show recovery code"
 * affordance can re-display it. The caller must already be authenticated as
 * this guest — holding the session cookie is what authorises the read.
 */
export async function getGuestRecoveryCode(id: string): Promise<string | null> {
  const { data, error } = await db()
    .from("users")
    .select("guest_recovery_code_enc")
    .eq("id", id)
    .maybeSingle();
  if (error || !data?.guest_recovery_code_enc) return null;
  try {
    return decryptToken(data.guest_recovery_code_enc as string);
  } catch (err) {
    console.error(`getGuestRecoveryCode decrypt failed for ${id}:`, err);
    return null;
  }
}

/**
 * Sweeper step 1: move live guests whose last activity is older than
 * `inactiveDays` into the grace window. Single UPDATE — returns the count.
 */
export async function markStaleGuestsForGrace(
  inactiveDays: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - inactiveDays * 86_400_000).toISOString();
  const { data, error } = await db()
    .from("users")
    .update({ grace_started_at: new Date().toISOString() })
    .eq("account_type", "guest")
    .is("converted_at", null)
    .is("grace_started_at", null)
    .lt("last_active_at", cutoff)
    .select("id");
  if (error) throw new Error(`markStaleGuestsForGrace failed: ${error.message}`);
  return (data ?? []).length;
}

/**
 * Sweeper query: guests that have sat in the grace window longer than
 * `graceDays` without being touched or converted — these get hard-deleted.
 */
export async function listGuestsToDelete(graceDays: number): Promise<string[]> {
  const cutoff = new Date(Date.now() - graceDays * 86_400_000).toISOString();
  const { data, error } = await db()
    .from("users")
    .select("id")
    .eq("account_type", "guest")
    .is("converted_at", null)
    .lt("grace_started_at", cutoff);
  if (error) throw new Error(`listGuestsToDelete failed: ${error.message}`);
  return (data ?? []).map((r) => r.id as string);
}

/**
 * Hard-delete a user row. ON DELETE CASCADE clears their projects, messages,
 * chat sessions, deployments and audit events. Used by the guest sweeper after
 * per-project Storage/VM teardown has run.
 */
export async function deleteUser(id: string): Promise<void> {
  const { error } = await db().from("users").delete().eq("id", id);
  if (error) throw new Error(`deleteUser failed: ${error.message}`);
}
