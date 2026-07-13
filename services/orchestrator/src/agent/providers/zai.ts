import OpenAI from "openai";
import { fetch as undiciFetch } from "undici";
import type Anthropic from "@anthropic-ai/sdk";
import type { Citation, ThinkingEffort } from "@gate15/api-types";
import { normalizeCitations } from "../citations.js";
import { safeParseJson } from "./openai.js";
import { parsePartialJson } from "./partialJson.js";
import { DEFAULT_VISION_BRIDGE_SYSTEM } from "./types.js";
import type {
  BillableToolUsage,
  ForcedToolParams,
  ModelProviderAdapter,
  StreamTurnParams,
  StreamTurnResult,
  TokenUsage,
} from "./types.js";

const ZAI_WEB_SEARCH_USD = 0.01;

/**
 * Z.ai (GLM) adapter — OpenAI-style Chat Completions (`/paas/v4/chat/completions`).
 *
 * GLM also exposes an Anthropic-compatible Messages endpoint, but web search is
 * NOT available there as a tool (Z.ai routes the Anthropic/Claude-Code path
 * through a separate Search MCP server, coding-plan only). GLM's `web_search`
 * tool is documented on Chat Completions, so we run GLM here instead and attach
 * it alongside our function tools. The Chat Completions surface is OpenAI-shaped,
 * so we reuse the `openai` SDK pointed at Z.ai's base URL.
 *
 * Translation: the canonical Anthropic-shaped history maps to Chat Completions
 * `messages` (assistant text+tool_use → assistant message with `tool_calls`;
 * tool_result → a `tool` message) and the streamed response maps back to
 * Anthropic content blocks, so the loop and persisted history stay
 * provider-agnostic. GLM-5.2 is TEXT-ONLY, so image blocks are never sent as
 * `image_url`; they're replaced by a text note pointing at the `analyze_image`
 * tool (see describeImage), which bridges to GLM-5V-Turbo for visual questions.
 *
 * Thinking: GLM uses a top-level `reasoning_effort` ("high"/"max") plus
 * `thinking:{type:"enabled"}` — sent via a cast since they aren't in the OpenAI
 * Chat Completions typings. The reasoning trace streams as `delta.reasoning_content`.
 */

const ZAI_BASE_URL = "https://api.z.ai/api/paas/v4";

/** Z.ai's vision model that backs the analyze_image bridge (override via env). */
const ZAI_VISION_MODEL = "glm-5v-turbo";

/**
 * The vision bridge for text-only GLM. GLM-5.2 can't see images, so the
 * `analyze_image` tool sends the image + GLM's targeted question here; this
 * forwards both to GLM-5V-Turbo (Z.ai's VLM — same key + endpoint) and returns
 * its analysis as text, which GLM then reads. A small system steer keeps the
 * answer concrete and UI-aware.
 */
// Default system steer for the GLM-V bridge (overridden by task-specialized
// tools) — shared with the Gemini bridge via types.ts so the two can't drift.

export async function describeImage(opts: {
  apiKey: string;
  baseURL?: string;
  model?: string;
  /** One or more images (each becomes an image_url data: URL part). */
  media: { base64: string; mimeType: string }[];
  question: string;
  /** Override the default UI-analysis system steer (task-specialized tools do). */
  system?: string;
  maxTokens?: number;
  signal?: AbortSignal;
}): Promise<{ text: string; model: string; usage?: TokenUsage }> {
  const client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL || ZAI_BASE_URL });
  const model = opts.model || process.env.ZAI_VISION_MODEL || ZAI_VISION_MODEL;
  const response = await client.chat.completions.create(
    {
      model,
      max_tokens: opts.maxTokens ?? 4096,
      messages: [
        { role: "system", content: opts.system || DEFAULT_VISION_BRIDGE_SYSTEM },
        {
          role: "user",
          content: [
            { type: "text", text: opts.question },
            ...opts.media.map((m) => ({
              type: "image_url" as const,
              image_url: { url: `data:${m.mimeType};base64,${m.base64}` },
            })),
          ],
        },
      ],
    },
    opts.signal ? { signal: opts.signal } : undefined,
  );
  const text = response.choices?.[0]?.message?.content;
  const usage = toTokenUsage(response.usage);
  return {
    text:
      typeof text === "string" && text.trim()
        ? text
        : "(the vision model returned no description)",
    model,
    usage,
  };
}

