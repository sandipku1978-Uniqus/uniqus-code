import Anthropic from "@anthropic-ai/sdk";
import type { ThinkingEffort } from "@uniqus/api-types";
import { WEB_SEARCH_TOOL } from "../tools.js";
import { parsePartialJson } from "./partialJson.js";
import type {
  ForcedToolParams,
  ModelProviderAdapter,
  StreamTurnParams,
  StreamTurnResult,
} from "./types.js";

/**
 * Map the thinking-effort control to Claude's `effort` levels (low/medium/high
 * line up 1:1). On Opus 4.8 / Sonnet 4.6, `effort` (under `output_config`) is
 * the supported control — manual `thinking.budget_tokens` returns a 400 on 4.8
 * — paired with adaptive thinking (`thinking: {type:"adaptive"}`) so the model
 * actually reasons; `effort` then governs how deeply. Applied via a runtime
 * cast since these fields may post-date the SDK's typings. Only on the agent
 * turn — forced-tool (plan) calls can't combine with thinking.
 * See https://platform.claude.com/docs/en/build-with-claude/effort
 */
function applyEffort(
  params: Record<string, unknown>,
  effort: ThinkingEffort | undefined,
  enabled: boolean,
): void {
  // Thinking toggled OFF: disable extended thinking entirely (accepted on Opus
  // 4.8/4.7). We still let `effort` govern overall token spend when set — effort
  // and thinking are independent controls — but with thinking disabled the model
  // won't burn a reasoning budget, which is the whole point of the toggle.
  if (!enabled) {
    params.thinking = { type: "disabled" };
    if (effort) params.output_config = { effort };
    return;
  }
  // Opus 4.8 accepts the full low/medium/high/xhigh/max scale under
  // output_config.effort, paired with adaptive thinking so the model reasons.
  // display:"summarized" is REQUIRED to stream a visible reasoning trace: on
  // Opus 4.8/4.7 the `display` default is "omitted", which still emits thinking
  // blocks but with EMPTY text — so `thinking_delta` fires with nothing in it and
  // the UI's reasoning card never fills (the "no thought signatures on Claude"
  // bug). Summarized returns a readable trace; thinking is billed the same either
  // way. See claude-api skill → "Thinking display".
  params.thinking = { type: "adaptive", display: "summarized" };
  if (effort) params.output_config = { effort };
}

// Non-standard fields other adapters stamp onto content blocks for their own
// round-tripping: Gemini's `thought_signature` + `thought_signature_model`
// (3.x multi-turn reasoning — on BOTH tool_use AND text blocks; the model
// stamp gates same-model signature replay) and OpenAI's `openai_reasoning`
// (encrypted reasoning replay, on tool_use). The Messages API 400s on unknown
// block fields ("Extra inputs are not permitted"), so they must be removed
// before a conversation that switched to Claude reaches the API.
const FOREIGN_BLOCK_FIELDS = [
  "thought_signature",
  "thought_signature_model",
  "openai_reasoning",
] as const;

/**
 * Strip provider-specific extras the canonical history may carry that the
 * Anthropic API rejects (see FOREIGN_BLOCK_FIELDS). We send a shallow-cleaned
 * copy and leave the stored history untouched (the other providers still need
 * their fields). Only clones messages/blocks that actually carry one — and
 * checks every block type, since a Gemini text block can carry a signature too.
 */
function stripForeignFields(
  messages: Anthropic.MessageParam[],
): Anthropic.MessageParam[] {
  return messages.map((m) => {
    if (!Array.isArray(m.content)) return m;
    let touched = false;
    const content = m.content.map((block) => {
      const rec = block as unknown as Record<string, unknown>;
      if (
        block &&
        typeof block === "object" &&
        FOREIGN_BLOCK_FIELDS.some((f) => f in rec)
      ) {
        touched = true;
        const rest = { ...rec };
        for (const f of FOREIGN_BLOCK_FIELDS) delete rest[f];
        return rest as unknown as Anthropic.ContentBlockParam;
      }
      return block;
    });
    return touched ? ({ ...m, content } as Anthropic.MessageParam) : m;
  });
}

/**
 * Mark the LAST tool as a cache breakpoint. Tools render first in the prompt
 * prefix (before system + messages), and our tool schemas are large (~16 KB)
 * and static, so caching them is a major saving across the loop's iterations.
 * A breakpoint here caches the entire tools block; it also survives turns where
 * only the system text changes (skills/repo/account-prompt are per-turn), which
 * a system-only breakpoint would invalidate. cache_control on a tool is natively
 * typed in the SDK (0.100.1), so no cast is needed. Returns a shallow copy.
 */
