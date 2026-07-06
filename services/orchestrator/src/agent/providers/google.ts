import { randomBytes } from "node:crypto";
import { FunctionCallingConfigMode, GoogleGenAI, ThinkingLevel } from "@google/genai";
import { DEFAULT_VISION_BRIDGE_SYSTEM } from "./types.js";
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
 * Google Gemini adapter (@google/genai — function calling + streaming).
 *
 * Translates canonical Anthropic-shaped history to Gemini `Content[]` on the
 * way in (tool_use → functionCall, tool_result → functionResponse) and back
 * to Anthropic content blocks on the way out. Gemini matches a
 * functionResponse to its call by function NAME, so we keep an id→name map
 * from the assistant's prior tool_use blocks.
 *
 * Web search: enabled on Gemini 3.x by attaching the built-in `googleSearch`
 * grounding tool alongside our functionDeclarations and setting
 * `toolConfig.includeServerSideToolInvocations` (3.x 400s on the combo without
 * it). Gemini 2.5 genuinely can't combine search with function calling, so it
 * runs function-calling only. Server-side search calls Gemini surfaces in the
 * content are recognized by NOT matching one of our tool names — we show them
 * as a web_search activity row and never execute them.
 *
 * Reasoning: Gemini 3.x uses `thinkingConfig.thinkingLevel` (low/medium/high);
 * Gemini 2.5 uses `thinkingConfig.thinkingBudget` (tokens) — sending a budget
 * to a 3.x model degrades it, so we branch on the model. Thought signatures
 * returned on function-call parts are preserved across turns (required for
 * 3.x multi-turn function calling). Signatures are encrypted reasoning state
 * VALID ONLY FOR THE MODEL THAT MINTED THEM: each block records its minting
 * model (`thought_signature_model`) and replay is same-model only — replaying
 * a 3.5 Flash signature into 3.1 Pro isn't rejected on text parts (validation
 * there is lax), it silently poisons the reasoning state and the model can
 * derail into regurgitating unrelated pretraining data. On a model switch,
 * function-call parts get Google's documented dummy bypass signature and text
 * parts drop theirs (per the Gemini 3 docs' "switching between models" rule).
 *
 * Image previews: image blocks inside a tool_result (e.g. the screenshot tool)
 * are forwarded as inlineData parts alongside the functionResponse, so the
 * model sees the preview. Images in plain user messages are forwarded too.
 */

/**
 * 2.5 thinkingBudget (tokens) per effort level; 3.x uses thinkingLevel instead.
 * Gemini has no reasoning tiers above "high", so xhigh/max just buy a larger 2.5
 * budget (the composer hides xhigh/max for Google models anyway — these keys
 * exist only to satisfy the exhaustive Record and for an Auto turn that resolved
 * to Gemini with a higher rung requested).
 */
const GEMINI_2_5_BUDGET: Record<ThinkingEffort, number> = {
  low: 2048,
  medium: 8192,
  high: 16384,
  xhigh: 24576,
  max: 32768,
};

/**
 * Our lowercase `ThinkingEffort` → the SDK's `ThinkingLevel` enum, whose wire
 * values are UPPERCASE ("LOW"/"MEDIUM"/"HIGH"). This mapping is load-bearing:
 * the SDK forwards `thinkingConfig` verbatim, so passing a lowercase string is
 * an invalid enum the API silently drops — and Gemini 3 then falls back to its
 * default of HIGH. At HIGH the 3.x models routinely return empty or one-/two-
 * word answer text (all the content goes to the reasoning trace, the final
 * answer comes back blank — finishReason STOP, not MAX_TOKENS). Sending the
 * correct enum is what actually applies the requested level.
 */
const GEMINI_3_LEVEL: Record<ThinkingEffort, ThinkingLevel> = {
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
  // Gemini 3.x has no level above HIGH — the top two rungs clamp to HIGH (the
  // composer hides them for Google models; this is only hit on an Auto turn).
  xhigh: ThinkingLevel.HIGH,
  max: ThinkingLevel.HIGH,
};

/**
 * The right thinkingConfig for this model: Gemini 3.x takes a semantic
 * `thinkingLevel` (see GEMINI_3_LEVEL); 2.5 takes a `thinkingBudget` token
 * count. For 3.x we ALWAYS return a level — defaulting to medium when the user
 * didn't pick one — so we never inherit 3.x's empty-prone HIGH default. For 2.5
 * we return undefined (provider default) when no effort was requested.
 */
export function thinkingConfigFor(
  model: string,
  effort: ThinkingEffort | undefined,
  enabled = true,
): Record<string, unknown> | undefined {
  // Thinking toggled OFF. Gemini can't fully disable reasoning the way Claude
  // can, so we minimize it: 2.5 takes a 0-token budget (its "off"); 3.x has no
  // sub-LOW level, so LOW is the floor. No includeThoughts — nothing to surface.
  if (!enabled) {
    if (/^gemini-3/.test(model)) return { thinkingLevel: ThinkingLevel.LOW };
    return { thinkingBudget: 0 };
  }
  // includeThoughts returns thought-summary parts we surface as the live
  // reasoning trace (see the `part.thought` handling in streamAgentTurn).
  const base = { includeThoughts: true };
  if (/^gemini-3/.test(model)) {
    return { ...base, thinkingLevel: GEMINI_3_LEVEL[effort ?? "medium"] };
  }
  if (!effort) return undefined;
  return { ...base, thinkingBudget: GEMINI_2_5_BUDGET[effort] };
}

/**
 * Google's documented bypass for Gemini 3's strict thought-signature
 * validation on function-call parts, prescribed exactly for our case: "If you
 * are switching between models … you will not have a valid signature. To
 * bypass strict validation in these specific scenarios, populate the field
 * with this specific dummy string." A REAL foreign signature must never be
 * sent instead — see the adapter doc comment.
 */
export const FOREIGN_SIGNATURE_BYPASS = "context_engineering_is_the_way_to_go";

/** Default model backing the analyze_image vision bridge (override via env). */
export const VISION_BRIDGE_MODEL = "gemini-3.5-flash";

// Default vision-bridge system steer — shared with the GLM-5V fallback bridge
// via types.ts (DEFAULT_VISION_BRIDGE_SYSTEM) so the two backends can't drift.

/**
 * Vision bridge for text-only models (e.g. GLM-5.2). The analyze_image tool
 * sends an image + a targeted question here and Gemini 3.5 Flash answers in
 * text. Flash is the bridge backend (not GLM-5V-Turbo) for two reasons: real
 * throughput — no concurrency-1 wall that serializes every user's image — and
 * near-Pro vision quality, so the text-only path loses little to nothing vs a
 * natively-multimodal model. Thinking defaults to LOW (visual description isn't
 * deep reasoning and LOW keeps the bridge fast); the caller can pass "medium".
 * Returns the analysis AND token usage so the caller can meter the sub-call's
 * cost precisely (gemini-3.5-flash is in MODEL_PRICING).
 */
export async function describeImage(opts: {
  apiKey: string;
  model?: string;
  /** One or more media parts — images, or a PDF (Gemini reads PDFs natively). */
  media: { base64: string; mimeType: string }[];
  question: string;
  /** Override the default UI-analysis system steer (task-specialized tools do). */
  system?: string;
  thinking?: ThinkingEffort;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}): Promise<{ text: string; model: string; usage?: TokenUsage }> {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  const model = opts.model || process.env.VISION_BRIDGE_MODEL || VISION_BRIDGE_MODEL;
  // thinkingLevel only (no includeThoughts — we don't surface the trace for a
  // one-shot sub-call). 3.x needs the UPPERCASE enum or it silently defaults to
  // HIGH (see GEMINI_3_LEVEL). 2.5 ignores a level, so only send it to 3.x.
  const isGemini3 = /^gemini-3/.test(model);
  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          { text: opts.question },
          ...opts.media.map((m) => ({ inlineData: { mimeType: m.mimeType, data: m.base64 } })),
        ],
      },
    ],
    config: {
      systemInstruction: opts.system || DEFAULT_VISION_BRIDGE_SYSTEM,
      maxOutputTokens: opts.maxOutputTokens ?? 4096,
      ...(isGemini3 ? { thinkingConfig: { thinkingLevel: GEMINI_3_LEVEL[opts.thinking ?? "low"] } } : {}),
      abortSignal: opts.signal,
    },
  });
  // Concatenate non-thought answer parts (defensive — thoughts aren't requested).
  let text = "";
  for (const part of response.candidates?.[0]?.content?.parts ?? []) {
    if (part.text && !part.thought) text += part.text;
  }
  text = text.trim();
  const um = response.usageMetadata;
  let usage: TokenUsage | undefined;
  if (um) {
    const cached = um.cachedContentTokenCount ?? 0;
    usage = {
      inputTokens: Math.max(0, (um.promptTokenCount ?? 0) - cached),
      // Reasoning ("thoughts") tokens bill as output — include them.
      outputTokens: (um.candidatesTokenCount ?? 0) + (um.thoughtsTokenCount ?? 0),
      cacheReadTokens: cached,
      cacheCreationTokens: 0,
    };
  }
  return { text: text || "(the vision model returned no description)", model, usage };
}

