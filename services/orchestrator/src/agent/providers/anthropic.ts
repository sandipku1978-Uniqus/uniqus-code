import Anthropic from "@anthropic-ai/sdk";
import { WEB_SEARCH_TOOL } from "../tools.js";
import type {
  ForcedToolParams,
  ModelProviderAdapter,
  StreamTurnParams,
  StreamTurnResult,
} from "./types.js";

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
    const stream = this.client.messages.stream(
      {
        model: p.model,
        max_tokens: p.maxTokens,
        system: [{ type: "text", text: p.system, cache_control: { type: "ephemeral" } }],
        tools: [...p.tools, WEB_SEARCH_TOOL] as Anthropic.MessageCreateParams["tools"],
        messages: p.messages,
      },
      p.signal ? { signal: p.signal } : undefined,
    );

    const announced = new Set<string>();
    stream.on("streamEvent", (event) => {
      if (event.type === "content_block_start") {
        const block = event.content_block;
        if (block.type === "tool_use" && !announced.has(block.id)) {
          announced.add(block.id);
          p.onToolCallStarted?.(block.id, block.name);
        }
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") p.onText?.(event.delta.text);
      }
    });

    const finalMessage = await stream.finalMessage();

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
        messages: p.messages,
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