/**
 * GLM-OCR document/image OCR via Z.ai's layout_parsing endpoint
 * (POST /paas/v4/layout_parsing, model "glm-ocr"). Reads scanned/image-only PDFs
 * (and images) that have no extractable text layer and returns the recognized
 * text as Markdown. This is Z.ai's own answer for the document case. `file`
 * accepts a URL or base64; we pass a data: URL (GLM's inline-binary convention).
 * Synchronous — md_results comes back in the same response. Returns usage so the
 * caller meters it (glm-ocr is in MODEL_PRICING at $0.03/Mtok).
 */
export async function layoutParse(opts: {
  apiKey: string;
  baseURL?: string;
  /** A data: URL (data:<mime>;base64,<…>) or an https URL to a PDF/image. */
  file: string;
  signal?: AbortSignal;
}): Promise<{ markdown: string; usage?: TokenUsage }> {
  const base = opts.baseURL || ZAI_BASE_URL;
  const res = await fetch(`${base}/layout_parsing`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "glm-ocr", file: opts.file }),
    signal: opts.signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`GLM-OCR layout_parsing failed: ${res.status} ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as { md_results?: string; usage?: OpenAIUsage };
  return { markdown: (data.md_results ?? "").trim(), usage: toTokenUsage(data.usage) };
}

type OpenAIUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
};

/**
 * Normalize an OpenAI-style usage object to our TokenUsage. prompt_tokens
 * INCLUDES any cached prefix (prompt_tokens_details), so subtract it to land on
 * the fresh-input meaning TokenUsage expects — lets the caller meter precisely.
 */
function toTokenUsage(u: OpenAIUsage | undefined | null): TokenUsage | undefined {
  if (!u) return undefined;
  const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    inputTokens: Math.max(0, (u.prompt_tokens ?? 0) - cached),
    outputTokens: u.completion_tokens ?? 0,
    cacheReadTokens: cached,
    cacheCreationTokens: 0,
  };
}

/**
 * GLM's built-in web search tool (Chat Completions). Z.ai runs it server-side
 * and folds the results into the answer (with `[n]` citations); the loop never
 * executes it. Z.ai's API takes these sub-fields as STRINGS (per the docs'
 * example), so they're strings here on purpose.
 *
 * `search_engine` is REQUIRED — NOT optional. With it omitted, glm-5.2 silently
 * does NOT run the search: it answers from stale training data (or spends the
 * whole token budget "thinking" and returns nothing), which reads to the user as
 * "web search is broken". The documented default engine is `search-prime`.
 * Verified end-to-end against glm-5.2 on /paas/v4 (streaming + non-streaming):
 * omitting search_engine → no search; `search-prime` → live, cited results
 * (e.g. correctly returns today's latest framework versions). `search-pro` did
 * NOT trigger a search in testing, so stick with `search-prime`.
 * `search_result:"True"` asks for the result list alongside the answer.
 */
/**
 * One entry of GLM's top-level `web_search` array — returned because the tool
 * sets `search_result:"True"` below. `refer` ("ref_1") is what the model's own
 * inline `[1]` markers point at, so array order IS citation order.
 */
interface GlmWebSearchResult {
  title?: string;
  link?: string;
  refer?: string;
}

/**
 * Z.ai charges $0.01 per built-in web-search use, not per returned result. Its
 * Chat Completions response exposes results but no authoritative tool-usage
 * counter, so a non-empty result array proves one use while the count remains
 * an estimate. Never multiply by result count: `count:"5"` only controls how
 * many documents that one search returns.
 * https://docs.z.ai/guides/overview/pricing#built-in-tools
 * https://docs.z.ai/api-reference/llm/chat-completion
 */
export function zaiWebSearchBillableUsage(results: unknown): BillableToolUsage | undefined {
  if (!Array.isArray(results) || results.length === 0) return undefined;
  return {
    kind: "web_search",
    units: 1,
    costUsd: ZAI_WEB_SEARCH_USD,
    accuracy: "estimated",
  };
}

/**
 * Map GLM's search results to canonical citations. GLM gives no offsets into
 * the answer — it writes its own `[n]` markers inline instead — so these are
 * un-anchored and ordered by `refer`, which is exactly the numbering the model
 * used. The UI links the existing markers rather than inserting new ones.
 *
 * Without this the model's `[1]`/`[2]` render as dead text pointing at nothing.
 */
export function citationsFromGlmSearch(results: GlmWebSearchResult[]): Citation[] {
  const referNumber = (r: GlmWebSearchResult, i: number): number => {
    const n = Number.parseInt(String(r.refer ?? "").replace(/\D+/g, ""), 10);
    return Number.isFinite(n) && n > 0 ? n : i + 1;
  };
  return normalizeCitations(
    [...results]
      .map((r, i) => ({ r, n: referNumber(r, i) }))
      .sort((a, b) => a.n - b.n)
      .map(({ r }) => ({ url: r.link, title: r.title })),
  );
}

const GLM_WEB_SEARCH_TOOL = {
  type: "web_search",
  web_search: {
    enable: "True",
    search_engine: "search-prime",
    search_result: "True",
    count: "5",
    content_size: "high",
  },
} as const;

export class ZaiAdapter implements ModelProviderAdapter {
  readonly provider = "zai" as const;
  private client: OpenAI;

  constructor(apiKey: string, opts?: { baseURL?: string; timeout?: number }) {
    this.client = new OpenAI({
      apiKey,
      baseURL: opts?.baseURL || ZAI_BASE_URL,
      // Force an UNCOMPRESSED response stream. Z.ai's gzipped SSE isn't flushed
      // per event, so when the transport negotiates gzip the WHOLE turn is held
      // in the decompression window and delivered in one burst at the end — the
      // "answers arrive in large batches" bug. `identity` makes each SSE event
      // flush as written, so onText/onThinking/onToolCallStarted fire live.
      //
      // CRITICAL: this header only works if it actually reaches Z.ai, and
      // `Accept-Encoding` is a Fetch-spec FORBIDDEN header. The OpenAI SDK calls
      // `globalThis.fetch`, whose bundled undici may SILENTLY STRIP it (the rule
      // is enforced inconsistently across Node versions) — then the transport
      // falls back to gzip and the bursts return. That's why setting it via
      // `defaultHeaders` alone "fixed" it on some machines but not the server.
      // Pin the request to OUR undici dependency (v7), which reliably forwards
      // the header, instead of the host's globalThis.fetch. Verified end-to-end:
      // with gzip negotiated the SDK yields all deltas in one ~900ms burst; with
      // pinned-undici + identity they stream ~25ms apart.
      fetch: undiciFetch as unknown as typeof fetch,
      defaultHeaders: { "Accept-Encoding": "identity" },
      ...(opts?.timeout ? { timeout: opts.timeout } : {}),
    });
  }

  async streamAgentTurn(p: StreamTurnParams): Promise<StreamTurnResult> {
    const body = {
      model: p.model,
      messages: toChatMessages(p.system, p.messages),
      tools: toChatTools(p.tools, true),
      max_tokens: p.maxTokens,
      stream: true,
      stream_options: { include_usage: true },
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming;
    applyThinking(
      body as unknown as Record<string, unknown>,
      p.thinkingEffort,
      p.thinkingEnabled !== false,
    );
    // Stream function-call arguments incrementally (GLM-4.6+). WITHOUT this GLM
    // buffers each tool call and emits its whole `arguments` JSON in one burst at
    // the end — so on a coding turn (mostly large write_file/edit_file calls) the
    // "running…" row appears, then a long silence, then everything lands at once:
    // the lumpy streaming the user sees. With it, `delta.tool_calls[*].function
    // .arguments` fragments stream live (we already stitch them per-index below),
    // so onToolCallStarted fires the moment the name arrives and the call fills in
    // smoothly. https://docs.z.ai/guides/tools/stream-tool
    (body as unknown as Record<string, unknown>).tool_stream = true;

    const stream = await this.client.chat.completions.create(
      body,
      p.signal ? { signal: p.signal } : undefined,
    );

    let text = "";
    // Streamed tool calls arrive in fragments keyed by `index`; accumulate the
    // id, name, and (chunked) argument string per index. `lastEmit` throttles the
    // live partial-parse emission so per-fragment deltas don't flood the socket.
    const toolAcc = new Map<number, { id: string; name: string; args: string; lastEmit: number }>();
    const announced = new Set<number>();
    let usage: TokenUsage | undefined;
    let finish: string | null = null;
    // GLM returns its search results as a top-level `web_search` array on the
    // chunk that carries them (we asked for it via search_result:"True").
    let webSearch: GlmWebSearchResult[] = [];

    try {
      for await (const chunk of stream) {
      // With include_usage, the final chunk carries usage and has no choices.
      if (chunk.usage) {
        usage = zaiTokenUsage(chunk.usage);
        p.onUsage?.(usage);
      }
      // Not in the OpenAI SDK's chunk typings — GLM adds it when search ran.
      const results = (chunk as unknown as { web_search?: GlmWebSearchResult[] }).web_search;
      if (Array.isArray(results) && results.length > 0) webSearch = results;
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta as OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta & {
        reasoning_content?: string;
      };
      if (delta?.content) {
        text += delta.content;
        p.onText?.(delta.content);
      }
      // GLM streams its chain-of-thought as `reasoning_content` (non-standard);
      // surface it as the live thinking trace, separate from the answer text.
      if (delta?.reasoning_content) p.onThinking?.(delta.reasoning_content);
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          let cur = toolAcc.get(idx);
          if (!cur) {
            cur = { id: "", name: "", args: "", lastEmit: 0 };
            toolAcc.set(idx, cur);
          }
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          if (cur.id && cur.name && !announced.has(idx)) {
            announced.add(idx);
            p.onToolCallStarted?.(cur.id, cur.name);
          }
          // Forward a best-effort partial parse (throttled ~60ms) so the UI
          // shows the file name / command / diff live as GLM types the args.
          if (cur.id && cur.name && tc.function?.arguments && p.onToolCallPartial) {
            const now = Date.now();
            if (now - cur.lastEmit >= 60) {
              cur.lastEmit = now;
              const partial = parsePartialJson(cur.args);
              if (partial !== undefined) p.onToolCallPartial(cur.id, cur.name, partial);
            }
          }
        }
      }
      if (choice.finish_reason) finish = choice.finish_reason;
      }
    } finally {
      // Z.ai exposes only result presence, so retain that estimated fee even if
      // a subsequent stream event fails after the search already occurred.
      const billableWebSearch = zaiWebSearchBillableUsage(webSearch);
      if (billableWebSearch) p.onBillableToolUsage?.(billableWebSearch);
    }

    const content: Anthropic.ContentBlockParam[] = [];
    if (text) content.push({ type: "text", text });
    const toolCalls: StreamTurnResult["toolCalls"] = [];
    for (const [, c] of [...toolAcc.entries()].sort((a, b) => a[0] - b[0])) {
      if (!c.id || !c.name) continue;
      const input = safeParseJson(c.args, c.name);
      content.push({ type: "tool_use", id: c.id, name: c.name, input } as Anthropic.ToolUseBlockParam);
      p.onToolCall?.(c.id, c.name, input);
      toolCalls.push({ id: c.id, name: c.name, input });
    }

    const citations = citationsFromGlmSearch(webSearch);
    return {
      content,
      stopReason: mapZaiFinish(finish, toolCalls.length > 0),
      toolCalls,
      usage,
      ...(citations.length > 0 ? { citations } : {}),
    };
  }

  async callForcedTool(p: ForcedToolParams) {
    const response = await this.client.chat.completions.create(
      {
        model: p.model,
        messages: toChatMessages(p.system, p.messages),
        tools: toChatTools([p.tool], false),
        tool_choice: { type: "function", function: { name: p.tool.name } },
        max_tokens: p.maxTokens,
      },
      p.signal ? { signal: p.signal } : undefined,
    );
    const usage = toTokenUsage(response.usage);
    if (usage) p.onUsage?.(usage);
    const call = response.choices?.[0]?.message?.tool_calls?.find(
      (c): c is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall =>
        c.type === "function" && c.function.name === p.tool.name,
    );
    if (!call) {
      throw new Error(`Model did not return a ${p.tool.name} tool call`);
    }
    return {
      input: safeParseJson(call.function.arguments),
      usage,
    };
  }
}