// Module-level monotonic counter for synthetic Gemini tool ids. A fresh
// GoogleAdapter is constructed every turn (loop.ts builds the adapter per
// turn), so a per-instance counter resets to 0 each turn and re-issues
// gem_0, gem_1… The web store dedupes tool rows on call_id chat-wide, so a
// reused id hijacks a prior turn's rendered row; duplicates also corrupt
// cross-provider replay. Pairing this counter with a per-instance random
// prefix makes every id globally unique across turns AND adapter instances.
let geminiIdCounter = 0;

export class GoogleAdapter implements ModelProviderAdapter {
  readonly provider = "google" as const;
  private ai: GoogleGenAI;
  // Random per-instance (per-turn) prefix; combined with the module counter so
  // synthetic ids never repeat across turns or instances (see geminiIdCounter).
  private idPrefix = randomBytes(4).toString("hex");

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  /** Mint a globally-unique synthetic id for a call Gemini left id-less. */
  private nextSyntheticId(kind: "fn" | "search"): string {
    return `gem_${kind === "search" ? "search_" : ""}${this.idPrefix}_${geminiIdCounter++}`;
  }

  async streamAgentTurn(p: StreamTurnParams): Promise<StreamTurnResult> {
    const contents = toGeminiContents(p.messages, p.model);
    const thinkingConfig = thinkingConfigFor(p.model, p.thinkingEffort, p.thinkingEnabled !== false);
    // Built-in Google Search grounding (3.x only — 2.5 can't combine it with
    // function calling). Needs includeServerSideToolInvocations or 3.x 400s.
    const useSearch = /^gemini-3/.test(p.model);
    const tools = useSearch
      ? [{ googleSearch: {} }, { functionDeclarations: toGeminiFunctionDeclarations(p.tools) }]
      : [{ functionDeclarations: toGeminiFunctionDeclarations(p.tools) }];
    const stream = await this.ai.models.generateContentStream({
      model: p.model,
      contents,
      config: {
        systemInstruction: p.system,
        maxOutputTokens: p.maxTokens,
        tools,
        ...(useSearch ? { toolConfig: { includeServerSideToolInvocations: true } } : {}),
        ...(thinkingConfig ? { thinkingConfig } : {}),
        abortSignal: p.signal,
      },
    });

    let text = "";
    // Thought signature riding the answer text (3.x attaches it to a text part,
    // often a trailing empty-text one at end-of-stream). Echoed back next turn
    // to preserve reasoning/answer quality across the agent loop — see below.
    let textSignature: string | undefined;
    let finishReason: string | undefined;
    // Gemini reports usage as cumulative `usageMetadata` on (typically the
    // final) chunks. Track the latest and surface it as it updates.
    let usage: TokenUsage | undefined;
    // Capture the thought signature that rides on each function-call part —
    // Gemini 3.x requires it echoed back on the next turn for multi-turn
    // function calling, so we stash it on the tool_use block (see toGeminiContents).
    const calls: Array<{ id: string; name: string; args: unknown; signature?: string }> = [];
    const announced = new Set<string>();
    // Our client tools (everything else in a functionCall part is a server-side
    // tool like googleSearch — surfaced as web_search, never executed).
    const ourTools = new Set(p.tools.map((t) => t.name));
    let searchSurfaced = false;

    // Iterate raw parts (not the chunk.text / chunk.functionCalls accessors) so
    // we can (a) split thought-summary parts from the answer text and (b) read
    // the thoughtSignature that rides alongside each function-call part.
    const surfaceSearch = (detail: unknown, result: string): void => {
      searchSurfaced = true;
      const sid = this.nextSyntheticId("search");
      p.onToolCallStarted?.(sid, "web_search");
      p.onToolCall?.(sid, "web_search", detail);
      p.onToolResult?.(sid, "web_search", detail, result, false);
    };

    for await (const chunk of stream) {
      if (p.signal?.aborted) break;
      // groundingMetadata fallback — some models only report searches here (and
      // typically only on the final chunk). Skipped when toolCall parts already
      // surfaced the same searches with richer per-call queries (3.5 Flash).
      const queries = chunk.candidates?.[0]?.groundingMetadata?.webSearchQueries;
      if (queries && queries.length > 0 && !searchSurfaced)
        surfaceSearch({ queries }, queries.join("\n"));

      const parts = chunk.candidates?.[0]?.content?.parts;
      if (parts) {
        for (const part of parts) {
          // Server-side tool executions stream as toolCall/toolResponse parts
          // (3.5 Flash surfaces googleSearch THIS way — as verified against the
          // live API; groundingMetadata only arrives on the last chunk, if at
          // all). Surface each search with its real queries; never execute
          // these. Handled BEFORE the text/functionCall branches: these parts
          // carry their own thoughtSignatures, which must not be captured as
          // the answer-text signature below (and are deliberately not
          // persisted — they belong to server-tool parts we don't replay).
          const serverCall = (
            part as { toolCall?: { toolType?: string; args?: { queries?: string[] } } }
          ).toolCall;
          if (serverCall) {
            if (String(serverCall.toolType ?? "").startsWith("GOOGLE_SEARCH")) {
              const q = serverCall.args?.queries ?? [];
              surfaceSearch({ queries: q }, q.join("\n") || "Searched the web.");
            }
            continue;
          }
          if ((part as { toolResponse?: unknown }).toolResponse) continue;
          if (part.text) {
            // `thought: true` → reasoning trace; otherwise it's answer text.
            if (part.thought) p.onThinking?.(part.text);
            else {
              text += part.text;
              p.onText?.(part.text);
              // Capture the answer's thought signature when it rides a text part.
              if (part.thoughtSignature) textSignature = part.thoughtSignature;
            }
            continue;
          }
          const fc = part.functionCall;
          if (!fc) {
            // 3.x may deliver the answer's signature on a part with EMPTY text
            // at end-of-stream — keep it for the text block even though there's
            // nothing to display here. (Thought parts keep their own signature.)
            if (part.thoughtSignature && !part.thought) textSignature = part.thoughtSignature;
            continue;
          }
          const name = fc.name ?? "";
          // A functionCall whose name isn't one of ours is a server-side tool
          // (googleSearch, included via includeServerSideToolInvocations). Show
          // it as web_search and do NOT hand it to the loop to execute.
          if (!ourTools.has(name)) {
            surfaceSearch({ name }, "Searched the web.");
            continue;
          }
          const id = fc.id ?? this.nextSyntheticId("fn");
          if (!announced.has(id)) {
            announced.add(id);
            p.onToolCallStarted?.(id, name);
            // Gemini delivers functionCall args ATOMICALLY with the part, so the
            // full input is known right now — surface it immediately as a
            // "partial" (the UI upserts by id) instead of leaving the row on the
            // empty started-input until the whole stream ends (trailing text
            // after a call could keep the label blank for seconds).
            p.onToolCallPartial?.(id, name, fc.args ?? {});
          }
          calls.push({ id, name, args: fc.args ?? {}, signature: part.thoughtSignature });
        }
      }
      const fr = chunk.candidates?.[0]?.finishReason;
      if (fr) finishReason = String(fr);

      const um = chunk.usageMetadata;
      if (um) {
        // promptTokenCount INCLUDES cached tokens (implicit caching is on by
        // default for 2.5/3.x). Subtract the cached portion so inputTokens is
        // the fresh, full-price remainder and the dashboard can price the
        // cached reads at the discounted rate instead of billing them at 1×.
        const cached = um.cachedContentTokenCount ?? 0;
        usage = {
          inputTokens: Math.max(0, (um.promptTokenCount ?? 0) - cached),
          // Reasoning ("thoughts") tokens are billed as output — include them.
          outputTokens: (um.candidatesTokenCount ?? 0) + (um.thoughtsTokenCount ?? 0),
          cacheReadTokens: cached,
          cacheCreationTokens: 0,
        };
        p.onUsage?.(usage);
      }
    }
    if (p.signal?.aborted) {
      throw new Error("aborted");
    }

    const content: Anthropic.ContentBlockParam[] = [];
    if (text) {
      const textBlock: Record<string, unknown> = { type: "text", text };
      // Non-standard fields, preserved verbatim through history and re-attached
      // to the Gemini text part next turn (toGeminiContents); stripped before
      // other providers' APIs (see anthropic.ts stripForeignFields). The
      // minting model rides along because a signature is only valid for the
      // model that produced it — replay is same-model gated.
      if (textSignature) {
        textBlock.thought_signature = textSignature;
        textBlock.thought_signature_model = p.model;
      }
      content.push(textBlock as unknown as Anthropic.TextBlockParam);
    }
    const toolCalls: StreamTurnResult["toolCalls"] = [];
    for (const c of calls) {
      const block = { type: "tool_use", id: c.id, name: c.name, input: c.args } as Record<
        string,
        unknown
      >;
      // Non-standard fields, preserved verbatim through history; re-attached to
      // the Gemini functionCall part on the next turn (same-model only — see
      // replaySignature). Ignored by other providers.
      if (c.signature) {
        block.thought_signature = c.signature;
        block.thought_signature_model = p.model;
      }
      content.push(block as unknown as Anthropic.ToolUseBlockParam);
      p.onToolCall?.(c.id, c.name, c.args);
      toolCalls.push({ id: c.id, name: c.name, input: c.args });
    }

    return {
      content,
      stopReason: mapStopReason(finishReason, toolCalls.length > 0),
      toolCalls,
      usage,
    };
  }

