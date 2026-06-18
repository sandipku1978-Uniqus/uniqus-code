import { AnthropicAdapter } from "./anthropic.js";
import { OpenAIAdapter } from "./openai.js";
import { GoogleAdapter } from "./google.js";
import { ZaiAdapter } from "./zai.js";
import { MissingProviderKeyError, type ModelProviderAdapter, type ProviderKeys, type ProviderName } from "./types.js";

export * from "./types.js";

/**
 * Read provider API keys from the environment. Anthropic is required (the
 * product's default + internal compaction/classification); OpenAI and Google
 * are optional and only needed when a user picks one of their models.
 */
export function providerKeysFromEnv(): ProviderKeys {
  return {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    // Accept either of Google's two common env var names.
    google: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY,
    // Z.ai (GLM). `ZAI_API_KEY` is canonical; `GLM_API_KEY` accepted as an alias.
    zai: process.env.ZAI_API_KEY || process.env.GLM_API_KEY,
  };
}

// GLM's 1M-context first-token latency runs well past the SDK's default
// timeout, so give its client a generous ceiling.
const ZAI_TIMEOUT_MS = 10 * 60_000;

/**
 * Build the adapter for a provider, throwing a clear error if that provider's
 * API key isn't configured (so the user sees "set OPENAI_API_KEY" rather than
 * an opaque SDK auth failure).
 */
export function getProvider(provider: ProviderName, keys: ProviderKeys): ModelProviderAdapter {
  switch (provider) {
    case "anthropic":
      if (!keys.anthropic) throw new MissingProviderKeyError("anthropic");
      return new AnthropicAdapter(keys.anthropic);
    case "openai":
      if (!keys.openai) throw new MissingProviderKeyError("openai");
      return new OpenAIAdapter(keys.openai);
    case "google":
      if (!keys.google) throw new MissingProviderKeyError("google");
      return new GoogleAdapter(keys.google);
    case "zai":
      if (!keys.zai) throw new MissingProviderKeyError("zai");
      // GLM runs on Z.ai's OpenAI-style Chat Completions endpoint (where its
      // web_search tool lives). ZAI_BASE_URL overrides for self-hosted/proxy use.
      return new ZaiAdapter(keys.zai, {
        ...(process.env.ZAI_BASE_URL ? { baseURL: process.env.ZAI_BASE_URL } : {}),
        timeout: ZAI_TIMEOUT_MS,
      });
  }
}
