import { randomUUID } from "node:crypto";
import { db } from "./client.js";
import { decryptToken, encryptToken } from "../auth/encrypt.js";

/** Columns that make up a UserRecord — shared by every query that returns one. */
const USER_COLUMNS = "id, workos_id, email, display_name, account_type, converted_at, guest_lifecycle_claim";

function userCredentialContext(userId: string, purpose: string): string {
  return `user-credential:${userId}:${purpose}`;
}

export interface UserRecord {
  id: string;
  /** NULL for guest accounts — they have no WorkOS identity. */
  workos_id: string | null;
  email: string;
  display_name: string | null;
  account_type: "standard" | "guest";
  /** Set when a guest signs in with Google and their projects move across. */
  converted_at: string | null;
  /** Non-null while conversion or irreversible cleanup exclusively owns the row. */
  guest_lifecycle_claim: string | null;
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
  const ciphertext = encryptToken(token, userCredentialContext(userId, "github-access"));
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
  const ciphertext = encryptToken(token, userCredentialContext(userId, "vercel-access"));
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
    return decryptToken(
      data.vercel_access_token as string,
      userCredentialContext(userId, "vercel-access"),
    );
  } catch (err) {
    console.error(`getVercelToken decrypt failed for user ${userId}:`, err);
    return null;
  }
}

// ── Supabase ────────────────────────────────────────────────────────────────
// Differs from Vercel: access tokens expire (~1h) and refresh tokens rotate, so
// we store BOTH (encrypted) plus an expiry, and supabase.ts refreshes on demand.

export interface SupabaseLink {
  org_id: string | null;
  org_name: string | null;
  connected_at: string;
}

export interface SupabaseTokens {
  access_token: string;
  refresh_token: string;
  /** Epoch ms at which the access token expires. */
  expires_at: number;
  /** Opaque compare-and-swap generation for rotated refresh credentials. */
  generation: string;
}

/** Persist the full token set after the initial OAuth exchange (sets org + connected_at). */
export async function setSupabaseToken(
  userId: string,
  tokens: { access_token: string; refresh_token: string; expires_in: number },
  org: { id: string | null; name: string | null },
): Promise<void> {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const { error } = await db()
    .from("users")
    .update({
      supabase_access_token: encryptToken(
        tokens.access_token,
        userCredentialContext(userId, "supabase-access"),
      ),
      supabase_refresh_token: encryptToken(
        tokens.refresh_token,
        userCredentialContext(userId, "supabase-refresh"),
      ),
      supabase_token_expires_at: expiresAt,
      supabase_token_generation: randomUUID(),
      supabase_org_id: org.id,
      supabase_org_name: org.name,
      supabase_connected_at: new Date().toISOString(),
    })
    .eq("id", userId);
  if (error) throw new Error(`setSupabaseToken failed: ${error.message}`);
}

/** Persist only the rotated tokens after a refresh — leaves org/connected_at alone. */
export async function updateSupabaseTokens(
  userId: string,
  tokens: { access_token: string; refresh_token: string; expires_in: number },
  expectedGeneration: string,
): Promise<boolean> {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const { data, error } = await db()
    .from("users")
    .update({
      supabase_access_token: encryptToken(
        tokens.access_token,
        userCredentialContext(userId, "supabase-access"),
      ),
      supabase_refresh_token: encryptToken(
        tokens.refresh_token,
        userCredentialContext(userId, "supabase-refresh"),
      ),
      supabase_token_expires_at: expiresAt,
      supabase_token_generation: randomUUID(),
    })
    .eq("id", userId)
    .eq("supabase_token_generation", expectedGeneration)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`updateSupabaseTokens failed: ${error.message}`);
  return Boolean(data);
}

export async function clearSupabaseToken(userId: string): Promise<void> {
  const { error } = await db()
    .from("users")
    .update({
      supabase_access_token: null,
      supabase_refresh_token: null,
      supabase_token_expires_at: null,
      supabase_token_generation: randomUUID(),
      supabase_org_id: null,
      supabase_org_name: null,
      supabase_connected_at: null,
    })
    .eq("id", userId);
  if (error) throw new Error(`clearSupabaseToken failed: ${error.message}`);
}

/** Connection metadata for the status endpoint / UI. Null when not connected. */
export async function getSupabaseLink(userId: string): Promise<SupabaseLink | null> {
  const { data, error } = await db()
    .from("users")
    .select(
      "supabase_org_id, supabase_org_name, supabase_connected_at, supabase_access_token",
    )
    .eq("id", userId)
    .single();
  if (error || !data?.supabase_access_token) return null;
  return {
    org_id: (data.supabase_org_id as string | null) ?? null,
    org_name: (data.supabase_org_name as string | null) ?? null,
    connected_at: data.supabase_connected_at as string,
  };
}