  async callForcedTool(p: ForcedToolParams): Promise<unknown> {
    const contents = toGeminiContents(p.messages, p.model);
    const response = await this.ai.models.generateContent({
      model: p.model,
      contents,
      config: {
        systemInstruction: p.system,
        maxOutputTokens: p.maxTokens,
        abortSignal: p.signal,
        tools: [{ functionDeclarations: toGeminiFunctionDeclarations([p.tool]) }],
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.ANY,
            allowedFunctionNames: [p.tool.name],
          },
        },
      },
    });
    const call = response.functionCalls?.[0];
    if (!call || call.name !== p.tool.name) {
      throw new Error(`Model did not return a ${p.tool.name} tool call`);
    }
    return call.args ?? {};
  }
}

export function mapStopReason(
  reason: string | undefined,
  hadToolCalls: boolean,
): StreamTurnResult["stopReason"] {
  if (hadToolCalls) return "tool_use";
  if (reason === "MAX_TOKENS") return "max_tokens";
  return "end_turn";
}

// Gemini rejects a few JSON-schema keywords; strip the ones we know it
// doesn't accept so our Anthropic-shaped tool schemas pass through.
export function sanitizeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeSchema);
  if (schema && typeof schema === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
      if (k === "$schema" || k === "additionalProperties") continue;
      out[k] = sanitizeSchema(v);
    }
    return out;
  }
  return schema;
}

