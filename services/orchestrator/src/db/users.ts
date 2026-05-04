import { db } from "./client.js";
import { decryptToken, encryptToken } from "../auth/encrypt.js";

export interface UserRecord {
  id: string;
  workos_id: string;
  email: string;
  display_name: string | null;
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
      },
      { onConflict: "workos_id" },
    )
    .select("id, workos_id, email, display_name")
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
