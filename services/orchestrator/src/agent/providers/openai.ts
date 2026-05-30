import OpenAI from "openai";
import type Anthropic from "@anthropic-ai/sdk";
import type { ThinkingEffort } from "@uniqus/api-types";
import type {
  ForcedToolParams,
  ModelProviderAdapter,
  StreamTurnParams,
  StreamTurnResult,
  TokenUsage,
} from "./types.js";

/**
 * OpenAI adapter — Responses API (`/v1/responses`).
 *
 * We use Responses rather than Chat Completions because reasoning effort
 * (`reasoning.effort`) is NOT supported alongside function tools on Chat
 * Completions for the GPT-5.x models we route ("...not supported for gpt-5.5
 * in /v1/chat/completions. Please use /v1/responses instead.") — and the agent
 * always passes tools. Responses supports both, and streams reasoning
 * summaries we surface as the live thinking trace.
 *
 * Web search: the built-in `web_search` tool is attached alongside our function
 * tools (Responses supports mixing the two). OpenAI runs it server-side; we
 * surface the `web_search_call` items as a web_search activity row (parity with
 * Anthropic) and never hand them to the loop to execute.
 *
 * Translation: the canonical Anthropic-shaped history maps to Responses `input`
 * items (assistant text → output_text message; tool_use → function_call item;
 * tool_result → function_call_output item) and the output items map back to
 * Anthropic content blocks, so the loop and persisted history stay
 * provider-agnostic. We run stateless (`store: false`) and do NOT round-trip
 * reasoning items, which keeps multi-turn function calling free of
 * dangling-reasoning-item errors.
 *
 * Image previews: a `function_call_output` can't carry images, so tool-result
 * images ride on a trailing user message as `input_image` parts (same approach
 * as before). Images in plain user messages are forwarded the same way.
 */

/** GPT-5.5 Pro supports the Responses API, but not streaming. */
function supportsStreaming(model: string): boolean {
  return model !== "gpt-5.5-pro";
}

/**
 * Build the `reasoning` request field from the thinking-effort control. The
 * `*-pro` models only accept "high" (low/medium 400), so clamp them. `summary:
 * "auto"` asks for a reasoning summary we stream as the thinking trace.
 */
function reasoningParam(
  model: string,
  effort: ThinkingEffort | undefined,
): OpenAI.Responses.ResponseCreateParams["reasoning"] | undefined {
  if (!effort) return undefined;
  return { effort: model.includes("-pro") ? "high" : effort, summary: "auto" };
}

export class OpenAIAdapter implements ModelProviderAdapter {
  readonly provider = "openai" as const;
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async streamAgentTurn(p: StreamTurnParams): Promise<StreamTurnResult> {
    if (!supportsStreaming(p.model)) {
      return this.completeAgentTurn(p);
    }

    const reasoning = reasoningParam(p.model, p.thinkingEffort);
    const stream = await this.client.responses.create(
      {
        model: p.model,
        instructions: p.system,
        input: toResponsesInput(p.messages),
        tools: toResponsesTools(p.tools, true),
        max_output_tokens: p.maxTokens,
        store: false,
        ...(reasoning ? { reasoning } : {}),
        stream: true,
      },
      p.signal ? { signal: p.signal } : undefined,
    );

    let text = "";
    const announced = new Set<string>();
    const calls: Array<{ callId: string; name: string; args: string }> = [];
    // OpenAI's Responses stream only reports usage once, on the terminal
    // `response.completed` event (no incremental token counts mid-stream).
    let usage: TokenUsage | undefined;

    for await (const event of stream) {
      switch (event.type) {
        case "response.output_text.delta":
          text += event.delta;
          p.onText?.(event.delta);
          break;
        case "response.completed":
          if (event.response.usage) {
            usage = {
              inputTokens: event.response.usage.input_tokens ?? 0,
              outputTokens: event.response.usage.output_tokens ?? 0,
            };
            p.onUsage?.(usage);
          }
          break;
        case "response.reasoning_summary_text.delta":
          p.onThinking?.(event.delta);
          break;
        case "response.output_item.added":
          if (event.item.type === "function_call" && !announced.has(event.item.call_id)) {
            announced.add(event.item.call_id);
            p.onToolCallStarted?.(event.item.call_id, event.item.name);
          } else if (event.item.type === "web_search_call") {
            // Server-side search — surface the activity, never execute it.
            p.onToolCallStarted?.(event.item.id, "web_search");
          }
          break;
        case "response.output_item.done":
          if (event.item.type === "function_call") {
            calls.push({
              callId: event.item.call_id,
              name: event.item.name,
              args: event.item.arguments,
            });
          } else if (event.item.type === "web_search_call") {
            const query = webSearchQuery(event.item);
            p.onToolCall?.(event.item.id, "web_search", { query });
            p.onToolResult?.(
              event.item.id,
              "web_search",
              { query },
              query ? `Searched the web: ${query}` : "Searched the web.",
              false,
            );
          }
          break;
      }
    }

    const content: Anthropic.ContentBlockParam[] = [];
    if (text) content.push({ type: "text", text });
    const toolCalls: StreamTurnResult["toolCalls"] = [];
    for (const c of calls) {
      const input = safeParseJson(c.args);
      content.push({ type: "tool_use", id: c.callId, name: c.name, input } as Anthropic.ToolUseBlockParam);
      p.onToolCall?.(c.callId, c.name, input);
      toolCalls.push({ id: c.callId, name: c.name, input });
    }

    return {
      content,
      stopReason: toolCalls.length > 0 ? "tool_use" : "end_turn",
      toolCalls,
      usage,
    };
  }

