export interface PlanStep {
  description: string;
  files?: string[];
  success_criteria?: string;
}

export interface Plan {
  summary: string;
  steps: PlanStep[];
  /**
   * One plain-English sentence a non-technical user can understand, e.g.
   * "I'll build a simple expense tracker where you can add expenses and watch a
   * running total." Rendered as the prominent top line of the plan card; the
   * technical `summary` becomes the secondary/collapsible detail (B2). Optional
   * for backward-compat with plans emitted before the planner learned to write
   * it.
   */
  plain_summary?: string;
  /**
   * Outcome bullets written for a non-technical user — what they'll GET, not how
   * it's built ("A booking page where clients pick a class and a time slot").
   * Deliberately NOT a 1:1 translation of `steps`: infrastructure steps have no
   * user-visible outcome and are omitted rather than forced into fake plain
   * language. Rendered as the "What you'll get" section of the plan document;
   * the technical `steps` live in the collapsed details. Optional for
   * backward-compat with plans emitted before the planner learned to write it.
   */
  deliverables?: string[];
  /**
   * Optional low-fidelity ASCII wireframe of the intended primary screen (boxes
   * + labels for header / nav / main regions). Deliberately ASCII rather than
   * SVG/HTML so it can be rendered inside a <pre> with ZERO markup-injection
   * surface from model output (B4). A real rendered screenshot is impossible in
   * plan mode — nothing is running yet.
   */
  wireframe?: string;
  /**
   * Optional short questions/assumptions the planner wants the user to settle
   * at approval time (framework choice, data store, scope boundaries) — each
   * phrased with the planner's default so approving without answering is safe.
   * Shown on the plan card; unanswered ones are surfaced to the executor as
   * "make a reasonable default choice and say what you chose".
   */
  open_questions?: string[];
}

/**
 * One file mutated during a turn, derived deterministically from the agent's
 * write_file/edit_file tool calls (NOT from model prose) — the trustworthy
 * "what changed" source consumed by the complete marker's changed-files list
 * (C6-Tier1) and the per-tool diff-on-expand (B5). A brand-new file is recorded
 * as all-additions. Because it's git/tool-derived it cannot hallucinate a file
 * the agent never wrote, which matters for a finance/audit product.
 */
export interface ChangedFile {
  path: string;
  action: "created" | "edited" | "deleted";
  lines_added: number;
  lines_removed: number;
}

export type RunMode = "plan-then-execute" | "execute-only";

/**
 * How much the agent may do on its own before pausing for the user (the
 * composer's mode dropdown, an extension of the old binary Plan toggle). The
 * agent loop consults the CURRENT mode at every tool call, so the user can
 * change it at any time — including mid-turn — and it takes effect immediately.
 *
 * - `"plan"` — read-only investigation, then propose a plan the user approves
 *   before anything runs (the old `plan-then-execute`). Default on a brand-new
 *   project's first turn.
 * - `"default"` — "ask before edits": pause for approval before any file edit
 *   OR shell command OR dangerous/expensive op; read-only tools run freely.
 * - `"acceptEdits"` — "auto-accept edits": file edits and routine commands run
 *   automatically; still pause for dangerous/expensive ops (rm -rf, git push,
 *   deploys, DB writes, paid image/sub-agent calls). Default after the first turn.
 * - `"bypass"` — never pause; every tool runs (the old `execute-only`).
 */
export type PermissionMode = "plan" | "default" | "acceptEdits" | "bypass";

/** Map a PermissionMode to the coarse RunMode the plan-vs-execute path keys on. */
export function runModeForPermission(mode: PermissionMode): RunMode {
  return mode === "plan" ? "plan-then-execute" : "execute-only";
}

/**
 * Risk class the orchestrator assigns a tool call, surfaced on a
 * `tool_approval_requested` so the UI can label the prompt:
 * - `edit` — a file write/edit.
 * - `execute` — a routine shell command / server op.
 * - `dangerous` — irreversible or money/data-spending (destructive shell,
 *   DB writes, deploys, paid image/sub-agent calls).
 * (`read`-class tools never prompt, so they never reach the client.)
 */
export type ToolRiskCategory = "edit" | "execute" | "dangerous";

/** LLM providers the coding agent can run on. */
export type ModelProvider = "anthropic" | "openai" | "google" | "zai";

/**
 * What model the coding agent should use for a turn.
 * - `"auto"` (the default): the orchestrator picks the strongest sensible
 *   model per role. Never resolves to a low/cheap tier.
 * - A catalog `id` ("<provider>:<model>", e.g. "openai:gpt-5.6-sol"): an explicit
 *   override chosen via the Advanced model picker. "results may vary" applies.
 */
export type ModelChoice = "auto" | string;

/**
 * Per-turn reasoning/thinking effort for the agent. Maps to each provider's
 * native control: Anthropic `output_config.effort` (low→max), OpenAI
 * `reasoning.effort`, Gemini `thinkingConfig`. Account-wide
 * default like the model choice; also overridable per turn from the composer.
 *
 * The full scale is `low`→`max`, but not every provider accepts every rung —
 * see {@link thinkingEffortsForModel}, the single source of truth the composer
 * uses to render only the rungs a model actually supports. `xhigh` (added on
 * Claude Opus 4.7) sits between `high` and `max`.
 */
export type ThinkingEffort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * One web source a model cited, normalized across providers. Every provider
 * that runs a server-side web search returns attribution in its own shape —
 * Anthropic `citations` on each text block, OpenAI `url_citation` annotations,
 * Gemini `groundingMetadata`, GLM a top-level `web_search` array — and every
 * one of them requires it to be shown. OpenAI's is the strictest: "inline
 * citations must be made clearly visible and clickable in your user interface."
 * So this shape carries both what the footer needs (url, title) and what an
 * inline marker needs (where the cited span ends).
 */
export interface Citation {
  /** Absolute http(s) URL of the source. */
  url: string;
  /** Page title, when the provider supplies one. */
  title?: string;
  /**
   * 0-based character offset into the assistant's answer text at which the
   * cited span ENDS — where an inline marker is anchored. Absent when the
   * provider gives no span (GLM, which writes its own `[n]` markers inline);
   * such a source still appears in the footer.
   */
  endIndex?: number;
}

/** Every rung, low→max, in order. The composer slider renders a subset of these. */
export const THINKING_EFFORTS: ThinkingEffort[] = ["low", "medium", "high", "xhigh", "max"];

/**
 * Which reasoning-effort rungs a given model actually supports — the adaptive
 * set the composer's slider renders. Shared by the web UI and the router so the
 * two never drift (mirrors how MODEL_CATALOG is the single source of truth).
 *
 * - **Anthropic** (`output_config.effort`) accepts the full low→max scale.
 * - **Z.ai / GLM-5.2** collapses its seven rungs into three real tiers
 *   (`none`/`minimal` ⇒ no thinking, `low`/`medium`/`high` ⇒ "high",
 *   `xhigh`/`max` ⇒ "max"), so we expose only `high`→`max`: the two reasoning
 *   tiers that actually differ. Showing five rungs would be a lie — `low` and
 *   `medium` are indistinguishable from `high` on the wire.
 * - **OpenAI** (`reasoning.effort`) is model-specific: GPT-5.6 exposes the full
 *   `low`→`max` scale, while the older selectable GPT-5.x models top out at
 *   `xhigh` and therefore hide only `max`.
 * - **Google** caps out at `high` (`thinkingLevel` has no xhigh/max), so we hide
 *   the top two rungs.
 * - **Auto / unknown** shows the full scale — Auto may resolve to any provider,
 *   and each adapter clamps a rung it can't honor.
 *
 * @param choice a MODEL_CATALOG id ("<provider>:<model>"), "auto", or a bare id.
 */
export function thinkingEffortsForModel(choice: string): ThinkingEffort[] {
  const option = MODEL_CATALOG.find((m) => m.id === choice);
  const provider =
    choice === "auto" || !choice
      ? undefined
      : option?.provider;
  switch (provider) {
    case "zai":
      return ["high", "max"];
    case "openai":
      return option?.model.startsWith("gpt-5.6")
        ? ["low", "medium", "high", "xhigh", "max"]
        : ["low", "medium", "high", "xhigh"];
    case "google":
      return ["low", "medium", "high"];
    case "anthropic":
      return ["low", "medium", "high", "xhigh", "max"];
    default:
      // Auto (undefined) or a model not in the catalog: expose the full scale;
      // the resolved provider's adapter clamps any rung it can't take.
      return ["low", "medium", "high", "xhigh", "max"];
  }
}

/**
 * Clamp an effort to the rungs a model supports, choosing the nearest rung at or
 * below the request (never escalating). Used when the composer switches to a
 * model whose slider doesn't include the currently-selected rung (e.g. `max`
 * selected, then switch to GPT which caps at `high`).
 */
export function clampThinkingEffort(effort: ThinkingEffort, choice: string): ThinkingEffort {
  const allowed = thinkingEffortsForModel(choice);
  if (allowed.includes(effort)) return effort;
  const want = THINKING_EFFORTS.indexOf(effort);
  // Highest allowed rung that is ≤ the requested rung; else the lowest allowed.
  const atOrBelow = allowed.filter((e) => THINKING_EFFORTS.indexOf(e) <= want);
  return atOrBelow.length ? atOrBelow[atOrBelow.length - 1] : allowed[0];
}

/**
 * One selectable model in the Advanced picker. The curated `MODEL_CATALOG`
 * below is the single source of truth shared by the web UI (to render the
 * picker) and the orchestrator (to validate an override and route it to the
 * right provider). Deliberately excludes the lowest tiers (Claude Haiku,
 * Gemini Flash-Lite, GPT mini/nano) — those are never offered for the agent.
 */
export interface ModelOption {
  /** "<provider>:<model>" — also the value sent as a `ModelChoice`. */
  id: string;
  provider: ModelProvider;
  /** Provider-native model id passed to that provider's API. */
  model: string;
  /** Short human label for the picker, e.g. "Claude Opus 4.8". */
  label: string;
  /** One-line "what it's good at" shown under the label. */
  description: string;
  /** Coarse capability/cost tier. "frontier" = top, "high" = strong. */
  tier: "frontier" | "high";
}

export const MODEL_CATALOG: ReadonlyArray<ModelOption> = [
  // ── Anthropic ──
  {
    id: "anthropic:claude-opus-4-8",
    provider: "anthropic",
    model: "claude-opus-4-8",
    label: "Claude Opus 4.8",
    description: "Anthropic's most capable coding & agentic model.",
    tier: "frontier",
  },
  {
    id: "anthropic:claude-sonnet-4-6",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    description: "Fast, strong general coding — great cost/quality balance.",
    tier: "high",
  },
  // ── Z.ai (GLM) ──
  {
    id: "zai:glm-5.2",
    provider: "zai",
    model: "glm-5.2",
    label: "GLM-5.2",
    description: "Near-Opus coding quality at a fraction of the cost; 1M context.",
    tier: "frontier",
  },
  // ── OpenAI ──
  {
    id: "openai:gpt-5.6-sol",
    provider: "openai",
    model: "gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    description: "OpenAI's frontier model for complex professional work.",
    tier: "frontier",
  },
  {
    id: "openai:gpt-5.6-terra",
    provider: "openai",
    model: "gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    description: "GPT-5.6 intelligence balanced for lower cost.",
    tier: "high",
  },
  {
    id: "openai:gpt-5.5",
    provider: "openai",
    model: "gpt-5.5",
    label: "GPT-5.5",
    description: "OpenAI's flagship for complex reasoning and coding.",
    tier: "frontier",
  },
  {
    id: "openai:gpt-5.3-codex",
    provider: "openai",
    model: "gpt-5.3-codex",
    label: "GPT-5.3 Codex",
    description: "Agentic coding model tuned for long tool-use sessions.",
    tier: "high",
  },
  // ── Google ──
  {
    id: "google:gemini-3.1-pro-preview-customtools",
    provider: "google",
    model: "gemini-3.1-pro-preview-customtools",
    label: "Gemini 3.1 Pro Preview",
    description: "Agentic workflows & coding with a 1M-token context.",
    tier: "frontier",
  },
  {
    id: "google:gemini-3.5-flash",
    provider: "google",
    model: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    description: "Near-Pro intelligence at Flash speed; strong at code.",
    tier: "high",
  },
  {
    id: "google:gemini-2.5-pro",
    provider: "google",
    model: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    description: "High-capability reasoning & coding, 1M-token context.",
    tier: "high",
  },
];

/**
 * A set of $/1,000,000-token rates. `cacheRead` / `cacheWrite` are optional:
 * when omitted they're derived from `input` via the CACHE_*_MULTIPLIER below,
 * which matches the published rates for every provider we use today (a cache
 * read is 10% of input on Anthropic/OpenAI and Gemini's implicit cache; a
 * 5-minute cache write is 1.25× input on Anthropic). Set them explicitly only
 * for a model whose cache pricing diverges from those multiples.
 */
export interface ModelRates {
  /** $/1M FRESH (uncached) input tokens. */
  input: number;
  /** $/1M output tokens. */
  output: number;
  /** $/1M cache-read tokens. Omit ⇒ `input × CACHE_READ_MULTIPLIER`. */
  cacheRead?: number;
  /** $/1M cache-write tokens. Omit ⇒ `input × CACHE_WRITE_MULTIPLIER`. */
  cacheWrite?: number;
}

/**
 * Per-model pricing: base {@link ModelRates} plus an optional long-context tier.
 * `longContext` mirrors how Anthropic/OpenAI/Google publish a premium band — a
 * turn whose *prompt* (fresh input + cache read + cache write) exceeds
 * `thresholdTokens` reprices the ENTIRE turn at `above`. This is per-turn, so it
 * can only be applied with a single turn's token split (see estimateTurnCostUsd),
 * never on an aggregate of many turns.
 */
export interface ModelPrice extends ModelRates {
  longContext?: { thresholdTokens: number; above: ModelRates };
}

/**
 * Approximate published list prices in USD per 1,000,000 tokens, keyed by the
 * provider-native model id (what the orchestrator persists on each usage row).
 * Used only to render the dashboard's "estimated cost" widget — it is a
 * best-effort estimate, NOT a billing figure. The `input` rate applies to
 * FRESH (uncached) input tokens; cached prompt tokens are priced separately via
 * the cache multipliers below; turns past `longContext.thresholdTokens` reprice
 * at the premium band (see estimateTurnCostUsd). Update these as provider
 * pricing changes; unknown models fall back to DEFAULT_PRICE.
 */
export const MODEL_PRICING: Record<string, ModelPrice> = {
  // source: provider published list prices as of 2026-06-16. Keep this dated
  // and keep every MODEL_CATALOG id below explicitly priced — the
  // `MODEL_CATALOG ⊆ MODEL_PRICING` invariant is asserted in pricing.test.ts so
  // a new catalogued model can never silently fall through to DEFAULT_PRICE
  // (which can be 5–40× off and corrupts the per-run/account cost estimate).
  //
  // Long-context bands: providers publish a premium above a prompt-size
  // threshold (Anthropic/Google 200K, OpenAI 272K) where the whole turn reprices
  // at ~2× input / ~1.5× output. Models whose context window can't exceed the
  // threshold (Opus 200K) or that price flat (Flash, the *-pro single tier) have
  // no band. The ×2 / ×1.5 multiples are applied to the base rates above so they
  // track any base-price edit (e.g. Gemini 3.1 Pro 2/12 → 4/18, matching docs).
  // Anthropic
  "claude-opus-4-8": { input: 5, output: 25 },
  // Sonnet 4.6 prices its full 1M context FLAT — the >200K premium (2× in / 1.5×
  // out) that Sonnet 4/4.5 charged under the `context-1m` beta does NOT apply to
  // the 4.6 generation (verified 2026-07-07 vs the Anthropic models overview;
  // Opus 4.8 is likewise flat). The old band over-priced every >200K Sonnet turn.
  "claude-sonnet-4-6": { input: 3, output: 15 },
  // Haiku 4.5 — NOT user-selectable (absent from MODEL_CATALOG, like the vision
  // bridge models below), but it IS the internal compact/classify model (router.ts
  // AUTO), so a metered aux call must not fall through to DEFAULT_PRICE's $3/$15 —
  // a 3× overprice on every summarize/classify row. Both the dated id the router
  // pins and the bare alias are listed so either persists correctly. Flat, no band.
  // Source: platform.claude.com/docs/en/about-claude/pricing (verified 2026-07-09).
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  // Z.ai (GLM) — source: z.ai published API rates as of 2026-06-18. Cached input
  // is ~0.26 (not the 0.1× default), so set it explicitly; GLM has no separate
  // cache-write line. Flat-priced (no long-context band) despite the 1M window.
  "glm-5.2": { input: 1.4, output: 4.4, cacheRead: 0.26 },
  // OpenAI — rates re-verified against developers.openai.com/api/docs/models on
  // 2026-07-11. Base `input` is the fresh rate; cached input is the 0.1×
  // default, which reproduces OpenAI's published cached rates exactly at BOTH
  // tiers. GPT-5.6 also bills cache writes at 1.25× fresh input, matching the
  // shared default. gpt-5.3-codex has NO long-context band per the docs.
  "gpt-5.6-sol": {
    input: 5,
    output: 30,
    longContext: { thresholdTokens: 272_000, above: { input: 10, output: 45 } },
  },
  "gpt-5.6-terra": {
    input: 2.5,
    output: 15,
    longContext: { thresholdTokens: 272_000, above: { input: 5, output: 22.5 } },
  },
  "gpt-5.5": {
    input: 5,
    output: 30,
    longContext: { thresholdTokens: 272_000, above: { input: 10, output: 45 } },
  },
  "gpt-5.3-codex": { input: 1.75, output: 14 },
  // Google
  "gemini-3.1-pro-preview-customtools": {
    input: 2,
    output: 12,
    longContext: { thresholdTokens: 200_000, above: { input: 4, output: 18 } },
  },
  // 3.5 Flash: $1.50/$9.00 (cached $0.15 = 0.1×), verified 2026-07-07 vs
  // ai.google.dev/gemini-api/docs/pricing. The prior $0.30/$2.50 were Gemini
  // *2.5* Flash's rates — a copy-paste that was never repriced (a ~5× input
  // undercount on the model that leads Auto's `quick` tier). No long-context band.
  "gemini-3.5-flash": { input: 1.5, output: 9 },
  "gemini-2.5-pro": {
    input: 1.25,
    output: 10,
    longContext: { thresholdTokens: 200_000, above: { input: 2.5, output: 15 } },
  },
  // Vision-bridge models — NOT user-selectable (absent from MODEL_CATALOG, so the
  // completeness test doesn't require them). The analyze_image bridge for
  // text-only models routes to gemini-3.5-flash (priced above); these GLM VLMs
  // are the fallback when no Google key is set. Priced explicitly so a metered
  // bridge sub-call is precise and never falls through to DEFAULT_PRICE (5–40×
  // off). Source: z.ai published vision rates as of 2026-06-19 (cached input set
  // explicitly, like glm-5.2; no separate cache-write line; flat, no band).
  "glm-5v-turbo": { input: 1.2, output: 4, cacheRead: 0.24 },
  "glm-4.6v": { input: 0.3, output: 0.9, cacheRead: 0.05 },
  // GLM-OCR (layout_parsing / document OCR) — uniform $0.03/Mtok input & output.
  "glm-ocr": { input: 0.03, output: 0.03 },
};

/** Fallback $/1M when a model id isn't in MODEL_PRICING (mid-tier estimate). */
export const DEFAULT_PRICE: ModelRates = { input: 3, output: 15 };

/**
 * Cache-token price multipliers relative to the model's fresh `input` rate, used
 * when a model's pricing doesn't override `cacheRead` / `cacheWrite`. A cache
 * READ is ~10% of fresh input across providers (Anthropic 0.1×, OpenAI 0.1×,
 * Gemini's implicit cache is a 90% discount = 0.1×); measured cache WRITEs
 * (Anthropic and GPT-5.6) are 1.25× fresh input.
 * Best-effort, not a billing figure.
 */
export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_WRITE_MULTIPLIER = 1.25;

/** Token split for a single turn (a subset of the providers' TokenUsage). */
export interface TurnTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

/** Cost in USD for the given token counts at a fixed set of rates. */
function costUsdFromRates(
  r: ModelRates,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheCreationTokens: number,
): number {
  const cacheReadRate = r.cacheRead ?? r.input * CACHE_READ_MULTIPLIER;
  const cacheWriteRate = r.cacheWrite ?? r.input * CACHE_WRITE_MULTIPLIER;
  return (
    (inputTokens * r.input +
      cacheReadTokens * cacheReadRate +
      cacheCreationTokens * cacheWriteRate +
      outputTokens * r.output) /
    1_000_000
  );
}

/**
 * Estimated USD cost at a model's BASE rates (no long-context band). Fresh input
 * bills at the full `input` rate; cached reads/writes at their discounted rates
 * (per-model overrides or the CACHE_*_MULTIPLIER defaults). Passing only
 * input/output (cache args default to 0) reproduces the old full-price estimate.
 *
 * Use this when pricing an AGGREGATE of many turns (e.g. an account/day/project
 * rollup), where the per-turn prompt size — and therefore the long-context band
 * — is unknowable. For a single turn, prefer {@link estimateTurnCostUsd}, which
 * also applies the band.
 */
export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheCreationTokens = 0,
): number {
  const p = MODEL_PRICING[model] ?? DEFAULT_PRICE;
  return costUsdFromRates(p, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens);
}

/**
 * Estimated USD cost for ONE turn, applying the model's long-context band: when
 * the turn's prompt (fresh input + both cache buckets) exceeds the model's
 * `longContext.thresholdTokens`, the whole turn reprices at the premium band —
 * exactly how the providers bill. This is the most precise per-turn estimate;
 * the orchestrator snapshots it onto each usage row at record time so historical
 * spend isn't re-priced when rates change.
 */
export function estimateTurnCostUsd(model: string, usage: TurnTokenUsage): number {
  const p = MODEL_PRICING[model] ?? DEFAULT_PRICE;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheCreation = usage.cacheCreationTokens ?? 0;
  const promptTokens = usage.inputTokens + cacheRead + cacheCreation;
  const rates =
    "longContext" in p && p.longContext && promptTokens > p.longContext.thresholdTokens
      ? p.longContext.above
      : p;
  return costUsdFromRates(rates, usage.inputTokens, usage.outputTokens, cacheRead, cacheCreation);
}

/** Per-model rollup for the dashboard "top models" widget. */
export interface ModelUsageRollup {
  /** Provider-native model id, e.g. "claude-opus-4-8". */
  model: string;
  provider: ModelProvider;
  /** Human label from MODEL_CATALOG, or the raw model id if not catalogued. */
  label: string;
  /** FRESH (uncached) input tokens — billed at the full input rate. */
  input_tokens: number;
  output_tokens: number;
  /** Prompt tokens served from cache (billed ~0.1×). 0 if not tracked. */
  cache_read_tokens: number;
  /** Tokens written to the cache (Anthropic, billed ~1.25×). 0 otherwise. */
  cache_creation_tokens: number;
  /** Number of agent turns served by this model. */
  turns: number;
}

