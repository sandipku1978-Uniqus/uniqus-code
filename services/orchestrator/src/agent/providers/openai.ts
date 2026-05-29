import OpenAI from "openai";
import type Anthropic from "@anthropic-ai/sdk";
import type {
  ForcedToolParams,
  ModelProviderAdapter,
  StreamTurnParams,
  StreamTurnResult,
} from "./types.js";

/**
 * OpenAI adapter (Chat Completions API + function calling).
 *
 * Translates the canonical Anthropic-shaped history to OpenAI's message list
 * on the way in, and synthesizes Anthropic content blocks (text + tool_use)
 * on the way out so the loop and persisted history stay provider-agnostic.
 *
 * Web search: enabled via `web_search_options` on the GPT-5.5 family (the
 * model decides when to search; citations come back inline in the text).
 *
 * Image previews: OpenAI's `tool` role can't carry images, so image blocks
 * inside a tool_result (e.g. the screenshot tool) ride on a following user
 * message as image_url parts — the model still sees the screenshot. Images in
 * plain user messages are forwarded the same way.
 */

/** GPT-5.5-family models support built-in web search; the codex model doesn't. */
function supportsWebSearch(model: string): boolean {
  return !model.includes("codex");
}

/** GPT-5.5 Pro supports Chat Completions, but not streaming. */
function supportsStreaming(model: string): boolean {
  return model !== "gpt-5.5-pro";
}
export class OpenAIAdapter implements ModelProviderAdapter {
  readonly provider = "openai" as const;
  private client: OpenAI;
  private idSeq = 0;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async streamAgentTurn(p: StreamTurnParams): Promise<StreamTurnResult> {
    if (!supportsStreaming(p.model)) {
      return this.completeAgentTurn(p);
    }

    const messages = toOpenAIMessages(p.system, p.messages);
    const stream = await this.client.chat.completions.create(
      {
        model: p.model,
        max_completion_tokens: p.maxTokens,
        tools: toOpenAITools(p.tools),
        messages,
        stream: true,
        // Built-in web search: the model searches when it judges it useful and
        // weaves cited results into its answer. Parity with the Anthropic path.
        ...(supportsWebSearch(p.model) ? { web_search_options: {} } : {}),
      },
      p.signal ? { signal: p.signal } : undefined,
    );

    let text = "";
    let finishReason: string | null = null;
    // Accumulate streamed tool calls by their position index.
    const acc = new Map<number, { id: string; name: string; args: string; announced: boolean }>();

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (!choice) continue;
      const delta = choice.delta;
      if (delta?.content) {
        text += delta.content;
        p.onText?.(delta.content);
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          let cur = acc.get(idx);
          if (!cur) {
            cur = { id: tc.id ?? "", name: "", args: "", announced: false };
            acc.set(idx, cur);
          }
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          if (!cur.announced && cur.name) {
            cur.announced = true;
            if (!cur.id) cur.id = `oai_${this.idSeq++}`;
            p.onToolCallStarted?.(cur.id, cur.name);
          }
        }
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }

    const content: Anthropic.ContentBlockParam[] = [];
    if (text) content.push({ type: "text", text });
    const toolCalls: StreamTurnResult["toolCalls"] = [];
    for (const cur of [...acc.values()]) {
      if (!cur.id) cur.id = `oai_${this.idSeq++}`;
      const input = safeParseJson(cur.args);
      content.push({ type: "tool_use", id: cur.id, name: cur.name, input } as Anthropic.ToolUseBlockParam);
      p.onToolCall?.(cur.id, cur.name, input);
      toolCalls.push({ id: cur.id, name: cur.name, input });
    }