  private async completeAgentTurn(p: StreamTurnParams): Promise<StreamTurnResult> {
    const reasoning = reasoningParam(p.model, p.thinkingEffort);
    const response = await this.client.responses.create(
      {
        model: p.model,
        instructions: p.system,
        input: toResponsesInput(p.messages),
        tools: toResponsesTools(p.tools, true),
        max_output_tokens: p.maxTokens,
        store: false,
        ...(reasoning ? { reasoning } : {}),
      },
      p.signal ? { signal: p.signal } : undefined,
    );

    let text = "";
    const content: Anthropic.ContentBlockParam[] = [];
    const toolCalls: StreamTurnResult["toolCalls"] = [];
    for (const item of response.output ?? []) {
      if (item.type === "message") {
        for (const part of item.content) {
          if (part.type === "output_text") text += part.text;
        }
      } else if (item.type === "function_call") {
        const input = safeParseJson(item.arguments);
        content.push({ type: "tool_use", id: item.call_id, name: item.name, input } as Anthropic.ToolUseBlockParam);
        p.onToolCallStarted?.(item.call_id, item.name);
        p.onToolCall?.(item.call_id, item.name, input);
        toolCalls.push({ id: item.call_id, name: item.name, input });
      } else if (item.type === "web_search_call") {
        const query = webSearchQuery(item);
        p.onToolCallStarted?.(item.id, "web_search");
        p.onToolResult?.(
          item.id,
          "web_search",
          { query },
          query ? `Searched the web: ${query}` : "Searched the web.",
          false,
        );
      } else if (item.type === "reasoning") {
        for (const s of item.summary) p.onThinking?.(s.text);
      }
    }
    if (text) {
      content.unshift({ type: "text", text });
      p.onText?.(text);
    }

    let usage: TokenUsage | undefined;
    if (response.usage) {
      usage = {
        inputTokens: response.usage.input_tokens ?? 0,
        outputTokens: response.usage.output_tokens ?? 0,
      };
      p.onUsage?.(usage);
    }

    return {
      content,
      stopReason: toolCalls.length > 0 ? "tool_use" : "end_turn",
      toolCalls,
      usage,
    };
  }

  async callForcedTool(p: ForcedToolParams): Promise<unknown> {
    const response = await this.client.responses.create({
      model: p.model,
      instructions: p.system,
      input: toResponsesInput(p.messages),
      tools: toResponsesTools([p.tool], false),
      tool_choice: { type: "function", name: p.tool.name },
      max_output_tokens: p.maxTokens,
      store: false,
    });
    const call = (response.output ?? []).find((i) => i.type === "function_call");
    if (!call || call.type !== "function_call" || call.name !== p.tool.name) {
      throw new Error(`Model did not return a ${p.tool.name} tool call`);
    }
    return safeParseJson(call.arguments);
  }
}

/** Best-effort search query from a web_search_call item's action, for display. */
function webSearchQuery(item: OpenAI.Responses.ResponseFunctionWebSearch): string {
  const action = item.action as { query?: unknown } | undefined;
  return typeof action?.query === "string" ? action.query : "";
}