/** Map GLM's thinking-effort control onto the Chat Completions request body. */
function applyThinking(
  body: Record<string, unknown>,
  effort: ThinkingEffort | undefined,
  enabled: boolean,
): void {
  // Thinking toggled OFF: disable GLM's reasoning for a faster turn. GLM accepts
  // `thinking:{type:"disabled"}` on Chat Completions; drop reasoning_effort too.
  if (!enabled) {
    body.thinking = { type: "disabled" };
    return;
  }
  if (!effort) return;
  // GLM-5.2's `reasoning_effort` accepts max/xhigh/high/medium/low/minimal/none,
  // which the server collapses into THREE real tiers:
  //   none/minimal    ⇒ no thinking
  //   low/medium/high ⇒ "high"  — enhanced but BOUNDED reasoning
  //   xhigh/max       ⇒ "max"   — GLM's deepest reasoning (and its own default)
  // So "high" is its OWN tier, not an alias for the deepest one. The composer
  // surfaces exactly high/max for a GLM model (thinkingEffortsForModel), so those
  // two are the live path and they MUST send different payloads — folding `high`
  // into "max" made the picker a no-op and ran every GLM turn at the deepest tier.
  // CRITICAL: medium must NOT map to "max". It used to (`effort === "low" ? high
  // : max`), which silently promoted a *medium* request to GLM's deepest tier and
  // let GLM-5.2 spiral in thinking for minutes — repeatedly "deciding" to start
  // implementing, then re-deliberating — with no tool call ever emitted. Nor must
  // `high`: that reintroduced the same spiral one rung up. Only xhigh/max opt in.
  // We send the already-resolved tier rather than leaning on the server-side
  // collapse, so the request is explicit and robust if that mapping ever changes.
  // https://docs.z.ai/guides/capabilities/thinking (reasoning_effort)
  const deep = effort === "xhigh" || effort === "max";
  body.thinking = { type: "enabled" };
  body.reasoning_effort = deep ? "max" : "high";
}

