import OpenAI from "openai";
import { fetch as undiciFetch } from "undici";
import type Anthropic from "@anthropic-ai/sdk";
import type { ThinkingEffort } from "@uniqus/api-types";
import { safeParseJson } from "./openai.js";
import type {
  ForcedToolParams,
  ModelProviderAdapter,
  StreamTurnParams,
  StreamTurnResult,
  TokenUsage,
} from "./types.js";

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
/** Default system steer for the GLM-V bridge (overridden by task-specialized tools). */
const DEFAULT_VISION_SYSTEM =
  "You are a precise visual-analysis assistant. Examine the image and answer the question factually and specifically. For UI screenshots, report layout, alignment, spacing, color/contrast, overlaps, truncation, legibility, and anything visibly broken or off. Be concrete; do not speculate beyond what's visible.";

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
        { role: "system", content: opts.system || DEFAULT_VISION_SYSTEM },
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
 * and folds the results into the answer; the loop never executes it. Z.ai's API
 * takes these sub-fields as STRINGS (per the docs' example), so they're strings
 * here on purpose. `search_engine` is left unset so GLM picks its default engine
 * (the documented engine names vary by plan; omitting avoids an invalid-enum
 * rejection). `search_result:"True"` returns the result list in the response.
 */
const GLM_WEB_SEARCH_TOOL = {
  type: "web_search",
  web_search: {
    enable: "True",
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
    applyThinking(body as unknown as Record<string, unknown>, p.thinkingEffort);
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
    // id, name, and (chunked) argument string per index.
    const toolAcc = new Map<number, { id: string; name: string; args: string }>();
    const announced = new Set<number>();
    let usage: TokenUsage | undefined;
    let finish: string | null = null;

    for await (const chunk of stream) {
      // With include_usage, the final chunk carries usage and has no choices.
      if (chunk.usage) {
        usage = zaiTokenUsage(chunk.usage);
        p.onUsage?.(usage);
      }
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
            cur = { id: "", name: "", args: "" };
            toolAcc.set(idx, cur);
          }
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          if (cur.id && cur.name && !announced.has(idx)) {
            announced.add(idx);
            p.onToolCallStarted?.(cur.id, cur.name);
          }
        }
      }
      if (choice.finish_reason) finish = choice.finish_reason;
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

    return {
      content,
      stopReason: mapZaiFinish(finish, toolCalls.length > 0),
      toolCalls,
      usage,
    };
  }

  async callForcedTool(p: ForcedToolParams): Promise<unknown> {
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
    const call = response.choices?.[0]?.message?.tool_calls?.find(
      (c): c is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall =>
        c.type === "function" && c.function.name === p.tool.name,
    );
    if (!call) {
      throw new Error(`Model did not return a ${p.tool.name} tool call`);
    }
    return safeParseJson(call.function.arguments);
  }
}

/** Map GLM's thinking-effort control onto the Chat Completions request body. */
function applyThinking(body: Record<string, unknown>, effort: ThinkingEffort | undefined): void {
  if (!effort) return;
  // GLM-5.2's `reasoning_effort` accepts max/xhigh/high/medium/low/minimal/none,
  // but with thinking ON the server COLLAPSES them to two working tiers:
  // low/medium → "high" (enhanced reasoning) and xhigh/max → "max" (deepest,
  // GLM's recommended coding default). So our three UI levels map onto those two:
  //   high       ⇒ "max"   — GLM's deepest reasoning, for the hardest turns
  //   low/medium ⇒ "high"  — enhanced but BOUNDED reasoning
  // CRITICAL: medium must NOT map to "max". It used to (`effort === "low" ? high
  // : max`), which silently promoted a *medium* request to GLM's deepest tier and
  // let GLM-5.2 spiral in thinking for minutes — repeatedly "deciding" to start
  // implementing, then re-deliberating — with no tool call ever emitted. Only an
  // explicit "high" should opt into max. We send the already-resolved tier
  // ("high"/"max") rather than leaning on the server-side collapse, so the request
  // is explicit and robust if that mapping ever changes.
  // https://docs.z.ai/api-reference/llm/chat-completion (reasoning_effort)
  body.thinking = { type: "enabled" };
  body.reasoning_effort = effort === "high" ? "max" : "high";
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
