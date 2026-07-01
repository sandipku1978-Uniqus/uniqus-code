import OpenAI from "openai";
import type Anthropic from "@anthropic-ai/sdk";
import type { ThinkingEffort } from "@uniqus/api-types";
import { parsePartialJson } from "./partialJson.js";
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
 * provider-agnostic.
 *
 * Reasoning round-trip: we run stateless (`store: false`) but DO preserve the
 * reasoning chain across tool calls. Each request asks for
 * `include: ["reasoning.encrypted_content"]`; the encrypted reasoning item that
 * precedes a function_call is stashed on that tool_use block (a non-standard
 * `openai_reasoning` field) and replayed immediately before the call on the
 * next request. This keeps gpt-5.x multi-turn tool accuracy + prompt-cache
 * reuse that omitting it would forfeit. The invariant that avoids the
 * dangling-reasoning-item 400 is that a reasoning item is ONLY ever emitted
 * directly before its own function_call — never orphaned (see toResponsesInput).
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
 * "auto"` asks for a reasoning summary we stream as the thinking trace — OpenAI
 * downgrades it to the richest level the org is entitled to, so an org that
 * isn't verified for reasoning summaries simply yields no summary deltas (the
 * thinking trace is empty) rather than an error. That, or running on a stale
 * deploy that predates this wiring, is the usual reason OpenAI shows no thinking.
 */
function reasoningParam(
  model: string,
  effort: ThinkingEffort | undefined,
  enabled = true,
): OpenAI.Responses.ResponseCreateParams["reasoning"] | undefined {
  // GPT-5.x always reasons — the on/off toggle can only floor it: "minimal" is
  // the lowest reasoning_effort the Responses API accepts.
  if (!enabled) return { effort: "minimal", summary: "auto" };
  if (!effort) return undefined;
  // Current GPT-5.x models accept low/medium/high/xhigh (xhigh is the ceiling —
  // there is NO "max"), so pass low→xhigh straight through and map our top rung
  // `max` down to `xhigh`. `*-pro` models only accept "high" (low/medium/xhigh
  // 400), so clamp those. `xhigh` is model-dependent on OpenAI's side; the
  // composer only offers it for OpenAI, and Auto-resolved-to-OpenAI requests at
  // `max` land on `xhigh` here.
  const level = model.includes("-pro")
    ? "high"
    : effort === "max"
      ? "xhigh"
      : effort;
  return { effort: level as NonNullable<OpenAI.Responses.ResponseCreateParams["reasoning"]>["effort"], summary: "auto" };
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

    const reasoning = reasoningParam(p.model, p.thinkingEffort, p.thinkingEnabled !== false);
    const stream = await this.client.responses.create(
      {
        model: p.model,
        instructions: p.system,
        input: toResponsesInput(p.messages),
        tools: toResponsesTools(p.tools, true),
        max_output_tokens: p.maxTokens,
        store: false,
        // Ask for the encrypted reasoning so it can be replayed across tool
        // calls without server-side state (store:false). Reasoning models
        // (gpt-5.x) reason BEFORE each function call; echoing the reasoning item
        // back on the next request preserves that chain (better tool accuracy +
        // prompt-cache reuse). Only meaningful when reasoning is on.
        ...(reasoning
          ? { reasoning, include: ["reasoning.encrypted_content" as const] }
          : {}),
        stream: true,
      },
      p.signal ? { signal: p.signal } : undefined,
    );

    let text = "";
    const announced = new Set<string>();
    const calls: Array<{ callId: string; name: string; args: string; reasoning?: ReasoningRef }> = [];
    // Live tool-arg streaming: the Responses API emits function-call argument
    // fragments as `response.function_call_arguments.delta` events keyed by the
    // output ITEM id. Track id → {callId, name, args} so we can forward a
    // best-effort partial parse (throttled) and fill the UI row live.
    const argAcc = new Map<string, { callId: string; name: string; args: string; lastEmit: number }>();
    // OpenAI's Responses stream only reports usage once, on the terminal
    // `response.completed`/`response.incomplete` event (no incremental counts).
    let usage: TokenUsage | undefined;
    // True if the response was cut off (usually max_output_tokens — reasoning
    // and the visible answer share that budget on reasoning models).
    let truncated = false;
    // The reasoning item that precedes the next function_call(s); echoed back
    // on the following turn (encrypted) so the chain survives the tool round-trip.
    let pendingReasoning: ReasoningRef | undefined;

    for await (const event of stream) {
      // Function-call argument deltas — the live path for showing a call's file
      // name / command as it streams. Handled before the typed switch because
      // the SDK's event union may not expose this variant across versions.
      const etype = (event as { type?: string }).type;
      if (etype === "response.function_call_arguments.delta") {
        const e = event as unknown as { item_id?: string; delta?: string };
        const acc = e.item_id ? argAcc.get(e.item_id) : undefined;
        if (acc && p.onToolCallPartial && typeof e.delta === "string") {
          acc.args += e.delta;
          const now = Date.now();
          if (now - acc.lastEmit >= 60) {
            acc.lastEmit = now;
            const partial = parsePartialJson(acc.args);
            if (partial !== undefined) p.onToolCallPartial(acc.callId, acc.name, partial);
          }
        }
        continue;
      }
      switch (event.type) {
        case "response.output_text.delta":
          text += event.delta;
          p.onText?.(event.delta);
          break;
        case "response.completed":
          if (event.response.usage) {
            usage = toTokenUsage(event.response.usage);
            p.onUsage?.(usage);
          }
          break;
        case "response.incomplete":
          truncated = true;
          if (event.response.usage) {
            usage = toTokenUsage(event.response.usage);
            p.onUsage?.(usage);
          }
          break;
        case "response.failed": {
          // A mid-stream provider failure (server error, content-policy block).
          // The SDK does NOT throw for this (the error nests under `response`,
          // not the top-level `data.error` the raw stream watches), so without
          // this case the stream just ends and the turn looks like a silent
          // empty success. Throw so the loop's existing catch path surfaces it.
          const err = event.response.error;
          throw new Error(
            `OpenAI response failed${err?.code ? ` (${err.code})` : ""}: ${
              err?.message ?? "the provider failed the response mid-stream"
            }`,
          );
        }
        case "error":
          // Top-level stream error event (Responses `error` type). Same rationale
          // as response.failed — surface it instead of finishing empty.
          throw new Error(
            `OpenAI stream error${event.code ? ` (${event.code})` : ""}: ${
              event.message ?? "the provider emitted a stream error"
            }`,
          );
        case "response.reasoning_summary_text.delta":
          p.onThinking?.(event.delta);
          break;
        case "response.output_item.added":
          if (event.item.type === "function_call" && !announced.has(event.item.call_id)) {
            announced.add(event.item.call_id);
            // Map the output-item id → this call so argument deltas can stream.
            if (event.item.id) {
              argAcc.set(event.item.id, {
                callId: event.item.call_id,
                name: event.item.name,
                args: "",
                lastEmit: 0,
              });
            }
            p.onToolCallStarted?.(event.item.call_id, event.item.name);
          } else if (event.item.type === "web_search_call") {
            // Server-side search — surface the activity, never execute it.
            p.onToolCallStarted?.(event.item.id, "web_search");
          }
          break;
        case "response.output_item.done":
          if (event.item.type === "reasoning") {
            // A reasoning item precedes the function_call(s) it reasoned out.
            // Stash it so we can attach it to the next call for round-tripping.
            pendingReasoning = reasoningRefOf(event.item);
          } else if (event.item.type === "function_call") {
            calls.push({
              callId: event.item.call_id,
              name: event.item.name,
              args: event.item.arguments,
              reasoning: pendingReasoning,
            });
            // One reasoning item covers a group of calls; re-emit it once
            // (before the first call) to avoid a duplicate-id 400.
            pendingReasoning = undefined;
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
      const input = safeParseJson(c.args, c.name);
      content.push(toolUseBlock(c.callId, c.name, input, c.reasoning));
      p.onToolCall?.(c.callId, c.name, input);
      toolCalls.push({ id: c.callId, name: c.name, input });
    }

    return {
      content,
      stopReason: toolCalls.length > 0 ? "tool_use" : truncated ? "max_tokens" : "end_turn",
      toolCalls,
      usage,
    };
  }

  private async completeAgentTurn(p: StreamTurnParams): Promise<StreamTurnResult> {
    const reasoning = reasoningParam(p.model, p.thinkingEffort, p.thinkingEnabled !== false);
    const response = await this.client.responses.create(
      {
        model: p.model,
        instructions: p.system,
        input: toResponsesInput(p.messages),
        tools: toResponsesTools(p.tools, true),
        max_output_tokens: p.maxTokens,
        store: false,
        ...(reasoning
          ? { reasoning, include: ["reasoning.encrypted_content" as const] }
          : {}),
      },
      p.signal ? { signal: p.signal } : undefined,
    );

    let text = "";
    const content: Anthropic.ContentBlockParam[] = [];
    const toolCalls: StreamTurnResult["toolCalls"] = [];
    // Output items arrive in order: a reasoning item precedes the function_call
    // it reasoned out. Track the most recent so we can pair them for round-trip.
    let pendingReasoning: ReasoningRef | undefined;
    for (const item of response.output ?? []) {
      if (item.type === "message") {
        for (const part of item.content) {
          if (part.type === "output_text") text += part.text;
        }
      } else if (item.type === "function_call") {
        const input = safeParseJson(item.arguments, item.name);
        content.push(toolUseBlock(item.call_id, item.name, input, pendingReasoning));
        pendingReasoning = undefined;
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
        pendingReasoning = reasoningRefOf(item);
      }
    }
    if (text) {
      content.unshift({ type: "text", text });
      p.onText?.(text);
    }

    let usage: TokenUsage | undefined;
    if (response.usage) {
      usage = toTokenUsage(response.usage);
      p.onUsage?.(usage);
    }

    const truncated =
      response.status === "incomplete" &&
      response.incomplete_details?.reason === "max_output_tokens";
    return {
      content,
      stopReason: toolCalls.length > 0 ? "tool_use" : truncated ? "max_tokens" : "end_turn",
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

export function safeParseJson(s: string, toolName?: string): unknown {
  if (!s || !s.trim()) return {};
  try {
    return JSON.parse(s);
  } catch {
    // Non-empty but unparseable almost always means the arguments JSON was
    // truncated at the output-token limit. Returning {} lets the tool's own
    // input validation surface a clear error to the model (which then retries
    // with a smaller response) instead of crashing the turn. NOTE: the turn's
    // stopReason stays "tool_use" here (a call exists), NOT "max_tokens" — the
    // tool's validation error is what tells the model the args were truncated.
    console.warn(
      `openai: unparseable arguments for ${toolName ?? "tool"} — likely truncated at max_output_tokens`,
    );
    return {};
  }
}

/** Opaque, encrypted reasoning reference round-tripped across tool calls. */
interface ReasoningRef {
  id: string;
  encrypted: string;
}

/** Extract the round-trippable reasoning reference from a reasoning item. */
function reasoningRefOf(item: OpenAI.Responses.ResponseReasoningItem): ReasoningRef | undefined {
  const enc = item.encrypted_content;
  if (!item.id || !enc) return undefined;
  return { id: item.id, encrypted: enc };
}

/**
 * Build a canonical tool_use block, stashing the preceding reasoning item (if
 * any) on a non-standard `openai_reasoning` field so toResponsesInput can replay
 * it immediately before this call on the next request — preserving gpt-5.x's
 * reasoning chain across the tool round-trip. The other adapters build fresh
 * objects from id/name/input and ignore the extra field; the Anthropic adapter
 * strips it (stripForeignFields) so Claude never sees a foreign block field.
 */
function toolUseBlock(
  id: string,
  name: string,
  input: unknown,
  reasoning: ReasoningRef | undefined,
): Anthropic.ToolUseBlockParam {
  const block: Record<string, unknown> = { type: "tool_use", id, name, input };
  if (reasoning) block.openai_reasoning = reasoning;
  return block as unknown as Anthropic.ToolUseBlockParam;
}

/**
 * Normalize OpenAI usage to our canonical shape. OpenAI's `input_tokens` is the
 * TOTAL prompt and INCLUDES cached tokens; `cached_tokens` is the cached subset.
 * We subtract to report the fresh (full-price) remainder, and surface the cached
 * portion separately so the dashboard prices it at the discounted rate instead
 * of billing every replayed prefix token at full price. OpenAI auto-caches with
 * no separate write line, so cacheCreationTokens is 0.
 */
export function toTokenUsage(u: OpenAI.Responses.ResponseUsage): TokenUsage {
  const cached = u.input_tokens_details?.cached_tokens ?? 0;
  return {
    inputTokens: Math.max(0, (u.input_tokens ?? 0) - cached),
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: cached,
    cacheCreationTokens: 0,
  };
}

/**
 * Anthropic tool schema → Responses API tools: our function tools plus the
 * built-in `web_search`. `includeWebSearch` is false for the forced-tool (plan)
 * call, which must return exactly one specific function.
 */
export function toResponsesTools(
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
export function toResponsesInput(
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
          // Replay the encrypted reasoning item immediately before its call so
          // the model keeps its chain-of-thought across the tool round-trip
          // (stateless store:false). Only when both id + ciphertext survived.
          const reasoning = (block as { openai_reasoning?: ReasoningRef }).openai_reasoning;
          if (reasoning?.id && reasoning.encrypted) {
            fnCalls.push({
              type: "reasoning",
              id: reasoning.id,
              summary: [],
              encrypted_content: reasoning.encrypted,
            } as unknown as OpenAI.Responses.ResponseInputItem);
          }
          fnCalls.push({
            type: "function_call",
            call_id: block.id,
            name: block.name,
            arguments: JSON.stringify(block.input ?? {}),
          });
        }
      }
      // Assistant text as a plain string (an output_text content part would
      // require annotations); reasoning + function_call items ride as top-level
      // items, each reasoning item immediately preceding its function_call.
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