    return {
      content,
      stopReason: mapStopReason(finishReason, toolCalls.length > 0),
      toolCalls,
    };
  }

  private async completeAgentTurn(p: StreamTurnParams): Promise<StreamTurnResult> {
    const messages = toOpenAIMessages(p.system, p.messages);
    const response = await this.client.chat.completions.create(
      {
        model: p.model,
        max_completion_tokens: p.maxTokens,
        tools: toOpenAITools(p.tools),
        messages,
        ...(supportsWebSearch(p.model) ? { web_search_options: {} } : {}),
      },
      p.signal ? { signal: p.signal } : undefined,
    );

    const choice = response.choices[0];
    const message = choice?.message;
    const content: Anthropic.ContentBlockParam[] = [];
    const text = textFromOpenAIContent(message?.content);
    if (text) {
      content.push({ type: "text", text });
      p.onText?.(text);
    }

    const toolCalls: StreamTurnResult["toolCalls"] = [];
    for (const call of message?.tool_calls ?? []) {
      if (call.type !== "function") continue;
      const input = safeParseJson(call.function.arguments);
      content.push({
        type: "tool_use",
        id: call.id,
        name: call.function.name,
        input,
      } as Anthropic.ToolUseBlockParam);
      p.onToolCallStarted?.(call.id, call.function.name);
      p.onToolCall?.(call.id, call.function.name, input);
      toolCalls.push({ id: call.id, name: call.function.name, input });
    }

    return {
      content,
      stopReason: mapStopReason(choice?.finish_reason ?? null, toolCalls.length > 0),
      toolCalls,
    };
  }

  async callForcedTool(p: ForcedToolParams): Promise<unknown> {
    const messages = toOpenAIMessages(p.system, p.messages);
    const response = await this.client.chat.completions.create(
      {
        model: p.model,
        max_completion_tokens: p.maxTokens,
        tools: toOpenAITools([p.tool]),
        tool_choice: { type: "function", function: { name: p.tool.name } },
        messages,
      },
      p.signal ? { signal: p.signal } : undefined,
    );
    const call = response.choices[0]?.message?.tool_calls?.[0];
    if (!call || call.type !== "function" || call.function.name !== p.tool.name) {
      throw new Error(`Model did not return a ${p.tool.name} tool call`);
    }
    return safeParseJson(call.function.arguments);
  }
}

function safeParseJson(s: string): unknown {
  if (!s || !s.trim()) return {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

function textFromOpenAIContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (
        part &&
        typeof part === "object" &&
        "text" in part &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        return (part as { text: string }).text;
      }
      return "";
    })
    .join("");
}

function mapStopReason(
  reason: string | null,
  hadToolCalls: boolean,
): StreamTurnResult["stopReason"] {
  if (reason === "tool_calls" || (hadToolCalls && reason !== "length")) return "tool_use";
  if (reason === "length") return "max_tokens";
  if (reason === "stop") return "end_turn";
  return hadToolCalls ? "tool_use" : "end_turn";
}

function toOpenAITools(tools: Anthropic.Tool[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema as Record<string, unknown>,
    },
  }));
}

/**
 * Build a map from tool_use id → tool name across the assistant history so we
 * can label tool messages. OpenAI doesn't need the name on tool messages, but
 * we keep this symmetrical with the Gemini adapter.
 */
function toOpenAIMessages(
  system: string,
  messages: Anthropic.MessageParam[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: system },
  ];

  for (const msg of messages) {
    if (msg.role === "assistant") {
      out.push(assistantToOpenAI(msg.content));
      continue;
    }
    // role === "user": may be a real user turn or a batch of tool_results.
    if (typeof msg.content === "string") {
      out.push({ role: "user", content: msg.content });
      continue;
    }
    const userParts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
    // Images found inside tool_results — the `tool` role can't carry images,
    // so we forward them on a trailing user message (the model still sees them).
    const toolImageUrls: string[] = [];
    for (const block of msg.content) {
      if (block.type === "tool_result") {
        const { text, images } = splitToolResult(block);
        out.push({ role: "tool", tool_call_id: block.tool_use_id, content: text });
        toolImageUrls.push(...images);
      } else if (block.type === "text") {
        userParts.push({ type: "text", text: block.text });
      } else if (block.type === "image") {
        const url = imageBlockToDataUrl(block);
        if (url) userParts.push({ type: "image_url", image_url: { url } });
      }
    }
    if (toolImageUrls.length > 0) {
      const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
        { type: "text", text: "Image output from the preceding tool call(s):" },
        ...toolImageUrls.map(
          (url): OpenAI.Chat.Completions.ChatCompletionContentPart => ({
            type: "image_url",
            image_url: { url },
          }),
        ),
      ];
      out.push({ role: "user", content: parts });
    }
    if (userParts.length > 0) out.push({ role: "user", content: userParts });
  }
  return out;
}

function assistantToOpenAI(
  content: Anthropic.MessageParam["content"],
): OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam {
  if (typeof content === "string") return { role: "assistant", content };
  let text = "";
  const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = [];
  for (const block of content) {
    if (block.type === "text") text += block.text;
    else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
      });
    }
  }
  const msg: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
    role: "assistant",
    content: text || null,
  };
  if (toolCalls.length > 0) msg.tool_calls = toolCalls;
  return msg;
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
