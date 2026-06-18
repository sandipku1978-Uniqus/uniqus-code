import { db } from "./client.js";
import { encryptToken, decryptToken } from "../auth/encrypt.js";
import { providerKeysFromEnv, type ProviderKeys, type ProviderName } from "../agent/providers/index.js";

/**
 * Bring-Your-Own-Key (F7): per-account provider API keys.
 *
 * Encrypted with the SAME AES-256-GCM helper as project secrets / OAuth tokens
 * (auth/encrypt.ts). The DB never stores plaintext, the value is never returned
 * to the client (only WHICH providers have a key), and the key never enters the
 * sandbox/agent context — it's used only to construct the provider adapter
 * server-side. When an account has a key for a provider it is preferred over the
 * platform env key; otherwise we fall back to the platform key.
 */

const PROVIDERS: ProviderName[] = ["anthropic", "openai", "google"];

export function isProviderName(v: string): v is ProviderName {
  return (PROVIDERS as string[]).includes(v);
}

/** Which providers this account has a stored key for (names only, never values). */
export async function listAccountProviderKeys(userId: string): Promise<ProviderName[]> {
  const { data, error } = await db()
    .from("account_provider_keys")
    .select("provider")
    .eq("user_id", userId);
  if (error) throw new Error(`listAccountProviderKeys failed: ${error.message}`);
  return ((data ?? []) as { provider: string }[])
    .map((r) => r.provider)
    .filter(isProviderName);
}

export async function setAccountProviderKey(
  userId: string,
  provider: ProviderName,
  value: string,
): Promise<void> {
  const encrypted = encryptToken(value);
  const { error } = await db()
    .from("account_provider_keys")
    .upsert(
      { user_id: userId, provider, encrypted_value: encrypted },
      { onConflict: "user_id,provider" },
    );
  if (error) throw new Error(`setAccountProviderKey failed: ${error.message}`);
}

export async function deleteAccountProviderKey(
  userId: string,
  provider: ProviderName,
): Promise<void> {
  const { error } = await db()
    .from("account_provider_keys")
    .delete()
    .eq("user_id", userId)
    .eq("provider", provider);
  if (error) throw new Error(`deleteAccountProviderKey failed: ${error.message}`);
}

/** Decrypted account keys (server-side only). Missing providers are omitted. */
async function getAccountProviderKeys(userId: string): Promise<Partial<Record<ProviderName, string>>> {
  const { data, error } = await db()
    .from("account_provider_keys")
    .select("provider, encrypted_value")
    .eq("user_id", userId);
  if (error) throw new Error(`getAccountProviderKeys failed: ${error.message}`);
  const out: Partial<Record<ProviderName, string>> = {};
  for (const row of (data ?? []) as { provider: string; encrypted_value: string }[]) {
    if (!isProviderName(row.provider)) continue;
    try {
      out[row.provider] = decryptToken(row.encrypted_value);
    } catch {
      // A key encrypted under a rotated master key can't be read — skip it and
      // fall back to the platform key rather than failing the whole turn.
    }
  }
  return out;
}

/**
 * Resolve the provider keys for a turn: the account's BYOK key per provider when
 * present, else the platform env key. Used by runSession to build the loop /
 * plan / compaction clients, so a BYOK account's spend lands on THEIR provider
 * account — including compaction and planning, which the plan flags as the easy
 * thing to get wrong.
 */
export async function resolveProviderKeysForUser(userId: string): Promise<ProviderKeys> {
  const env = providerKeysFromEnv();
  let account: Partial<Record<ProviderName, string>> = {};
  try {
    account = await getAccountProviderKeys(userId);
  } catch (err) {
    // Never let a BYOK lookup failure break a turn — fall back to platform keys.
    console.error("resolveProviderKeysForUser failed; using platform keys:", err);
  }
  return {
    anthropic: account.anthropic ?? env.anthropic,
    openai: account.openai ?? env.openai,
    google: account.google ?? env.google,
    // Z.ai (GLM) is platform-env only — it's not in the BYOK `PROVIDERS` list,
    // so there's never an account key to prefer. Must still be threaded through
    // here, or every GLM/Auto-→-GLM turn throws MissingProviderKeyError("zai")
    // despite ZAI_API_KEY being set.
    zai: env.zai,
  };
}
