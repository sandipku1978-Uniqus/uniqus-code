import OpenAI from "openai";
import type Anthropic from "@anthropic-ai/sdk";
import type { Citation, ThinkingEffort } from "@gate15/api-types";
import { normalizeCitations } from "../citations.js";
import { lastRealUserTurnIndex } from "../messageHistory.js";
import { parsePartialJson } from "./partialJson.js";
import type {
  BillableToolUsage,
  ForcedToolParams,
  ModelProviderAdapter,
  StreamTurnParams,
  StreamTurnResult,
  TokenUsage,
} from "./types.js";

const OPENAI_WEB_SEARCH_USD = 0.01;

/**
 * Count completed Responses output items that represent an actual web search.
 * Open/page-find items are navigation within search results, not additional
 * search tool calls. IDs are de-duplicated because a streamed item can be seen
 * more than once by defensive/replayed consumers. We intentionally do not
 * filter on `status`: OpenAI's public price is per tool call, and the caller's
 * required accounting contract counts a done search action regardless of the
 * terminal status carried by that item.
 * https://platform.openai.com/docs/api-reference/responses-streaming/response/output_item/done
 * https://openai.com/api/pricing/#built-in-tools
 */
export function openAIWebSearchBillableUsage(
  items: Iterable<Pick<OpenAI.Responses.ResponseFunctionWebSearch, "id" | "action">>,
): BillableToolUsage | undefined {
  const ids = new Set<string>();
  for (const item of items) {
    if (item.action?.type === "search" && item.id) ids.add(item.id);
  }
  if (ids.size === 0) return undefined;
  return {
    kind: "web_search",
    units: ids.size,
    costUsd: ids.size * OPENAI_WEB_SEARCH_USD,
    accuracy: "exact",
  };
}

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

/**
 * Build the `reasoning` request field from the thinking-effort control. GPT-5.6
 * adds a real `max` rung, while every generation has its own lowest supported
 * effort for the thinking toggle. The `*-pro` models only accept "high"
 * (low/medium 400), so clamp them. `summary:
 * "auto"` asks for a reasoning summary we stream as the thinking trace — OpenAI
 * downgrades it to the richest level the org is entitled to, so an org that
 * isn't verified for reasoning summaries simply yields no summary deltas (the
 * thinking trace is empty) rather than an error. That, or running on a stale
 * deploy that predates this wiring, is the usual reason OpenAI shows no thinking.
 */
export function reasoningParam(
  model: string,
  effort: ThinkingEffort | undefined,
  enabled = true,
): OpenAI.Responses.ResponseCreateParams["reasoning"] | undefined {
  const isGpt56 = /^gpt-5\.6(?:$|-)/.test(model);
  // This app's toggle maps to the model's lowest supported effort. GPT-5.5/5.6
  // accept `none`, GPT-5.3 Codex bottoms out at `low`, and legacy/freeform models
  // retain the older `minimal` fallback. A legacy `*-pro` slug accepts only high.
  if (!enabled) {
    const floor = model.includes("-pro")
      ? "high"
      : /^gpt-5\.(?:5|6)(?:$|-)/.test(model)
        ? "none"
        : /^gpt-5\.3-codex(?:$|-)/.test(model)
          ? "low"
          : "minimal";
    return {
      effort: floor,
      summary: "auto",
      ...(isGpt56 ? { context: "current_turn" as const } : {}),
    };
  }
  if (!effort) return undefined;
  // GPT-5.6 accepts the full low→max scale. Older GPT-5.x models still cap at
  // xhigh, so only those downgrade our shared max rung. `*-pro` model slugs use
  // their legacy fixed-high behavior; GPT-5.6 pro is a reasoning mode, not a
  // separate model slug, and is intentionally not enabled by this picker.
  const level = model.includes("-pro")
    ? "high"
    : effort === "max" && !isGpt56
      ? "xhigh"
      : effort;
  return {
    effort: level,
    summary: "auto",
    // The adapter deliberately replays encrypted reasoning only within the
    // active user turn. Make GPT-5.6's persisted-reasoning policy match that
    // boundary explicitly instead of leaving it to the model's `auto` default.
    ...(isGpt56 ? { context: "current_turn" as const } : {}),
  };
}

export class OpenAIAdapter implements ModelProviderAdapter {
  readonly provider = "openai" as const;
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async streamAgentTurn(p: StreamTurnParams): Promise<StreamTurnResult> {
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
    // Web sources cited this turn, read off the terminal response.completed.
    let citations: Citation[] = [];
    // Only `response.output_item.done` carries the final action shape needed to
    // distinguish a billable search from open_page/find_in_page navigation.
    // Keep all such items and de-duplicate by id once, after the response ends.
    const billableWebSearchItems: OpenAI.Responses.ResponseFunctionWebSearch[] = [];
    const reportBillableWebSearch = (): void => {
      const billable = openAIWebSearchBillableUsage(billableWebSearchItems);
      if (billable) p.onBillableToolUsage?.(billable);
    };

    try {
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
          citations = citationsFromResponse(event.response);
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
          // empty success. A failed Response can still carry authoritative,
          // billable usage; report it before throwing so the loop's error path
          // does not have to fall back to its output-only live estimate.
          if (event.response.usage) {
            usage = toTokenUsage(event.response.usage);
            p.onUsage?.(usage);
          }
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
            billableWebSearchItems.push(event.item);
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
    } finally {
      // A completed search action can be billable even if a later stream event
      // fails. Report the de-duplicated actions observed so far on every exit.
      reportBillableWebSearch();
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
      ...(citations.length > 0 ? { citations } : {}),
    };
  }

