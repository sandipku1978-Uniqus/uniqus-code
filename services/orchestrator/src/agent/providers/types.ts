/**
 * Provider-adapter interface (Plan §5 — "router behind a clean interface").
 *
 * The agent loop speaks ONE canonical shape — Anthropic's `MessageParam`
 * content blocks — because that's what gets persisted to chat history and
 * replayed across turns. Each adapter translates that canonical shape to and
 * from its provider's native request/response format, so the loop never
 * branches on the vendor. OpenAI and Gemini adapters convert messages on the
 * way in and synthesize Anthropic-shaped content blocks on the way out.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { Citation, ThinkingEffort } from "@gate15/api-types";

/** API keys for whichever providers are configured. */
export interface ProviderKeys {
  anthropic?: string;
  openai?: string;
  google?: string;
  /** Z.ai (GLM). Runs through the Anthropic-compatible endpoint. */
  zai?: string;
}

export type ProviderName = "anthropic" | "openai" | "google" | "zai";

/** A client tool call the loop must execute (read_file, run_command, …). */
export interface AgentToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface StreamTurnParams {
  model: string;
  system: string;
  /** Canonical (Anthropic-shaped) tool definitions the agent may call. */
  tools: Anthropic.Tool[];
  /** Conversation so far, canonical (Anthropic-shaped) form. */
  messages: Anthropic.MessageParam[];
  maxTokens: number;
  /**
   * Reasoning effort for this turn (the composer's thinking control). Each
   * adapter maps it to its provider's native reasoning param. Undefined ⇒ the
   * provider's own default (no reasoning param sent).
   */
  thinkingEffort?: ThinkingEffort;
  /**
   * Whether extended thinking is enabled for this turn (the composer's on/off
   * toggle). Undefined ⇒ true (thinking on). When false, each adapter disables
   * reasoning in its native way (Anthropic `thinking:disabled`, GLM thinking
   * off, OpenAI `minimal`, Gemini its lowest tier) for a faster, cheaper turn.
   */
  thinkingEnabled?: boolean;
  /** Omit provider-native web search when its per-request spend is not bounded. */
  disableWebSearch?: boolean;
  signal?: AbortSignal;
  /** Fires for each streamed text delta. */
  onText?: (delta: string) => void;
  /**
   * Fires for each streamed reasoning/thinking delta (Anthropic adaptive
   * thinking, Gemini thought summaries). Surfaced as a collapsible trace,
   * separate from the answer text. Not all providers expose reasoning
   * content (e.g. OpenAI Chat Completions hides it).
   */
  onThinking?: (delta: string) => void;
  /** Fires once when a tool block first appears (UI shows a "running…" row). */
  onToolCallStarted?: (id: string, name: string) => void;
  /**
   * Fires as a tool's argument JSON streams in, carrying a best-effort partial
   * parse of the arguments so far (see parsePartialJson — may be incomplete).
   * Lets the UI fill in the file name / command / live diff BEFORE the tool call
   * finishes generating, instead of a blank "running…" row. Providers that emit
   * whole tool calls atomically (Gemini) never fire this; the loop forwards it as
   * an updated `tool_call` event, which the client upserts by id.
   */
  onToolCallPartial?: (id: string, name: string, partialInput: unknown) => void;
  /** Fires with the full parsed input once a tool block finishes streaming. */
  onToolCall?: (id: string, name: string, input: unknown) => void;
  /**
   * Fires for provider-side tools the adapter ran itself (e.g. Anthropic's
   * server-side web_search) — the loop does NOT execute these.
   */
  onToolResult?: (
    id: string,
    name: string,
    input: unknown,
    result: string,
    isError: boolean,
  ) => void;
  /**
   * Fires as token usage for THIS provider call becomes known (live during the
   * stream where the provider supports it — Anthropic streams output tokens
   * incrementally; OpenAI/Gemini only report at the end). Counts are for this
   * single call; the loop accumulates across iterations. Drives the live
   * "X in · Y out" counter in the composer.
   */
  onUsage?: (usage: TokenUsage) => void;
  /**
   * Fires once per provider response when a built-in, provider-executed tool
   * incurred a separately billable fee. The payload is the cumulative total
   * for THIS response (never a streaming delta), and zero-use responses do not
   * fire it. `exact` means both units and cost are authoritative at current
   * list pricing; `estimated` means the provider response proves the units but
   * an allowance or opaque billing rule prevents knowing the eventual invoice
   * amount from the response alone.
   */
  onBillableToolUsage?: (usage: BillableToolUsage) => void;
}