/** Decrypt the stored access+refresh tokens (+ expiry). supabase.ts refreshes when stale. */
export async function getSupabaseTokens(userId: string): Promise<SupabaseTokens | null> {
  const { data, error } = await db()
    .from("users")
    .select(
      "supabase_access_token, supabase_refresh_token, supabase_token_expires_at, supabase_token_generation",
    )
    .eq("id", userId)
    .single();
  if (error || !data?.supabase_access_token || !data?.supabase_refresh_token) return null;
  try {
    return {
      access_token: decryptToken(
        data.supabase_access_token as string,
        userCredentialContext(userId, "supabase-access"),
      ),
      refresh_token: decryptToken(
        data.supabase_refresh_token as string,
        userCredentialContext(userId, "supabase-refresh"),
      ),
      expires_at: data.supabase_token_expires_at
        ? new Date(data.supabase_token_expires_at as string).getTime()
        : 0,
      generation: data.supabase_token_generation as string,
    };
  } catch (err) {
    console.error(`getSupabaseTokens decrypt failed for user ${userId}:`, err);
    return null;
  }
}

// ── Figma ─────────────────────────────────────────────────────────────────
// Like Supabase: access tokens expire and a refresh token is issued, so we
// store both (encrypted) + an expiry and refresh on demand (see figma.ts).

export interface FigmaLink {
  handle: string | null;
  connected_at: string;
}

export interface FigmaTokens {
  access_token: string;
  refresh_token: string;
  /** Epoch ms at which the access token expires. */
  expires_at: number;
  /** Opaque compare-and-swap generation for rotated refresh credentials. */
  generation: string;
}

export async function setFigmaToken(
  userId: string,
  tokens: { access_token: string; refresh_token: string; expires_in: number },
  handle: string | null,
): Promise<void> {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const { error } = await db()
    .from("users")
    .update({
      figma_access_token: encryptToken(
        tokens.access_token,
        userCredentialContext(userId, "figma-access"),
      ),
      figma_refresh_token: encryptToken(
        tokens.refresh_token,
        userCredentialContext(userId, "figma-refresh"),
      ),
      figma_token_expires_at: expiresAt,
      figma_token_generation: randomUUID(),
      figma_handle: handle,
      figma_connected_at: new Date().toISOString(),
    })
    .eq("id", userId);
  if (error) throw new Error(`setFigmaToken failed: ${error.message}`);
}

export async function updateFigmaTokens(
  userId: string,
  tokens: { access_token: string; refresh_token: string; expires_in: number },
  expectedGeneration: string,
): Promise<boolean> {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const { data, error } = await db()
    .from("users")
    .update({
      figma_access_token: encryptToken(
        tokens.access_token,
        userCredentialContext(userId, "figma-access"),
      ),
      figma_refresh_token: encryptToken(
        tokens.refresh_token,
        userCredentialContext(userId, "figma-refresh"),
      ),
      figma_token_expires_at: expiresAt,
      figma_token_generation: randomUUID(),
    })
    .eq("id", userId)
    .eq("figma_token_generation", expectedGeneration)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`updateFigmaTokens failed: ${error.message}`);
  return Boolean(data);
}

export async function clearFigmaToken(userId: string): Promise<void> {
  const { error } = await db()
    .from("users")
    .update({
      figma_access_token: null,
      figma_refresh_token: null,
      figma_token_expires_at: null,
      figma_token_generation: randomUUID(),
      figma_handle: null,
      figma_connected_at: null,
    })
    .eq("id", userId);
  if (error) throw new Error(`clearFigmaToken failed: ${error.message}`);
}

export async function getFigmaLink(userId: string): Promise<FigmaLink | null> {
  const { data, error } = await db()
    .from("users")
    .select("figma_handle, figma_connected_at, figma_access_token")
    .eq("id", userId)
    .single();
  if (error || !data?.figma_access_token) return null;
  return {
    handle: (data.figma_handle as string | null) ?? null,
    connected_at: data.figma_connected_at as string,
  };
}