  async callForcedTool(p: ForcedToolParams) {
    const response = await this.client.responses.create(
      {
        model: p.model,
        instructions: p.system,
        input: toResponsesInput(p.messages),
        tools: toResponsesTools([p.tool], false),
        tool_choice: { type: "function", name: p.tool.name },
        max_output_tokens: p.maxTokens,
        store: false,
      },
      p.signal ? { signal: p.signal } : undefined,
    );
    const usage = response.usage ? toTokenUsage(response.usage) : undefined;
    if (usage) p.onUsage?.(usage);
    const call = (response.output ?? []).find((i) => i.type === "function_call");
    if (!call || call.type !== "function_call" || call.name !== p.tool.name) {
      throw new Error(`Model did not return a ${p.tool.name} tool call`);
    }
    return {
      input: safeParseJson(call.arguments),
      usage,
    };
  }
}

/** Best-effort search query from a web_search_call item's action, for display. */
function webSearchQuery(item: OpenAI.Responses.ResponseFunctionWebSearch): string {
  if (item.action.type !== "search") return "";
  const queries = item.action.queries?.filter((q) => typeof q === "string" && q.trim());
  if (queries && queries.length > 0) return queries.join("\n");
  return typeof item.action.query === "string" ? item.action.query : "";
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
 * TOTAL prompt and includes both cache reads and GPT-5.6 cache writes. Subtract
 * both subsets to report the fresh remainder, then surface each bucket separately
 * so the dashboard applies the discounted read and 1.25x write rates correctly.
 */
/**
 * Pull the web sources out of a completed Responses turn. Each `output_text`
 * part carries `url_citation` annotations whose `end_index` is a character
 * offset into THAT part, so we walk the parts in order and rebase onto the
 * concatenated answer text the loop actually renders.
 *
 * Read from the terminal `response.completed` payload rather than the streamed
 * `response.output_text.annotation.added` events: the final output is
 * authoritative and already ordered, so the offsets can't drift.
 */
export function citationsFromResponse(response: OpenAI.Responses.Response): Citation[] {
  const raw: Partial<Citation>[] = [];
  let base = 0;
  for (const item of response.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.type !== "output_text") continue;
      for (const a of part.annotations ?? []) {
        if (a.type === "url_citation") {
          raw.push({ url: a.url, title: a.title, endIndex: base + a.end_index });
        }
      }
      base += part.text.length;
    }
  }
  return normalizeCitations(raw);
}

export function toTokenUsage(u: OpenAI.Responses.ResponseUsage): TokenUsage {
  const cached = u.input_tokens_details?.cached_tokens ?? 0;
  const written = u.input_tokens_details?.cache_write_tokens ?? 0;
  return {
    inputTokens: Math.max(0, (u.input_tokens ?? 0) - cached - written),
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: cached,
    cacheCreationTokens: written,
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
 *
 * Reasoning items are replayed ONLY for the turn in progress. OpenAI's documented
 * rule is to pass back reasoning / function-call items "since the last user
 * message"; older ones its "systems will smartly ignore". But EVERY item in
 * `input` bills as input tokens, so replaying the whole session's encrypted
 * reasoning means paying to upload blobs the server then discards — and the pile
 * grows with every tool call the session makes, unbounded until compaction. We
 * cut at the same turn boundary pruneStaleImagesInPlace uses.
 */
export function toResponsesInput(
  messages: Anthropic.MessageParam[],
): OpenAI.Responses.ResponseInputItem[] {
  const out: OpenAI.Responses.ResponseInputItem[] = [];
  // Anything at an index ABOVE this belongs to the current turn. -1 (the slice
  // holds no real user turn) means replay everything — we're mid-turn already.
  const lastUserTurn = lastRealUserTurnIndex(messages);

  for (const [index, msg] of messages.entries()) {
    // OpenAI requires every item between the last user message and the pending
    // function_call_output to survive untouched; below that line, drop the
    // reasoning ciphertext (the function_call itself must always stay, or the
    // matching function_call_output would dangle).
    const replayReasoning = index > lastUserTurn;
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
          // (stateless store:false). Only when both id + ciphertext survived,
          // and only for the current turn (see the boundary note above).
          const reasoning = replayReasoning
            ? (block as { openai_reasoning?: ReasoningRef }).openai_reasoning
            : undefined;
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