function safeParseJson(s: string): unknown {
  if (!s || !s.trim()) return {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

/**
 * Anthropic tool schema → Responses API tools: our function tools plus the
 * built-in `web_search`. `includeWebSearch` is false for the forced-tool (plan)
 * call, which must return exactly one specific function.
 */
function toResponsesTools(
  tools: Anthropic.Tool[],
  includeWebSearch: boolean,
): OpenAI.Responses.Tool[] {
  const fns: OpenAI.Responses.Tool[] = tools.map((t) => ({
    type: "function",
    name: t.name,
    description: t.description ?? null,
    parameters: t.input_schema as Record<string, unknown>,
    strict: false,
  }));
  return includeWebSearch ? [{ type: "web_search" }, ...fns] : fns;
}

/**
 * Canonical (Anthropic-shaped) history → Responses API input items. Assistant
 * text becomes an output_text message; tool_use blocks become top-level
 * function_call items; tool_result blocks become function_call_output items,
 * with any images forwarded on a trailing user message.
 */
function toResponsesInput(
  messages: Anthropic.MessageParam[],
): OpenAI.Responses.ResponseInputItem[] {
  const out: OpenAI.Responses.ResponseInputItem[] = [];

  for (const msg of messages) {
    if (msg.role === "assistant") {
      if (typeof msg.content === "string") {
        if (msg.content) out.push({ role: "assistant", content: msg.content });
        continue;
      }
      let text = "";
      const fnCalls: OpenAI.Responses.ResponseInputItem[] = [];
      for (const block of msg.content) {
        if (block.type === "text") text += block.text;
        else if (block.type === "tool_use") {
          fnCalls.push({
            type: "function_call",
            call_id: block.id,
            name: block.name,
            arguments: JSON.stringify(block.input ?? {}),
          });
        }
      }
      // Assistant text as a plain string (an output_text content part would
      // require annotations); function_call items ride as top-level items.
      if (text) out.push({ role: "assistant", content: text });
      out.push(...fnCalls);
      continue;
    }

    // role === "user": real user turn or a batch of tool_results.
    if (typeof msg.content === "string") {
      out.push({ role: "user", content: msg.content });
      continue;
    }
    const userParts: OpenAI.Responses.ResponseInputContent[] = [];
    const toolImageUrls: string[] = [];
    for (const block of msg.content) {
      if (block.type === "tool_result") {
        const { text, images } = splitToolResult(block);
        out.push({ type: "function_call_output", call_id: block.tool_use_id, output: text });
        toolImageUrls.push(...images);
      } else if (block.type === "text") {
        userParts.push({ type: "input_text", text: block.text });
      } else if (block.type === "image") {
        const url = imageBlockToDataUrl(block);
        if (url) userParts.push({ type: "input_image", image_url: url, detail: "auto" });
      }
    }
    if (toolImageUrls.length > 0) {
      out.push({
        role: "user",
        content: [
          { type: "input_text", text: "Image output from the preceding tool call(s):" },
          ...toolImageUrls.map(
            (url): OpenAI.Responses.ResponseInputContent => ({
              type: "input_image",
              image_url: url,
              detail: "auto",
            }),
          ),
        ],
      });
    }
    if (userParts.length > 0) out.push({ role: "user", content: userParts });
  }

  return out;
}

/** Split a tool_result into its text and any image data URLs it carries. */
function splitToolResult(block: Anthropic.ToolResultBlockParam): {
  text: string;
  images: string[];
} {
  if (typeof block.content === "string") {
    return { text: block.content || "(no output)", images: [] };
  }
  if (Array.isArray(block.content)) {
    const texts: string[] = [];
    const images: string[] = [];
    for (const c of block.content) {
      if (c.type === "text") texts.push(c.text);
      else if (c.type === "image") {
        const url = imageBlockToDataUrl(c);
        if (url) images.push(url);
      }
    }
    const text =
      texts.join("\n") || (images.length > 0 ? "[image output — see image below]" : "(no output)");
    return { text, images };
  }
  return { text: "(no output)", images: [] };
}

function imageBlockToDataUrl(block: Anthropic.ImageBlockParam): string | null {
  const src = block.source;
  if (src.type === "base64") return `data:${src.media_type};base64,${src.data}`;
  if (src.type === "url") return src.url;
  return null;
}