/** "tool_calls"/"length"/"stop" → our canonical stop reason. */
export function mapZaiFinish(
  reason: string | null,
  hadToolCalls: boolean,
): StreamTurnResult["stopReason"] {
  if (hadToolCalls || reason === "tool_calls") return "tool_use";
  if (reason === "length") return "max_tokens";
  return "end_turn";
}

/** Minimal shape of the Chat Completions usage object we read. */
interface ChatUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
}

/**
 * Normalize Chat Completions usage to our canonical shape. Like OpenAI's
 * Responses usage, `prompt_tokens` is the TOTAL prompt and INCLUDES cached
 * tokens, so subtract the cached subset to report the fresh (full-price)
 * remainder and surface the cached portion separately (priced ~0.1×). GLM
 * auto-caches with no separate write line, so cacheCreationTokens is 0.
 */
export function zaiTokenUsage(u: ChatUsage): TokenUsage {
  const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    inputTokens: Math.max(0, (u.prompt_tokens ?? 0) - cached),
    outputTokens: u.completion_tokens ?? 0,
    cacheReadTokens: cached,
    cacheCreationTokens: 0,
  };
}

/**
 * Anthropic tool schema → Chat Completions tools: our function tools plus GLM's
 * built-in `web_search`. `includeWebSearch` is false for the forced-tool (plan)
 * call, which must return exactly one specific function.
 */
