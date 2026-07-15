import { db } from "./client.js";
import { encryptToken, decryptToken } from "../auth/encrypt.js";
import { isModelVisibleProjectConfig } from "../security/projectSecretPolicy.js";

/**
 * Per-project encrypted secrets (Plan §1.6, §6).
 *
 * Values are AES-256-GCM encrypted with OAUTH_TOKEN_ENCRYPTION_KEY (shared
 * with the OAuth-token store — see auth/encrypt.ts). The DB never sees
 * plaintext. Connectors read sensitive credentials server-side and pass
 * ephemeral results to the agent loop. A narrow set of connector-declared
 * public client config (currently Supabase URL + anon key) remains visible so
 * the agent can wire the generated app without exposing privileged values.
 *
 * Per-environment scoping (Phase 2.x): the same secret name can carry
 * different values for `default` / `development` / `staging` / `production`
 * etc. Callers that don't care pass nothing — they read/write the
 * `default` env, which is what every legacy row was migrated to. Callers
 * that DO care specify an env and the API treats it as a separate slot.
 */

/** What env name to use when the caller doesn't supply one. Matches the DB default. */
export const DEFAULT_ENV = "default";

function projectSecretContext(projectId: string, name: string, env: string): string {
  return `project-secret:${projectId}:${env}:${name}`;
}

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
  /** Admin-approved exact hostnames this secret may be sent to by HTTP connector. */
  allowed_hosts: string[];
  created_at: string;
  updated_at: string;
}

const SECRET_RECORD_COLUMNS =
  "id, project_id, name, env, description, allowed_hosts, created_at, updated_at";
const LEGACY_SECRET_RECORD_COLUMNS =
  "id, project_id, name, env, description, created_at, updated_at";

interface DbErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

/** Recognize only the hosted-schema skew caused by the allowed_hosts migration. */
export function isMissingAllowedHostsColumn(error: DbErrorLike | null | undefined): boolean {
  if (!error) return false;
  const detail = [error.message, error.details, error.hint].filter(Boolean).join(" ").toLowerCase();
  return detail.includes("allowed_hosts") && (error.code === "42703" || error.code === "PGRST204");
}

function normalizeSecretRecord(row: Record<string, unknown>): SecretRecord {
  return {
    ...(row as unknown as Omit<SecretRecord, "allowed_hosts">),
    allowed_hosts: normalizeAllowedSecretHosts(
      Array.isArray(row.allowed_hosts)
        ? row.allowed_hosts.filter((host): host is string => typeof host === "string")
        : [],
    ),
  };
}

export async function listSecrets(
  projectId: string,
  env?: string | null,
): Promise<SecretRecord[]> {
  const run = async (withAllowedHosts: boolean) => {
    let query = db()
      .from("project_secrets")
      .select(withAllowedHosts ? SECRET_RECORD_COLUMNS : LEGACY_SECRET_RECORD_COLUMNS)
      .eq("project_id", projectId);
    // Pass env=null explicitly to fetch every env. Pass nothing or a string to
    // filter — defaults to the `default` env so existing single-env callers
    // see the same view they always have.
    if (env !== null) query = query.eq("env", normalizeEnv(env));
    return await query.order("env").order("name", { ascending: true });
  };

  let { data, error } = await run(true);
  if (isMissingAllowedHostsColumn(error)) {
    ({ data, error } = await run(false));
  }
  if (error) throw new Error(`listSecrets failed: ${error.message}`);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(normalizeSecretRecord);
}