function withToolCache(tools: Anthropic.Tool[]): Anthropic.Tool[] {
  if (tools.length === 0) return tools;
  const i = tools.length - 1;
  const copy = [...tools];
  copy[i] = { ...copy[i], cache_control: { type: "ephemeral" } } as Anthropic.Tool;
  return copy;
}

/**
 * Mark the last message's last block as a cache breakpoint so the whole
 * conversation prefix (system + all prior messages) is read from cache on the
 * next iteration instead of re-billed in full. The agent loop replays the
 * growing history every iteration; without this, a long tool-use turn pays
 * full input price for the unchanged prefix each time. Returns a shallow copy
 * (only the last message/block is cloned) so shared history isn't mutated.
 */
function withPrefixCache(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  if (messages.length === 0) return messages;
  const lastIdx = messages.length - 1;
  const last = messages[lastIdx];
  const cc = { type: "ephemeral" as const };

  let content: Anthropic.MessageParam["content"];
  if (typeof last.content === "string") {
    content = [{ type: "text", text: last.content, cache_control: cc }];
  } else if (Array.isArray(last.content) && last.content.length > 0) {
    content = last.content.map((b, i) =>
      i === last.content.length - 1
        ? ({ ...(b as object), cache_control: cc } as Anthropic.ContentBlockParam)
        : b,
    );
  } else {
    return messages;
  }

  const copy = [...messages];
  copy[lastIdx] = { ...last, content } as Anthropic.MessageParam;
  return copy;
}

/**
 * Anthropic adapter. This is the native path — the canonical message shape IS
 * Anthropic's, so there's no translation. It also keeps the server-side
 * web_search tool, which only Anthropic offers; the other adapters omit it.
 */
export class AnthropicAdapter implements ModelProviderAdapter {
  readonly provider = "anthropic" as const;
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async streamAgentTurn(p: StreamTurnParams): Promise<StreamTurnResult> {
    const params = {
      model: p.model,
      max_tokens: p.maxTokens,
      system: [{ type: "text", text: p.system, cache_control: { type: "ephemeral" } }],
      tools: withToolCache([
        ...p.tools,
        WEB_SEARCH_TOOL,
      ] as Anthropic.Tool[]) as Anthropic.MessageCreateParams["tools"],
      messages: withPrefixCache(stripForeignFields(p.messages)),
    } as Anthropic.MessageCreateParamsStreaming;
    applyEffort(
      params as unknown as Record<string, unknown>,
      p.thinkingEffort,
      p.thinkingEnabled !== false,
    );

    const stream = this.client.messages.stream(
      params,
      p.signal ? { signal: p.signal } : undefined,
    );

    const announced = new Set<string>();
    // Live tool-arg streaming: accumulate each tool_use block's partial JSON
    // (keyed by content-block index) and forward a best-effort parse so the UI
    // shows the file name / command / diff as it's typed. Throttled per block so
    // per-token deltas don't flood the parse+socket path.
    const toolBlocks = new Map<number, { id: string; name: string; json: string; lastEmit: number }>();
    // Live token usage. message_start carries the input breakdown; each
    // message_delta carries the running output_tokens. We keep the three input
    // buckets SEPARATE — `input_tokens` is the fresh/uncached remainder,
    // `cache_read_input_tokens` bills ~0.1×, `cache_creation_input_tokens`
    // ~1.25× — so the dashboard can price a cached turn honestly instead of
    // charging every replayed prefix token at the full rate (the bug that made
    // a small task look like millions of input tokens).
    let inputTokens = 0; // fresh (uncached)
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;
    let outputTokens = 0;
    const emitLive = (): void =>
      p.onUsage?.({ inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens });
    stream.on("streamEvent", (event) => {
      if (event.type === "message_start") {
        const u = event.message.usage;
        inputTokens = u.input_tokens ?? 0;
        cacheReadTokens = u.cache_read_input_tokens ?? 0;
        cacheCreationTokens = u.cache_creation_input_tokens ?? 0;
        outputTokens = u.output_tokens ?? 0;
        emitLive();
      } else if (event.type === "message_delta") {
        if (event.usage?.output_tokens != null) {
          outputTokens = event.usage.output_tokens;
          emitLive();
        }
      } else if (event.type === "content_block_start") {
        const block = event.content_block;
        if (block.type === "tool_use" && !announced.has(block.id)) {
          announced.add(block.id);
          toolBlocks.set(event.index, { id: block.id, name: block.name, json: "", lastEmit: 0 });
          p.onToolCallStarted?.(block.id, block.name);
        }
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") p.onText?.(event.delta.text);
        // Adaptive/extended thinking streams as thinking_delta — surface it as
        // the live reasoning trace (separate from the final answer text).
        else if (event.delta.type === "thinking_delta") p.onThinking?.(event.delta.thinking);
        // A tool's arguments stream as input_json_delta fragments. Accumulate
        // and forward a best-effort partial parse (throttled ~60ms) so the UI
        // shows the file name / command / diff live before the call completes.
        else if (event.delta.type === "input_json_delta") {
          const tb = toolBlocks.get(event.index);
          if (tb && p.onToolCallPartial) {
            tb.json += event.delta.partial_json;
            const now = Date.now();
            if (now - tb.lastEmit >= 60) {
              tb.lastEmit = now;
              const partial = parsePartialJson(tb.json);
              if (partial !== undefined) p.onToolCallPartial(tb.id, tb.name, partial);
            }
          }
        }
      }
    });

    const finalMessage = await stream.finalMessage();
    const fu = finalMessage.usage;
    const finalUsage = {
      inputTokens: fu.input_tokens ?? 0, // fresh (uncached) only
      outputTokens: fu.output_tokens ?? 0,
      cacheReadTokens: fu.cache_read_input_tokens ?? 0,
      cacheCreationTokens: fu.cache_creation_input_tokens ?? 0,
    };
    p.onUsage?.(finalUsage);

    const toolCalls: StreamTurnResult["toolCalls"] = [];
    for (const block of finalMessage.content) {
      if (block.type === "tool_use") {
        toolCalls.push({ id: block.id, name: block.name, input: block.input });
        p.onToolCall?.(block.id, block.name, block.input);
      } else if (block.type !== "text") {
        // Server-side tool blocks (web_search): Anthropic ran them; surface
        // the activity but don't hand them to the loop for execution.
        const b = block as unknown as {
          type: string;
          id?: string;
          name?: string;
          input?: unknown;
          tool_use_id?: string;
          content?: unknown;
        };
        if (b.type === "server_tool_use") {
          if (b.id && !announced.has(b.id)) p.onToolCallStarted?.(b.id, b.name ?? "web_search");
          p.onToolCall?.(b.id ?? "", b.name ?? "web_search", b.input);
        } else if (b.type === "web_search_tool_result") {
          p.onToolResult?.(
            b.tool_use_id ?? "",
            "web_search",
            undefined,
            formatWebSearchResults(b.content),
            false,
          );
        }
      }
    }

    return {
      content: finalMessage.content,
      stopReason: mapStopReason(finalMessage.stop_reason),
      toolCalls,
      usage: finalUsage,
    };
  }