/**
 * Account-wide usage rollup powering the dashboard widgets. Aggregated from the
 * `usage_events` the orchestrator records at the end of each agent turn.
 */
export interface AccountUsageStats {
  /** FRESH (uncached) input tokens — billed at the full input rate. */
  total_input_tokens: number;
  total_output_tokens: number;
  /** Prompt tokens served from cache across all turns (billed ~0.1×). */
  total_cache_read_tokens: number;
  /** Tokens written to the cache across all turns (Anthropic, ~1.25×). */
  total_cache_creation_tokens: number;
  /**
   * Estimated spend in USD (see estimateCostUsd — not a billing figure).
   * Cache reads/writes are priced at their discounted multipliers, so this is
   * far lower than pricing every processed token at the full input rate.
   */
  total_cost_usd: number;
  /** Total agent wall-clock across all turns, milliseconds. */
  total_time_ms: number;
  /** Number of agent turns recorded. */
  turns: number;
  /** Models ranked by total tokens, most-used first. */
  top_models: ModelUsageRollup[];
  /** Per-day spend/usage for a trend chart, oldest-first. */
  daily?: Array<{ date: string; cost_usd: number; tokens: number }>;
  /** Per-project spend/usage rollup, highest-spend first. */
  by_project?: Array<{ project_id: string; project_name: string; cost_usd: number; tokens: number }>;
}

export interface UploadedFileSummary {
  name: string;
  path: string;
  size: number;
  mime_type: string;
}

export type ClientEvent =
  | {
      type: "user_message";
      content: string;
      mode: RunMode;
      /**
       * The permission mode for this turn (the composer's mode dropdown). The
       * orchestrator prefers this over `mode` when present; `mode` is kept for
       * back-compat (an older client that only sends plan-then-execute / execute-only
       * still works). Mid-turn changes ride on `set_permission_mode`, not here.
       */
      permission_mode?: PermissionMode;
      /**
       * Which model to run the agent (and plan step) on for this turn.
       * Omitted or `"auto"` ⇒ the orchestrator picks the best model per role.
       * A catalog id ("<provider>:<model>") ⇒ explicit Advanced override.
       */
      model?: ModelChoice;
      /**
       * Reasoning effort for this turn. Omitted ⇒ the orchestrator's default
       * ("medium"). Higher = more internal reasoning before answering.
       */
      thinking?: ThinkingEffort;
      /**
       * Whether extended thinking is enabled for this turn (the composer's
       * on/off toggle). Omitted or `true` ⇒ thinking on at `thinking` effort;
       * `false` ⇒ the adapter selects its lowest supported reasoning setting
       * (Anthropic/GLM off, OpenAI model-specific `none`/`low`, Gemini lowest).
       */
      thinking_enabled?: boolean;
      attachments?: UploadedFileSummary[];
      /**
       * Sandbox-relative paths the user explicitly @-referenced in the
       * composer. The orchestrator reads each file (with size caps) and
       * inlines the contents into the agent's user message so the agent
       * doesn't have to spend a `read_file` tool round-trip.
       */
      file_refs?: string[];
    }
  | { type: "plan_approved"; plan: Plan }
  /**
   * Change the permission mode of the in-flight (or next) turn. The agent loop
   * reads the live mode at every tool call, so switching mid-turn takes effect
   * on the very next tool. Switching to a MORE permissive mode (e.g. bypass)
   * auto-resolves any approval the run is currently paused on.
   */
  | { type: "set_permission_mode"; mode: PermissionMode }
  /**
   * The user's verdict on a paused tool call (`tool_approval_requested`).
   * `decision`: run it once / run it and stop asking for this tool / decline it.
   * On `deny`, `feedback` (if any) is fed back to the model as the tool result
   * so it can adapt instead of just failing.
   */
  | {
      type: "tool_approval_response";
      call_id: string;
      decision: "approve" | "approve_always" | "deny";
      feedback?: string;
    }
  | { type: "request_tree" }
  | { type: "request_file"; path: string }
  | { type: "reset_session" }
  /** Summarize older model-facing history now, without deleting the raw transcript. */
  | { type: "compact_context" }
  | { type: "abort" }
  | { type: "client_write_file"; path: string; content: string }
  | { type: "user_question_answered"; call_id: string; answer: string };

export interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  /** Optional emoji or short visual ID. Null = picker renders an auto-derived hash tile. */
  icon: string | null;
  created_at: string;
  updated_at: string;
  /** Web URL of the linked GitHub repo, if the user has clicked "Create GitHub repo". */
  github_repo_url?: string | null;
  /** "owner/name" form for compact display. */
  github_repo_full_name?: string | null;
  /** Vercel-side project name, populated after the first Vercel deploy. */
  vercel_project_name?: string | null;
  /** Git branch this project's sandbox is currently tracking, if known. */
  linked_branch?: string | null;
  /** State of the project's most recent deploy, if it has ever deployed. */
  latest_deploy_state?: DeploymentState | null;
  /** ISO timestamp of the project's most recent deploy, if any. */
  latest_deploy_at?: string | null;
  /** Attached global design system (null = none). The agent generates against its tokens. */
  design_system_id?: string | null;
  /** Attached reusable library skills (ids; empty/undefined = none). */
  skill_library_ids?: string[] | null;
  /** Whether `.uniqus/skills.md` is trusted enough to inject into the agent prompt. */
  skills_trust?: ProjectSkillsTrust | null;
  /** Organization (workspace) the project belongs to. Null = the owner's personal workspace. */
  org_id?: string | null;
}

export type ProjectSkillsTrust = "trusted" | "untrusted_import";

// ── Design systems ──────────────────────────────────────────────────────────
// Global, per-user reusable token sets attached to a project (or none) and
// injected into the agent's system prompt so generation stays on-system. The
// single source of truth for the token shape, shared by the UI editor and the
// orchestrator's prompt formatter.

/**
 * One button variant (primary, secondary, outline, ghost, destructive, …).
 * Color fields are a PALETTE TOKEN NAME (e.g. "primary") when possible so the
 * variant tracks the palette; a raw CSS color or "transparent" is also allowed.
 */
export interface ButtonVariantSpec {
  name: string;
  /** Fill — palette token name, raw CSS color, or "transparent". */
  background?: string;
  /** Label color — palette token name or raw CSS color. */
  foreground?: string;
  /** Border color — palette token name or raw CSS color; omit for none. */
  border?: string;
}

/**
 * One real component discovered from a source (a live site, a codebase, …) — an
 * open-ended catalog beyond the fixed button/input/card/badge specs, e.g. a
 * search bar, a data table, a chat bubble, a nav, multiple button styles. Each
 * carries a self-contained HTML snippet rendered (sandboxed) in the preview.
 */
export interface DiscoveredComponent {
  /** Slug, e.g. "primary-button", "search-input", "data-table", "chat-bubble". */
  type: string;
  /** Human label, e.g. "Primary button". */
  name: string;
  /** One-line description of its look/role. */
  description?: string;
  /** Self-contained HTML snippet (NO <script>/external refs) for the live preview.
   *  Should style via the injected CSS vars: var(--color-<token>), var(--radius),
   *  var(--font-heading)/var(--font-body), or inline styles. */
  html?: string;
}

/**
 * Structured component specs so a design system constrains not just color/type
 * but the SHAPE and behavior of common UI: controls, navigation, tables,
 * overlays, and feedback. The coding agent generates components against these;
 * the web preview renders the core visual set. Color-ish fields accept a palette
 * token name or a raw CSS color (see ButtonVariantSpec).
 */
export interface DesignComponentTokens {
  button?: {
    radius?: string;
    paddingX?: string;
    paddingY?: string;
    fontWeight?: number;
    variants?: ButtonVariantSpec[];
  };
  input?: {
    radius?: string;
    background?: string;
    border?: string;
  };
  card?: {
    radius?: string;
    background?: string;
    border?: string;
    /** CSS box-shadow value, or "none". */
    shadow?: string;
    padding?: string;
  };
  badge?: {
    radius?: string;
    /** "soft" = tinted bg, "solid" = filled, "outline" = bordered. */
    variant?: "soft" | "solid" | "outline";
  };
  navigation?: {
    height?: string;
    active?: string;
    responsive?: string;
  };
  table?: {
    rowHeight?: string;
    header?: string;
    numeric?: string;
    responsive?: string;
  };
  overlay?: {
    radius?: string;
    shadow?: string;
    behavior?: string;
  };
  feedback?: {
    status?: string;
    empty?: string;
    loading?: string;
    toast?: string;
  };
  /** Open-ended named component rules, e.g. composer, chart, command-bar. */
  rules?: Record<string, string>;
  /** Open catalog of real components discovered from the source (renders in the
   *  preview; the user approves which to keep; injected into the agent prompt). */
  catalog?: DiscoveredComponent[];
}

/** Structured visual foundations shared by every component and screen. */
export interface DesignFoundationTokens {
  typography?: {
    sizes?: Record<string, string>;
    lineHeights?: Record<string, string>;
    weights?: Record<string, string>;
    measures?: Record<string, string>;
  };
  spacingScale?: Record<string, string>;
  radii?: Record<string, string>;
  elevations?: Record<string, string>;
  layout?: {
    breakpoints?: Record<string, string>;
    containers?: Record<string, string>;
    grid?: string;
  };
  motion?: {
    durations?: Record<string, string>;
    easings?: Record<string, string>;
    reducedMotion?: string;
  };
  iconography?: string;
  imagery?: string;
}

/** Cross-component composition and responsive patterns. */
export interface DesignPatternTokens {
  responsive?: string;
  navigation?: string;
  forms?: string;
  tables?: string;
  overlays?: string;
  dataVisualization?: string;
  states?: string;
}

/** Interaction, accessibility, content, and recovery behavior. */
export interface DesignBehaviorTokens {
  interaction?: string;
  focus?: string;
  validation?: string;
  loading?: string;
  destructiveActions?: string;
  accessibility?: string;
  content?: string;
}

export interface DesignTokens {
  /** The mode the palette primarily targets. */
  mode: "light" | "dark" | "system";
  /** Semantic color tokens: name → CSS color. Use semantic names (primary,
   *  background, surface, text, muted, border, accent, …), not raw hues. */
  colors: Record<string, string>;
  fonts: { body: string; heading: string; mono?: string };
  /** Type-scale ratio label, e.g. "1.25 — major third". */
  typeScale?: string;
  /** Base border radius, e.g. "8px". */
  radius: string;
  /** Base spacing unit, e.g. "4px". */
  spacing?: string;
  /** Component-level specs so generated UIs stay on-system (buttons, inputs, …). */
  components?: DesignComponentTokens;
  /** Structured scales, layout rails, motion, iconography, and imagery. */
  foundations?: DesignFoundationTokens;
  /** Reusable responsive/composition patterns spanning several components. */
  patterns?: DesignPatternTokens;
  /** Interaction, state, content, accessibility, and recovery requirements. */
  behavior?: DesignBehaviorTokens;
  /** Brand assets pulled from the source, e.g. a logo image URL. */
  assets?: { logo?: string };
  /** Freeform guidance the agent should follow (voice, density, motion, etc.). */
  notes?: string;
}

export interface DesignSystem {
  id: string;
  name: string;
  tokens: DesignTokens;
  created_at: string;
  updated_at: string;
}

/**
 * A reusable, account-level Skill: a named markdown rule-set the user authors
 * once and ATTACHES to any number of projects. Distinct from the per-project
 * `.uniqus/skills.md` file (which stays the project-specific override layer) and
 * from the code-defined curated `SKILL_PACKS`. At each turn, every attached
 * the skill's name + description are advertised to the agent. Its `body` is
 * loaded on demand when the task matches, before the project's own skills.md,
 * so the project file can still override/extend it without every skill body
 * consuming every turn's context.
 */
export interface SkillLibrary {
  id: string;
  name: string;
  description: string | null;
  /** The skill instructions, markdown. Capped at 64 KB by the API. */
  body: string;
  created_at: string;
  updated_at: string;
}

/** Canonical explicit-invocation handle shown in the UI and agent catalog. */
export function skillInvocationName(name: string): string {
  const normalized = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return normalized || "skill";
}

/** Lightweight row for list views (no body). */
export interface SkillLibrarySummary {
  id: string;
  name: string;
  description: string | null;
  updated_at: string;
}

/**
 * An account-level Knowledge document: a file the user uploaded (regulation,
 * research paper, dataset, spec, …) once, available to the agent across ALL of
 * their projects via the `knowledge_search` tool. The raw file is kept in object
 * storage; the extracted plain text lives in the DB and powers search. This list
 * shape omits the full extracted text — fetch one document to read its content.
 */