export async function upsertSecret(input: {
  project_id: string;
  name: string;
  value: string;
  description?: string | null;
  env?: string | null;
  allowed_hosts?: string[];
}): Promise<SecretRecord> {
  const env = normalizeEnv(input.env);
  const encrypted = encryptToken(
    input.value,
    projectSecretContext(input.project_id, input.name, env),
  );
  const allowedHosts = input.allowed_hosts === undefined
    ? undefined
    : normalizeAllowedSecretHosts(input.allowed_hosts);
  const row: Record<string, unknown> = {
    project_id: input.project_id,
    name: input.name,
    env,
    encrypted_value: encrypted,
    description: input.description ?? null,
  };
  if (allowedHosts !== undefined) row.allowed_hosts = allowedHosts;

  const run = async (withAllowedHosts: boolean) => {
    const candidate = withAllowedHosts
      ? row
      : Object.fromEntries(Object.entries(row).filter(([key]) => key !== "allowed_hosts"));
    return await db()
      .from("project_secrets")
      .upsert(candidate, { onConflict: "project_id,name,env" })
      .select(withAllowedHosts ? SECRET_RECORD_COLUMNS : LEGACY_SECRET_RECORD_COLUMNS)
      .single();
  };

  let { data, error } = await run(true);
  if (isMissingAllowedHostsColumn(error)) {
    if (allowedHosts && allowedHosts.length > 0) {
      throw new Error(
        "upsertSecret failed: project_secrets.allowed_hosts migration is required before saving HTTP destination bindings",
      );
    }
    ({ data, error } = await run(false));
  }
  if (error || !data) throw new Error(`upsertSecret failed: ${error?.message}`);
  return normalizeSecretRecord(data as unknown as Record<string, unknown>);
}

export function normalizeAllowedSecretHosts(hosts: string[]): string[] {
  const normalized = new Set<string>();
  for (const raw of hosts) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    if (raw.includes("*")) throw new Error("secret host bindings cannot contain wildcards");
    let parsed: URL;
    try {
      parsed = new URL(raw.includes("://") ? raw : `https://${raw}`);
    } catch {
      throw new Error(`invalid secret destination host '${raw}'`);
    }
    if (parsed.username || parsed.password) {
      throw new Error("secret destination hosts cannot contain credentials");
    }
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (!hostname) throw new Error(`invalid secret destination host '${raw}'`);
    normalized.add(hostname);
  }
  return [...normalized].sort();
}

export async function getSecretWithBinding(
  projectId: string,
  name: string,
  env?: string | null,
): Promise<{ value: string; allowedHosts: string[] } | null> {
  const e = normalizeEnv(env);
  const run = async (withAllowedHosts: boolean) =>
    await db()
      .from("project_secrets")
      .select(withAllowedHosts ? "encrypted_value, allowed_hosts" : "encrypted_value")
      .eq("project_id", projectId)
      .eq("name", name)
      .eq("env", e)
      .maybeSingle();

  let { data, error } = await run(true);
  if (isMissingAllowedHostsColumn(error)) {
    ({ data, error } = await run(false));
  }
  if (error) throw new Error(`getSecretWithBinding failed: ${error.message}`);
  if (!data) return null;
  return {
    value: decryptToken(
      (data as unknown as { encrypted_value: string }).encrypted_value,
      projectSecretContext(projectId, name, e),
    ),
    allowedHosts: normalizeAllowedSecretHosts(
      ((data as unknown as { allowed_hosts?: string[] }).allowed_hosts ?? []),
    ),
  };
}

/** Sensitive plaintexts used only for last-mile redaction before model context. */
export async function getProjectSecretPlaintexts(projectId: string): Promise<string[]> {
  const { data, error } = await db()
    .from("project_secrets")
    .select("name, env, encrypted_value")
    .eq("project_id", projectId);
  if (error) throw new Error(`getProjectSecretPlaintexts failed: ${error.message}`);
  const values = new Set<string>();
  for (const row of (data ?? []) as { name: string; env: string; encrypted_value: string }[]) {
    if (isModelVisibleProjectConfig(row.name)) continue;
    const value = decryptToken(
      row.encrypted_value,
      projectSecretContext(projectId, row.name, normalizeEnv(row.env)),
    );
    if (value) values.add(value);
  }
  return [...values].sort((a, b) => b.length - a.length);
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
    return decryptToken(
      (data as { encrypted_value: string }).encrypted_value,
      projectSecretContext(projectId, name, e),
    );
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
      out[row.name] = decryptToken(
        row.encrypted_value,
        projectSecretContext(projectId, row.name, e),
      );
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