export function toGeminiFunctionDeclarations(tools: Anthropic.Tool[]): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parametersJsonSchema: sanitizeSchema(t.input_schema),
  }));
}

/**
 * The signature to replay for a history block, if any. Same-model signatures
 * pass through verbatim. When there is NO signature valid for this model — a
 * signature minted by a DIFFERENT Gemini model, OR none at all (every function
 * call from a non-Gemini provider: GLM/Anthropic/OpenAI, i.e. the turns before
 * a mid-chat switch TO Gemini) — function-call parts get Google's documented
 * dummy bypass on 3.x (where presence is validated) and text parts are dropped.
 * Blocks stamped before minting models were recorded (`thought_signature`
 * without `thought_signature_model`) are treated as same-model — the pre-fix
 * status quo, correct for the common single-model conversation; every new block
 * is stamped.
 */
function replaySignature(
  block: { thought_signature?: string; thought_signature_model?: string },
  model: string,
  kind: "text" | "fn",
): string | undefined {
  const sig = block.thought_signature;
  const mint = block.thought_signature_model;
  // A same-model signature (or a legacy block stamped before we recorded the
  // minting model) is valid for this model — replay it verbatim.
  if (sig && (!mint || mint === model)) return sig;
  // Otherwise there's no signature valid for THIS model. Two cases land here:
  //  - a FOREIGN Gemini signature (minted by a different Gemini model), and
  //  - NO signature at all, which is EVERY function call minted by a non-Gemini
  //    provider (GLM / Anthropic / OpenAI) — i.e. the turns that precede a
  //    mid-chat switch TO Gemini.
  // Both are the docs' "function calls not generated by [this] model / switching
  // between models" scenario. Gemini 3.x requires a signature PRESENT on
  // function-call parts; when it's absent it doesn't 400 — it silently poisons
  // the reasoning state and the model derails into repeating one line forever
  // (observed after a GLM→Gemini switch: looping "call analyze_image" while
  // running `sleep 1`). Give function-call parts Google's documented dummy
  // bypass on 3.x; text-part validation is lax, so just drop those. 2.5 doesn't
  // use thought signatures at all, so it gets nothing either way.
  if (kind === "fn" && /^gemini-3/.test(model)) return FOREIGN_SIGNATURE_BYPASS;
  return undefined;
}

