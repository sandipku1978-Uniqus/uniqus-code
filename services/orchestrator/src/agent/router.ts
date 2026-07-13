/**
 * Multi-provider model routing (Plan §5).
 *
 * The agent loop, plan-mode, and compaction never name a vendor — they ask
 * the router for a model by ROLE, and the router resolves it to a concrete
 * `{ provider, model }`. A `ModelChoice` from the UI (per-turn) can override
 * the user-facing roles (`agent`, `plan`); the internal roles (`compact`,
 * `classify`) are infrastructure and stay on a fast Claude model regardless.
 *
 * Resolution precedence for `agent`/`plan`:
 *   1. An explicit, valid per-turn `ModelChoice` (the Advanced picker).
 *   2. An ops env override (`UNIQUS_MODEL_<ROLE>`).
 *   3. The "auto" default for that role.
 *
 * "auto" deliberately resolves to a frontier model — never a low/cheap tier.
 * The selectable set lives in `MODEL_CATALOG` (@gate15/api-types) so the web
 * picker and this router share one source of truth.
 */

import {
  MODEL_CATALOG,
  type ModelChoice,
  type ModelProvider,
} from "@gate15/api-types";

export type ModelRole =
  | "agent" // long tool-use loop
  | "plan" // plan-mode
  | "compact" // history summarizer (internal, Claude-only)
  | "classify" // routing / brief-refine / lightweight (internal, Claude-only)
  | "design"; // design-system generation + inference (internal, Claude-only)

export type Provider = ModelProvider;

export interface ResolvedModel {
  provider: Provider;
  model: string;
  /** Set when overridden via the Advanced picker or env. UI shows "results may vary". */
  overridden: boolean;
}

/**
 * "auto" fallbacks. The user-facing roles (agent/plan) prefer GLM-5.2 when a
 * Z.ai key is configured (see resolveModel) and fall back to this map — Claude's
 * flagship — otherwise. The lightweight internal roles (compact/classify) use
 * Haiku: they summarize / classify, never write code, so the "no low tiers for
 * the agent" rule doesn't apply, and they always stay on Claude (compaction
 * speaks the Anthropic shape). `design` is internal but quality-sensitive (it
 * designs a whole system from a brief), so it runs on Sonnet — a clear step up
 * from Haiku without the flagship's cost.
 */
const AUTO: Record<ModelRole, ResolvedModel> = {
  agent: { provider: "anthropic", model: "claude-opus-4-8", overridden: false },
  plan: { provider: "anthropic", model: "claude-opus-4-8", overridden: false },
  compact: { provider: "anthropic", model: "claude-haiku-4-5-20251001", overridden: false },
  classify: { provider: "anthropic", model: "claude-haiku-4-5-20251001", overridden: false },
  design: { provider: "anthropic", model: "claude-sonnet-4-6", overridden: false },
};

const PROVIDERS: ReadonlySet<string> = new Set<ModelProvider>([
  "anthropic",
  "openai",
  "google",
  "zai",
]);

/** Resolve a curated catalog id ("<provider>:<model>") to a concrete model. */
function fromCatalog(choice: string): ResolvedModel | null {
  const opt = MODEL_CATALOG.find((m) => m.id === choice);
  if (!opt) return null;
  return { provider: opt.provider, model: opt.model, overridden: true };
}

/** Parse a freeform "<provider>:<model>" string (env / power-user escape hatch). */
function fromFreeform(raw: string): ResolvedModel | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const colonAt = trimmed.indexOf(":");
  if (colonAt > 0) {
    const provider = trimmed.slice(0, colonAt).toLowerCase();
    const model = trimmed.slice(colonAt + 1).trim();
    if (PROVIDERS.has(provider) && model) {
      return { provider: provider as Provider, model, overridden: true };
    }
    return null;
  }
  // Bare model name → assume Anthropic (back-compat with old env values).
  return { provider: "anthropic", model: trimmed, overridden: true };
}

/**
 * Env-var overrides. Examples:
 *   UNIQUS_MODEL_AGENT=anthropic:claude-opus-4-8
 *   UNIQUS_MODEL_COMPACT=claude-haiku-4-5-20251001
 */
function fromEnv(role: ModelRole): ResolvedModel | null {
  const raw = process.env[`UNIQUS_MODEL_${role.toUpperCase()}`];
  if (!raw) return null;
  return fromFreeform(raw);
}

/** True for "auto" or any value the router can actually resolve. */
export function isValidChoice(choice: string): boolean {
  if (choice === "auto") return true;
  return fromCatalog(choice) !== null || fromFreeform(choice) !== null;
}

/**
 * Resolve the model for a role. `choice` (the per-turn Advanced override) only
 * affects the user-facing `agent`/`plan` roles; internal roles ignore it.
 */
export function resolveModel(role: ModelRole, choice?: ModelChoice): ResolvedModel {
  if ((role === "agent" || role === "plan") && choice && choice !== "auto") {
    const picked = fromCatalog(choice) ?? fromFreeform(choice);
    if (picked) return picked;
    // Unknown/invalid id: fall through to env/auto rather than crash the turn.
  }
  const fromOps = fromEnv(role);
  if (fromOps) return fromOps;
  // "auto" for the user-facing roles returns a STATIC default here; the agent
  // loop and plan mode then refine it per task via agent/autoRouter.ts (route
  // routine work cheap, escalate hard/vision turns). This map is the floor Auto
  // falls back to when task routing finds no signal or is unavailable.
  //
  // NOTE: GLM (zai) and OpenAI are excluded from Auto "for now" — Auto's floor
  // stays Claude (AUTO map) regardless of whether a Z.ai key is set, and
  // autoRouter.ts routes only across Anthropic + Google. GLM/OpenAI remain
  // selectable via the manual picker. To restore the GLM floor, re-add the
  // `hasZaiKey()` branch that returned { provider: "zai", model: "glm-5.2" }.
  return AUTO[role];
}

/**
 * Resolve a role that MUST stay on Anthropic (compaction / classification).
 * Returns the model id and throws if an env override points it elsewhere —
 * those code paths only speak the Anthropic request shape.
 */
export function ensureAnthropic(role: ModelRole): string {
  const m = resolveModel(role);
  if (m.provider !== "anthropic") {
    throw new Error(
      `Role '${role}' is configured for ${m.provider} (${m.model}), but this code path only supports Anthropic. ` +
        `Revert UNIQUS_MODEL_${role.toUpperCase()} to a Claude model.`,
    );
  }
  return m.model;
}