export function toChatTools(
  tools: Anthropic.Tool[],
  includeWebSearch: boolean,
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  const fns: OpenAI.Chat.Completions.ChatCompletionTool[] = tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description ?? undefined,
      parameters: t.input_schema as Record<string, unknown>,
    },
  }));
  // web_search isn't a valid ChatCompletionTool shape in the SDK typings, but
  // the SDK forwards the body as-is and GLM expects this object — cast it in.
  return includeWebSearch
    ? [GLM_WEB_SEARCH_TOOL as unknown as OpenAI.Chat.Completions.ChatCompletionTool, ...fns]
    : fns;
}

/**
 * Canonical (Anthropic-shaped) history → Chat Completions messages. Assistant
 * text + tool_use become one assistant message (text in `content`, calls in
 * `tool_calls`); each tool_result becomes a `tool` message keyed by the call id;
 * images (in user turns or tool results) ride on a trailing user message as
 * `image_url` parts, since a `tool` message can only carry text.
 */
export function toChatMessages(
  system: string,
  messages: Anthropic.MessageParam[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  if (system) out.push({ role: "system", content: system });

  for (const msg of messages) {
    if (msg.role === "assistant") {
      if (typeof msg.content === "string") {
        if (msg.content) out.push({ role: "assistant", content: msg.content });
        continue;
      }
      let text = "";
      const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[] = [];
      for (const block of msg.content) {
        if (block.type === "text") text += block.text;
        else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id,
            type: "function",
            function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
          });
        }
      }
      if (!text && toolCalls.length === 0) continue;
      const m: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
        role: "assistant",
        content: text || null,
      };
      if (toolCalls.length > 0) m.tool_calls = toolCalls;
      out.push(m);
      continue;
    }

    // role === "user": a real user turn or a batch of tool_results.
    if (typeof msg.content === "string") {
      out.push({ role: "user", content: msg.content });
      continue;
    }
    const userParts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
    for (const block of msg.content) {
      if (block.type === "tool_result") {
        out.push({ role: "tool", tool_call_id: block.tool_use_id, content: toolResultText(block) });
      } else if (block.type === "text") {
        userParts.push({ type: "text", text: block.text });
      } else if (block.type === "image") {
        // GLM-5.2 is text-only — it can't receive images. Don't send image_url
        // (it would be rejected/ignored); point GLM at the vision bridge instead.
        userParts.push({
          type: "text",
          text: "[An attached image isn't shown — this model is text-only. Find it with list_assets (under assets/uploads/), then call analyze_image(path, question) to inspect it.]",
        });
      }
    }
    if (userParts.length > 0) out.push({ role: "user", content: userParts });
  }

  return out;
}

/**
 * Tool-result content → the text a text-only model can use. Image blocks are
 * dropped (GLM can't see them) and replaced by a note steering GLM to the
 * analyze_image bridge — the image's asset path is already in the result text
 * above the note (every image-producing tool includes it).
 */
function toolResultText(block: Anthropic.ToolResultBlockParam): string {
  if (typeof block.content === "string") return block.content || "(no output)";
  if (!Array.isArray(block.content)) return "(no output)";
  const texts: string[] = [];
  let imageCount = 0;
  for (const c of block.content) {
    if (c.type === "text") texts.push(c.text);
    else if (c.type === "image") imageCount++;
  }
  let text = texts.join("\n") || (imageCount > 0 ? "(image output)" : "(no output)");
  if (imageCount > 0) {
    text += `\n\n[${imageCount} image(s) here aren't shown — this model is text-only. Inspect them with analyze_image(path, question) using the asset path above.]`;
  }
  return text;
}