  async callForcedTool(p: ForcedToolParams): Promise<unknown> {
    const response = await this.client.messages.create(
      {
        model: p.model,
        max_tokens: p.maxTokens,
        system: p.system,
        tools: [p.tool],
        tool_choice: { type: "tool", name: p.tool.name },
        messages: stripForeignFields(p.messages),
      },
      p.signal ? { signal: p.signal } : undefined,
    );
    const block = response.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use" || block.name !== p.tool.name) {
      throw new Error(`Model did not return a ${p.tool.name} tool call`);
    }
    return block.input;
  }
}

function mapStopReason(reason: string | null): StreamTurnResult["stopReason"] {
  if (reason === "end_turn" || reason === "stop_sequence") return "end_turn";
  if (reason === "tool_use") return "tool_use";
  if (reason === "max_tokens") return "max_tokens";
  // A server-side tool (web_search) paused a long-running turn; per the SDK
  // (0.100.1) we resubmit the partial assistant content as-is to continue, so
  // the loop must re-loop rather than treat this as a finish.
  if (reason === "pause_turn") return "pause_turn";
  // The model refused to respond — end the turn, but surface it distinctly so
  // the loop doesn't present a silent empty completion.
  if (reason === "refusal") return "refusal";
  return "other";
}

function formatWebSearchResults(content: unknown): string {
  if (!Array.isArray(content)) return JSON.stringify(content ?? null);
  const lines: string[] = [];
  content.forEach((r, i) => {
    const item = r as { type?: string; title?: string; url?: string; error_code?: string };
    if (item.type === "web_search_result") {
      lines.push(`${i + 1}. ${item.title ?? "(no title)"}\n   ${item.url ?? ""}`);
    } else if (item.error_code) {
      lines.push(`${i + 1}. [error] ${item.error_code}`);
    }
  });
  return lines.length > 0 ? lines.join("\n") : "(no results)";
}
