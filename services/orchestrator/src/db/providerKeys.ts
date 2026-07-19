import { db } from "./client.js";
import { encryptToken, decryptToken } from "../auth/encrypt.js";
import {
  providerKeysFromEnv,
  type ProviderKeys,
  type ProviderName,
} from "../agent/providers/index.js";

/**
 * Per-account model-provider keys. Values are encrypted at rest, write-only to
 * clients, and used only by server-side adapters (never placed in a sandbox).
 */
const PROVIDERS: ProviderName[] = ["anthropic", "openai", "google", "zai"];

export function isProviderName(value: string): value is ProviderName {
  return (PROVIDERS as string[]).includes(value);
}

function providerKeyContext(userId: string, provider: ProviderName): string {
  return `account-provider-key:${userId}:${provider}`;
}

export async function listAccountProviderKeys(userId: string): Promise<ProviderName[]> {
  const { data, error } = await db()
    .from("account_provider_keys")
    .select("provider")
    .eq("user_id", userId);
  if (error) throw new Error(`listAccountProviderKeys failed: ${error.message}`);
  return ((data ?? []) as { provider: string }[])
    .map((row) => row.provider)
    .filter(isProviderName);
}

export async function setAccountProviderKey(
  userId: string,
  provider: ProviderName,
  value: string,
): Promise<void> {
  const encrypted = encryptToken(value, providerKeyContext(userId, provider));
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

async function getAccountProviderKeys(
  userId: string,
): Promise<{
  keys: Partial<Record<ProviderName, string>>;
  unreadable: Set<ProviderName>;
}> {
  const { data, error } = await db()
    .from("account_provider_keys")
    .select("provider, encrypted_value")
    .eq("user_id", userId);
  if (error) throw new Error(`getAccountProviderKeys failed: ${error.message}`);
  const keys: Partial<Record<ProviderName, string>> = {};
  const unreadable = new Set<ProviderName>();
  for (const row of (data ?? []) as { provider: string; encrypted_value: string }[]) {
    if (!isProviderName(row.provider)) continue;
    try {
      keys[row.provider] = decryptToken(
        row.encrypted_value,
        providerKeyContext(userId, row.provider),
      );
    } catch (err) {
      // Isolate encryption drift to the affected provider. `choose` still
      // blocks platform fallback for this row, so an unreadable BYOK key can
      // neither break unrelated providers nor become an invisible charge.
      unreadable.add(row.provider);
      console.warn(
        `[provider-keys] stored ${row.provider} key for ${userId} could not be decrypted; replacement required`,
        err,
      );
    }
  }
  return { keys, unreadable };
}

export type ProviderKeySource = "account" | "platform" | "missing";
export type ProviderKeyPolicy = "platform-only" | "account-only" | "account-first";

export interface ResolvedProviderKeys {
  keys: ProviderKeys;
  sources: Record<ProviderName, ProviderKeySource>;
}

/** Resolve credentials under an explicit billing policy, without hidden fallback. */
export async function resolveProviderKeysForUserWithSources(
  userId: string,
  policy: ProviderKeyPolicy,
): Promise<ResolvedProviderKeys> {
  const env = policy === "account-only" ? {} : providerKeysFromEnv();
  const account =
    policy === "platform-only"
      ? { keys: {} as Partial<Record<ProviderName, string>>, unreadable: new Set<ProviderName>() }
      : await getAccountProviderKeys(userId);

  const choose = (provider: ProviderName): { key: string | undefined; source: ProviderKeySource } => {
    const accountKey = account.keys[provider];
    const platformKey = env[provider];
    if (policy !== "platform-only" && accountKey) {
      return { key: accountKey, source: "account" };
    }
    if (policy !== "platform-only" && account.unreadable.has(provider)) {
      return { key: undefined, source: "missing" };
    }
    if (policy !== "account-only" && platformKey) {
      return { key: platformKey, source: "platform" };
    }
    return { key: undefined, source: "missing" };
  };

  const anthropic = choose("anthropic");
  const openai = choose("openai");
  const google = choose("google");
  const zai = choose("zai");
  return {
    // All fields are explicit so downstream code cannot spread env defaults
    // back into an account-only result.
    keys: {
      anthropic: anthropic.key,
      openai: openai.key,
      google: google.key,
      zai: zai.key,
    },
    sources: {
      anthropic: anthropic.source,
      openai: openai.source,
      google: google.source,
      zai: zai.source,
    },
  };
}