export interface KnowledgeDocument {
  id: string;
  /** Display title — defaults to the original filename, user-renameable. */
  title: string;
  /** Optional one-line note about what the document is / when to use it. */
  description: string | null;
  /** Original uploaded filename (e.g. "ifrs-16-leases.pdf"). */
  file_name: string;
  /** MIME type sniffed from the upload (e.g. "application/pdf"). */
  mime_type: string;
  /** Size of the original file in bytes. */
  size_bytes: number;
  /** Number of characters of plain text extracted (0 if extraction failed). */
  char_count: number;
  /** Whether text extraction succeeded — false ⇒ not searchable, download only. */
  extracted: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * What the agent detected while analyzing a source (brief, codebase, live site,
 * Figma, …), grouped for the approve/deny review step. Each entry is a short
 * human-readable line. Unchecking a category in the UI reverts that slice of the
 * tokens to defaults before saving.
 */
export interface DesignFindings {
  /** Human label for where this came from, e.g. "live site: stripe.com". */
  source: string;
  colors: string[];
  typography: string[];
  components: string[];
  spacing: string[];
  notes: string[];
}

/**
 * An UNSAVED proposal returned by the analyze step. The user reviews the
 * findings + live preview, approves/denies, optionally refines, then saves
 * (which persists the tokens as a DesignSystem).
 */
export interface DesignSystemDraft {
  name: string;
  tokens: DesignTokens;
  findings: DesignFindings;
}

/** Sensible starting point for "start blank". Semantic names map to AI consistency. */
export const DEFAULT_DESIGN_TOKENS: DesignTokens = {
  mode: "light",
  colors: {
    primary: "#6d5efc",
    accent: "#22c55e",
    background: "#ffffff",
    surface: "#f6f6f8",
    text: "#0e0e14",
    muted: "#6b7280",
    border: "#e5e7eb",
  },
  fonts: {
    body: "Inter, system-ui, sans-serif",
    heading: "Inter, system-ui, sans-serif",
    mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  typeScale: "1.25 — major third",
  radius: "8px",
  spacing: "4px",
  components: {
    button: {
      radius: "8px",
      paddingX: "14px",
      paddingY: "8px",
      fontWeight: 600,
      variants: [
        { name: "primary", background: "primary", foreground: "#ffffff" },
        { name: "secondary", background: "surface", foreground: "text", border: "border" },
        { name: "outline", background: "transparent", foreground: "primary", border: "primary" },
        { name: "ghost", background: "transparent", foreground: "muted" },
      ],
    },
    input: { radius: "8px", background: "background", border: "border" },
    card: { radius: "12px", background: "surface", border: "border", shadow: "0 1px 2px rgba(0,0,0,0.06)", padding: "16px" },
    badge: { radius: "999px", variant: "soft" },
    navigation: {
      height: "56px",
      active: "accent text plus a quiet tinted background; never color-only",
      responsive: "collapse into a labeled mobile menu without hiding the primary action",
    },
    table: {
      rowHeight: "40px",
      header: "sticky when the table scrolls; concise labels with visible sort state",
      numeric: "right-aligned tabular numerals with units",
      responsive: "preserve row meaning; scroll the table region or transform rows deliberately",
    },
    overlay: {
      radius: "12px",
      shadow: "0 8px 24px rgba(0,0,0,0.12)",
      behavior: "trap focus, close on Escape, restore focus to the trigger",
    },
    feedback: {
      status: "pair semantic color with text or an icon",
      empty: "explain the state and offer one clear next action",
      loading: "skeletons match final geometry; announce long async work",
      toast: "brief, dismissible, and announced without stealing focus",
    },
  },
  foundations: {
    typography: {
      sizes: { display: "3rem", h1: "2.25rem", h2: "1.5rem", body: "1rem", small: "0.875rem" },
      lineHeights: { tight: "1.1", heading: "1.25", body: "1.6" },
      weights: { regular: "400", medium: "500", semibold: "600" },
      measures: { body: "68ch", narrow: "48ch" },
    },
    spacingScale: { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "32px", section: "96px" },
    radii: { sm: "4px", md: "8px", lg: "12px", full: "9999px" },
    elevations: { raised: "0 1px 2px rgba(0,0,0,0.06)", overlay: "0 8px 24px rgba(0,0,0,0.12)" },
    layout: {
      breakpoints: { narrow: "360px", medium: "768px", wide: "1024px", max: "1440px" },
      containers: { content: "72rem", reading: "68ch" },
      grid: "12 columns on wide screens; collapse by content priority, not by equal fractions",
    },
    motion: {
      durations: { fast: "120ms", base: "200ms", slow: "300ms" },
      easings: { out: "cubic-bezier(0.22, 1, 0.36, 1)", inOut: "cubic-bezier(0.65, 0, 0.35, 1)" },
      reducedMotion: "remove travel and looping motion while preserving state changes",
    },
    iconography: "one coherent icon family and stroke weight; labels for unfamiliar actions",
    imagery: "use product-relevant assets or deliberate generated visuals; never placeholder rectangles",
  },
  patterns: {
    responsive: "define what stacks, collapses, scrolls, pins, hides, or reorders at narrow, intermediate, and wide widths",
    navigation: "keep location, primary destination, and account access understandable at every width",
    forms: "visible labels, inline help and validation, preserved values on error, one clear submit path",
    tables: "optimize scanning; preserve headers and row identity; provide a deliberate narrow-screen treatment",
    overlays: "use dialogs for blocking decisions and side panels/sheets for contextual work; avoid nested modals",
    dataVisualization: "every chart answers a decision; include units, legends, accessible summaries, and underlying data when needed",
    states: "design loading, empty, error, disabled, success, and partial-data states alongside the default state",
  },
  behavior: {
    interaction: "every interactive element has hover where relevant, press, focus, disabled, and pending behavior",
    focus: "logical keyboard order, visible focus, managed overlays, and restored focus after dismissal",
    validation: "validate on blur or submit; explain what happened and how to fix it; focus an error summary after failed submit",
    loading: "preserve layout, prevent duplicate actions, and communicate progress for work longer than a moment",
    destructiveActions: "prefer undo for reversible actions; confirm irreversible actions with specific consequences",
    accessibility: "WCAG 2.2 AA contrast, semantic controls, accessible names, keyboard operation, reduced motion, and 200% zoom/reflow",
    content: "real concise copy in the product voice; labels describe outcomes rather than implementation",
  },
  notes: "",
};

export interface CurrentUser {
  id: string;
  email: string;
  display_name: string | null;
  /** "guest" accounts have full parity with "standard" except GitHub + deploys. */
  account_type: "standard" | "guest";
}

/**
 * Account-wide agent customization (Settings → Custom prompts & default
 * skills). `custom_prompt` is appended to the agent system prompt on every
 * turn; `default_skills` is the Skills markdown seeded into each new project's
 * `.uniqus/skills.md`. Empty string = unset.
 */
export interface AccountSettings {
  custom_prompt: string;
  default_skills: string;
  /**
   * Library skill ids (from the account's Skill Library) to AUTO-ATTACH to
   * every NEW project on creation — the "use this skill on every project"
   * toggle in the Skills tab. On project create the orchestrator seeds
   * `project.skill_library_ids` from this list, so a default skill is active on
   * the very first turn without the user re-selecting and re-prompting. Ids that
   * no longer resolve to an owned skill are ignored. Empty = no defaults.
   */
  default_skill_library_ids?: string[];
}

export type DeploymentState = "QUEUED" | "BUILDING" | "READY" | "ERROR" | "CANCELED";

export type ServerEvent =
  | {
      type: "session_started";
      sandbox_dir: string;
      shell: string;
      platform: string;
      project: ProjectSummary;
      user: CurrentUser;
      /**
       * Active chat session id (Phase 2.x). The workspace dropdown uses this
       * to highlight which thread is currently bound; reconnect with
       * `?session=<id>` to switch.
       */
      chat_session?: { id: string; title: string | null };
    }
  | { type: "iteration"; iter: number }
  | {
      /**
       * Task-aware "Auto" routing picked the model for THIS turn. Emitted once at
       * turn start, and ONLY when the user is on Auto (an explicit pick / env pin
       * is already shown in the composer, so it isn't announced). Lets the UI
       * surface e.g. "⚡ Auto → GLM-5.2" before the answer streams, so the routing
       * isn't invisible. `tier` is the classified task tier (quick / standard /
       * hard) for a short "why" hint; `vision` marks an image-biased pick.
       */
      type: "model_selected";
      provider: ModelProvider;
      /** Provider-native model id, e.g. "glm-5.2". */
      model: string;
      tier?: "quick" | "standard" | "hard";
      vision?: boolean;
    }
  | { type: "text"; content: string }
  | {
      /**
       * Replay of a persisted USER message when a project's history is loaded
       * (reconnect / project open). Distinct from `text` (which is assistant
       * output) so the client renders it as the user's own bubble instead of
       * dumping the raw text into an assistant message. Carries just the user's
       * words — the orchestrator strips the inlined upload/file-ref/plan
       * trailers it added before persisting.
       */
      type: "replay_user_message";
      content: string;
    }
  | {
      /**
       * Reasoning/thinking delta — the model's internal reasoning trace, shown
       * in a collapsible block separate from the answer text. Not every model
       * exposes it (e.g. OpenAI Chat Completions hides reasoning content).
       */
      type: "thinking";
      content: string;
    }
  | {
      /**
       * Web sources the model cited, emitted once per assistant turn that ran a
       * search, immediately after that turn's text. Providers hand back
       * attribution only with the finished response, so this cannot stream as a
       * delta. Rendering it is REQUIRED — see the {@link Citation} docs.
       */
      type: "citations";
      citations: Citation[];
    }
  | {
      /**
       * Non-agent system message — VM lifecycle, storage sync notices, etc.
       * Renders in muted/grey type so the user doesn't mistake it for agent
       * output. Don't use for anything the agent itself "said".
       */
      type: "system";
      content: string;
    }
  | { type: "tool_call"; call_id: string; name: string; input: unknown }
  | {
      type: "tool_result";
      call_id: string;
      result: string;
      is_error: boolean;
      /** Lines added/removed for write_file/edit_file, for the "+A −R" diff badge. */
      lines_added?: number;
      lines_removed?: number;
      /**
       * Sandbox-relative image paths to show as inline thumbnails under the tool
       * row — set for screenshot_preview and the vision-bridge tools (analyze_image
       * etc.), never interact_preview. The web loads each via the project's /raw/
       * endpoint; a path whose file was pruned just renders nothing.
       */
      image_paths?: string[];
    }
  | {
      /**
       * P2 live "Preview (Agent)" view — one frame per step as the agent (or a
       * one-click smoke-flow replay) drives the running app via interact_preview.
       * The web renders these in the dedicated "Preview (Agent)" tab so the user
       * watches the agent operate the browser in near-real-time, like a
       * screen-share (Claude-in-Chrome / Antigravity feel) — instead of a single
       * opaque "Interact Preview" tool row. `image` is a base64 JPEG (no `data:`
       * prefix). `call_id` ties a frame stream together: the originating
       * interact_preview tool-call id for agent runs, or the flow id for a UI
       * replay. The final frame of a run carries `done: true`.
       */
      type: "agent_preview_frame";
      call_id: string;
      /** 0-based frame index within this run. */
      seq: number;
      /** Human caption for the step, e.g. "Opened /login" or "click #submit". */
      label: string;
      ok: boolean;
      detail?: string;
      url: string;
      image: string;
      mime: string;
      /** Page <title> at capture time, when known. */
      title?: string;
      /** True on the last frame of the run. */
      done?: boolean;
      /** Set on a saved-flow replay so the UI can caption "Replaying <name>". */
      flow_name?: string;
    }
  | { type: "plan_proposed"; plan: Plan }
  | { type: "plan_running" }
  /**
   * The agent loop paused on a tool call that the current permission mode gates
   * (an edit in `default`, a dangerous op in `default`/`acceptEdits`). The UI
   * renders an approval card; the user answers with `tool_approval_response`.
   * `summary` is a one-line human description of the action; `reason` says why
   * it's being gated. The matching `tool_result` lands afterward as usual (the
   * tool ran on approve, or a "declined by user" note on deny).
   */
  | {
      type: "tool_approval_requested";
      call_id: string;
      tool: string;
      category: ToolRiskCategory;
      summary: string;
      reason: string;
      input: unknown;
    }
  /**
   * Echo of a permission-mode change (from `set_permission_mode`, or the server
   * auto-resolving), so every socket bound to the session — and a reconnecting
   * one replaying the buffer — keeps its mode dropdown in sync.
   */
  | { type: "permission_mode_changed"; mode: PermissionMode }
  | { type: "tree_listing"; entries: TreeEntry[] }
  | { type: "file_content"; path: string; content: string | null }
  | { type: "file_changed"; path: string }
  | { type: "server_started"; id: string; command: string; port: number }
  | { type: "server_stopped"; id: string }
  | { type: "session_reset" }
  | {
      /**
       * Live cumulative token usage for the in-flight turn (Plan §5). Emitted
       * (throttled) as the agent streams so the composer can show a running
       * "X in · Y out" counter. Cumulative across every iteration of the turn
       * — i.e. total tokens billed so far this turn, not per-iteration.
       */
      type: "usage";
      /** FRESH (uncached) input tokens so far this turn. */
      input_tokens: number;
      output_tokens: number;
      /** Prompt tokens served from cache this turn (billed ~0.1×). */
      cache_read_tokens?: number;
      /** Tokens written to the cache this turn (billed ~1.25×). */
      cache_creation_tokens?: number;
      /**
       * Provider-native model id the turn is running on (e.g. "claude-opus-4-8"),
       * so the client can price the live spend via estimateCostUsd. May be absent
       * for the first few events on an Auto turn until routing resolves.
       */
      model?: string;
    }
  | {
      /**
       * Live progress for one spawned sub-agent (the Activity Monitor's
       * sub-agent widget). Emitted as a sub-agent runs in the background: on
       * spawn (status "running"), on each tool call (updated `last_action`), and
       * on completion (status "done"/"error" with final token usage). The client
       * upserts by `id`. Sub-agents run asynchronously now, so several of these
       * stream concurrently while the lead agent keeps working.
       */
      type: "subagent_update";
      /** Stable per-turn id, e.g. "sa_0". The client dedupes/updates on this. */
      id: string;
      /** 1-based display index within the turn. */
      index: number;
      /** Specialization key (e.g. "frontend") + its human label. */
      agent_type: string;
      label: string;
      /** Short task description the lead agent gave this sub-agent. */
      task: string;
      /** Provider-native model the sub-agent runs on ("auto" until resolved). */
      model: string;
      status: "running" | "done" | "error";
      /** Most recent action, e.g. "Writing src/App.tsx" (1-line, for the widget). */
      last_action?: string;
      /** Cumulative token usage for this sub-agent so far (for live cost). */
      input_tokens?: number;
      output_tokens?: number;
      cache_read_tokens?: number;
      cache_creation_tokens?: number;
      /** Set when status is "error". */
      error?: string;
    }
  | {
      type: "complete";
      tool_calls: number;
      elapsed_ms: number;
      aborted?: boolean;
      /** Final cumulative token usage for the turn (absent on replayed turns). */
      input_tokens?: number;
      output_tokens?: number;
      /** Prompt tokens served from cache this turn (billed ~0.1×). */
      cache_read_tokens?: number;
      /** Tokens written to the cache this turn (Anthropic, billed ~1.25×). */
      cache_creation_tokens?: number;
      /**
       * Provider-native model id that served this turn (e.g. "claude-opus-4-8"),
       * so the client can price the single run via estimateCostUsd. Absent on
       * replayed turns. (C5)
       */
      model?: string;
      /**
       * Best-effort estimated USD cost for THIS run (see estimateCostUsd — an
       * estimate, NOT a billed amount). Computed server-side from the token
       * split + model so the client doesn't need the pricing table at emit
       * time. (C5)
       */
      cost_usd?: number;
      /**
       * Sub-agent spend folded into this turn (Phase 1): how many sub-agents ran,
       * their combined tokens, and their combined estimated USD cost (priced
       * per-model server-side, since sub-agents may run on different models than
       * the lead). `cost_usd` above is the LEAD agent's cost only; the turn's true
       * cost is `cost_usd + subagent_cost_usd`. Absent when no sub-agents ran.
       */
      subagent_count?: number;
      subagent_input_tokens?: number;
      subagent_output_tokens?: number;
      subagent_cost_usd?: number;
      /**
       * Deterministic, tool-derived list of files this turn created / edited /
       * deleted (C6-Tier1). Drives the "What changed" list on the complete
       * marker and cannot hallucinate, unlike the model's prose summary.
       */
      changed_files?: ChangedFile[];
      /**
       * Up to ~3 context-aware follow-up prompts to offer as chips after the run
       * (C2). Suggestions only — clicking one drops it into the composer, never
       * auto-sends.
       */
      suggestions?: string[];
    }
  | { type: "storage_synced"; at: number }
  | { type: "client_write_ack"; path: string; ok: boolean; error?: string }
  | {
      type: "deploy_state_changed";
      deployment_id: string;
      state: DeploymentState;
      vercel_url: string | null;
      error_message: string | null;
    }
  | {
      /**
       * Agent invoked the `ask_user` tool. UI renders the question + options
       * inline in the chat; the matching `user_question_answered` ClientEvent
       * resumes the agent loop.
       */
      type: "user_question_asked";
      call_id: string;
      question: string;
      options?: string[];
      allow_free_text: boolean;
    }
  | {
      /** Agent loop summarized older turns to fit the context window. */
      type: "history_compacted";
      removed_messages: number;
      before_tokens: number;
      after_tokens: number;
    }
  | {
      /** Current estimated model request size and the automatic-compaction boundary. */
      type: "context_usage";
      estimated_tokens: number;
      context_window_tokens: number;
      compaction_trigger_tokens: number;
      model: string;
    }
  | {
      /** Progress/outcome for a user-requested context compaction. */
      type: "context_compaction_state";
      state: "queued" | "running" | "idle";
      outcome?: "compacted" | "nothing_to_compact" | "failed";
    }
  | {
      /**
       * Agent invoked the `todo_write` tool. UI rerenders the Tasks pane.
       * Stored per-project on the orchestrator; survives across turns.
       */
      type: "todos_updated";
      todos: TodoItem[];
    }
  | {
      /** A new checkpoint was committed to the project's shadow git (Plan §3.5). */
      type: "checkpoint_created";
      sha: string;
      short_sha: string;
      message: string;
      created_at: string;
    }
  | {
      /** Private, per-run bearer used only to reattach after a socket refresh. */
      type: "run_capability";
      session_id: string;
      capability: string;
    }
  | {
      /**
       * Emitted on (re)connect when an agent run for this session is STILL alive
       * on the server — i.e. the turn kept running while the socket was gone
       * (A1). The client re-binds the live run to the new socket, keeps the busy
       * state, and shows a "Build still running — reconnecting…" banner (A2)
       * instead of treating the replayed history as a finished turn. Buffered
       * events emitted while no socket was attached are flushed right after.
       */
      type: "run_active";
      session_id?: string;
      /** Best-effort: the in-flight user prompt, to caption the banner. */
      prompt?: string;
    }
  | {
      /**
       * A package install the AGENT kicked off via run_command is starting /
       * finishing (A4). Lets the client raise a prominent "Installing
       * dependencies — don't refresh" banner (distinct from the agent's own
       * streamed text) and clear it on completion.
       */
      type: "install_state";
      phase: "start" | "end";
      /** The install command, e.g. "npm install" — for the banner caption. */
      command?: string;
    }
  | {
      type: "error";
      message: string;
      /**
       * Machine-readable error class so the client can show friendly copy +
       * choose a retry policy (C7): e.g. "rate_limit", "provider_auth",
       * "provider_5xx", "overloaded", "boot_timeout", "max_iterations",
       * "missing_key". Absent ⇒ render the generic error card.
       */
      code?: string;
      /** True for transient classes the run may auto-retry / the user may retry. */
      retryable?: boolean;
    };

export interface TodoItem {
  content: string;
  activeForm: string;
  status: "pending" | "in_progress" | "completed";
}

export interface PreviewServer {
  id: string;
  command: string;
  port: number;
}

export interface TreeEntry {
  path: string;
  is_dir: boolean;
}


// ── Curated design skill packs ───────────────────────────────────────────────
// Inlined here (not a separate module) so the single "@gate15/api-types" entry
// resolves cleanly under both the orchestrator (NodeNext) and Next (webpack).

export interface SkillPack {
  /** Stable id used by the apply-pack API + the picker. */
  id: string;
  /** Display name. */
  name: string;
  /** One-line "what it is / when to use" shown in pickers. */
  summary: string;
  /** Full markdown guidance written into the project Skills file. */
  body: string;
}

export const SKILL_PACKS: readonly SkillPack[] = [
  {
    "id": "hi-fi-minimal",
    "name": "Hi-Fi Minimal",
    "summary": "Airy premium product/marketing UI: ink on cool white, hairline grid + plus-marks, one cobalt action per view. Linear/Vercel lineage.",
    "body": "# Design: Hi-Fi Minimal\n\nBase craft rules (states, accessibility, responsive, real content) still apply — this pack sets the art direction. Explicit user direction overrides it.\n\n## When to use\nPremium product marketing sites, developer-product landing pages, changelogs, pricing pages, and polished settings/product surfaces that must feel Linear/Vercel/Stripe-grade. NOT for dense operational dashboards (saas-dashboard) or expressive brand/editorial work.\n\n## Direction\nAiry precision: near-monochrome ink on cool white, structure carried by hairlines and whitespace, exactly one electric-cobalt action per view. Lineage: Linear's marketing site, Vercel's grid-ruled pages, Stripe docs. The brief: engineered calm — the restraint IS the flex.\n\n## Palette\nLight-first, committed; no dark variant unless asked.\n- Background #FBFBFC; surface #FFFFFF; ink text #0A0C10; muted text #5C6470; hairline/border rgba(10,12,16,0.08) (solid fallback #E4E6EA).\n- Dominant is the ink itself. Accent: cobalt #3B5BFD; hover #2E4AE0; focus ring #3B5BFD at 35%.\n- Semantic (rare): success #17843B, danger #D92D20 — text-level only, never filled banners.\n- Derive every gray as ink at an alpha over #FBFBFC (border 8%, disabled 35%, muted 62%). No stock Tailwind grays.\n\n## Type\nOne family: Geist ('Geist', 'Helvetica Neue', Arial, sans-serif), with Geist Mono ('Geist Mono', ui-monospace, 'SF Mono', monospace) for micro-labels, metadata, and code. Contrast comes from size and weight steps inside Geist, never a second display face.\n- Hero: clamp(2.75rem, 6vw, 4.5rem), weight 550 (variable), line-height 1.02, letter-spacing -0.025em.\n- Section titles 28-32px/550; body 15px/1.6 weight 400; UI text 13-14px/450.\n- Micro-labels: Geist Mono 11px uppercase, +0.08em, muted, prefixed with a slash: \"/ 02 — PRICING\".\n\n## Shape & composition\n- Radii: 6px controls, 10px panels, 999px only for avatars. Depth = 1px hairlines, not shadows; the single shadow tier is popovers/menus: 0 4px 16px rgba(10,12,16,0.08).\n- Airy density: sections 112-144px vertical padding, content max-width 1120px on the 12-col grid.\n- Hairline rules run FULL-BLEED viewport edge to edge while content stays contained — the page reads as a drafted sheet.\n- Hero: 8/4 split, left-weighted headline; the right column holds a bordered product frame that bleeds off the right viewport edge.\n- Features as hairline-divided editorial list rows, not card grids.\n\n## Components\n- Buttons: 36px height, 6px radius, 14px/500 label. Primary = cobalt fill, white text. Secondary = white fill, 1px ink-12% border; hover darkens border to 24% and label to full ink — no elevation change, no scale.\n- Inputs: 36px, 1px hairline, 6px radius; focus = 2px cobalt ring offset 2px; label 13px/500 above.\n- Nav: 56px, hairline bottom border; links 14px muted, easing to ink over 150ms on hover; one cobalt CTA at far right.\n- Cards: white, hairline border, 24px padding; hover = border to ink-24%, never a lift.\n- Product screenshots sit in a 1px hairline frame, 10px radius, with a 32px CSS-drawn browser-chrome bar.\n\n## Motion\nInstant and crisp: 120-160ms ease-out, zero bounce, no parallax. One indulgence: the hero headline and product frame rise 12px and fade in once over 400ms. Everything after is state-change only (color, border) — this style animates almost nothing and feels faster for it.\n\n## Signature moves\n- Grid plus-marks: at intersections of the full-bleed hairlines, render 9px \"+\" glyphs in ink at 25% — the drafting-table tell.\n- Slash labels: every eyebrow starts with \"/ \" in Geist Mono and numbers its section (\"/ 01\", \"/ 02\"), doubling as page wayfinding.\n- One cobalt per viewport: exactly one cobalt element visible at any scroll position (the CTA). If a second appears, demote it to ink.\n- Machined buttons: primary buttons carry an inset 1px top highlight (inset 0 1px 0 rgba(255,255,255,0.18)).\n\n## Avoid\n- Any gradient wash, mesh, or glow — this style's atmosphere is paper-flat.\n- Shadow-based cards or hover lifts; depth here is drawn with lines.\n- A second accent hue anywhere, charts included (use ink-alpha steps plus cobalt).\n- Illustration, emoji, or stocky iconography as content; imagery is product frames and geometry.\n- Warm/cream neutrals (#FAF9F7 territory) — the sheet stays cool and lab-like.\n- Filling whitespace: if a section feels empty, the type is too small — scale type up, never add elements."
  },
  {
    "id": "saas-dashboard",
    "name": "SaaS Dashboard",
    "summary": "Dense operational/admin UI: teal-tinted workspace, hairline KPI strip, command bar, status-dot tables — scan fast, act confidently.",
    "body": "# Design: SaaS Dashboard\n\nBase craft rules (states, accessibility, responsive, real content) still apply — this pack sets the art direction. Explicit user direction overrides it.\n\n## When to use\nOperational and admin products: CRMs, back-offices, billing consoles, monitoring, queues, internal tools — screens whose job is scanning many records and acting confidently. NOT for marketing pages (hi-fi-minimal) or narrative analytics reports (data-story).\n\n## Direction\nCalm operational density: a cool teal-tinted workspace where hundreds of rows stay legible and the primary action is always obvious. Lineage: Stripe Dashboard, Retool, Height. Brief: an instrument panel, not a brochure — nothing decorative, everything scannable.\n\n## Palette\nLight-first, committed (dark only on explicit request).\n- Canvas #F6F8F8; surface #FFFFFF; text #14201D; muted #5B6B67; border #DCE4E2; row hover #F0F5F4; selected #E6F3F1.\n- Primary/dominant: teal #0F766E; hover #115E59; focus ring #0F766E at 40%.\n- Semantic set (used constantly): success #15803D, warning #B45309, danger #B91C1C, info #0369A1, neutral #64748B — each gets a 10%-tint chip background (success chip #E8F5EC pattern).\n- Derive grays by mixing the teal hue (~172) into neutrals at 6-10% saturation.\n\n## Type\nOne family: IBM Plex Sans ('IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif) with IBM Plex Mono ('IBM Plex Mono', ui-monospace, monospace) for IDs, keys, and timestamps. No display face — dashboards have no hero; contrast comes from weight (400/500/600) and the mono switch.\n- Page title 20px/600; panel title 14px/600; body and table cells 13px/400; KPI numerals 28px/600; micro-labels 11px uppercase +0.06em muted.\n- IDs and API keys always IBM Plex Mono 12px inside a bordered chip.\n\n## Shape & composition\n- Radii 6px controls, 8px panels. Depth = 1px #DCE4E2 borders; the one shadow tier is overlays: 0 8px 24px rgba(20,32,29,0.12).\n- Density: 16px panel padding, 12px gaps, 40px table rows (ship a 32px compact toggle), 8px between related controls. Never inflate padding past 24px inside data regions.\n- Frame: 240px fixed left nav (collapsible to a 56px icon rail) + fluid content under a 48px top bar.\n- Master-detail: clicking a row opens a 400px right side panel; modals exist only for destructive confirms.\n- KPI band: one 72px full-width strip of hairline-divided cells directly under the page title — never a grid of stat cards.\n\n## Components\n- Buttons 32px, 6px radius, 13px/500: primary teal fill; secondary white + border; destructive = ghost red text, fills #FEF1F1 on hover.\n- Inputs/selects 32px, 12px/500 labels above; filters are 24px chips with a clear-x and a live count (\"Status: Active · 128\").\n- Tables: sticky 36px header (bg #FBFDFD, 11px uppercase labels), 40px checkbox column, status = 6px dot + 12px label, actions column pinned right and revealed on hover.\n- Status pills 20px tall: tint chip background + 12px semantic-color text.\n- Empty panel state: 13px explanation + one 32px primary action, centered in the panel, never the whole page.\n\n## Motion\nNear-instant: 80-120ms ease-out; hover 0ms in / 120ms out. Optimistic UI — rows update immediately and reconcile silently. KPI numerals tick over 300ms on live change. Side panel slides in 200ms. No entrance choreography inside the app; only login/first-run may stagger once (300ms).\n\n## Signature moves\n- The KPI strip: hairline-DIVIDED cells, not cards — each cell is a 28px numeral + 12px delta arrow + a 56x20px inline sparkline, reading together as one instrument row.\n- Command bar as centerpiece: a 240px \"Cmd-K — search or jump to…\" pill seated center of the top bar, expanding to a 560px palette; it is the fastest path to every object.\n- Saved-view tabs above every table with live record counts: \"All 1,204 · Overdue 37 · Flagged 8\".\n- Row anatomy: every table row leads with its status dot; trend columns render 48px inline sparklines, never mini bar charts.\n\n## Avoid\n- Marketing gestures inside the app: heroes, gradient banners, oversized display type.\n- Equal-card stat grids, and charts as decoration — a chart that doesn't drive a decision gets cut.\n- Editing in modals (side panel or inline instead); modal-on-modal never.\n- More than one teal-filled primary action per view region.\n- Whitespace inflation that drops visible rows below ~12 on a laptop screen.\n- Skeleton shimmer beyond 1s — show cached data or counts instead."
  },
  {
    "id": "developer-tool",
    "name": "Developer Tool",
    "summary": "Dark mono-forward code workspace: blue-charcoal panels, JetBrains Mono data, one matte amber accent, split panes, keycap hints.",
    "body": "# Design: Developer Tool\n\nBase craft rules (states, accessibility, responsive, real content) still apply — this pack sets the art direction. Explicit user direction overrides it.\n\n## When to use\nCode-facing workspaces: IDE-likes, API consoles, CI/CD and infra dashboards, log explorers, database clients, CLI companion UIs. NOT for marketing sites (even dev-tool marketing — hi-fi-minimal) and not CRT nostalgia (terminal-retro owns phosphor-and-scanlines).\n\n## Direction\nA modern dark workshop: blue-charcoal panels, mono-forward type, amber as the single point of heat. Lineage: Zed, Warp, GitHub dark, Raycast. Brief: the UI is a tool on a bench — matte, dense, precise, no glow.\n\n## Palette\nDark-first, committed; light mode only on explicit request.\n- Background #0C0F14; panel #12161D; raised/hover #171C24; text #E6EAF0; muted #8B94A3; border #232A35.\n- Accent: amber #FFB224 (hover #FFC554; text-on-amber #0C0F14). Amber doubles as the warning color — in a dev tool, attention IS the accent.\n- Semantic: error #F26D6D, success #56C288, info #6CB6FF. Diff backgrounds: add rgba(86,194,136,0.14), remove rgba(242,109,109,0.14).\n- Derive: every surface is hue 215 at 4-8% saturation, stepping lightness 5-7% per layer. Never pure #000.\n\n## Type\nSpace Grotesk ('Space Grotesk', 'Helvetica Neue', sans-serif) for UI prose, nav, and headings; JetBrains Mono ('JetBrains Mono', ui-monospace, 'Cascadia Code', monospace) for code, data, paths, IDs, numbers, and labels. Mono-forward rule: when unsure whether a string is prose or data, it is data — set it mono.\n- Panel/page headings 16-20px Space Grotesk 500; UI body 14px/1.5.\n- Code and log lines JetBrains Mono 13px/1.6; data cells 12.5px; micro-labels 11px mono uppercase +0.06em.\n- Weights cap at 600; hierarchy comes from the text-to-muted color step and the mono/sans switch.\n\n## Shape & composition\n- Radius 4px everywhere (6px for floating palettes); 1px #232A35 borders; the only shadow is overlays: 0 8px 24px rgba(0,0,0,0.5).\n- High density: 26px tree rows, 32px tabs, 8-12px panel padding, a 44px icon activity rail on the far left.\n- Workspace = split panes with 1px draggable gutters (gutter turns amber while dragging); a 240px bottom console drawer toggled by keystroke.\n- Editor-style tab bar: 32px tabs with filename, unsaved dot, and a close-x on hover.\n\n## Components\n- Buttons 28px, 4px radius, 13px: default #171C24 fill + border; primary amber fill with #0C0F14 text; danger ghost, filling #F26D6D on hover.\n- Inputs 28px, mono text, background #0C0F14 inset within panels; focus = 1px amber border, no glow ring.\n- Command palette 560px wide, anchored at 20vh, mono input, results show dim path breadcrumbs.\n- Tree/list rows 26px; selected = #171C24 fill + 2px amber left rule.\n- Toasts bottom-right, 320px, 2px left border in the semantic color, mono timestamp.\n- kbd keycaps: 20px tall, JetBrains Mono 11px, #171C24 fill, 1px border with a 2px bottom edge — placed beside major actions.\n\n## Motion\nSnappy and mechanical: 100-140ms, flat easing, no spring or bounce. Direct manipulation is unanimated (pane drag, scroll = 0ms). The only thing that blinks is the caret in command/search inputs. Long jobs render a determinate mono progress line (\"[####----] 52%\") instead of a spinner whenever progress is knowable.\n\n## Signature moves\n- Copyable ID chips: every entity (run, commit, container, key) shows its short ID in a mono chip; clicking copies it and flashes a 300ms amber underline.\n- Severity gutter: log/console rows carry a 2px left rule colored by level (muted/info/amber/error); row hover reveals a right-aligned dim timestamp gutter.\n- The amber caret: one active-state marker shared everywhere — 2px amber rule (left edge on nav, top edge on tabs, full 1px border on the focused pane).\n- Keycap culture: real kbd keycaps beside actions and inside empty states (\"Press Cmd-K to jump\") — the UI teaches its own shortcuts.\n\n## Avoid\n- Glows, neon, gradients, scanlines — heat comes from one matte amber, not light bloom.\n- Pure #000 backgrounds or #FFF text (text ceiling is #E6EAF0).\n- Rounded-full pills and buttons; radius stays at or under 6px.\n- Body paragraphs in mono — prose is Space Grotesk; mono is for machine-adjacent strings.\n- Muted text below #8B94A3 on panel backgrounds — it falls under AA.\n- Decorative charts; chart only owned time-series (build times, latency), drawn as thin muted lines with amber for the focus series."
  },
  {
    "id": "data-story",
    "name": "Data Story",
    "summary": "Chart-led analytical reports on warm paper: one vermilion series per chart, findings as sentence titles, direct labels, no legends.",
    "body": "# Design: Data Story\n\nBase craft rules (states, accessibility, responsive, real content) still apply — this pack sets the art direction. Explicit user direction overrides it.\n\n## When to use\nAnalytical reports, exec dashboards read top-to-bottom, KPI reviews, public data essays, post-mortems — pages that argue ONE insight with charts. NOT for live operational monitoring (saas-dashboard) or transactional money UI (calm-finance).\n\n## Direction\nEditorial data journalism on warm paper: prose leads, charts prove, one vermilion series carries the argument. Lineage: FT Visual Journalism, The Pudding, Our World in Data. Brief: the chart is a sentence, not a widget.\n\n## Palette\nLight-first, on warm paper.\n- Background #FAF7F2; charts sit directly on the paper (never boxed on white cards); text #1F1B16; muted #6E655A; hairline #E7E0D5; tooltip surface #FFFDF9.\n- Focus color: vermilion #E4572E — the ONE colored series/bar/point per chart. Context series: #C9C1B4 and #A39B8E.\n- Only when series genuinely must be told apart: slate #46688B, ochre #C6912C, moss #5F7350 (4 hues max including vermilion).\n- Deltas in prose and stat blocks: positive #227A4B, negative #B42318, rendered as signed text (+38%).\n- Derive neutrals from the paper's warm hue (~40) at 8-12% saturation.\n\n## Type\nNewsreader ('Newsreader', Georgia, 'Times New Roman', serif) for display and insight titles — weight 500, italic for emphasis — paired with Public Sans ('Public Sans', 'Helvetica Neue', Arial, sans-serif) for body, axis labels, and annotations.\n- Big-number lede: clamp(3.5rem, 8vw, 6rem) Public Sans 600 tabular-nums, its meaning set beneath in 18px Newsreader.\n- Insight titles 22px Newsreader 500; prose 16px/1.7 Public Sans at 68ch measure.\n- Axis labels 11px Public Sans #6E655A; annotations 13px; source lines 12px muted.\n\n## Shape & composition\n- Prose column 720px; charts BREAK OUT to 960-1080px — the alternation of narrow text and wide evidence is the page's silhouette.\n- Section breaks are full-width hairlines with a small-caps kicker. Radius 0-4px, no card chrome, no shadows: ink on paper.\n- Margin annotations: short callouts hang in the whitespace beside the prose column, tied to their paragraph.\n- The centerpiece is a scrollytelling block: the chart pins in a 7-col right rail while 4-col prose steps scroll past, each step restyling the chart (highlight, zoom, annotate).\n- One chart per point: a section makes one claim, shows one chart, moves on.\n\n## Components\n- Chart header: the sentence title plus a 13px method subtitle (\"Monthly actives, Jan 2024-Jun 2026 · excludes internal accounts\").\n- Source line under EVERY chart: \"Source: internal billing · n=12,480\", 12px muted, hairline rule above it.\n- Stat blocks: 40px tabular numeral + signed delta + one-line context, laid as a hairline-divided row of at most 3.\n- Chart controls (only when needed): 28px ghost toggle chips (\"Weekly / Monthly\") — muted until active, then vermilion text with a hairline underline.\n- Tooltips: #FFFDF9 surface, 1px #E7E0D5 border, 13px, tabular values, anchored to a 12px dot marker on the series.\n\n## Motion\nCharts draw ONCE on scroll-into-view: axes fade 200ms, series draw left-to-right 700ms ease-out, annotations fade in last (150ms). The lede number counts up 800ms on load. Scrollytelling steps crossfade 240ms. Nothing loops, nothing pulses; after the draw, the page is still.\n\n## Signature moves\n- The one-vermilion rule: every chart has exactly one colored series; all context stays warm gray. Color IS the argument — a squinting reader still finds the point.\n- Findings as titles: chart titles are full sentences stating the takeaway (\"Churn halved after the onboarding rework\"), never metric names (\"Churn rate\").\n- Direct labels, no legends: series are named at their line-ends; annotation callouts run 1px leader lines to the exact datapoint they explain.\n- Charts wider than words: every chart escapes the 720px prose column — evidence physically outweighs commentary.\n\n## Avoid\n- Legends when direct labels fit (nearly always).\n- More than one colored series per chart; rainbow categorical palettes.\n- Dual y-axes, 3D, donuts beyond 2 segments, gridlines darker than #E7E0D5.\n- Boxing charts in bordered/shadowed white cards — charts live on the paper.\n- Truncated y-axes without an explicit axis-break note on the chart.\n- Dashboard furniture: filter bars, KPI grids, auto-refresh — this is an argument, not a console."
  },
  {
    "id": "premium-commerce",
    "name": "Premium Commerce",
    "summary": "Photography-led storefront + checkout: warm studio catalog, black pill CTAs with live price, conversion trust without urgency clutter.",
    "body": "# Design: Premium Commerce\n\nBase craft rules (states, accessibility, responsive, real content) still apply — this pack sets the art direction. Explicit user direction overrides it.\n\n## When to use\nStorefronts, product detail pages, cart/checkout, DTC brand shops, catalog-led marketing. NOT for content-first magazines (editorial-brand) or hushed high-fashion minimalism (luxury-boutique) — this pack sells with photography and an honest path to purchase.\n\n## Direction\nA confident studio catalog: the product photograph is the hero, everything else is quiet infrastructure serving add-to-cart. References: Apple Store PDPs, Herman Miller shop, Bellroy, Fellow. Brief: \"one photo shoot, one green, zero urgency tricks.\"\n\n## Palette\nLight mode, committed.\n- Background #FBF9F5 (warm ivory) · Surface #FFFFFF\n- Studio tint #F1EBE1 — the wash EVERY product image sits on\n- Text #1D1915 · Muted #6F675C · Border #E8E1D5\n- CTA ink #17140F (near-black, the buy color)\n- Accent #1E5B44 laurel green: in-stock, savings, cart badge, success\n- Error #B3261E · Review stars #C98A2D (stars only)\nNeutrals derived at hue ~38, 6-12% saturation. Green never fills buttons; ink does.\n\n## Type\n- Display: Bricolage Grotesque (600/700) — headlines, section titles, product names (20-24px at 600). Hero clamp(2.75rem, 6vw, 5rem), letter-spacing -0.02em.\n- Text/UI: Instrument Sans (400/500) — body 16px/1.6, specs, meta. Fallbacks: ui-sans-serif, Helvetica, sans-serif.\n- Prices: Instrument Sans 500, tabular-nums, same size as or smaller than the product name — never bolder.\n- Eyebrows/badges: Instrument Sans 11px uppercase +0.08em.\n\n## Shape & composition\n- Radius: 12px images/tiles, 10px inputs, 999px (pill) buttons.\n- Depth: hairline borders, no shadows on tiles; shadow only on the sticky buy bar and cart drawer (0 8px 30px rgba(29,25,21,0.12)).\n- PDP: 7/5 split — gallery left, bleeding to the viewport edge; sticky buy panel right (title, price, variants, CTA, trust row).\n- Product grid is a true collection: uniform 4:5 tiles, 2-col mobile / 4-col desktop, 24px gaps; interrupt every ~8 tiles with one full-bleed lifestyle band carrying a single line of copy.\n- Cart is a 480px right drawer, not a page; checkout is one 560px column, near-invisible design, summary collapses on mobile.\n\n## Components\n- Primary CTA: 52px pill, #17140F fill, ivory text; hover darkens to #000, scale 1.02.\n- Secondary: 52px pill, 1px #1D1915 border, transparent fill.\n- Product tile: image on #F1EBE1, name, price, 16px swatch dots; hover cross-fades to the alternate shot (300ms) — no zoom.\n- Inputs: 52px, 10px radius, 1px border, focus ring in #1E5B44.\n- Trust row: three 12px-caps items with lucide icons (shipping / returns / warranty) directly under the PDP CTA.\n- Nav: 32px announcement bar (#17140F, ivory 12px text), 64px header, cart count badge in #1E5B44.\n- Reviews: \"4.8 · 2,314 reviews\" in ink; stars #C98A2D.\n\n## Motion\nSettled and responsive: 200-300ms ease-out. Gallery cross-fades 300ms. Cart drawer slides 300ms, line items stagger 40ms. Add-to-cart moment: button label swaps to \"Added\" while the cart badge pulses once (scale 1 to 1.3 to 1, 350ms) — the one celebratory beat.\n\n## Signature moves\n- Price lives inside the primary CTA — \"Add to bag — $148\" — and updates live with variant and quantity.\n- Studio tint: every product image sits on #F1EBE1 (or a per-product tint at identical lightness), so the whole catalog reads as one photo shoot.\n- Sticky buy bar: when the PDP CTA scrolls out of view, a 64px bottom bar appears with thumbnail, name, price, CTA.\n- The editorial break band: one full-bleed lifestyle image per ~8 grid tiles, single caption line, no button.\n\n## Avoid\n- Urgency theater: countdown timers, \"Only 2 left!\" flashes, blinking sale stickers.\n- Discount shouting: sale price larger or louder than the product name.\n- Zoom-on-hover tile scaling (cross-fade to the alternate shot instead).\n- Autoplaying hero or gallery carousels.\n- Mixed aspect ratios inside one product grid; drop shadows on tiles.\n- Trust-badge soup: stacked rows of SSL/payment/lock icons.\n- Newsletter or chat modals before the first add-to-cart."
  },
  {
    "id": "editorial-brand",
    "name": "Editorial Brand",
    "summary": "Magazine-grade narrative pages: Fraunces headlines with one italic phrase, vermilion kickers, drop caps, thick-thin print rules.",
    "body": "# Design: Editorial Brand\n\nBase craft rules (states, accessibility, responsive, real content) still apply — this pack sets the art direction. Explicit user direction overrides it.\n\n## When to use\nBrand storytelling, magazines/journals, agency and studio sites, longform campaign and manifesto pages. NOT for transactional flows, dashboards, or product catalogs (use premium-commerce for selling, luxury-boutique for hushed fashion).\n\n## Direction\nA printed magazine that learned to scroll: front-page confidence, images that lead, type set by a headline desk. References: The Gentlewoman, NYT Magazine features, Bloomberg Businessweek, It's Nice That. Brief: \"ink on paper, one red pencil.\"\n\n## Palette\nLight mode, committed — this is paper.\n- Paper #F5F1E8 · Raised panel #FDFBF6\n- Ink #211D17 · Muted #797061 · Hairline #DDD5C6\n- Vermilion #D2401E — kickers, folios, links, drop caps. The only working color.\n- Plate #1F4A46 (deep teal) — at most ONE full-bleed section cover band per page.\nNeutrals derived at hue ~40, 8-14% saturation. No dark mode.\n\n## Type\n- Display: Fraunces (400-700) — headlines with exactly ONE italic phrase inside each; hero clamp(3rem, 8vw, 7rem), line-height 0.95. Standfirst/deck: Fraunces 300 italic, 22-26px.\n- Body: Newsreader 17px/1.65, measure 65ch. Fallback: Georgia, serif.\n- Kickers, bylines, captions, nav: Libre Franklin 11-12px uppercase +0.12em. Fallback: Helvetica, Arial, sans-serif.\n- Hierarchy: kicker (Franklin caps, vermilion) then headline (Fraunces) then deck (italic) then byline row — every article surface repeats this stack.\n\n## Shape & composition\n- Radius 0 everywhere; no shadows. Depth = overlap and rules, like print.\n- 1px hairlines structure the page; body text lives in cols 2-8 of 12 with pull quotes and images hanging into the leftover margin.\n- Full-bleed image sections with the headline overlapping the image's bottom edge by ~0.5em.\n- Chapters open with \"No. 02 — The Process\" kickers and an oversized folio numeral.\n- Captions sit in the margin beside images: Franklin 12px muted with an em-dash prefix (\"— Shot in Oslo, 2026\").\n\n## Components\n- Links over buttons: 1px underline, 3px offset, hover turns #D2401E. When a button is required: 48px, square, 1px ink border, Franklin caps 12px, transparent; hover fills ink.\n- Article lists: hairline-divided full-width rows — vermilion kicker, Fraunces title, one-line deck, Franklin meta. Never card grids.\n- Byline block: hairline rule above and below; \"Words — Amara Osei · Photography — Jonas Lindqvist\".\n- Nav: print masthead — centered Fraunces wordmark, thick-thin rule beneath, Franklin caps links under it.\n- Quotes: Fraunces italic 28-36px, breaking out of the text column into the margin, vermilion open-quote glyph at 2x size.\n\n## Motion\nRestrained print energy: 250-400ms ease-out. Images reveal with a clip-path wipe, inset(0 0 100% 0) to inset(0), 500ms. Full-bleed images may parallax 4-6%, nothing more. Headlines never animate letter-by-letter.\n\n## Signature moves\n- Thick-thin masthead rule: a 4px bar over a 1px hairline, 3px apart — under the header, above the footer. The print tell.\n- Drop caps: first paragraph after any headline opens with a 3-line Fraunces drop cap in #D2401E.\n- Oversized folios: chapter numerals in Fraunces italic at 120-180px, overlapping the section's lead image.\n- One italic phrase per headline — emphasis by italics, never by color; vermilion belongs to kickers and folios.\n\n## Avoid\n- Rounded corners or drop shadows anywhere — they break the print metaphor instantly.\n- Vermilion used as fills, backgrounds, or body text; it is a pencil, not a paint bucket.\n- Card grids for articles or features — ruled list rows and offset stacks only.\n- Sans-serif headlines; Franklin stays in kickers, captions, and nav.\n- Hero sliders or rotating covers.\n- Typewriter/letter-by-letter headline animation.\n- Color-tinted duotone photography — run images honest, full color or true monochrome."
  },
  {
    "id": "playful-consumer",
    "name": "Playful Consumer",
    "summary": "Candy-bright rounded consumer app — taffy pink on cream, sticker cards, squishy springs. For habit/todo/social apps meant to feel fun.",
    "body": "# Design: Playful Consumer\n\nBase craft rules (states, accessibility, responsive, real content) still apply — this pack sets the art direction. Explicit user direction overrides it.\n\n## When to use\nConsumer apps where the task should feel effortless and fun: habit trackers, todo and list apps, social/sharing tools, event planners, casual utilities. NOT for money, health data, or professional workflows — playfulness reads as unserious there.\n\n## Direction\nCandy-store energy on a warm cream canvas: saturated sweet-shop color, sticker-like cards, everything rounded and squishy. References: Gumroad's pink era, Cash App's confident color blocking, Nintendo Switch eShop chrome, Poolsuite's sunny irreverence. Brief: \"a toy you trust\".\n\n## Palette\nLight mode, committed. Saturation is the point — candy, not pastel.\n- Background #FFF9EF (warm cream), surface #FFFFFF, raised tint #FFF3E2\n- Text #33234B (plum ink), muted #7A6C8F\n- Borders are 2px solid #33234B ink outlines on interactive elements — no gray hairlines anywhere\n- Dominant #FF5A8A (taffy pink): primary actions, hero blocks, active states\n- Support candies (chips, illustration, chart series ONLY — never actions): #FFC940 lemon, #3ECF8E mint, #5B8DFF berry\n- Semantic: success #21B573; error #F04E4E text on #FFE9E9 pill — friendly, never full-bleed red\n- Derive tints by mixing the dominant into the cream (pink-100 #FFE4EC for selected/halo states), never into gray.\n\n## Type\n- Display: Fredoka (SemiBold 600), fallback \"Comic Neue\", system-ui — headings, big numerals, empty-state titles. Sentence case, letter-spacing 0. Cap display weight at 600; Fredoka gets chunky fast.\n- Text: Nunito (400/700), fallback \"Trebuchet MS\", sans-serif — body 16px/1.6; buttons and labels 700.\n- Micro-labels: Nunito 800, 12px uppercase +0.06em, on candy chip fills.\n- Hero scale clamp(2.2rem, 6vw, 4rem).\n\n## Shape & composition\n- Radii: cards 24px, inputs 16px, buttons pill (999px), images 20px. Nothing under 12px.\n- Depth = die-cut sticker: 2px ink outline wrapped in a 4px white rim (box-shadow 0 0 0 4px #FFFFFF) over a pink-tinted drop (0 8px 20px rgba(255,90,138,0.25)) on tappable elements; static surfaces are flat and shadowless.\n- Density: generous — 24px card padding, 20px gaps, 96px section rhythm.\n- Layout moves: one hero card tilted -2deg among straight siblings; big rounded color-block sections (dominant or lemon fills, 32px radius) breaking up the cream; streaks/counts as oversized Fredoka numerals (72px+) with the label tucked small beneath.\n\n## Components\n- Buttons: 52px pill, taffy fill, ink text 700, the die-cut treatment; hover = translateY(-3px) with the drop deepening to 0 12px 28px at 0.35 alpha; press = squish to scale 0.94, spring back with overshoot. Secondary: cream fill, same treatment.\n- Cards: white, 24px radius; tappable cards get the die-cut treatment, static ones get neither.\n- Inputs: 52px, 16px radius, cream fill, 2px ink border; focus = border flips to taffy + 4px #FFE4EC halo.\n- Chips: pill, support-candy fills at full saturation, ink text, Nunito 800 12px caps.\n- Nav: floating pill bar (bottom on mobile, top on desktop), white with ink outline; active item sits on a #FFE4EC pill.\n\n## Motion\nSpringy and juicy: springs (stiffness 400, damping 18) with visible overshoot on scale/translate — never on opacity. Signature moments: (1) completed items squash (scaleY 0.8) and pop back before sliding away; (2) ONE confetti burst (canvas, 400ms, palette colors only) when the day's LAST task completes — once, not per task.\n\n## Signature moves\n- Die-cut stickers: ink outline + 4px white rim + pink drop + hover-lift + squish-press on every tappable element. This combo IS the identity.\n- The tilted hero: exactly one card or badge per screen rotated -2deg, straightening to 0deg on hover.\n- Candy numerals: totals and streaks set huge in Fredoka with one organic SVG blob in a support candy peeking from behind (one blob per screen).\n- Mascot-scale empty states: a large flat SVG object or character (160px+, palette colors) with one cheerful line and one button — the empty state is a stage, not an apology.\n\n## Avoid\n- Pastel or desaturated fills as primary color — washed-out candy reads as a baby product.\n- Gray/black shadows, hard offset shadows, or 1px gray borders — shadows are pink-tinted blurs; structure is ink outlines.\n- Dark mode; the cream canvas is the brand.\n- Corporate blue, gradient text, glass blur.\n- More than one tilted element or one blob per screen — playful is not chaotic.\n- Solid bottom-edge \"3D\" pressable buttons (Duolingo-style) — press feedback here is squish, not landing; that edge belongs to a different style.\n- Weights under 400 anywhere; thin type collapses the toy feel."
  },
  {
    "id": "accessibility-first",
    "name": "Accessibility First",
    "summary": "WCAG 2.2 AA in practice: semantics, form errors, focus management, live-region announcements, media. Stacks with any visual pack.",
    "body": "# Accessibility First\n\nBuild to WCAG 2.2 AA as verified practice — real semantics, managed focus, announced dynamics — beyond the base contrast/keyboard/reduced-motion rules. Explicit user direction overrides it.\n\n## When to use\nWhenever accessibility is named, for public-sector or enterprise compliance, or any broad-reach consumer product. Stacks with any visual pack.\n\n## Rules\n\n### Semantics\n- Landmarks: exactly one <main>; label repeated landmarks (<nav aria-label=\"Primary\">); the first focusable element is a skip link targeting #main.\n- One <h1> per page; never skip heading levels downward.\n- Native elements before ARIA: <button>, <a href>, <details>, <dialog>, <select>. Clickable <div>/<span> is banned. URL change = <a>; in-page action = <button>.\n- Icon-only buttons get aria-label naming the action (\"Delete invoice\"); decorative SVGs get aria-hidden=\"true\" focusable=\"false\".\n- Wire state: aria-expanded on disclosure triggers, aria-current=\"page\" in nav, aria-pressed on toggles; tabs = role tablist/tab/tabpanel with Arrow-key movement and roving tabindex.\n- Targets ≥24×24 CSS px (2.5.8) — pad small icon buttons; 44×44 for primary mobile actions.\n- Alt text: informative images describe meaning in context; functional images name the destination or action; decorative images get alt=\"\" (never omit the attribute). Charts: one-line alt plus the data as adjacent text or a table.\n\n### Forms\n- Every control has <label htmlFor>; radio/checkbox groups use <fieldset><legend>.\n- autocomplete tokens on identity fields: name, email, tel, street-address, postal-code, current-password, new-password, one-time-code (1.3.5).\n- Errors: aria-invalid=\"true\" on the field, message tied via aria-describedby; message text = what happened + how to fix (\"Enter a date after today\", not \"Invalid input\"). On failed submit, focus an error summary (tabindex=\"-1\") at the top that links to each bad field.\n- Validate on blur or submit, never per keystroke; never clear entered values on error; never re-ask for data given earlier in the flow (3.3.7).\n- Auth (3.3.8): never block paste; support password managers via autocomplete; offer an email-link or OTP path instead of transcription puzzles.\n\n### Focus management\n- SPA route change: set document.title, then focus the new page's <h1 tabindex=\"-1\">.\n- Modals: <dialog>.showModal(), or a trap (Tab cycles inside, Esc closes); restore focus to the trigger on close. Same for menus and popovers.\n- When the focused element is removed (row delete, toast dismiss), move focus to the next item or the list container — never let it fall to <body>.\n- Sticky headers: scroll-margin-top ≥ header height on focusable targets so focus is never hidden behind them (2.4.11).\n- Every drag interaction (reorder, kanban, slider) also works via single clicks or buttons, plus keyboard (2.5.7).\n\n### Announcements\n- Mount ONE persistent polite region at app root on load — <div role=\"status\" aria-live=\"polite\" class=\"sr-only\"> — and inject text into it; regions created at announce time are not read.\n- role=\"status\" for success, toasts, and result counts; role=\"alert\" only for urgent errors.\n- Announce async outcomes: \"12 results\", \"Saved\", \"Item removed\". Coalesce rapid updates — announce the settled state, not every tick.\n- Mark updating containers aria-busy=\"true\"; for loads over 2s announce start and completion.\n\n### Media\n- Video with speech ships <track kind=\"captions\"> (WebVTT); audio-only content gets an adjacent transcript; prerecorded video also needs audio description or a descriptive transcript (1.2.5).\n- No autoplaying sound; anything auto-moving longer than 5s gets a visible pause/stop control (2.2.2).\n\n## Defaults\n- .sr-only: position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0\n- Field recipe: <label for> + <input autocomplete aria-describedby=\"hint err\">; hint always in the DOM, error text injected alongside aria-invalid.\n- Verify pass: run an axe scan and fix every critical/serious finding; then keyboard-only walk the primary flow — everything reachable in logical order, Esc closes every overlay, no traps, focus never lost.\n\n## Avoid\n- ARIA where HTML suffices: role=\"button\" on a div, aria-label duplicating visible text.\n- Live regions injected on demand; toasts that appear and vanish silently.\n- tabindex values greater than 0 anywhere.\n- A disabled submit button as the only validation feedback — keep it enabled, validate, announce.\n- Critical content only in hover tooltips that can't be hovered into or dismissed (1.4.13).\n- Auto-moving focus while the user is typing (OTP/date auto-advance with no way back)."
  },
  {
    "id": "mobile-native",
    "name": "Mobile Native",
    "summary": "Phone-first app patterns — bottom tabs, sheets over modals, collapsing headers, thumb-zone CTAs, safe areas. Neutral chassis, any palette.",
    "body": "# Design: Mobile Native\n\nBase craft rules (states, accessibility, responsive, real content) still apply — this pack sets the art direction. Explicit user direction overrides it.\n\n## When to use\nApps used primarily on a phone: personal trackers, chat, delivery, field tools, anything PWA/installable. NOT for desktop dashboards or marketing sites. This pack is mostly PATTERNS — its neutral chassis palette yields to any other active design pack or user palette; keep the patterns either way.\n\n## Direction\nFeels like an installed app, not a website on a phone: native navigation grammar, everything important within thumb reach, sheets instead of modals. References: iOS grouped-list apps, Airbnb's mobile app, Linear's mobile client. Brief: \"indistinguishable from native\".\n\n## Palette\nNeutral chassis, light mode; swap the accent freely.\n- Background #F6F6F7 (grouped canvas), surface #FFFFFF, text #121216, muted #71717A, divider #E4E4E9\n- Accent #FF5C39 (signal coral): actions, active tab, links\n- Semantic: success #16A34A, warning #D97706, danger #DC2626 (danger doubles as the destructive-action tint)\n- Dark variant only for media/night-centric apps: canvas #101014, surface #1B1B20, divider #2A2A31.\n\n## Type\nOne family, weight contrast only: Manrope (400/500/700), fallback -apple-system, \"Segoe UI\", sans-serif.\n- Large title 30px/700; nav-bar title 17px/600; row title 16px/500 with 13px/400 muted secondary; tab labels 10px/500; section headers 13px/600 uppercase +0.04em muted.\n- ALL inputs at 16px font-size or larger (below 16px, iOS Safari zooms the page on focus).\n- List/badge numbers: font-variant-numeric: tabular-nums.\n\n## Shape & composition\n- Single column, edge-to-edge; max-width 640px centered when viewed on desktop.\n- Viewport: meta viewport with viewport-fit=cover; heights in 100dvh, never 100vh (100vh hides content behind mobile browser chrome); pad fixed bars with env(safe-area-inset-bottom/top).\n- Grouped inset lists are the default data display: 16px side margins, 12px group radius, 52px min-height rows, 16px inset padding, dividers inset 16px from the left, chevron-right on navigable rows.\n- Thumb map: primary and frequent actions live in the bottom 40% of the screen; top corners hold only rare items (back, settings, close).\n- Touch targets 44x44px minimum including padding; the tap target is the FULL row, never just the chevron.\n- -webkit-tap-highlight-color: transparent; every tappable gets an :active state (background wash rgba(0,0,0,0.08) or scale 0.97); hover is never the only affordance.\n\n## Components\n- Tab bar: fixed bottom, 56px + safe-area padding, 3-5 tabs, 24px icons over 10px labels; active = accent icon + label; surface background with a 1px top divider.\n- Nav bar: 44px compact bar; scrolling screens open with a 30px large title that collapses into the compact bar (title crossfades in) after ~48px of scroll; back = chevron-left plus the previous screen's title.\n- Bottom sheet (replaces EVERY centered modal): border-radius 20px 20px 0 0, 36x4px drag handle 8px from the top, backdrop rgba(0,0,0,0.4), detents at 50% and 92% of dvh; drag-down or backdrop tap dismisses.\n- Sticky CTA: one full-width 52px pill button, 16px side insets, docked above the safe area on a surface bar with top divider — the screen's single primary action, keyboard-safe for forms.\n- Search: 36px field, 10px radius, sunken #E9E9EC fill, magnifier icon; a text Cancel button appears on focus.\n- List rows with destructive actions get swipe-to-act plus a 5s undo snackbar — no confirm dialog for reversible operations.\n- Forms: inputmode= (numeric/email/tel) and autocomplete= on every input; submit is the sticky CTA.\n\n## Motion\nNative stack grammar: push = incoming screen slides from the right, 350ms cubic-bezier(0.32, 0.72, 0, 1), while the outgoing view dims and shifts -25%; pop reverses it. Sheets rise on the same curve, 400ms. Tab switches crossfade 150ms — never slide. Set overscroll-behavior-y: contain on sheets and inner scrollers so the page never chain-scrolls behind them.\n\n## Signature moves\n- The collapsing large-title header — the single strongest \"this is an app\" cue.\n- Sheets for everything transient: filters, pickers, confirmations, detail peeks. A centered modal never appears.\n- The docked thumb CTA: one pinned primary action per screen, always reachable one-handed.\n- Grouped inset lists with full-row tap targets as the default content structure.\n\n## Avoid\n- Hover-dependent interactions, tooltips, or dropdown menus — use sheets and press states.\n- Centered dialogs, multi-column layouts, or data tables under 768px (tables restructure into stacked label/value rows).\n- 100vh, fixed elements without safe-area padding, inputs under 16px.\n- Primary buttons at the top of the screen or floating mid-content — the CTA is docked.\n- Hamburger menus for 5 or fewer destinations — that is what the tab bar is for.\n- Desktop breadcrumbs; navigation depth is the push/pop stack."
  },
  {
    "id": "retro-pixel",
    "name": "Retro Pixel",
    "summary": "8-bit console game energy: Sweetie-16 palette, Press Start 2P, notched sprite panels, stepped frame-by-frame motion. For games and toys.",
    "body": "# Design: Retro Pixel\n\nBase craft rules (states, accessibility, responsive, real content) still apply — this pack sets the art direction. Explicit user direction overrides it.\n\n## When to use\nGames, game-adjacent tools (leaderboards, jam sites, speedrun trackers), toys, quirky portfolios — anything that should feel like a playable 8-bit cartridge. Not for data-dense dashboards, fintech, or anything where small-size legibility is the whole job.\n\n## Direction\nAn 8-bit console game that happens to be a website: sprite logic, HUD chrome, coins and hearts, chunky pixel edges. References: Celeste and Shovel Knight menu UI, Pico-8 carts, itch.io jam pages, NES box art. Everything on screen should look redrawable on a 16x16 sprite sheet.\n\n## Palette\nDark-committed, built on the Sweetie-16 palette:\n- Background #1A1C2C, surface/panel #333C57, raised panel #29366F\n- Text #F4F4F4, muted text #94B0C2, border/outline #566C86\n- Accent: coin gold #FFCD75 — primary actions, scores, focus\n- Player-2 secondary #41A6F6 — links and info, small doses only\n- Semantic: success #38B764, danger #B13E53, warning #EF7D57\nDerive extra tints by stepping within Sweetie-16 (e.g. #73EFF7 for a rare highlight) — never introduce off-palette hexes or alpha blends; 8-bit color is indexed, not mixed.\n\n## Type\n- Display: \"Press Start 2P\", monospace — heroes and section titles only, 16–32px (it reads huge), line-height 1.4–1.6, uppercase, zero tracking (pixels don't kern).\n- Body: \"Pixelify Sans\", sans-serif — 16–18px, line-height 1.6, weights 400/500.\n- Micro/HUD labels: \"Silkscreen\", monospace — 10–12px (its native pixel size), uppercase, +0.05em tracking; use for scores, stats, badges.\n- Hierarchy comes from palette steps and size jumps, like a game HUD — bold sparingly.\n\n## Shape & composition\n- Radius 0, but corners are NOTCHED, not merely square: clip 4px steps off each corner (clip-path polygon or stacked box-shadows) so panels read as 9-slice sprites.\n- Borders 4px solid (#566C86 default, #FFCD75 active). Depth = hard offset shadow 4px 4px 0 #0F0F1B — zero blur, ever.\n- Everything snaps to the pixel grid: spacing in 8/16/24/32px, strokes in multiples of 4.\n- Layout moves: HUD frame (fixed top bar — score/status left, actions right); level-select grid for collections; dialogue-box footer CTA (full-width bordered panel with a ▶ prompt, like an NPC text box).\n- image-rendering: pixelated on all imagery; draw icons as CSS box-shadow pixel sprites or inline SVG with shape-rendering: crispEdges — no smooth icon sets.\n\n## Components\n- Buttons: 40–48px tall, 16px padding, notched corners, 4px border, 4px offset shadow; hover = shadow shrinks to 2px 2px 0 and the button translates 2px toward it; press = shadow 0, translate 4px (it \"sits down\"). Uppercase Silkscreen label.\n- Cards: #333C57 fill, 4px #566C86 border, notched, offset shadow; a Silkscreen name-plate overlaps the top border like a cartridge label.\n- Inputs: #1A1C2C fill, 4px border, caret-color #FFCD75; focus = border flips gold (no glow rings).\n- Nav: HUD bar, 56px, 4px bottom border; active item gets a ▶ pixel arrow to its left.\n- Progress: segmented heart/cell meters (10 discrete blocks) — never smooth fills.\n\n## Motion\nFrame-based, never eased: animation-timing-function steps(2)–steps(4) on everything — hovers, entrances, and meter fills snap like sprite frames, 150–300ms. Signature moments: (1) score/stat count-ups tick in visible increments; (2) invalid actions fire a 3-frame 2px shake on the offending panel. No smooth easing curves anywhere.\n\n## Signature moves\n- The ▶ selector: a pixel arrow that JUMPS (steps, not slides) to sit beside the hovered/focused menu item, exactly like a game menu cursor.\n- Notched 9-slice panels with hard 4px offset shadows — the page reads as sprite plates.\n- Game-vernacular stats: \"1UP\", \"HI-SCORE\", \"LV.3\" framing for real product numbers, Silkscreen labels with gold #FFCD75 numerals.\n- Segmented meters (hearts, cells, XP blocks) for any progress or rating.\n\n## Avoid\n- Smooth gradients, blur, translucency, soft shadows — 8-bit has none of these.\n- Mixed pixel scale: one element's \"pixel\" at 2px and another's at 6px breaks the sprite illusion; one unit (4px) sitewide.\n- 1px hairlines or thin borders — minimum visible stroke is 2px, standard is 4px.\n- CRT effects (scanlines, phosphor glow, flicker) — that is a terminal aesthetic, not a console one.\n- Anti-aliased icon libraries at default rendering; redraw or filter icons to crisp pixels.\n- Press Start 2P for body copy — display only; paragraphs in it are unreadable.\n- Smooth eased tweens; every animation must visibly step."
  },
  {
    "id": "liquid-glass",
    "name": "Liquid Glass",
    "summary": "Frosted translucent panes over a living gradient-mesh backdrop: Sora/Figtree, pill controls, edge lensing, springy motion. Light-first.",
    "body": "# Design: Liquid Glass\n\nBase craft rules (states, accessibility, responsive, real content) still apply — this pack sets the art direction. Explicit user direction overrides it.\n\n## When to use\nConsumer apps, media/music players, weather and ambient dashboards, spatial-feeling product marketing, creative tools — briefs that want modern, premium, dimensional. Not for print-flat editorial, dense admin tables, or terminal/brutalist briefs.\n\n## Direction\nFrosted panes floating over a living backdrop: light bends, edges catch highlights, everything hovers. References: Apple visionOS ornaments, iOS 26 Liquid Glass, macOS window materials, Windows Acrylic.\n\n## Palette\nLight-committed. The backdrop is a design element, not decoration:\n- Backdrop: pale base #EAF2FB carrying a slow gradient mesh of sky #7CC4FF, aqua #6EE7D8, and peach #FFB7A1 (radial blobs, 40–60% opacity, blurred 80px+)\n- Glass surfaces: white at alpha 0.40 (quiet) / 0.55 (default) / 0.72 (floating)\n- Text ink #10233A (deep blue slate), muted rgba(16,35,58,0.55), hairline border rgba(255,255,255,0.7)\n- Accent: deep cyan #0891B2 — primary actions, active states, selection\n- Semantic: success #0E9F6E, danger #D64550, warning #C77D1F\nNeutrals derive from ink at reduced alpha, never gray hexes — on glass, alpha IS the neutral scale.\n\n## Type\n- Display: \"Sora\", sans-serif — 300/400 for heroes (clamp(2.75rem, 6vw, 5.5rem), letter-spacing -0.02em, line-height 1.05); 500 for section titles. Light weight at big sizes keeps the air in.\n- Body: \"Figtree\", sans-serif — 15–16px, 400/500, line-height 1.6.\n- Micro-labels: Figtree 600, 11px uppercase, +0.08em, muted ink.\n- Stat numbers: Sora 400, tabular-nums.\n\n## Shape & composition\n- Big radii: cards 24px, sheets 28px, controls pill (999px). Concentric rule: nested radius = parent radius minus the gap (24px card with 12px padding → 12px inner element).\n- The glass recipe, used exactly: background rgba(255,255,255,alpha) + backdrop-filter blur(20px) saturate(1.4) + 1px border rgba(255,255,255,0.7) + shadow 0 8px 32px rgba(16,35,58,0.12). Elevation tiers: alpha 0.40/blur 12px, 0.55/20px, 0.72/28px.\n- Edge lensing on every pane: inset 0 1px 0 rgba(255,255,255,0.85) top highlight + inset 0 -1px 0 rgba(16,35,58,0.06) bottom shade — the light-through-glass tell.\n- Panels FLOAT: 16–24px gaps between panes and viewport edges; the mesh must stay visible around and through everything. No full-bleed opaque sections, ever.\n- Layout moves: detached ornament nav (floating glass toolbar 16px from the top, radius 20px, never touching the viewport edge); a hero where display type sits DIRECTLY on the backdrop (no panel) beside one floating glass card; stacked-sheet detail views (a second sheet slides over the first with both edges visible).\n- Maximum two glass layers overlap; a third pane sits beside, not atop.\n\n## Components\n- Buttons: pill, 44px; primary = solid #0891B2, white text, hover brightens 8% and lifts 1px; secondary = glass at alpha 0.55, ink text, hover alpha 0.72.\n- Cards: the glass recipe; hover = alpha +0.1, translateY(-2px), shadow deepens to 0 12px 40px.\n- Inputs: glass alpha 0.5, radius 16px or pill, 44px tall, inset top shadow for a recessed feel; focus = 2px #0891B2 ring outside the border.\n- Nav: the floating ornament bar; the active tab is a solid white pill (alpha 0.9) that slides behind the label.\n- Modals/sheets: alpha 0.72, blur 28px, radius 28px; the mesh stays perceptible through them.\n\n## Motion\nSoft and springy: 300–450ms, cubic-bezier(0.34, 1.56, 0.64, 1) with light overshoot for entrances and sheets; hovers a calmer 200ms ease-out. Panes enter at scale 0.96→1 with fade. Signature moments: (1) the mesh blobs drift on a 60s loop — the blur is provably live; (2) the nav's active pill springs between tabs. Reduced-motion: freeze the mesh, keep opacity fades.\n\n## Signature moves\n- The detached floating ornament nav — chrome that hovers in space instead of touching screen edges.\n- Edge lensing (bright top inset, shaded bottom inset) on every pane.\n- A living mesh backdrop visible through every surface — glass that demonstrably blurs something.\n- Concentric-radius discipline that makes nesting look machined.\n\n## Avoid\n- Glass over a flat white or solid background — blur with nothing to blur reads as gray fog; build the mesh first.\n- Opaque #FFF cards mixed in with glass panes; every surface uses the alpha scale.\n- Body copy sitting on the raw backdrop — text always gets a pane; only display type may sit bare, contrast-checked.\n- Hard dark borders, radius 0, offset shadows — nothing in this style is flat or hard-edged.\n- Stacking three or more blurred layers (GPU cost, visual mud).\n- Purple-violet mesh blobs — keep sky/aqua/peach.\n- Improvised dark mode: this pack is light-committed; do not half-ship an inverted variant."
  },
  {
    "id": "brutalist",
    "name": "Brutalist",
    "summary": "Raw print-poster web: ink on warm paper, Anton megatype cropped at the edge, exposed 2px grid rules, instant inverse hovers. Zero radius.",
    "body": "# Design: Brutalist\n\nBase craft rules (states, accessibility, responsive, real content) still apply — this pack sets the art direction. Explicit user direction overrides it.\n\n## When to use\nPortfolios, studios, zines, event/festival sites, manifestos, indie products with an opinion — anywhere confidence beats comfort. Not for trust-sensitive flows (checkout, health, finance) or dense data tools.\n\n## Direction\nA print poster that compiles: structure shown proudly, oversized ink-on-paper type, zero decoration. References: Bloomberg Businessweek's 2016 redesign, Balenciaga.com, Swiss punk posters, Cargo-hosted studio sites.\n\n## Palette\nLight-committed, print materials:\n- Paper #F2EFE9 (warm off-white background), panel #EAE6DC\n- Ink #141414 — text AND every border; muted #6E6A5E\n- Accent: safety orange #FF3D00 — links, active states, at most one word per headline\n- Marker #FFE600 — inline text-highlight backgrounds only\nNo other colors, no alpha, no gradients. Dark sections invert fully: ink background, paper text, same accent.\n\n## Type\n- Display: \"Anton\", sans-serif — uppercase, one weight, set HUGE: hero clamp(4rem, 14vw, 12rem), line-height 0.85, letter-spacing 0. Anton is the identity; use it at sizes that feel almost wrong.\n- Body: \"Archivo\", sans-serif — 16–17px, 400, line-height 1.55, sentence case.\n- Meta/labels: \"Space Mono\", monospace — 12px, uppercase, +0.06em: timestamps, index numbers, captions, table headers.\n- Hierarchy is scale violence: jump 12px → 17px → 40px → 12vw; skip polite intermediate sizes.\n\n## Shape & composition\n- Radius 0 on everything. Borders 2px solid #141414. NO shadows, no elevation, no layering illusions — the page is one flat sheet.\n- The exposed grid: adjacent sections and columns SHARE visible 2px rules so the layout reads as a printed broadsheet table — border-collapse thinking, no doubled rules.\n- Full-bleed by default: grid lines run to the viewport edge; gutters 0px between bordered cells, interior cell padding 24–40px.\n- Layout moves: cropped megatype (a headline sized past its container, clipped by the viewport edge or the next rule — deliberate amputation); ledger sections (content as bordered rows: mono index left, Anton title center, meta right); a fixed mono marginalia strip (running title, page code \"NO. 04 / ARCHIVE\") pinned to one edge.\n- Every section carries printed metadata: an index number, a date, or a section code in Space Mono.\n\n## Components\n- Buttons: rectangles, 48px tall, 2px ink border, transparent fill, uppercase Archivo 700 14px; hover = instant solid-ink fill with paper text (0ms). Accent version: #FF3D00 fill, paper text.\n- Links: 2px underline; hover = marker #FFE600 background wash, no transition.\n- Inputs: 2px ink border, radius 0, paper fill, 48px tall; focus = border thickens to 4px (no ring); labels in Space Mono uppercase above.\n- No card components — content lives in bordered rows/cells of the exposed grid.\n- Nav: full-width top strip with a 2px bottom rule; wordmark left in Anton, links right in Space Mono uppercase; current page inverse (ink background).\n- Tables/lists: 2px rules between ALL rows and columns, mono headers, 20px cell padding.\n\n## Motion\nAnti-motion is the aesthetic: state changes are instant (0ms) or one 80ms linear step. No easing curves, no fades, no scroll-reveals — content is simply there, like a printed page. The single allowed moving element: a full-width marquee ticker (Anton uppercase, 2px rules top and bottom, ~80s linear loop), used at most once per page.\n\n## Signature moves\n- Megatype amputation: the hero word at 14vw, cropped by the viewport or a rule — legibility sacrificed at the edge, confidence gained.\n- The exposed grid: visible 2px rules turning the entire page into a broadsheet table.\n- Print metadata as design objects: mono index codes, dates, running heads.\n- Inverse-fill hovers with zero transition — the page snaps like a rubber stamp.\n\n## Avoid\n- Border-radius above 0, any box-shadow, any gradient — one of these alone kills the style.\n- Soft gray borders; every rule is full-strength ink at 2px minimum.\n- Polite centered-and-cushioned symmetry: push type against rules and edges.\n- Eased or springy animation, hover scales, fade-ins — motion reads as apology here.\n- Decorative icons; use text glyphs (→, ↗, ×) in mono instead.\n- A second display face, or italics inside Anton's territory.\n- Neo-brutalist candy (pastel fills + offset shadows) — that is a softer trend; this is print."
  },
  {
    "id": "apple-hig",
    "name": "Apple HIG",
    "summary": "Apple-platform feel: deference, SF-style type, hairline separators, system-blue restraint. For apps meant to feel iOS/macOS-native.",
    "body": "# Design: Apple HIG\n\nBase craft rules (states, accessibility, responsive, real content) still apply — this pack sets the art direction. Explicit user direction overrides it.\n\n## When to use\nConsumer apps and utilities that should feel Apple-native: settings-style tools, media, productivity, companions to Apple-ecosystem products. Not for loud brand marketing, dense admin dashboards, or anything that must feel un-Apple.\n\n## Direction\nDeference: content is the interface and chrome recedes to near-nothing. References: iOS Settings/Music, macOS System Settings, Apple.com product pages, Things 3. Brief: white space, one system blue, hairlines instead of boxes, type does the talking.\n\n## Palette\nLight-first; commit fully (build dark only if asked).\n- Page canvas #F2F2F7 (grouped/settings screens) or #FFFFFF (content, marketing)\n- Surface #FFFFFF — separated by background shift alone: no border, no shadow\n- Text #1D1D1F, secondary #6E6E73, tertiary/disabled #AEAEB2\n- Hairline separator #D2D2D7 at 1px\n- Accent #007AFF (system blue) — the ONLY chrome color: links, text buttons, filled pills, toggles, selection\n- Semantic, content-only: green #34C759, red #FF3B30, orange #FF9500\n- Control fills are alpha, not hex: rgba(120,120,128,.16) resting, .12 subtle\n\n## Type\nThe system font IS the decision (this pack's sanctioned exception): stack `-apple-system, BlinkMacSystemFont, \"Inter Tight\", \"Helvetica Neue\", sans-serif` — real San Francisco on Apple hardware, Inter Tight (Google Fonts) loaded for everything else. One family; contrast comes from the HIG scale:\n- Large Title 34/700 tracking -0.4px · Title1 28/700 · Title2 22/700 · Title3 20/600\n- Headline 17/600 (row titles) · Body 17/400 lh 1.45 · Subheadline 15/400 in #6E6E73 · Footnote 13 · Caption 11–12\n- Web hero: 48–80px at weight 600, tracking -0.015em — semibold, never black\n- Sentence case everywhere, including buttons and nav actions. No uppercase micro-labels except optional 13px grouped-section headers.\n\n## Shape & composition\n- Radii (continuous-corner feel): grouped lists/cards 10px, buttons full pill, sheets 16px top corners, thumbnails 8px, icon tiles 6px. Nothing at 4px or 24px.\n- Flat by default. Exactly two depth devices allowed: sticky-nav translucency (rgba(255,255,255,.72) + backdrop-blur(20px) + hairline bottom border) and one floating-layer shadow (0 8px 40px rgba(0,0,0,.12)) on sheets/popovers. No other blur — whole-page glass is a different pack.\n- Density: generous. 16px screen gutters on mobile; marketing content max 980px.\n- Layout moves: (1) inset grouped lists: 10px-radius white groups on #F2F2F7, hairline separators inset 16px to align with the TEXT (never the icon), a 13px header above each group; (2) desktop/macOS: a 260px sidebar (canvas #F2F2F7) with 10px-radius rows — the selected row is a solid #007AFF fill with white text — beside a #FFFFFF content pane; (3) marketing = one oversized centered statement alternating with edge-to-edge product imagery — this style earns centered through sheer scale, so the type must be big enough to BE the layout.\n\n## Components\n- Primary button: #007AFF filled pill, h50 (h44 compact), 17/600 white label; hover #0071E3, press opacity .75. No outlined buttons exist — secondary is a gray-fill pill (rgba(120,120,128,.16), #007AFF label), tertiary is plain #007AFF text.\n- Nav actions are words: plain sentence-case #007AFF text (\"Done\", \"Add\") in the bar, zero button chrome.\n- List row: 29×29 icon tile (white glyph on a solid color, 6px radius), 17px title, trailing chevron #C7C7CC or value text in #6E6E73; min-height 44px.\n- Inputs: #F2F2F7 fill or hairline border, 10px radius, 17px text, label above.\n- Toggle: 51×31 pill, #34C759 when on, 27px knob with a soft shadow.\n- Mobile nav: 49px bottom tab bar, blue active tint, 10px labels; screen titles open at 34/700 and condense to the 17/600 bar title on scroll.\n\n## Motion\nSpringy restraint: ~85%-damped spring feel, 300–450ms for layer changes; small precise fades ≤200ms elsewhere; never linear, never big overshoot. Signature moments: (1) sheet presentation — panel slides up with 16px top radius while the page behind scales to .94 and dims 40% (the stacked-card effect); (2) toggle knobs and selection changes settle with one tiny spring, everything else is a fade.\n\n## Signature moves\n- Colored 29×29 icon tiles — white glyph on a solid semantic color, 6px radius — leading every list row; the strongest single \"made by Apple\" cue.\n- Primary actions as bare #007AFF sentence-case words in the bar (\"Done\", \"Add\") — blue text IS the button.\n- The translucent hairline nav bar (rgba(255,255,255,.72) + blur(20px) + 1px #D2D2D7) as the page's only depth device.\n- Sheets that push the page back: background scales to .94 and dims while the 16px-radius panel rises.\n\n## Avoid\n- A second chrome color, gradient-filled controls, or accent-tinted section backgrounds — deference dies first.\n- Borders or shadows on cards; separation is hairlines + background shifts only.\n- Blur beyond the nav bar (that becomes liquid-glass, a different pack).\n- Uppercase buttons, extrabold-everything, tracked-out headings.\n- Material-isms: FABs, pill nav indicators, tonal elevation tints.\n- Pure #000 text (use #1D1D1F) or gray hex control fills instead of alpha fills."
  },
  {
    "id": "material-3",
    "name": "Material 3",
    "summary": "Material You: seed-derived tonal surfaces, state layers, pill nav indicator, shape-scale grammar. For Google/Android-native-feeling apps.",
    "body": "# Design: Material 3\n\nBase craft rules (states, accessibility, responsive, real content) still apply — this pack sets the art direction. Explicit user direction overrides it.\n\n## When to use\nAndroid-companion apps, Google-ecosystem tools, consumer productivity/utility apps that should feel Material You-native. Not for luxury/editorial brands, trader-grade dense dashboards, or anything that must feel un-Google.\n\n## Direction\nColor-first friendliness: every surface is a tone of one seed color, shapes are big and soft, targets generous, motion emphatic. References: Pixel system apps (M3 Expressive era), Google Keep, Gmail, m3.material.io demos. Brief: one seed, tonal everywhere — roles, not raw grays.\n\n## Palette\nLight-first. Reseed from the subject, then regenerate every role from that seed's tonal palette; committed example (seed #386A20, leaf green):\n- primary #386A20 · on-primary #FFFFFF · primary-container #B7F397 · on-primary-container #042100\n- secondary #55624C · secondary-container #D9E7CB · on-secondary-container #131F0D\n- tertiary #386667 · tertiary-container #BCEBEC\n- surface #FDFDF5 · surface-container-lowest #FFFFFF · -low #F7F9EC · -container #F1F4E6 · -high #EBEEE1 · -highest #E6E9DB\n- on-surface #1A1C18 · on-surface-variant #43483E · outline #74796D · outline-variant #C4C8BB\n- error #BA1A1A · error-container #FFDAD6\nNo grays anywhere — every neutral is a low-chroma tone of the seed hue. The vivid pastel container fill (#B7F397 against near-white surface) is the M3 tell: bright and synthetic, not muted or organic. Name colors by role in code (--md-sys-color-primary), never by hex at point of use.\n\n## Type\nRoboto Flex (Google Fonts, variable) as the committed identity: `\"Roboto Flex\", Roboto, system-ui, sans-serif`. One family; contrast via the M3 scale and the width axis, not extra weights:\n- Display Large 57/400 lh 64 (hero only) · Display Small 36/400 · Headline Medium 28/400 · Title Large 22/400 · Title Medium 16/500\n- Body Large 16/400 lh 24 (default reading size) · Body Medium 14/400 lh 20 · Label Large 14/500 (buttons) · Label Medium 12/500\n- Component weights cap at 500; for hero drama widen the width axis (wdth 110–125) instead of going bold.\n\n## Shape & composition\n- Shape scale: XS 4 (text fields), S 8 (chips), M 12 (cards), L 16 (FABs), XL 28 (dialogs, bottom sheets, hero surfaces), full pill (buttons, search bar). Put 28 next to 12 deliberately — shape contrast is part of the grammar.\n- Elevation is tint-first: resting = surface, raised = step up the surface-container ladder; shadows only at level 1 (0 1px 2px rgba(0,0,0,.3), 0 1px 3px 1px rgba(0,0,0,.15)) for elevated cards and level 3 for FABs.\n- Interaction = state layers, never color swaps: overlay the on-color at hover 8%, focus 12%, pressed 12%, dragged 16%.\n- Targets ≥48×48px with ≥8px gaps. Gutters 16px compact, 24px ≥600px wide.\n- Layout moves: (1) list-detail two-pane at ≥840px (list fixed 360px, detail flexes); (2) mixed-span card collage — one 2×2 primary-container anchor card among 1×1 surface-container cards; (3) a full-pill search bar docked top as the de facto hero of utility screens.\n\n## Components\n- Filled button: h40, full pill, 24px side padding, Label Large on primary; hover adds the 8% state layer + level 1. Tonal variant: secondary-container fill. Outlined: 1px outline stroke. No gray buttons.\n- FAB: 56×56, r16, primary-container, level 3 — the screen's single strongest affordance.\n- Cards: default filled = surface-container-highest, r12, no shadow; elevated = surface-container-low + level 1 only when it must float.\n- Outlined text field: r4, 1px outline, label floats into a notch; focus = 2px primary outline + primary label.\n- Navigation bar (mobile): h80; active destination gets a 64×32 secondary-container pill behind the icon, Label Medium beneath. Rail (80px wide) at ≥600px.\n- Switch: 52×32 track; thumb grows 16→24px and the track fills primary when on.\n- Chips: h32, r8, outlined or tonal fill.\n\n## Motion\nStandard easing cubic-bezier(0.2, 0, 0, 1); entrances use emphasized-decelerate cubic-bezier(0.05, 0.7, 0.1, 1). Durations: state changes 100–200ms, component transitions 250–400ms, full-screen/container transforms 450–600ms. Signature moments: (1) container transform — a card morphs into its detail view, radius animating 12→0; (2) Expressive shape-morph — a pressed FAB/button animates its corner radius 16→28 with a soft spring. The nav pill slides between destinations.\n\n## Signature moves\n- Tonal nesting: primary-container blocks sitting on surface-container sections — depth read entirely through hue, near-zero shadows.\n- The sliding pill indicator behind nav icons.\n- XL 28 radius on sheets/dialogs set against r12 cards.\n- Every hover/focus/pressed/disabled state derived as an on-color opacity overlay — one mechanic everywhere.\n\n## Avoid\n- Gray neutrals or pure-white cards on gray — the tonal identity dies instantly.\n- Shadow-first elevation or border-separated cards; M3 separates by tone.\n- The default #6750A4 purple baseline — always reseed from the subject.\n- All-caps button labels and component weights above 500 (that's M2).\n- iOS-isms: hairline-inset grouped lists, blue text-only nav actions, blurred bars.\n- One uniform radius across all components — the five-step shape scale IS the style."
  },
  {
    "id": "calm-finance",
    "name": "Calm Finance",
    "summary": "Fintech trust UI: evergreen + sage, serif headings, tabular money with de-emphasized cents, audit lines, hold-to-confirm transfers.",
    "body": "# Design: Calm Finance\n\nBase craft rules (states, accessibility, responsive, real content) still apply — this pack sets the art direction. Explicit user direction overrides it.\n\n## When to use\nFintech and money-handling UI: banking, invoicing, payroll, treasury, budgeting, investment summaries — anywhere a user reads balances or moves money. NOT for analytics storytelling (data-story) or generic admin CRUD (saas-dashboard).\n\n## Direction\nQuiet institutional confidence: evergreen and sage, serif headings over precise sans numerals, every figure auditable at a glance. Lineage: Mercury, Wealthfront statements, Wise's plain-language clarity, printed bank ledgers. Brief: boring is the feature — the design's job is to make money feel handled.\n\n## Palette\nLight-first; evergreen is the dominant, not an accent.\n- Background #F5F8F6; surface #FFFFFF; text #10231C; muted #5E7268; border #DDE6E0; selected tint #E3F0EA.\n- Dominant: evergreen #0B3B2E (header band, primary buttons, active nav); hover #0E4A3A.\n- Money semantics, exact and non-negotiable: gain #137A4C, loss #B42318, pending #8A6A1F — always paired with a glyph (see Signature moves), never color alone.\n- Neutrals derive from the evergreen hue (~160) at 5-8% saturation; nothing cyan-shifted.\n\n## Type\nSource Serif 4 ('Source Serif 4', Georgia, serif) for headings and section titles; Archivo ('Archivo', 'Helvetica Neue', Arial, sans-serif) for UI, body, and ALL numerals with font-variant-numeric: tabular-nums. Serif is the trust voice, Archivo the precision voice; money is never set in the serif.\n- Page title 24px Source Serif 4 600; section titles 17px/600.\n- Hero balance 40px Archivo 600; body 14px/1.55; labels 12px/500; footnotes and legal 12px muted, printed on the page — never buried in tooltips.\n\n## Shape & composition\n- Radii 8px cards, 6px controls; 1px #DDE6E0 hairlines; one soft shadow tier: 0 1px 2px rgba(16,35,28,0.06). No glass, no gradients on any surface that shows money.\n- The evergreen band: a 112px deep-evergreen page header (white serif title, sage metadata) with the content cards overlapping 32px up into it.\n- Body: 8/4 split — statement/transactions left, sticky summary rail right (balance, next payment, limits).\n- Statement tables: 44px hairline-ruled rows (no zebra striping): date · counterparty · category chip · signed amount.\n- Comfortable density: 20px card padding, 16px gaps — calmer than an admin tool, denser than marketing.\n\n## Components\n- Buttons 40px, 6px radius, 14px/500: primary evergreen fill; secondary white + border; money-moving CTAs use hold-to-confirm (below).\n- Money input: 40px, fixed currency prefix, tabular digits, live thousands-separator formatting while typing.\n- Amount rendering everywhere: explicit sign (+ / minus U+2212), tabular, currency stated once per context.\n- Category chips 20px, tint backgrounds from a muted 6-hue set that never borrows the gain/loss hues.\n- Alerts: 1px-bordered tint panels, 14px sentence-case title, one action; no exclamation marks; red fills reserved for true loss/danger.\n- Disclosure rows (\"Fees · $4.00\") expand inline over 200ms; fees and rates are visible before any confirmation step.\n\n## Motion\nMeasured and even: 180-240ms ease-in-out, no spring, no bounce. Balances render FINAL on first paint — never count up from zero (animating money into existence reads as fabrication); they tick 400ms only on a genuine live change. Success is a single 300ms check-mark draw. No confetti, ever.\n\n## Signature moves\n- De-emphasized cents: every balance renders its cents at 60% size in the muted color (\"$12,480\" full-size, \".00\" small) — the printed-statement tell that makes magnitude scannable.\n- Glyph-paired deltas: signed amounts always carry the sign character; percentage deltas add a solid up/down triangle. Color reinforces, never informs alone.\n- The audit line: every mutable figure and setting shows a 12px muted line beneath it — \"Updated 09:41 · by S. Kumar\". The UI keeps receipts.\n- Hold-to-confirm: transfer/pay buttons fill left-to-right over 800ms while held (release cancels), the label stating the exact amount: \"Hold to send $2,400.00\".\n\n## Avoid\n- Counting balances up from zero on load, or skeleton-to-number morph effects on money.\n- Red/green as the only differentiator anywhere — glyphs are mandatory.\n- Gradients, glassmorphism, or glow on transactional surfaces.\n- Playful gestures: confetti, mascots, emoji in confirmations, \"Cha-ching!\" copy.\n- Hiding fees, rates, or legal text behind tooltips or hover states.\n- Rounded-full pill CTAs and candy-colored chips — this is an institution, not a consumer toy.\n- Reusing gain/loss hues for generic success/error toasts; those use evergreen tint and #B42318 with icons."
  },
  {
    "id": "health-wellness",
    "name": "Health & Wellness",
    "summary": "Calm organic health UI — sage and sand, Lora serif data, arch-masked imagery, breathing motion, first-class privacy cues.",
    "body": "# Design: Health & Wellness\n\nBase craft rules (states, accessibility, responsive, real content) still apply — this pack sets the art direction. Explicit user direction overrides it.\n\n## When to use\nHealth, mindfulness, sleep, nutrition, therapy, and recovery apps where the user may arrive anxious. NOT for clinical/EHR professional tools (they need density) or high-energy competitive fitness apps.\n\n## Direction\nA calm exhale: warm sand and eucalyptus, soft serif warmth, air between everything, data that reassures instead of grades. References: Calm's stillness, Headspace's warmth minus the cartoons, Oura's readable-metrics restraint, Kinfolk's editorial quiet. Brief: \"a room with plants and good light\".\n\n## Palette\nLight mode, committed. Muted and organic — nothing fluorescent.\n- Background #F5F4EE (warm sand), surface #FDFCF8, sunken #ECEBE2\n- Text #2C352E (moss ink), muted #6E7B70, border #DFE2D7 (1px hairlines, low contrast)\n- Dominant #3E6B54 (eucalyptus): actions, active states, data emphasis\n- Accent #D9906B (clay): RARE warm highlight — one stat, an illustration tone, the \"today\" marker\n- Semantic (gentle, never alarming): in-range #4E8A63, attention #C2913F, out-of-range #B65C4B — always paired with a plain-language sentence, never a bare red number\n- Neutrals are green-tinted sand; derive tints by mixing eucalyptus into #F5F4EE (green-wash #E6EBE2 for selected states).\n\n## Type\n- Display: Lora (400, Medium 500 for emphasis — never bolder), fallback Georgia, serif — headings, greeting lines, big metric values. Sentence case, letter-spacing -0.01em.\n- Text: Karla (400/600), fallback \"Segoe UI\", sans-serif — body 16-17px/1.7; UI labels Karla 600.\n- Micro-labels: Karla 600, 11px uppercase +0.08em, muted.\n- Metric pattern: value in Lora 400 at 40-64px, unit in Karla 13px muted beside the baseline. Never bold data.\n\n## Shape & composition\n- Radii: cards 20px, hero surfaces 28px, inputs 14px, chips pill. Corners feel worn-smooth, not geometric.\n- Depth: none by default; a card lifts with 0 8px 24px rgba(44,53,46,0.06) only when actionable. Section separation comes from background shifts (sand vs surface), not boxes.\n- Density: the airiest of any style — 28-32px card padding, 120px+ section spacing, one primary idea per mobile viewport.\n- Layout moves: (1) greeting-led home — a Lora sentence (\"Good morning, Asha — you slept 7h 40m\") IS the header, data below it; (2) arch-portal imagery — photos and illustrations masked with border-radius 999px 999px 24px 24px; (3) one wide \"today\" card followed by a quiet one-column list — never a grid of equal metric tiles.\n\n## Components\n- Buttons: 50px, 14px radius, eucalyptus fill, #FDFCF8 text; hover deepens to #345C47; secondary = sunken sand fill + moss text, no border.\n- Cards: surface fill, 20px radius, borderless.\n- Inputs: 52px, sunken #ECEBE2 fill, borderless; focus = 2px eucalyptus ring; labels above in Karla 600 13px.\n- Data: progress rings 6px stroke with rounded caps on a #DFE2D7 track; area charts with 8%-opacity fills; a shaded \"typical range\" band behind every personal metric line.\n- Privacy chip: lock icon + \"Only you can see this\" in an #E6EBE2 pill beside every data-entry form header — a first-class component, not fine print.\n\n## Motion\nSlow and breathing: 400-600ms, cubic-bezier(0.4, 0, 0.2, 1), opacity + 8px rise, zero overshoot ever. Signature moments: (1) one breathing halo — a soft radial eucalyptus glow behind the hero metric scaling 1 to 1.05 over 5s, infinite (static under reduced motion); (2) ring values fill over 900ms ease-out on first view only.\n\n## Signature moves\n- The arch portal: every image masked as a rounded arch (999px 999px 24px 24px) — an instantly recognizable silhouette.\n- Serif data: big metric values in Lora 400 — numbers that read human, not dashboard.\n- The range band: metrics always drawn against a soft \"your typical range\" band, so a low night reads as context, not failure.\n- Spoken-sentence framing: every metric card leads with a plain sentence (\"Your resting heart rate is settling\") above the number.\n\n## Avoid\n- Clinical blue-and-white or hospital teal — this is a room, not a ward.\n- Saturated red alerts, warning triangles, exclamation marks; concern is worded gently in clay/amber.\n- Streaks, confetti, badges, leaderboards — motivation is gentle continuity, not competition.\n- Grids of equal stat tiles; more than 4 numbers visible per viewport.\n- Pure white surfaces or neutral gray borders — everything is sand- or green-tinted.\n- Bounce, springs, or content motion faster than 300ms; the pace is the message.\n- Dark mode by default (only if the app is sleep-centric — then #171D19, never black)."
  },
  {
    "id": "education-lab",
    "name": "Education Lab",
    "summary": "Bright learning UI — cobalt + lemon on paper blue, pressable-edge buttons, highlighter marks, one progress affordance per screen.",
    "body": "# Design: Education Lab\n\nBase craft rules (states, accessibility, responsive, real content) still apply — this pack sets the art direction. Explicit user direction overrides it.\n\n## When to use\nLearning products: course platforms, quiz and flashcard apps, tutoring tools, coding-practice sites, study aids. NOT for reference/reading tools (use a quieter editorial style) or LMS admin panels.\n\n## Direction\nA bright, confidence-building lab: crisp paper-blue canvas, cobalt conviction, lemon highlighter, progress visible everywhere. Wrong answers cost nothing; momentum is the product. References: Duolingo's pressable juice without the mascot circus, Brilliant's crisp geometry, Khan Academy's earnest clarity, Kahoot's energy at 60%. Brief: \"you're getting better, and you can see it\".\n\n## Palette\nLight mode, committed.\n- Background #F4F7FD (paper blue), surface #FFFFFF, sunken #E9EEF9\n- Text #1D2A4A (ink navy), muted #5D6B8A, border #D8E0F0\n- Dominant #2952E3 (cobalt): primary actions, active lesson, links, progress fills\n- Accent #FFD338 (lemon highlighter): text marks, streak chips, the current step — never a button fill\n- Feedback set (load-bearing here): correct #23A559 on #E4F6EC; try-again #E0564A on #FCEAE8 (coral, retry framing, never alarm); hint #B7791F on #FBF3DF\n- Neutrals are blue-tinted; derive tints by mixing cobalt into white (cobalt-50 #EDF1FD for selected rows).\n\n## Type\n- Display: Lexend (600/700), fallback \"Segoe UI\", sans-serif — designed for reading proficiency; headings, lesson titles, scores. Sentence case.\n- Text: Atkinson Hyperlegible (400/700), fallback Arial, sans-serif — body 17px/1.65; question stems 20px/1.5.\n- Mono (code, answers, fill-blanks): Spline Sans Mono 500, fallback Consolas, monospace — 15px on #E9EEF9 chips.\n- Micro-labels: Lexend 600, 12px uppercase +0.06em (\"LESSON 4\", unit tags).\n\n## Shape & composition\n- Radii: cards 16px, buttons 12px, chips pill. Crisp, not squishy.\n- Depth = pressable: actionable elements carry a solid bottom edge (box-shadow 0 4px 0 in a 20%-darker shade of their own fill); static content is flat with 1px #D8E0F0 borders. No outlines-plus-offset sticker styling.\n- Density: medium — 20px card padding, 16px gaps. A lesson screen holds ONE question or concept; a dashboard holds one path plus one stats rail.\n- Layout moves: (1) the lesson rail — a 280px left column of numbered modules with state pips, main canvas holds the work; (2) the focus stage — during exercises the chrome collapses to a top progress bar plus a centered 640px column, nothing else; (3) checkpoint rhythm — explainer content breaks every 2-3 paragraphs for an inline interaction (mini-quiz, reveal, drag), never a wall of prose.\n\n## Components\n- Primary button: 52px, 12px radius, cobalt fill, white text, edge 0 4px 0 #1D3AA8; press = translateY(3px) with the edge collapsing to 1px; disabled = #D8E0F0 fill, no edge.\n- Answer options: full-width cards, 2px #D8E0F0 border, 16px radius; selected = cobalt border + #EDF1FD fill; correct/try-again swap border and fill from the feedback set and prepend a 20px icon.\n- Progress bar: 8px pill track #E9EEF9, cobalt fill animating width 300ms ease-out on each step.\n- Streak/XP chips: lemon pill, ink-navy text, Lexend 700.\n- Inputs: 52px, white, 2px #D8E0F0 border; focus = cobalt border + 4px #EDF1FD halo.\n\n## Motion\nQuick and rewarding: 150-250ms ease-out for UI. The core feedback loop is choreographed: correct = option recolors, a checkmark draws in (SVG stroke, 300ms), the progress bar fills — all under 600ms, auto-advance after 800ms. Try-again = 4px horizontal shake (2 cycles, 250ms) and a hint slides in below; the screen never blocks or moralizes. Completion screens count the score up over 700ms while the ring closes.\n\n## Signature moves\n- The pressable edge: solid bottom-edge depth on every actionable element, spent on press — the tactile identity of the app.\n- Highlighter marks: key terms in body copy get an inset lemon linear-gradient mark, skewed -2deg, 105% of the text width — content emphasis only, never decoration.\n- One progress affordance per screen: bar, ring, or pips — exactly one, always animating on change. Progress you can't see doesn't motivate.\n- Pip trail: module lists render mastery as a vertical trail of connected 12px pips (empty ring, half, filled), the current pip pulsing once on load.\n\n## Avoid\n- Candy pink, cream canvases, ink sticker outlines — that is a toy aesthetic; this is a lab.\n- Red-flood error states, \"Incorrect!\" copy, or deducting progress on a miss.\n- Mascots or clip-art on every screen; illustration stays geometric and diagrammatic.\n- More than one progress visualization per screen.\n- Prose walls — 3+ paragraphs with no interaction is a layout bug in this style.\n- Dark mode; countdown timers on learning tasks unless the user asks for quiz-show pressure."
  },
  {
    "id": "dark-gaming",
    "name": "Dark Gaming",
    "summary": "Modern esports dark UI: volt accent on near-black, one clipped corner, stat-card numerals, precise live glow. For gaming products.",
    "body": "# Design: Dark Gaming\n\nBase craft rules (states, accessibility, responsive, real content) still apply — this pack sets the art direction. Explicit user direction overrides it.\n\n## When to use\nGaming and esports products: team/tournament sites, stat trackers, game companions, launchers, streamer tools, community hubs. Not for retro/arcade briefs (use a pixel or terminal style) and not for non-gaming SaaS that merely wants dark mode.\n\n## Direction\nA modern esports command center: sleek near-black surfaces, one electric accent, angular cuts, stat-card culture, glow used like a laser pointer. References: Riot's Valorant site, Discord, Twitch's live chrome, NVIDIA GeForce, Steam's library redesign.\n\n## Palette\nDark-committed, cool blue-cast neutrals (hue ~230, never warm gray):\n- Background #0A0B10, surface #12141C, elevated #181B26\n- Text #EDEFF7, muted #8A90A6, border #232738\n- Accent: volt #CDFF3D — primary CTAs, active states, focus rings\n- Live red #FF4655 — EXCLUSIVELY live/recording/on-air indicators and loss deltas, never decoration\n- Win/up #2EE6A8\n- Rarity ramp (item/tier badges only, nowhere else): #8A90A6 / #4DA6FF / #B44DFF / #FFA928\nDerive hovers by lightening surfaces ~6% toward #232738.\n\n## Type\n- Display: \"Chakra Petch\", sans-serif — uppercase, 600/700, squared techy terminals; hero clamp(2.5rem, 6vw, 5rem), letter-spacing +0.01em (slightly open, not negative).\n- Body: \"Barlow\", sans-serif — 15–16px, 400/500, sentence case, line-height 1.6.\n- Stat numerals: Chakra Petch 600, tabular-nums, 28–56px, paired with an 11px uppercase Barlow 600 label at +0.08em.\n- Never set body copy in Chakra Petch — it is chrome and numbers only.\n\n## Shape & composition\n- Radius 4px max. The angular tell: ONE clipped corner per panel — clip-path a 10px 45° cut off the top-right corner of cards, hero panels, and badges. Same corner sitewide.\n- Borders 1px #232738 on all panels; no soft ambient shadows — separation comes from surface steps and borders. Matte by default.\n- Skew accents: section eyebrows, tier badges, and dividers skew -6°; the content inside stays level.\n- Layout moves: match-header hero (two entities flanking one huge center stat, 5/2/5); a stat-strip of compact KPI cards directly under the hero; leaderboards as dense ranked rows with big rank numerals, not cards.\n- Density: dashboard-dense — 12–16px card padding, 8px gaps in stat grids.\n\n## Components\n- Buttons: 40px, radius 4px, uppercase Chakra Petch 600 13px +0.04em; primary = volt fill with #0A0B10 text; secondary = transparent, 1px #232738 border, border→volt on hover; hover translateY(-1px), 140ms.\n- Stat cards: elevated surface, clipped corner, numeral + label + delta chip (▲ #2EE6A8 / ▼ #FF4655); the ONE hero stat spans double width with a 56px numeral.\n- Live badge: pill, #FF4655 fill, white 11px uppercase, leading 6px dot pulsing (scale 1→1.6 with fade, 2s infinite).\n- Inputs: #12141C fill, 1px border, 40px tall; focus = volt border + 0 0 0 3px rgba(205,255,61,0.18) ring.\n- Nav: 56px top bar or 240px left rail; active item = 2px volt left rule + volt text.\n- Toasts: kill-feed style — slide in from the right edge, stack downward, auto-dismiss 5s.\n\n## Motion\nSnappy and precise: 120–180ms, cubic-bezier(0.2, 0, 0, 1), no bounce. Signature moments: (1) stat numerals count up on first view (500ms, once); (2) the live-dot pulse. Glow is motion's partner: box-shadow 0 0 16px rgba(205,255,61,0.35) appears ONLY on primary-CTA hover and live elements — nothing glows at rest.\n\n## Signature moves\n- The single 45° clipped corner repeated on every panel — angular identity from one cut, not diagonal chaos.\n- Volt-on-black stat culture: oversized tabular numerals, tiny tracked labels, win/loss delta chips.\n- Precision glow: exactly two glow sources per page (CTA hover, live indicators); everything else matte.\n- -6° skewed eyebrow/badge chips against perfectly level content.\n\n## Avoid\n- Retro anything: scanlines, pixel fonts, CRT glow, neon-grid horizons.\n- Purple-blue gradients (reads as an AI-made Twitch clone) and RGB rainbow accents.\n- Glow at rest or on multiple elements — if three things glow, nothing reads as live.\n- Soft rounded cards (radius >8px) and cozy pastels — this style is angular and matte.\n- Muted text darker than #8A90A6 on #0A0B10 — dark-on-dark contrast failure.\n- Escalating angles: one clip depth, one skew value, sitewide; don't add diagonal section dividers on top.\n- Rarity colors leaking into buttons, links, or charts."
  },
  {
    "id": "luxury-boutique",
    "name": "Luxury Boutique",
    "summary": "High-fashion serif minimalism: Cormorant lightweights, spaced-caps Jost, hairlines and huge whitespace, ink/bone/clay only, slow motion.",
    "body": "# Design: Luxury Boutique\n\nBase craft rules (states, accessibility, responsive, real content) still apply — this pack sets the art direction. Explicit user direction overrides it.\n\n## When to use\nHigh-fashion labels, jewelry, fragrance, galleries, architecture and interiors studios, one-product prestige brands. NOT for conversion-led retail (premium-commerce), feature-rich SaaS, or anything needing urgency — this style refuses to hurry.\n\n## Direction\nAustere high-fashion minimalism: the confidence to say almost nothing. References: The Row, Aesop, Celine, Jil Sander. Brief: \"a gallery at closing time — monochrome, hairlines, one clay tone.\"\n\n## Palette\nLight, near-monochrome, committed.\n- Background #F4F3F0 (cool gallery bone) — also the only surface; separation comes from rules and space, never card fills.\n- Ink #161513 · Muted #8A857C · Hairline #DAD7D0\n- Clay #A89583 — the single non-neutral: active nav item, focus ring, current state. Nothing else gets color.\n- Error #8C3A2B (muted brick), stated in text, never in banners.\n- Dark inversion #131211 with bone text: exactly one full-viewport campaign section per page.\nNeutrals stay within 4% saturation of hue ~40; if it looks colorful, desaturate.\n\n## Type\n- Display: Cormorant Garamond 300/400 — hero clamp(3.5rem, 9vw, 8rem), line-height 1.02, letter-spacing -0.01em; one word may be 300 italic. Fallback: Garamond, serif.\n- Text/UI: Jost 300/400 — body 15-16px/1.7. Fallback: Futura, sans-serif.\n- The identity is spaced uppercase: labels, nav, buttons, product names in Jost 10-11px, +0.22em tracking, weight 400. Nothing on the page exceeds weight 500.\n- Prices and meta: 13px muted, oldstyle-leaning, whispered.\n\n## Shape & composition\n- Radius 0. No shadows, no fills, no cards — structure is 1px hairlines and whitespace.\n- Whitespace IS the layout: heroes are at least 60% empty; section padding 160-240px desktop, 96px mobile.\n- One image per viewport: a full-bleed or centered 4:5 photograph with a single caption line. Catalog grids: 2 columns desktop, 48-64px gutters, generous row gaps.\n- Text blocks sit off-center in cols 3-8, then cols 6-11, alternating by section — never dead-center columns.\n- Footer is an index: every link in one spaced-caps list under a single hairline.\n\n## Components\n- Button (one style only): 48px, square, transparent, 1px ink border, Jost caps 11px +0.2em; hover fills ink with bone text over a 400ms fade. Secondary action = underlined spaced-caps text link.\n- Inputs: no boxes — a 1px bottom rule, 44px tall, caps micro-label above, rule darkens to ink on focus.\n- Nav: 72px, transparent, spaced-caps wordmark left, links right; a 1px bottom hairline fades in only after scroll.\n- Product tile: photograph, name in caps 11px, price 13px muted on the line below; hover scales the image 1.00 to 1.03 over 900ms.\n\n## Motion\nSlow and weightless: 500-800ms, cubic-bezier(0.22, 1, 0.36, 1). Crossfade instead of slide. Images enter at scale 1.06 settling to 1 over 1.2s. Nothing bounces, nothing staggers quickly; a page that feels fast is wrong.\n\n## Signature moves\n- Tracking-expand hover: uppercase links and buttons animate letter-spacing from 0.2em to 0.26em over 400ms instead of changing color.\n- No cards, ever: hairline rules plus 160px+ whitespace do all separation across the entire product.\n- Whispered prices: 13px, muted, one line below the name — never bold, never colored, never a strike-through pair.\n- The dark interlude: one full-viewport #131211 section holding a single Cormorant italic line in bone.\n\n## Avoid\n- Any bright accent, gradient, badge, pill, or banner — the palette is ink, bone, clay, full stop.\n- Weights 600+ anywhere; luxury is light and spaced, never heavy.\n- Commerce artifacts: sale tags, timers, review stars, strike-through prices, cart badges.\n- Snappy sub-300ms transitions — they read as e-commerce, not atelier.\n- Dense grids, tight gutters, or more than ~8 words in a hero.\n- Rounded corners and drop shadows."
  },
  {
    "id": "terminal-retro",
    "name": "Terminal Retro",
    "summary": "Phosphor CRT terminal: VT323 green-on-black, box-drawing frames, boot-sequence typing, blinking block cursor. For CLI-adjacent tools.",
    "body": "# Design: Terminal Retro\n\nBase craft rules (states, accessibility, responsive, real content) still apply — this pack sets the art direction. Explicit user direction overrides it.\n\n## When to use\nCLI-adjacent products, system monitors, log/status dashboards, hacker-culture portfolios, sci-fi ops consoles — software that should feel like it runs on a 1980s terminal. Not for consumer warmth, commerce, or image-led pages; this style has no photography.\n\n## Direction\nA phosphor CRT terminal: bright text on near-black glass, box-drawing chrome, a cursor that blinks. The interface IS text. References: DEC VT220, IBM 5151, cool-retro-term, btop/htop TUIs, the Fallout Pip-Boy.\n\n## Palette\nDark-committed. Two phosphors and almost nothing else:\n- Background #050807 (green-cast black), panel #0A120C\n- Text: bright phosphor #33FF66; dim/muted #1E8F4A; faint structure/borders #14522E\n- Accent: amber phosphor #FFB000 — reserved for warnings, highlights, and the single most important value on screen\n- Danger #FF5555. No blue, no purple, no gradients.\nDerive every tint by scaling the green's luminance toward black; hovers are luminance jumps, not hue shifts. Inverse video (background #33FF66, text #050807) is the strongest emphasis available — stronger than amber.\n\n## Type\nOne family carries everything: \"VT323\", \"Courier New\", monospace — a genuine VT220 glyph revival. It runs small, so size up:\n- Hero/display: 48–72px, line-height 1.05\n- Body: 20–22px, line-height 1.5, measure ~66ch\n- Micro/status: 16px, uppercase, +0.1em tracking\nContrast within the single family comes from bright vs dim phosphor, inverse-video blocks, and size jumps. No second typeface, no italics (terminals had none), no weight above 400 — faux-bold ruins the glyphs; emphasize with brightness instead.\n\n## Shape & composition\n- Radius 0. Borders are DRAWN, not styled: frame panels with real box-drawing characters (┌ ─ ┐ │ └ ┘ ├ ┤) rendered as text, title inline in the top rule: ┌─[ SYSTEM STATUS ]────┐. Fall back to 1px solid #14522E only where character frames are impractical (inputs, tiny chips).\n- Layout on a character grid: widths and padding in ch units (80–100ch shells) so everything aligns like a TUI.\n- Section separators: full-width rules of ─ or ═, or a dim run of repeated glyphs (▚▚▚).\n- Composition moves: the two-bar shell — fixed top status bar (user@host · time · counters) and fixed bottom key-hint bar ([Q]UIT [E]NTER [?]HELP) with content panes between; tiled TUI panes of UNEQUAL width (a 62ch log pane beside a 28ch stats pane); ASCII tables and sparkline glyphs (▁▂▃▅▇) for all data.\n\n## Components\n- Buttons: text tokens [ EXECUTE ] or < DEPLOY >, 40px hit area, transparent fill, bright text; hover/focus = inverse video, instantly. The primary action gets amber.\n- Inputs: a > prompt prefix, no box — a 1px bottom rule #14522E and a blinking block caret (caret-color #33FF66); focus brightens the rule to #33FF66.\n- Panels: box-drawing frame in dim green; the FRAME (not a fill) brightens to #33FF66 on hover.\n- Nav: the top status bar; active section shown inverse-video. Lists prefix the active row with >.\n- Data: ASCII table rules, dim headers, bright values, amber for the one number that matters.\n\n## Motion\nTeletype character — things PRINT, they don't fade. (1) Boot sequence: on first load, hero lines type on at 12–18ms/char with 150ms pauses between lines, like POST output; later reveals are instant. (2) A block cursor ▍blinks after the hero headline and in the active input: 1s, steps(2), infinite. All other state changes are instant (0ms) — terminals don't ease. Optional dressing: a 2px repeating scanline overlay at ≤4% opacity plus text-shadow 0 0 6px rgba(51,255,102,0.35) on headings ONLY — together they count as the page's one atmosphere device.\n\n## Signature moves\n- Box-drawing frames with inline bracketed titles — the chrome is literally typed.\n- The boot-sequence intro and the persistent blinking block cursor.\n- Inverse-video as the universal hover/active/selected treatment.\n- The two-bar shell: status line on top, key-hint bar at the bottom.\n\n## Avoid\n- Pixel-art sprites, chunky offset shadows, notched corners — that is an 8-bit console look, not a terminal.\n- Any hue beyond green/amber (+red for danger); no gradients, no purple \"hacker glow\".\n- Sans-serif or proportional type anywhere, including the logo.\n- Heavy CRT effects: visible flicker, barrel distortion, scanlines above 4% opacity.\n- Rounded corners, drop shadows, elevation layers — a terminal is one flat plane of glass.\n- Typing animation on body copy or repeated per section — boot the hero once, then be instant.\n- Photography or full-color imagery; if imagery is essential, render it as ASCII/ANSI art."
  },
  {
    "id": "landing-conversion",
    "name": "Landing Conversion",
    "summary": "Structures landing pages as one-goal conversion paths: section cadence, headline formulas, proof placement, CTA discipline. Style-agnostic.",
    "body": "# Landing Conversion\n\nStructure every landing page as a single-goal conversion path — fixed section cadence, headline formulas, proof next to every claim, one CTA repeated verbatim. Visual style comes from the active design pack. Explicit user direction overrides it.\n\n## When to use\nMarketing, launch, waitlist, and pricing pages for a product or service. Not for docs, blogs, or in-app UI.\n\n## Rules\n\n### One goal\n- Pick ONE conversion action per page (signup, demo, waitlist, purchase). Every section either advances it or removes an objection to it.\n- Primary CTA label = verb + object + specificity (\"Start free 14-day trial\", \"Book a 20-min demo\"), identical wording at every appearance. Never \"Get started\", \"Learn more\", or \"Submit\" as the primary.\n- Risk-reversal microcopy sits directly under the primary CTA: \"No credit card · Cancel anytime\".\n- One secondary CTA maximum, lower-commitment (\"Watch the 2-min demo\"), visually subordinate, hero only.\n\n### Section cadence (default order)\n- 1 Hero: headline + subhead + primary CTA + one proof element + one real product visual (screenshot or live demo, not abstract art).\n- 2 Proof strip: 5-7 recognizable customer logos OR one specific metric (\"4,218 teams ship with Relay\"), inside the first scroll, labeled (\"Trusted by teams at\").\n- 3 Problem, then shift: name the pain in the customer's own words (2-3 sentences max), then the change the product makes.\n- 4 How it works: exactly 3 verb-first steps; lay them out per the active design pack (numbered editorial rows beat three equal cards).\n- 5 Benefit blocks: 3-5 sections; the heading is the benefit (\"Close the books in 2 days, not 2 weeks\"), the feature name goes in body copy; each block carries one proof point (metric, named quote, or screenshot).\n- 6 Deep social proof: 1-3 testimonials. One concrete quote with a number beats three vague ones.\n- 7 Pricing (if selling): max 3 tiers, one highlighted \"Most popular\", monthly/annual toggle with the annual saving stated, max 8 features per tier, a CTA per tier.\n- 8 Objection FAQ: 5-8 questions phrased as real objections.\n- 9 Final CTA: restate the hero promise + primary CTA + risk reversal. This is the last section before the footer, always after the FAQ.\n\n### Headlines\n- Formulas: \"[Outcome] in [timeframe]\" · \"[Do X] without [pain]\" · \"The [category] for [specific audience]\". Specificity beats cleverness — numbers, timeframes, named audiences.\n- Headline is the outcome in 9 words or fewer; subhead answers \"how, and for whom\" in 22 or fewer and never restates the headline.\n- Section headings are claims, not labels: \"Migrate in an afternoon\", never \"Features\".\n\n### Proof\n- Every claim gets adjacent evidence: a metric, a named quote, or a screenshot — same section, same viewport.\n- Exact numbers beat round ones: \"12,483 teams\" over \"thousands of teams\".\n- Testimonials lead with the outcome (\"Cut onboarding from 3 weeks to 4 days\") and carry full name + role + company. An unattributed quote is worse than none — cut it.\n\n### Forms\n- Hero capture asks for the minimum: email + button. Name and company move to post-signup.\n- Never gate the demo video behind a form.\n\n## Defaults\n- CTA + microcopy pairs: \"Start free trial\" / \"No credit card required\" · \"Book a demo\" / \"20 minutes, no pressure\" · \"Join the waitlist\" / \"Invites go out weekly\".\n- FAQ seed objections: what happens after the trial; data export and cancellation; security and compliance; migration effort; support response times; how it differs from the incumbent.\n- Above-the-fold checklist: headline, subhead, primary CTA, one proof element, product visual — nothing else.\n\n## Avoid\n- Competing CTAs: \"Sign up\", \"Contact sales\", and \"Download\" given equal weight.\n- Feature-name headlines (\"Introducing SmartSync\") with the benefit buried below.\n- Vague superlatives: \"world-class\", \"revolutionary\", \"supercharge\", \"unleash\", \"seamless\".\n- Testimonial and hero carousels — rotating content hides proof.\n- Logo soup: 10+ tiny unlabeled logos.\n- Demanding a sales call before showing the product.\n- Newsletter or chat popups that fire before the first scroll."
  },
  {
    "id": "seo-discoverability",
    "name": "SEO & Discoverability",
    "summary": "Technical SEO wired in: Next.js Metadata API, canonicals, OG/Twitter cards, JSON-LD by page type, sitemap/robots, server-rendered copy.",
    "body": "# SEO & Discoverability\n\nMake every public page indexable, shareable, and machine-readable by default: exact metadata, structured data, and crawl files wired in from the first build. Explicit user direction overrides it.\n\n## When to use\nAny public site with pages meant to rank or unfurl: marketing, blog, docs, commerce. Auth-walled app screens only need a title and robots noindex.\n\n## Rules\n\n### Metadata (Next.js App Router — the default stack)\n- Root layout exports metadata with metadataBase: new URL(\"https://site.com\"), title: { default: \"Site — value prop\", template: \"%s — Site\" }, description, openGraph: { siteName, type: \"website\" }, twitter: { card: \"summary_large_image\" }.\n- Every route: unique title ≤60 chars (page-specific first, brand via the template) and description 140–160 chars written as the search-result pitch, not a keyword list.\n- Dynamic routes use generateMetadata({ params }); set alternates: { canonical: \"/path\" } on every indexable page (metadataBase resolves it absolute). Filtered/parameterized variants canonicalize to the clean URL.\n- openGraph.images: [{ url, width: 1200, height: 630, alt }]. No asset? Generate per page with opengraph-image.tsx + ImageResponse at 1200×630.\n- Non-indexable routes (auth, checkout steps, internal search results, previews): robots: { index: false }.\n\n### Crawl files\n- app/sitemap.ts returns MetadataRoute.Sitemap listing every indexable URL with lastModified — generated from the DB/CMS, not hardcoded.\n- app/robots.ts: allow all, point at the absolute sitemap URL, disallow only /api/ and auth routes. Never block CSS, JS, or OG images.\n- app/icon.svg (or icon.tsx) plus apple-icon.png at 180×180.\n\n### Structured data (JSON-LD)\n- Emit from Server Components: <script type=\"application/ld+json\" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />.\n- By page type — Home: Organization (name, url, logo, sameAs) + WebSite. Blog post: Article (headline, description, datePublished, dateModified, author as Person, image). Product page: Product (name, image, description, offers { price, priceCurrency, availability }; aggregateRating only if reviews render). FAQ section: FAQPage. Deep hierarchies: BreadcrumbList.\n- Markup mirrors visible content exactly — never claim ratings, FAQs, or prices the page doesn't show.\n\n### Document semantics & URLs\n- One h1 per page carrying the primary phrase; heading levels sequential; header/nav/main/footer landmarks.\n- Indexable copy is server-rendered (Server Components/SSG). Content that appears only after client fetch or interaction does not reliably index — put it in the HTML.\n- Anchor text describes the destination (\"See pricing plans\", never \"click here\" or a bare \"Learn more\"); link related pages to each other.\n- Slugs: lowercase kebab-case, stable; moved content gets a 301 (next.config redirects / permanentRedirect), never a client-side redirect.\n- Image alt describes content in natural phrasing (keywords only when honest); filenames meaningful (team-dashboard.png, not img_004.png).\n\n## Defaults\n- Per-page ship checklist: unique title · description 140–160 · canonical · OG image resolves absolute · one h1 · JSON-LD type chosen · listed in sitemap · URL returns 200 with no redirect chain.\n- Title patterns: pages \"{Thing} — {Site}\"; home \"{Site} — {value prop in ≤8 words}\".\n- Non-Next fallback, same values as raw tags: <title>, <meta name=\"description\">, <link rel=\"canonical\">, og:title / og:description / og:image / og:url / og:site_name, twitter:card.\n\n## Avoid\n- One sitewide title/description shared across routes.\n- \"use client\" pages that render primary copy only after mount.\n- <meta name=\"keywords\">, multiple h1s, heading levels chosen for font size.\n- Canonicals pointing at redirects or parameterized URLs.\n- JSON-LD claiming content the rendered page doesn't show (manual-action bait).\n- Blocking OG images or /_next/ assets in robots.txt.\n- Titles stuffed past 60 chars that truncate in results."
  },
  {
    "id": "web-performance",
    "name": "Web Performance",
    "summary": "Fast by default: LCP<2.5s / INP<200ms / CLS<0.1 budgets, image and font discipline, JS restraint, streaming, virtualization thresholds.",
    "body": "# Web Performance\n\nShip fast by default: hard Core Web Vitals budgets, image/font discipline, and JS restraint — enforced while building, not patched after. Explicit user direction overrides it.\n\n## When to use\nEvery user-facing web project; strictest on landing, commerce, and content pages where speed is conversion.\n\n## Rules\n\n### Budgets (treat as failing tests)\n- LCP < 2.5s, INP < 200ms, CLS < 0.1 on throttled mobile.\n- First-load JS per route ≤ 200KB gzipped (read the next build table); any new dependency over 15KB gz needs a stated justification.\n- LCP image ≤ 200KB. Total webfont payload ≤ 120KB: max 2 families; one variable file beats four static weights.\n\n### Images\n- Zero dimensionless images: next/image, or <img> with explicit width + height (reserves layout).\n- Serve AVIF/WebP at rendered size with sizes/srcset — never a 2000px original in a 400px slot.\n- LCP image: priority (next/image) or fetchpriority=\"high\", never lazy. Everything below the fold: loading=\"lazy\" decoding=\"async\".\n- Hero atmosphere from CSS gradients/SVG over raster wherever the design allows — zero bytes beats optimized bytes.\n\n### Fonts\n- next/font/google: build-time self-host, automatic subsetting, size-adjust fallback metrics (no font CLS) — not a runtime Google Fonts <link>.\n- Non-Next stacks: self-host WOFF2 via @font-face with font-display: swap; preload only above-the-fold faces; subset to latin.\n\n### JavaScript\n- Server Components by default; \"use client\" only at interactive leaves, never on whole pages or layouts for convenience.\n- Dynamic-import heavy or below-fold widgets — charts, editors, maps, video players: next/dynamic(() => import(\"./x\"), { ssr: false }) when client-only.\n- Third-party scripts via next/script: analytics strategy=\"lazyOnload\", must-run-early \"afterInteractive\"; nothing synchronous in <head>.\n- Dependency discipline: Intl or date-fns over moment; per-function lodash-es or native array methods; CSS transitions over an animation library for simple effects; no component mega-kit for one widget.\n- Fetch on the server in parallel (Promise.all) — no client→API→API waterfalls; wrap slow sections in <Suspense> and stream them.\n- Prefer static: generateStaticParams + export const revalidate (ISR) for content pages; per-request SSR only for truly per-user pages.\n\n### Layout stability & long pages\n- Reserve space for everything async: aspect-ratio on media and embeds, fixed-height slots for banners; never insert content above existing content after load.\n- Animate transform/opacity only; will-change only on the element currently animating.\n- Below-fold sections of long pages: content-visibility: auto; contain-intrinsic-size: auto 600px.\n- Virtualize lists over 100 rendered rows (@tanstack/react-virtual); paginate or infinite-load API lists over 50 items.\n- <link rel=\"preconnect\"> to at most 2–3 critical third-party origins.\n\n## Defaults\n- Hero image: <Image src={hero} priority width={1600} height={900} sizes=\"(max-width: 768px) 100vw, 60vw\" quality={75} alt=\"...\" />.\n- Heavy widget: const Chart = dynamic(() => import(\"./chart\"), { ssr: false, loading: () => <Skeleton /> }).\n- Verify pass: after next build, flag any route whose first-load JS exceeds 200KB; load the page and confirm nothing shifts after first paint; confirm the LCP element is server-rendered text or a priority image.\n\n## Avoid\n- Lazy-loading the LCP image — the classic self-inflicted 1s+ LCP.\n- Dimensionless <img>/iframes and late-inserted banners above content.\n- moment.js, full-lodash imports, a chart library for one sparkline, a carousel library for three slides.\n- Blocking the whole page on one slow fetch instead of streaming it behind <Suspense>.\n- A runtime Google Fonts <link> pulling five weights.\n- Animating width/height/top/left; will-change sprinkled globally.\n- \"use client\" at page level to make one button interactive."
  },
  {
    "id": "brand-voice-copy",
    "name": "Brand Voice & Copy",
    "summary": "Product voice and microcopy: verb+object buttons, three-part errors, empty states with a next step, one term per concept. Style-agnostic.",
    "body": "# Brand Voice & Copy\n\nWrite every UI string like a product writer sat with the designer — verbs on actions, causes and fixes in errors, a next step in every state. Explicit user direction overrides it.\n\n## When to use\nAny project with UI text: buttons, errors, empty states, toasts, dialogs, onboarding. Composes with any design pack; casing rules apply to the source string even when a pack renders labels in uppercase.\n\n## Rules\n\n### Casing and grammar\n- Sentence case for every UI string: buttons, titles, labels, menu items (\"Save changes\", never \"Save Changes\"). Acronyms keep their caps.\n- Second person: \"you/your\" for the user. \"We\" only in apologies and announcements. Never \"I\".\n- Present tense, active voice: \"Export finished\", not \"The export has been completed\".\n- At most one exclamation mark per screen, and only at a genuine win — never in errors or destructive flows.\n\n### Buttons and actions\n- Verb + object: \"Delete project\", \"Invite teammates\", \"Export CSV\". Never \"Submit\", \"OK\", \"Yes\"/\"No\", or \"Click here\".\n- Destructive dialogs: title asks the question (\"Delete this project?\"), body states the consequence with counts (\"This permanently removes 14 deployments. This can't be undone.\"), buttons are [Cancel] [Delete project]. The confirm button repeats the specific action; the safe option is always \"Cancel\".\n- Disabled controls get a visible reason nearby: \"Add at least one item to check out\".\n\n### Errors\n- Three-part shape, in order: what happened, why (when known), what to do next. \"Couldn't save your changes. You're offline — they'll sync when you reconnect.\"\n- Name the failing thing: \"Card ending in 4242 was declined\", not \"Payment error\".\n- State the fix, not the violation: \"Enter a date after today\", not \"Invalid date\". \"Password needs 8+ characters\", not \"Password too short\".\n- Error codes go last, in parentheses, only when support needs them: \"(error 5023)\".\n- Banned as complete messages: \"Oops!\", \"Uh oh\", \"Something went wrong\", \"An error occurred\", \"Invalid input\", \"Failed\".\n\n### Empty, loading, success\n- Empty state = what will live here + one verb CTA: \"No invoices yet. Create your first invoice.\"\n- Filtered-empty differs from true-empty: \"No results for 'quarterly'. Clear filters?\"\n- Loading names the work: \"Importing 214 contacts…\" over \"Loading…\". Past ~3 seconds, show a count or progress.\n- Success names the result, not the emotion: \"Invoice sent to arjun@acme.com\", never \"Success!\". Toasts run 7 words or fewer, with \"Undo\" wherever the action is reversible.\n\n### Consistency and tone\n- One term per concept, project-wide: pick \"project\" or \"workspace\"; \"sign in\", not \"log in\". \"Delete\" means permanent; \"remove\" means detach — never swap them.\n- Tone default is plain and calm. Playfulness is allowed only in empty states, success moments, and onboarding — never in errors, billing, auth, or destructive flows.\n- Numbers: exact below 10,000 (\"9,847\"), abbreviated above (\"12.4k\"). Time: relative under 7 days (\"2h ago\"), absolute after (\"Jun 24\").\n- \"Please\" only when asking the user to redo work the product caused.\n\n## Defaults\n- Error template: \"Couldn't [action]. [Cause]. [Fix or next step].\"\n- Empty template: \"No [items] yet. [Verb] your first [item].\"\n- Destructive dialog template: \"[Verb] [object]?\" / \"[Consequence with count]. This can't be undone.\" / [Cancel] [Verb object].\n- Toasts: \"Changes saved\" · \"Invoice sent\" + Undo · \"Copied\" (never \"Copied to clipboard successfully\").\n- Auth strings: \"Sign in\" · \"Create account\" · \"Forgot password?\" · \"Check your email — we sent a link to {email}\".\n\n## Avoid\n- \"Oops!\"/\"Whoops!\" anywhere — cuteness at the moment of failure reads as mockery.\n- \"Successfully\" — \"Saved successfully\" is just \"Saved\".\n- Title Case Buttons And Headings.\n- Robotic passives: \"The operation could not be completed.\"\n- Synonym drift: delete/remove/trash used interchangeably for one action.\n- Marketing adjectives inside product UI: \"powerful\", \"seamless\", \"blazing-fast\".\n- Caveat walls in dialogs — one consequence line beats a paragraph of terms."
  },
  {
    "id": "motion-polish",
    "name": "Motion Polish",
    "summary": "Motion system deep pack — duration/easing tokens, entrance choreography, spring vs tween rules, FLIP/view transitions, scroll restraint.",
    "body": "# Motion Polish\n\nMakes the project's motion a designed SYSTEM — shared tokens, choreographed entrances, physical interactions — instead of ad-hoc transitions. Composes with any visual style pack. Explicit user direction overrides it.\n\n## When to use\nProjects where feel is a feature: consumer apps, marketing pages, portfolios. Skip for dense admin tools, where extra motion is noise.\n\n## Rules\n\n### Tokens (define once, use everywhere)\n- Durations: --dur-xs 120ms (hover, press, toggles); --dur-sm 200ms (dropdowns, tooltips, list ops); --dur-md 320ms (panels, sheets, route pieces); --dur-lg 500ms (one-time hero or celebration only).\n- Easings: entering = cubic-bezier(0.16, 1, 0.3, 1); moving on-screen = cubic-bezier(0.65, 0, 0.35, 1); exiting = cubic-bezier(0.55, 0, 1, 0.45) at 0.7x the entrance duration — leaving is always faster than arriving.\n- Never the CSS keywords ease/linear on UI (linear is for marquees, spinners, progress fills only). Never transition: all — list the properties.\n\n### Choreography\n- Enter = opacity + translateY(12px to 0); popovers instead scale 0.97 to 1 with transform-origin at the trigger. Exit = opacity only, no reverse-slide.\n- Stagger siblings 50ms apart, cap at 8 animated items — items 9+ appear with the 8th. Total sequence under 600ms.\n- Order entrances by hierarchy: primary content, then supporting, then chrome — never all at once.\n- Count-ups: 800ms, font-variant-numeric: tabular-nums so digits don't shift layout. Bars/rings animate 300ms on value change.\n- Skeleton-to-content: content fades in over the skeleton 200ms with a 50ms overlap — never a hard swap.\n- Accordions/reveals: animate grid-template-rows 0fr to 1fr at --dur-sm; never height: auto directly.\n\n### Hover / press grammar\n- Hover in at --dur-xs; hover out at 200ms — quick to respond, gentle to release.\n- Press: 80ms down; release springs back ~250ms with slight overshoot.\n- Hover changes transform/opacity/color/box-shadow only — never size or layout position.\n\n### Spring vs tween\n- Springs for user-driven, physical things: drag release, toggles, sheets, reorders, press-release. Framer Motion: type \"spring\", stiffness 380, damping 30 for small UI; stiffness 170, damping 26 for large panels.\n- Tweens for everything declarative: fades, color, load/scroll entrances. NEVER spring opacity or color.\n- All motion interruptible: CSS transitions and springs retarget mid-flight; never chain setTimeout sequences the user cannot cancel.\n\n### FLIP / View Transitions\n- Reorders, expand-to-detail, grid-to-list: FLIP (Framer Motion layout/layoutId) or document.startViewTransition with view-transition-name on the shared element; 250-350ms with the moving easing.\n- Guard it: document.startViewTransition ? document.startViewTransition(update) : update();\n- Compositor properties only (transform/opacity); FLIP inversion is the sole sanctioned layout animation. will-change lives only for the animation's duration.\n\n### Scroll\n- Reveal-on-scroll: IntersectionObserver at threshold 0.2, animate once, unobserve after; only for elements below the initial viewport (above the fold belongs to the load sequence).\n- Scroll-linked effects: CSS animation-timeline: view() where supported; total travel 8% of element height or less; at most ONE scroll-linked device per page.\n- Never hijack scroll speed, position, or wheel behavior — use sticky + transform choreography instead.\n\n### Reduced motion (the concrete fallback)\n- Under prefers-reduced-motion: keep 150ms opacity fades; zero all translate/scale/rotate; kill parallax, marquees, autoplay loops; count-ups render the final value instantly. Content must still appear — never gate visibility on a skipped entrance.\n- Gate JS motion identically: const reduced = matchMedia(\"(prefers-reduced-motion: reduce)\").matches.\n\n## Defaults\n- :root { --dur-xs: 120ms; --dur-sm: 200ms; --dur-md: 320ms; --dur-lg: 500ms; --ease-out: cubic-bezier(0.16,1,0.3,1); --ease-move: cubic-bezier(0.65,0,0.35,1); --ease-exit: cubic-bezier(0.55,0,1,0.45); }\n- .enter { animation: enter var(--dur-md) var(--ease-out) both; } @keyframes enter { from { opacity: 0; translate: 0 12px; } } — stagger via animation-delay: calc(50ms * var(--i)).\n- Framer Motion: parent { show: { transition: { staggerChildren: 0.05 } } }; child { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] } } }.\n\n## Avoid\n- Animating width/height/top/left/margin (outside FLIP inversion) — compositor properties only.\n- Uniform 300ms-ease on everything — that IS the ad-hoc feel this pack replaces.\n- Entrances over 600ms, or any animation that blocks input while it plays.\n- Springs on opacity, bounce on body text, overshoot on anything full-screen.\n- Two attention-seekers animating simultaneously in one viewport.\n- Re-triggering scroll reveals on direction change — reveal once, then stay.\n- Installing a library for what CSS transitions already do; Framer Motion earns its place only for FLIP, gestures, and springs."
  }
];

export function findPackById(id: string): SkillPack | null {
  return SKILL_PACKS.find((p) => p.id === id) ?? null;
}

// ── Collaboration, organizations & RBAC (P3/P8/P10) ───────────────────────────
// Single source of truth for the roles, statuses, and row shapes shared by the
// orchestrator (db + routes) and the web UI. Mirrors the tables added to
// `services/orchestrator/src/db/schema.sql`.

/** RBAC role on an org or a project, most→least privileged. */
export type Role = "owner" | "admin" | "editor" | "viewer";

/** Privilege rank for `Role` — higher is more privileged. */
export const ROLE_RANK: Record<Role, number> = {
  owner: 3,
  admin: 2,
  editor: 1,
  viewer: 0,
};

/** True when `role` is at least as privileged as `min`. */
export function roleAtLeast(role: Role | null | undefined, min: Role): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export interface Organization {
  id: string;
  name: string;
  owner_id: string | null;
  monthly_budget_usd: number | null;
  created_at: string;
  updated_at: string;
}

/** Org-scoped month-to-date spend vs. cap, for the org Usage card (P3.5). */
export interface OrgUsageSummary {
  /** Σ snapshotted agent spend (USD) across the org's projects this calendar month. */
  spend_usd: number;
  /** The org's monthly cap (USD), or null when uncapped. */
  budget_usd: number | null;
  /** How many projects currently live in the org. */
  project_count: number;
  /** ISO timestamp of the start of the current calendar month the spend covers. */
  month_start: string;
}

export interface OrgMember {
  id: string;
  org_id: string;
  user_id: string;
  role: Role;
  created_at: string;
  /** Joined for display (not a column). */
  email?: string | null;
  display_name?: string | null;
}

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  role: Role;
  created_at: string;
  email?: string | null;
  display_name?: string | null;
}

export type CommentTargetKind = "element" | "file" | "checkpoint" | "pr" | "general";

export interface Comment {
  id: string;
  project_id: string;
  user_id: string | null;
  target_kind: CommentTargetKind;
  target_ref: string | null;
  body: string;
  resolved: boolean;
  created_at: string;
  author_email?: string | null;
  author_name?: string | null;
}

/** Lifecycle of a durable async agent task (P8.1). */
export type AgentTaskStatus = "queued" | "running" | "done" | "failed" | "canceled";

export interface AgentTask {
  id: string;
  project_id: string;
  org_id: string | null;
  created_by: string | null;
  title: string;
  prompt: string;
  status: AgentTaskStatus;
  branch: string | null;
  acceptance_criteria: string | null;
  result_summary: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

/** Kind of evidence captured during a turn and persisted with a checkpoint (P2.3). */
export type ArtifactKind = "interaction" | "screenshot" | "console" | "network" | "a11y" | "flow";

export interface CheckpointArtifact {
  id: string;
  project_id: string;
  session_id: string | null;
  checkpoint_sha: string | null;
  kind: ArtifactKind;
  summary: string | null;
  data: Record<string, unknown>;
  created_at: string;
}

/**
 * One step of a saved smoke-flow (P2.4) — the exact action vocabulary the
 * agent's `interact_preview` tool drives. Stored as `project_flows.steps`
 * (jsonb) and replayed verbatim through the same Playwright path, so a saved
 * flow and a live agent interaction are the same shape.
 */
export interface FlowStep {
  type:
    | "navigate"
    | "click"
    | "type"
    | "fill"
    | "select"
    | "press"
    | "scroll"
    | "wait_for_text"
    | "wait"
    | "assert_text"
    | "assert_url"
    | "assert_visible"
    | "screenshot";
  /** CSS selector for click/type/fill/select/press/assert_visible. */
  selector?: string;
  /** Text to type/select, key to press, text/url to assert or wait for. */
  value?: string;
  /** Absolute URL or same-origin sub-path for navigate. */
  url?: string;
  direction?: "up" | "down";
  pixels?: number;
  timeout_ms?: number;
}

export type FlowRunStatus = "pass" | "fail" | "error";

/**
 * A saved, replayable smoke-flow (P2.4) — e.g. "create an invoice and mark it
 * paid". The agent records one after building a feature (`save_flow`) and
 * replays it after later changes (`run_flow`); the user can also replay it
 * one-click from the Preview (Agent) tab. The `last_*` fields capture the most
 * recent replay as a compact evidence card ("Gate 15 tried the app — here's what
 * it checked"), not a mandatory gate.
 */
export interface ProjectFlow {
  id: string;
  project_id: string;
  created_by: string | null;
  name: string;
  description: string | null;
  steps: FlowStep[];
  /** Optional sub-path to start the flow at (resolved against the preview origin). */
  start_path: string | null;
  last_status: FlowRunStatus | null;
  last_run_at: string | null;
  last_summary: string | null;
  created_at: string;
  updated_at: string;
}

/** Audit event kinds exposed to the admin audit UI (P10.3). Mirrors db AuditKind. */
export type AuditEventKind =
  | "secret_read"
  | "secret_write"
  | "secret_delete"
  | "connector_invoke"
  | "connector_invoke_error"
  | "checkpoint_create"
  | "checkpoint_restore"
  | "login"
  | "logout"
  | "project_create"
  | "project_update"
  | "project_delete"
  | "member_invite"
  | "member_remove"
  | "role_change"
  | "deploy"
  | "preview_share"
  | "github_action"
  | "db_lifecycle"
  | "org_create"
  | "org_update";

export interface AuditEvent {
  id: number;
  project_id: string | null;
  user_id: string | null;
  kind: AuditEventKind;
  target: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}
