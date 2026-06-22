import { db } from "./client.js";
import { encryptToken, decryptToken } from "../auth/encrypt.js";

/**
 * Per-project encrypted secrets (Plan §1.6, §6).
 *
 * Values are AES-256-GCM encrypted with OAUTH_TOKEN_ENCRYPTION_KEY (shared
 * with the OAuth-token store — see auth/encrypt.ts). The DB never sees
 * plaintext. Connectors read secrets server-side and pass ephemeral
 * results to the agent loop; the agent never sees the literal token.
 *
 * Per-environment scoping (Phase 2.x): the same secret name can carry
 * different values for `default` / `development` / `staging` / `production`
 * etc. Callers that don't care pass nothing — they read/write the
 * `default` env, which is what every legacy row was migrated to. Callers
 * that DO care specify an env and the API treats it as a separate slot.
 */

/** What env name to use when the caller doesn't supply one. Matches the DB default. */
export const DEFAULT_ENV = "default";

/** Tightened on env names so we don't end up with "Production" vs "production" duplicates. */
const ENV_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export function normalizeEnv(env: string | null | undefined): string {
  if (env === null || env === undefined) return DEFAULT_ENV;
  const trimmed = env.trim().toLowerCase();
  if (!trimmed) return DEFAULT_ENV;
  if (!ENV_NAME_RE.test(trimmed)) {
    throw new Error(
      `Invalid env name '${env}'. Use lowercase letters/digits/dashes/underscores, ≤32 chars (e.g. 'development', 'staging', 'production').`,
    );
  }
  return trimmed;
}

export interface SecretRecord {
  id: string;
  project_id: string;
  name: string;
  env: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export async function listSecrets(
  projectId: string,
  env?: string | null,
): Promise<SecretRecord[]> {
  let query = db()
    .from("project_secrets")
    .select("id, project_id, name, env, description, created_at, updated_at")
    .eq("project_id", projectId);
  // Pass env=null explicitly to fetch every env. Pass nothing or a string to
  // filter — defaults to the `default` env so existing single-env callers
  // see the same view they always have.
  if (env !== null) {
    query = query.eq("env", normalizeEnv(env));
  }
  const { data, error } = await query.order("env").order("name", { ascending: true });
  if (error) throw new Error(`listSecrets failed: ${error.message}`);
  return (data ?? []) as SecretRecord[];
}

export async function upsertSecret(input: {
  project_id: string;
  name: string;
  value: string;
  description?: string | null;
  env?: string | null;
}): Promise<SecretRecord> {
  const env = normalizeEnv(input.env);
  const encrypted = encryptToken(input.value);
  const { data, error } = await db()
    .from("project_secrets")
    .upsert(
      {
        project_id: input.project_id,
        name: input.name,
        env,
        encrypted_value: encrypted,
        description: input.description ?? null,
      },
      { onConflict: "project_id,name,env" },
    )
    .select("id, project_id, name, env, description, created_at, updated_at")
    .single();
  if (error || !data) throw new Error(`upsertSecret failed: ${error?.message}`);
  return data as SecretRecord;
}

export async function getSecretValue(
  projectId: string,
  name: string,
  env?: string | null,
): Promise<string | null> {
  const e = normalizeEnv(env);
  const { data, error } = await db()
    .from("project_secrets")
    .select("encrypted_value")
    .eq("project_id", projectId)
    .eq("name", name)
    .eq("env", e)
    .maybeSingle();
  if (error) throw new Error(`getSecretValue failed: ${error.message}`);
  if (!data) return null;
  try {
    return decryptToken((data as { encrypted_value: string }).encrypted_value);
  } catch (err) {
    throw new Error(
      `secret '${name}' (env '${e}') could not be decrypted (key changed?): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * All of a project's secrets (one env) as a decrypted name→value map, for
 * syncing into a deploy's env so the live app has the SAME env it had in the
 * preview. Skips any row that fails to decrypt (logs, never logs the value) so
 * one bad secret can't block a deploy.
 */
export async function getProjectSecretsAsEnv(
  projectId: string,
  env?: string | null,
): Promise<Record<string, string>> {
  const e = normalizeEnv(env);
  const { data, error } = await db()
    .from("project_secrets")
    .select("name, encrypted_value")
    .eq("project_id", projectId)
    .eq("env", e);
  if (error) throw new Error(`getProjectSecretsAsEnv failed: ${error.message}`);
  const out: Record<string, string> = {};
  for (const row of (data ?? []) as { name: string; encrypted_value: string }[]) {
    try {
      out[row.name] = decryptToken(row.encrypted_value);
    } catch (err) {
      console.error(`getProjectSecretsAsEnv: skipping secret '${row.name}' (decrypt failed):`, err);
    }
  }
  return out;
}

export async function deleteSecret(
  projectId: string,
  name: string,
  env?: string | null,
): Promise<void> {
  const { error } = await db()
    .from("project_secrets")
    .delete()
    .eq("project_id", projectId)
    .eq("name", name)
    .eq("env", normalizeEnv(env));
  if (error) throw new Error(`deleteSecret failed: ${error.message}`);
}
