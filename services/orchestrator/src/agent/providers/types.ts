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
import type { ThinkingEffort } from "@uniqus/api-types";

/** API keys for whichever providers are configured. */
export interface ProviderKeys {
  anthropic?: string;
  openai?: string;
  google?: string;
}

export type ProviderName = "anthropic" | "openai" | "google";

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
}

export interface StreamTurnResult {
  /**
   * Assistant content blocks to append to history verbatim. Always
   * Anthropic-shaped so history stays uniform across providers.
   */
  content: Anthropic.ContentBlockParam[];
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "other";
  /** Client tool calls the loop must execute. Excludes provider-side tools. */
  toolCalls: AgentToolCall[];
}

export interface ForcedToolParams {
  model: string;
  system: string;
  /** The single tool whose call is forced (plan mode's submit_plan). */
  tool: Anthropic.Tool;
  messages: Anthropic.MessageParam[];
  maxTokens: number;
  signal?: AbortSignal;
}

/** A provider that can run the agent loop and forced-tool (plan) calls. */
export interface ModelProviderAdapter {
  readonly provider: ProviderName;
  /** Stream one assistant turn (text + tool calls). */
  streamAgentTurn(p: StreamTurnParams): Promise<StreamTurnResult>;
  /** Force a single structured tool call; resolves with the parsed tool input. */
  callForcedTool(p: ForcedToolParams): Promise<unknown>;
}

/** Thrown when a turn is requested for a provider with no configured API key. */
export class MissingProviderKeyError extends Error {
  constructor(public readonly provider: ProviderName) {
    super(
      `No API key configured for provider '${provider}'. Set ${
        provider === "anthropic"
          ? "ANTHROPIC_API_KEY"
          : provider === "openai"
            ? "OPENAI_API_KEY"
            : "GOOGLE_API_KEY (or GEMINI_API_KEY)"
      } on the orchestrator, or pick a different model.`,
    );
    this.name = "MissingProviderKeyError";
  }
}