export async function getFigmaTokens(userId: string): Promise<FigmaTokens | null> {
  const { data, error } = await db()
    .from("users")
    .select("figma_access_token, figma_refresh_token, figma_token_expires_at, figma_token_generation")
    .eq("id", userId)
    .single();
  if (error || !data?.figma_access_token || !data?.figma_refresh_token) return null;
  try {
    return {
      access_token: decryptToken(
        data.figma_access_token as string,
        userCredentialContext(userId, "figma-access"),
      ),
      refresh_token: decryptToken(
        data.figma_refresh_token as string,
        userCredentialContext(userId, "figma-refresh"),
      ),
      expires_at: data.figma_token_expires_at
        ? new Date(data.figma_token_expires_at as string).getTime()
        : 0,
      generation: data.figma_token_generation as string,
    };
  } catch (err) {
    console.error(`getFigmaTokens decrypt failed for user ${userId}:`, err);
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
    return decryptToken(
      data.github_access_token as string,
      userCredentialContext(userId, "github-access"),
    );
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
  /** Library skill ids auto-attached to every new project (Skills tab toggle). */
  default_skill_library_ids: string[];
}

const SETTINGS_COLS = "custom_prompt, default_skills, default_skill_library_ids";

/**
 * Read the account-wide agent customization. Returns empty strings / an empty
 * array (not null) when unset, so callers can treat it as plain data without
 * null checks.
 */
export async function getAccountSettings(
  userId: string,
): Promise<AccountSettingsRecord> {
  const { data, error } = await db()
    .from("users")
    .select(SETTINGS_COLS)
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`getAccountSettings failed: ${error.message}`);
  return {
    custom_prompt: (data?.custom_prompt as string | null) ?? "",
    default_skills: (data?.default_skills as string | null) ?? "",
    default_skill_library_ids: (data?.default_skill_library_ids as string[] | null) ?? [],
  };
}

/**
 * Update account settings. Only the keys present in `patch` are written, so the
 * UI can save the custom prompt, default skills, and default skill library ids
 * independently. Returns the persisted values.
 */
export async function setAccountSettings(
  userId: string,
  patch: Partial<AccountSettingsRecord>,
): Promise<AccountSettingsRecord> {
  const update: Record<string, unknown> = {};
  if (patch.custom_prompt !== undefined) update.custom_prompt = patch.custom_prompt;
  if (patch.default_skills !== undefined) update.default_skills = patch.default_skills;
  if (patch.default_skill_library_ids !== undefined) {
    update.default_skill_library_ids = patch.default_skill_library_ids;
  }

  const { data, error } = await db()
    .from("users")
    .update(update)
    .eq("id", userId)
    .select(SETTINGS_COLS)
    .single();
  if (error || !data) {
    throw new Error(`setAccountSettings failed: ${error?.message ?? "no row returned"}`);
  }
  return {
    custom_prompt: (data.custom_prompt as string | null) ?? "",
    default_skills: (data.default_skills as string | null) ?? "",
    default_skill_library_ids: (data.default_skill_library_ids as string[] | null) ?? [],
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
  recovery_code: string;
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
      guest_recovery_code_enc: encryptToken(
        input.recovery_code,
        userCredentialContext(id, "guest-recovery"),
      ),
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
export async function touchUserActivity(id: string): Promise<boolean> {
  const { data, error } = await db()
    .from("users")
    .update({ last_active_at: new Date().toISOString(), grace_started_at: null })
    .eq("id", id)
    .eq("account_type", "guest")
    .is("converted_at", null)
    .is("guest_lifecycle_claim", null)
    .select("id");
  if (error) throw new Error(`touchUserActivity failed: ${error.message}`);
  return Array.isArray(data) && data.length === 1;
}

/** Atomically win the right to perform irreversible guest cleanup. */
export async function claimGuestForDeletion(
  guestId: string,
  graceDays: number,
  claim: string,
): Promise<boolean> {
  const graceCutoff = new Date(Date.now() - graceDays * 86_400_000).toISOString();
  const { data, error } = await db().rpc("claim_guest_for_deletion", {
    p_guest_id: guestId,
    p_grace_cutoff: graceCutoff,
    p_claim: claim,
  });
  if (error) throw new Error(`claimGuestForDeletion failed: ${error.message}`);
  return data === true;
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
    return decryptToken(
      data.guest_recovery_code_enc as string,
      userCredentialContext(id, "guest-recovery"),
    );
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
 * Hard-delete a user row. Personal projects must go first: their owner_id FK is
 * ON DELETE SET NULL so durable organization projects can survive account
 * offboarding, while projects_personal_owner_required forbids a personal row
 * with no owner. Deleting those projects cascades their sessions/messages/etc.;
 * organization projects remain intact. Used by the guest sweeper after
 * per-project Storage/VM teardown has run.
 */
export async function deleteUser(id: string, lifecycleClaim: string): Promise<void> {
  const { error: projectsError } = await db()
    .from("projects")
    .delete()
    .eq("owner_id", id)
    .is("org_id", null);
  if (projectsError) {
    throw new Error(`deleteUser personal-project cleanup failed: ${projectsError.message}`);
  }
  const { data, error } = await db()
    .from("users")
    .delete()
    .eq("id", id)
    .eq("guest_lifecycle_claim", lifecycleClaim)
    .select("id");
  if (error) throw new Error(`deleteUser failed: ${error.message}`);
  if (!Array.isArray(data) || data.length !== 1) {
    throw new Error("deleteUser failed: guest lifecycle claim was lost");
  }
}