/** Token usage for one model call (cumulative for the call, not a delta). */
export interface TokenUsage {
  /**
   * FRESH (uncached) input tokens — billed at the full input rate. Each
   * provider reports caching differently, so the adapters normalize to this
   * meaning: Anthropic's `input_tokens` is already the uncached remainder;
   * OpenAI/Gemini report a total that INCLUDES cache, so those adapters
   * subtract the cached portion to land here. Keeping one consistent meaning
   * lets the loop sum across providers without re-deriving the split.
   */
  inputTokens: number;
  outputTokens: number;
  /** Prompt tokens served from cache (Anthropic cache_read / OpenAI
   * cached_tokens / Gemini cachedContentTokenCount). Billed ~0.1×. */
  cacheReadTokens?: number;
  /** Tokens written to the cache this call (Anthropic cache_creation; ~1.25×).
   * OpenAI/Gemini auto-cache with no separate write line, so 0 there. */
  cacheCreationTokens?: number;
}

export interface StreamTurnResult {
  /**
   * Assistant content blocks to append to history verbatim. Always
   * Anthropic-shaped so history stays uniform across providers.
   */
  content: Anthropic.ContentBlockParam[];
  /**
   * Why the provider ended the turn. `pause_turn` is Anthropic-specific: a
   * server-side tool (web_search) paused a long turn and expects the partial
   * assistant content resubmitted to continue (the loop re-loops). `refusal`
   * means the model declined — the loop ends the turn but surfaces it rather
   * than dropping it silently.
   */
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "pause_turn" | "refusal" | "other";
  /** Client tool calls the loop must execute. Excludes provider-side tools. */
  toolCalls: AgentToolCall[];
  /** Final token usage for this call, if the provider reported it. */
  usage?: TokenUsage;
  /**
   * Web sources the model cited this turn, normalized across providers and
   * ordered by where the cited span ends. Every provider that runs a
   * server-side search requires these be shown to the user — see
   * agent/citations.ts. Absent when the turn did no searching.
   */
  citations?: Citation[];
}

export interface ForcedToolParams {
  model: string;
  system: string;
  /** The single tool whose call is forced (plan mode's submit_plan). */
  tool: Anthropic.Tool;
  messages: Anthropic.MessageParam[];
  maxTokens: number;
  signal?: AbortSignal;
  /**
   * Fires as soon as the provider response's usage is available. This is
   * deliberately separate from the resolved result: providers validate the
   * forced tool call after receiving (and therefore billing) the response, so
   * malformed output can reject while its usage still needs to be metered.
   */
  onUsage?: (usage: TokenUsage) => void;
}

/** Separately billed usage from a provider-side built-in tool. */
export interface BillableToolUsage {
  kind: "web_search";
  /** Provider-defined billable uses for this single response. */
  units: number;
  /** USD at the provider's current public list price. */
  costUsd: number;
  /** Whether `costUsd` can be treated as the response's authoritative charge. */
  accuracy: "exact" | "estimated";
}

export interface ForcedToolResult {
  input: unknown;
  usage?: TokenUsage;
}

/** A provider that can run the agent loop and forced-tool (plan) calls. */
export interface ModelProviderAdapter {
  readonly provider: ProviderName;
  /** Stream one assistant turn (text + tool calls). */
  streamAgentTurn(p: StreamTurnParams): Promise<StreamTurnResult>;
  /** Force a single structured tool call; resolves with the parsed tool input. */
  callForcedTool(p: ForcedToolParams): Promise<ForcedToolResult>;
}

/**
 * Default system steer for the vision bridge that backs analyze_image for
 * text-only models. ONE constant shared by both backends (Gemini Flash primary
 * in google.ts, GLM-5V fallback in zai.ts) so their behavior can't drift;
 * task-specialized vision tools override it per call (loop.ts visionBridgeSpec).
 */
export const DEFAULT_VISION_BRIDGE_SYSTEM =
  "You are a precise visual-analysis assistant. Examine the image and answer the question factually and specifically. For UI screenshots, report layout, alignment, spacing, color/contrast, overlaps, truncation, legibility, and anything visibly broken or off. Be concrete; do not speculate beyond what's visible.";

/** The env var(s) that configure each provider's key (for error messages). */
const PROVIDER_ENV_HINT: Record<ProviderName, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY (or GEMINI_API_KEY)",
  zai: "ZAI_API_KEY (or GLM_API_KEY)",
};

/** Thrown when a turn is requested for a provider with no configured API key. */
export class MissingProviderKeyError extends Error {
  constructor(public readonly provider: ProviderName) {
    super(
      `No API key configured for provider '${provider}'. Set ${PROVIDER_ENV_HINT[provider]} ` +
        `on the orchestrator, or pick a different model.`,
    );
    this.name = "MissingProviderKeyError";
  }
}
