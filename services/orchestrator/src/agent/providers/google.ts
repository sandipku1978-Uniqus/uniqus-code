import { FunctionCallingConfigMode, GoogleGenAI } from "@google/genai";
import type Anthropic from "@anthropic-ai/sdk";
import type {
  ForcedToolParams,
  ModelProviderAdapter,
  StreamTurnParams,
  StreamTurnResult,
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
 * Web search: Gemini 3.x can combine the built-in `googleSearch` grounding
 * tool with our custom functionDeclarations in one request, so we add it for
 * those models (2.5 can't combine the two, so it keeps function calling only).
 *
 * Image previews: image blocks inside a tool_result (e.g. the screenshot tool)
 * are forwarded as inlineData parts alongside the functionResponse, so the
 * model sees the preview. Images in plain user messages are forwarded too.
 */

/** Gemini 3.x can combine googleSearch grounding with function declarations. */
function supportsGoogleSearch(model: string): boolean {
  return /^gemini-3/.test(model);
}
export class GoogleAdapter implements ModelProviderAdapter {
  readonly provider = "google" as const;
  private ai: GoogleGenAI;
  private idSeq = 0;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async streamAgentTurn(p: StreamTurnParams): Promise<StreamTurnResult> {
    const contents = toGeminiContents(p.messages);
    // Built-in Google Search grounding (3.x only) + our custom tools.
    const tools: Array<Record<string, unknown>> = [
      { functionDeclarations: toGeminiFunctionDeclarations(p.tools) },
    ];
    if (supportsGoogleSearch(p.model)) tools.unshift({ googleSearch: {} });
    const stream = await this.ai.models.generateContentStream({
      model: p.model,
      contents,
      config: {
        systemInstruction: p.system,
        maxOutputTokens: p.maxTokens,
        tools,
        abortSignal: p.signal,
      },
    });

    let text = "";
    let finishReason: string | undefined;
    const calls: Array<{ id: string; name: string; args: unknown }> = [];
    const announced = new Set<string>();
    let searchSurfaced = false;

    for await (const chunk of stream) {
      if (p.signal?.aborted) break;
      const t = chunk.text;
      if (t) {
        text += t;
        p.onText?.(t);
      }
      // Surface Google Search grounding as a web_search activity row, once,
      // so the UI reflects that the model searched (parity with Anthropic).
      const queries = chunk.candidates?.[0]?.groundingMetadata?.webSearchQueries;
      if (!searchSurfaced && queries && queries.length > 0) {
        searchSurfaced = true;
        const id = `gem_search_${this.idSeq++}`;
        p.onToolCallStarted?.(id, "web_search");
        p.onToolCall?.(id, "web_search", { queries });
        p.onToolResult?.(id, "web_search", { queries }, queries.join("\n"), false);
      }
      const fnCalls = chunk.functionCalls;
      if (fnCalls && fnCalls.length > 0) {
        for (const fc of fnCalls) {
          const id = fc.id ?? `gem_${this.idSeq++}`;
          const name = fc.name ?? "";
          if (!announced.has(id)) {
            announced.add(id);
            p.onToolCallStarted?.(id, name);
          }
          calls.push({ id, name, args: fc.args ?? {} });
        }
      }
      const fr = chunk.candidates?.[0]?.finishReason;
      if (fr) finishReason = String(fr);
    }
    if (p.signal?.aborted) {
      throw new Error("aborted");
    }

    const content: Anthropic.ContentBlockParam[] = [];
    if (text) content.push({ type: "text", text });
    const toolCalls: StreamTurnResult["toolCalls"] = [];
    for (const c of calls) {
      content.push({ type: "tool_use", id: c.id, name: c.name, input: c.args } as Anthropic.ToolUseBlockParam);
      p.onToolCall?.(c.id, c.name, c.args);
      toolCalls.push({ id: c.id, name: c.name, input: c.args });
    }

    return {
      content,
      stopReason: mapStopReason(finishReason, toolCalls.length > 0),
      toolCalls,
    };
  }

  async callForcedTool(p: ForcedToolParams): Promise<unknown> {
    const contents = toGeminiContents(p.messages);
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

function mapStopReason(
  reason: string | undefined,
  hadToolCalls: boolean,
): StreamTurnResult["stopReason"] {
  if (hadToolCalls) return "tool_use";
  if (reason === "MAX_TOKENS") return "max_tokens";
  return "end_turn";
}

// Gemini rejects a few JSON-schema keywords; strip the ones we know it
// doesn't accept so our Anthropic-shaped tool schemas pass through.
function sanitizeSchema(schema: unknown): unknown {
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

function toGeminiFunctionDeclarations(tools: Anthropic.Tool[]): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parametersJsonSchema: sanitizeSchema(t.input_schema),
  }));
}

function toGeminiContents(messages: Anthropic.MessageParam[]): Array<Record<string, unknown>> {
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
          if (b.type === "text") parts.push({ text: b.text });
          else if (b.type === "tool_use") {
            parts.push({ functionCall: { name: b.name, args: (b.input ?? {}) as object } });
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
        const name = idToName.get(b.tool_use_id) ?? "unknown_tool";
        const { text, images } = splitToolResult(b);
        parts.push({ functionResponse: { name, response: { result: text } } });
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
