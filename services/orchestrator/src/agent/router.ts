/**
 * Multi-provider model routing (Plan §5).
 *
 * Phase-2 default: Claude Opus 4.7 for the agent loop and plan-mode, Sonnet
 * 4.6 for the future execute-mode default, Haiku 4.5 for compaction /
 * classification. The "router behind a clean interface" decision in §2 means
 * the agent loop never names a vendor — it asks the router for a model by
 * role, and the router resolves it.
 *
 * Per-project / per-turn overrides land via env vars or future per-project
 * settings; the agent loop, plan-mode, and classification stay Claude-only
 * by default per Plan §5: "Driven by user demand, not a wholesale Claude
 * replacement. Explicit 'results may vary' warning when overriding."
 *
 * Today the router only resolves model IDs and exposes the active provider
 * — actual cross-provider request shapes (OpenAI / Gemini / OSS) come
 * through the same interface when a customer demands them. The shape is
 * intentionally tight so a future provider plugs in without touching loop.ts.
 */

export type ModelRole =
  | "agent" // long tool-use loop
  | "plan" // plan-mode (Opus by default)
  | "compact" // history summarizer (Haiku)
  | "classify"; // routing / diagnose / lightweight

export type Provider = "anthropic" | "openai" | "google";

export interface ResolvedModel {
  provider: Provider;
  model: string;
  /** Set when overridden via env / per-project settings. UI should warn. */
  overridden: boolean;
}

const DEFAULTS: Record<ModelRole, ResolvedModel> = {
  agent: { provider: "anthropic", model: "claude-opus-4-7", overridden: false },
  plan: { provider: "anthropic", model: "claude-opus-4-7", overridden: false },
  compact: { provider: "anthropic", model: "claude-haiku-4-5-20251001", overridden: false },
  classify: { provider: "anthropic", model: "claude-haiku-4-5-20251001", overridden: false },
};

/**
 * Env-var overrides. Examples:
 *   UNIQUS_MODEL_AGENT=claude-sonnet-4-6
 *   UNIQUS_MODEL_PLAN=anthropic:claude-opus-4-7
 *   UNIQUS_MODEL_COMPACT=openai:gpt-4o-mini
 *
 * Format: optional "<provider>:" prefix; bare model names default to anthropic.
 */
function fromEnv(role: ModelRole): ResolvedModel | null {
  const key = `UNIQUS_MODEL_${role.toUpperCase()}`;
  const raw = process.env[key];
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const colonAt = trimmed.indexOf(":");
  if (colonAt > 0) {
    const provider = trimmed.slice(0, colonAt).toLowerCase() as Provider;
    const model = trimmed.slice(colonAt + 1).trim();
    if ((provider === "anthropic" || provider === "openai" || provider === "google") && model) {
      return { provider, model, overridden: true };
    }
  }
  return { provider: "anthropic", model: trimmed, overridden: true };
}

export function resolveModel(role: ModelRole): ResolvedModel {
  return fromEnv(role) ?? DEFAULTS[role];
}

export function modelForRole(role: ModelRole): string {
  return resolveModel(role).model;
}

/**
 * Mark a model as non-Anthropic so callers can refuse to call Anthropic-shaped
 * helpers with a foreign model ID. The agent loop today only knows Anthropic;
 * a future cross-provider adapter lives behind this guard.
 */
export function ensureAnthropic(role: ModelRole): string {
  const m = resolveModel(role);
  if (m.provider !== "anthropic") {
    throw new Error(
      `Role '${role}' is configured for ${m.provider} (${m.model}), but this code path only supports Anthropic. ` +
        `Either revert ${`UNIQUS_MODEL_${role.toUpperCase()}`} to a Claude model, or extend the router with a provider adapter.`,
    );
  }
  return m.model;
}