export function toGeminiContents(
  messages: Anthropic.MessageParam[],
  /** The model this request targets — gates signature replay (same-model only). */
  model: string,
): Array<Record<string, unknown>> {
  // tool_use id → function name, so tool_results can be matched back to calls.
  const idToName = new Map<string, string>();
  for (const msg of messages) {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const b of msg.content) {
        if (b.type === "tool_use") idToName.set(b.id, b.name);
      }
    }
  }

  const contents: Array<Record<string, unknown>> = [];
  for (const msg of messages) {
    if (msg.role === "assistant") {
      const parts: Array<Record<string, unknown>> = [];
      if (typeof msg.content === "string") {
        if (msg.content) parts.push({ text: msg.content });
      } else {
        for (const b of msg.content) {
          if (b.type === "text") {
            const part: Record<string, unknown> = { text: b.text };
            // Echo back the answer's thought signature captured on the way out,
            // so 3.x keeps its reasoning context across the multi-turn loop —
            // but only to the model that minted it (see replaySignature).
            const sig = replaySignature(b as unknown as Record<string, string | undefined>, model, "text");
            if (sig) part.thoughtSignature = sig;
            parts.push(part);
          } else if (b.type === "tool_use") {
            const part: Record<string, unknown> = {
              functionCall: { name: b.name, args: (b.input ?? {}) as object },
            };
            // Echo back the thought signature captured on the way out, so 3.x
            // multi-turn function calling keeps its reasoning context — same-
            // model only; a foreign one becomes the documented dummy bypass.
            const sig = replaySignature(b as unknown as Record<string, string | undefined>, model, "fn");
            if (sig) part.thoughtSignature = sig;
            parts.push(part);
          }
        }
      }
      if (parts.length > 0) contents.push({ role: "model", parts });
      continue;
    }

    // user role: string, mixed content, or a batch of tool_results.
    if (typeof msg.content === "string") {
      contents.push({ role: "user", parts: [{ text: msg.content }] });
      continue;
    }
    const parts: Array<Record<string, unknown>> = [];
    for (const b of msg.content) {
      if (b.type === "tool_result") {
        const matchedName = idToName.get(b.tool_use_id);
        const name = matchedName ?? "unknown_tool";
        const { text, images } = splitToolResult(b);
        // Echo the call id on the response only when it pairs with a REAL Gemini
        // functionCall id: the id must match an assistant tool_use in THIS
        // history (matchedName) AND not be one of the synthetic ids we minted
        // for id-less calls (gem_… prefix), which were never sent to Gemini.
        // Gemini 3.x parallel calling populates fc.id and the docs want it
        // echoed back; omitting it elsewhere keeps name/order pairing intact.
        const functionResponse: Record<string, unknown> = {
          name,
          response: { result: text },
        };
        if (matchedName !== undefined && !b.tool_use_id.startsWith("gem_")) {
          functionResponse.id = b.tool_use_id;
        }
        parts.push({ functionResponse });
        // Forward image outputs (e.g. screenshots) so the model sees them.
        for (const img of images) {
          parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
        }
      } else if (b.type === "text") {
        parts.push({ text: b.text });
      } else if (b.type === "image" && b.source.type === "base64") {
        parts.push({ inlineData: { mimeType: b.source.media_type, data: b.source.data } });
      }
    }
    if (parts.length > 0) contents.push({ role: "user", parts });
  }
  return contents;
}

/** Split a tool_result into its text and any base64 inline images it carries. */
function splitToolResult(block: Anthropic.ToolResultBlockParam): {
  text: string;
  images: Array<{ mimeType: string; data: string }>;
} {
  if (typeof block.content === "string") {
    return { text: block.content || "(no output)", images: [] };
  }
  if (Array.isArray(block.content)) {
    const texts: string[] = [];
    const images: Array<{ mimeType: string; data: string }> = [];
    for (const c of block.content) {
      if (c.type === "text") texts.push(c.text);
      else if (c.type === "image" && c.source.type === "base64") {
        images.push({ mimeType: c.source.media_type, data: c.source.data });
      }
    }
    const text =
      texts.join("\n") || (images.length > 0 ? "[image output — see image below]" : "(no output)");
    return { text, images };
  }
  return { text: "(no output)", images: [] };
}
