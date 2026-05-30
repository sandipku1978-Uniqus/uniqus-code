import Anthropic from "@anthropic-ai/sdk";
import type { ThinkingEffort } from "@uniqus/api-types";
import { WEB_SEARCH_TOOL } from "../tools.js";
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
): void {
  if (!effort) return;
  params.thinking = { type: "adaptive" };
  params.output_config = { effort };
}

/**
 * Strip provider-specific extras the canonical history may carry that the
 * Anthropic API rejects. The Gemini adapter stamps `thought_signature` onto
 * tool_use blocks (it needs them echoed back); when a conversation switches to
 * Claude, those blocks reach the Messages API, which 400s on the unknown field
 * ("tool_use.thought_signature: Extra inputs are not permitted"). We send a
 * shallow-cleaned copy and leave the stored history untouched (Gemini still
 * needs the signature). Only clones messages/blocks that actually carry it.
 */
function stripForeignFields(
  messages: Anthropic.MessageParam[],
): Anthropic.MessageParam[] {
  return messages.map((m) => {
    if (!Array.isArray(m.content)) return m;
    let touched = false;
    const content = m.content.map((block) => {
      if (
        block &&
        typeof block === "object" &&
        (block as { type?: string }).type === "tool_use" &&
        "thought_signature" in block
      ) {
        touched = true;
        const { thought_signature: _drop, ...rest } = block as Record<string, unknown>;
        return rest as unknown as Anthropic.ContentBlockParam;
      }
      return block;
    });
    return touched ? ({ ...m, content } as Anthropic.MessageParam) : m;
  });
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
      tools: [...p.tools, WEB_SEARCH_TOOL] as Anthropic.MessageCreateParams["tools"],
      messages: withPrefixCache(stripForeignFields(p.messages)),
    } as Anthropic.MessageCreateParamsStreaming;
    applyEffort(params as unknown as Record<string, unknown>, p.thinkingEffort);

    const stream = this.client.messages.stream(
      params,
      p.signal ? { signal: p.signal } : undefined,
    );

    const announced = new Set<string>();
    // Live token usage: message_start carries the input (+ cache) token count;
    // each message_delta carries the running output_tokens. Surface both as
    // they arrive so the composer's counter ticks up during the stream.
    let inputTokens = 0;
    let outputTokens = 0;
    stream.on("streamEvent", (event) => {
      if (event.type === "message_start") {
        const u = event.message.usage;
        inputTokens =
          (u.input_tokens ?? 0) +
          (u.cache_read_input_tokens ?? 0) +
          (u.cache_creation_input_tokens ?? 0);
        outputTokens = u.output_tokens ?? 0;
        p.onUsage?.({ inputTokens, outputTokens });
      } else if (event.type === "message_delta") {
        if (event.usage?.output_tokens != null) {
          outputTokens = event.usage.output_tokens;
          p.onUsage?.({ inputTokens, outputTokens });
        }
      } else if (event.type === "content_block_start") {
        const block = event.content_block;
        if (block.type === "tool_use" && !announced.has(block.id)) {
          announced.add(block.id);
          p.onToolCallStarted?.(block.id, block.name);
        }
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") p.onText?.(event.delta.text);
        // Adaptive/extended thinking streams as thinking_delta — surface it as
        // the live reasoning trace (separate from the final answer text).
        else if (event.delta.type === "thinking_delta") p.onThinking?.(event.delta.thinking);
      }
    });

    const finalMessage = await stream.finalMessage();
    const fu = finalMessage.usage;
    const finalUsage = {
      inputTokens:
        (fu.input_tokens ?? 0) +
        (fu.cache_read_input_tokens ?? 0) +
        (fu.cache_creation_input_tokens ?? 0),
      outputTokens: fu.output_tokens ?? 0,
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
