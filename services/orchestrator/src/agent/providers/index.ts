import { AnthropicAdapter } from "./anthropic.js";
import { OpenAIAdapter } from "./openai.js";
import { GoogleAdapter } from "./google.js";
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
  };
}

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
  }
}
