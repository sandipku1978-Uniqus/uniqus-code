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
 * Phase-2 substrate: simple key/value scoped to a project. Phase-3+ adds
 * per-environment scoping (dev/staging/prod), per-credential view
 * permissions (RBAC, Plan §1.6), and OAuth-token rotation.
 */

export interface SecretRecord {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export async function listSecrets(projectId: string): Promise<SecretRecord[]> {
  const { data, error } = await db()
    .from("project_secrets")
    .select("id, project_id, name, description, created_at, updated_at")
    .eq("project_id", projectId)
    .order("name", { ascending: true });
  if (error) throw new Error(`listSecrets failed: ${error.message}`);
  return (data ?? []) as SecretRecord[];
}

export async function upsertSecret(input: {
  project_id: string;
  name: string;
  value: string;
  description?: string | null;
}): Promise<SecretRecord> {
  const encrypted = encryptToken(input.value);
  const { data, error } = await db()
    .from("project_secrets")
    .upsert(
      {
        project_id: input.project_id,
        name: input.name,
        encrypted_value: encrypted,
        description: input.description ?? null,
      },
      { onConflict: "project_id,name" },
    )
    .select("id, project_id, name, description, created_at, updated_at")
    .single();
  if (error || !data) throw new Error(`upsertSecret failed: ${error?.message}`);
  return data as SecretRecord;
}

export async function getSecretValue(
  projectId: string,
  name: string,
): Promise<string | null> {
  const { data, error } = await db()
    .from("project_secrets")
    .select("encrypted_value")
    .eq("project_id", projectId)
    .eq("name", name)
    .maybeSingle();
  if (error) throw new Error(`getSecretValue failed: ${error.message}`);
  if (!data) return null;
  try {
    return decryptToken((data as { encrypted_value: string }).encrypted_value);
  } catch (err) {
    throw new Error(
      `secret '${name}' could not be decrypted (key changed?): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function deleteSecret(projectId: string, name: string): Promise<void> {
  const { error } = await db()
    .from("project_secrets")
    .delete()
    .eq("project_id", projectId)
    .eq("name", name);
  if (error) throw new Error(`deleteSecret failed: ${error.message}`);
}
