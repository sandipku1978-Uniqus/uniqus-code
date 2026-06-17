import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  safeParseJson,
  toResponsesInput,
  toResponsesTools,
  toTokenUsage,
} from "./openai.js";
import {
  mapStopReason,
  sanitizeSchema,
  thinkingConfigFor,
  toGeminiContents,
  toGeminiFunctionDeclarations,
} from "./google.js";

// These tests pin the canonical (Anthropic-shaped) ↔ provider-shape message and
// tool conversions. They run purely on the helper functions — no SDK client, no
// network — so they stay deterministic.

const TOOL: Anthropic.Tool = {
  name: "read_file",
  description: "Read a file",
  input_schema: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
    additionalProperties: false,
    $schema: "http://json-schema.org/draft-07/schema#",
  },
};

// =============================================================================
// OpenAI (Responses API) conversions
// =============================================================================

describe("openai · toResponsesTools", () => {
  it("maps Anthropic tools to Responses function tools", () => {
    const tools = toResponsesTools([TOOL], false);
    expect(tools).toHaveLength(1);
    const fn = tools[0] as Extract<(typeof tools)[number], { type: "function" }>;
    expect(fn.type).toBe("function");
    expect(fn.name).toBe("read_file");
    expect(fn.description).toBe("Read a file");
    expect(fn.parameters).toBe(TOOL.input_schema);
    expect(fn.strict).toBe(false);
  });

  it("prepends the built-in web_search tool when requested", () => {
    const tools = toResponsesTools([TOOL], true);
    expect(tools).toHaveLength(2);
    expect(tools[0]).toEqual({ type: "web_search" });
    expect((tools[1] as { type: string }).type).toBe("function");
  });

  it("omits web_search for forced-tool (plan) calls", () => {
    const tools = toResponsesTools([TOOL], false);
    expect(tools.some((t) => (t as { type: string }).type === "web_search")).toBe(
      false,
    );
  });
});

describe("openai · toResponsesInput", () => {
  it("converts a basic text turn (user string → input message)", () => {
    const input = toResponsesInput([{ role: "user", content: "hello world" }]);
    expect(input).toEqual([{ role: "user", content: "hello world" }]);
  });

  it("converts an assistant text turn to an assistant message", () => {
    const input = toResponsesInput([
      { role: "assistant", content: [{ type: "text", text: "hi there" }] },
    ]);
    expect(input).toEqual([{ role: "assistant", content: "hi there" }]);
  });

  it("round-trips a tool_use → tool_result exchange", () => {
    const messages: Anthropic.MessageParam[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "let me read it" },
          {
            type: "tool_use",
            id: "call_1",
            name: "read_file",
            input: { path: "a.txt" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "call_1",
            content: "file contents",
          },
        ],
      },
    ];

    const input = toResponsesInput(messages);

    // assistant text → message; tool_use → top-level function_call; tool_result
    // → function_call_output, all keyed by the same call_id.
    expect(input).toEqual([
      { role: "assistant", content: "let me read it" },
      {
        type: "function_call",
        call_id: "call_1",
        name: "read_file",
        arguments: JSON.stringify({ path: "a.txt" }),
      },
      {
        type: "function_call_output",
        call_id: "call_1",
        output: "file contents",
      },
    ]);
  });

  it("replays an encrypted reasoning item immediately before its function_call", () => {
    const block = {
      type: "tool_use",
      id: "call_2",
      name: "read_file",
      input: { path: "b.txt" },
      openai_reasoning: { id: "rs_1", encrypted: "ENC" },
    } as unknown as Anthropic.ContentBlockParam;

    const input = toResponsesInput([{ role: "assistant", content: [block] }]);

    expect(input).toEqual([
      { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "ENC" },
      {
        type: "function_call",
        call_id: "call_2",
        name: "read_file",
        arguments: JSON.stringify({ path: "b.txt" }),
      },
    ]);
  });

  it("forwards tool_result images on a trailing user message", () => {
    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "call_3",
            content: [
              { type: "text", text: "took a screenshot" },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: "AAAA",
                },
              },
            ],
          },
        ],
      },
    ];

    const input = toResponsesInput(messages);

    expect(input[0]).toEqual({
      type: "function_call_output",
      call_id: "call_3",
      output: "took a screenshot",
    });
    // The image rides on a trailing user message as an input_image part.
    const trailing = input[1] as {
      role: string;
      content: Array<{ type: string; image_url?: string }>;
    };
    expect(trailing.role).toBe("user");
    expect(trailing.content[1]).toMatchObject({
      type: "input_image",
      image_url: "data:image/png;base64,AAAA",
    });
  });
});

describe("openai · toTokenUsage", () => {
  it("subtracts the cached subset from the total input tokens", () => {
    const usage = toTokenUsage({
      input_tokens: 1000,
      output_tokens: 200,
      input_tokens_details: { cached_tokens: 750 },
    } as Parameters<typeof toTokenUsage>[0]);

    expect(usage).toEqual({
      inputTokens: 250,
      outputTokens: 200,
      cacheReadTokens: 750,
      cacheCreationTokens: 0,
    });
  });

  it("floors fresh input tokens at zero and treats missing details as no cache", () => {
    const usage = toTokenUsage({
      input_tokens: 0,
      output_tokens: 10,
    } as Parameters<typeof toTokenUsage>[0]);

    expect(usage.inputTokens).toBe(0);
    expect(usage.cacheReadTokens).toBe(0);
    expect(usage.cacheCreationTokens).toBe(0);
  });
});

describe("openai · safeParseJson", () => {
  it("parses valid JSON arguments", () => {
    expect(safeParseJson('{"path":"a.txt"}')).toEqual({ path: "a.txt" });
  });

  it("returns an empty object for empty/whitespace input", () => {
    expect(safeParseJson("")).toEqual({});
    expect(safeParseJson("   ")).toEqual({});
  });

  it("returns an empty object (not a throw) for truncated/invalid JSON", () => {
    expect(safeParseJson('{"path":"a.t')).toEqual({});
  });
});

// =============================================================================
// Google (Gemini) conversions
// =============================================================================

describe("google · toGeminiFunctionDeclarations", () => {
  it("maps Anthropic tools to function declarations and sanitizes the schema", () => {
    const decls = toGeminiFunctionDeclarations([TOOL]);
    expect(decls).toHaveLength(1);
    expect(decls[0].name).toBe("read_file");
    expect(decls[0].description).toBe("Read a file");
    // sanitizeSchema strips $schema and additionalProperties.
    const schema = decls[0].parametersJsonSchema as Record<string, unknown>;
    expect(schema.$schema).toBeUndefined();
    expect(schema.additionalProperties).toBeUndefined();
    expect(schema.type).toBe("object");
    expect((schema.properties as Record<string, unknown>).path).toEqual({
      type: "string",
    });
  });
});

describe("google · sanitizeSchema", () => {
  it("recursively strips $schema and additionalProperties", () => {
    const cleaned = sanitizeSchema({
      type: "object",
      additionalProperties: false,
      $schema: "x",
      properties: {
        nested: { type: "object", additionalProperties: true, $schema: "y" },
      },
    }) as Record<string, unknown>;

    expect(cleaned.additionalProperties).toBeUndefined();
    expect(cleaned.$schema).toBeUndefined();
    const nested = (cleaned.properties as Record<string, Record<string, unknown>>)
      .nested;
    expect(nested.additionalProperties).toBeUndefined();
    expect(nested.$schema).toBeUndefined();
    expect(nested.type).toBe("object");
  });

  it("passes primitives and arrays through", () => {
    expect(sanitizeSchema("hi")).toBe("hi");
    expect(sanitizeSchema([{ $schema: "x", k: 1 }])).toEqual([{ k: 1 }]);
  });
});

describe("google · toGeminiContents", () => {
  it("converts a basic text turn", () => {
    const contents = toGeminiContents([{ role: "user", content: "hello" }]);
    expect(contents).toEqual([{ role: "user", parts: [{ text: "hello" }] }]);
  });

  it("uses the 'model' role for assistant turns", () => {
    const contents = toGeminiContents([
      { role: "assistant", content: [{ type: "text", text: "hi" }] },
    ]);
    expect(contents).toEqual([{ role: "model", parts: [{ text: "hi" }] }]);
  });

  it("round-trips a tool_use → tool_result, matching the response by function name", () => {
    const messages: Anthropic.MessageParam[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "call_1",
            name: "read_file",
            input: { path: "a.txt" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "call_1",
            content: "file contents",
          },
        ],
      },
    ];

    const contents = toGeminiContents(messages);

    expect(contents).toEqual([
      {
        role: "model",
        parts: [{ functionCall: { name: "read_file", args: { path: "a.txt" } } }],
      },
      {
        role: "user",
        parts: [
          {
            // The call id is echoed on the response when it pairs with a real
            // (non-synthetic) functionCall in this history (C-89).
            functionResponse: {
              name: "read_file",
              id: "call_1",
              response: { result: "file contents" },
            },
          },
        ],
      },
    ]);
  });

  it("preserves a Gemini thought signature on the function-call part", () => {
    const block = {
      type: "tool_use",
      id: "call_1",
      name: "read_file",
      input: { path: "a.txt" },
      thought_signature: "SIG",
    } as unknown as Anthropic.ContentBlockParam;

    const contents = toGeminiContents([{ role: "assistant", content: [block] }]);
    const part = (contents[0].parts as Array<Record<string, unknown>>)[0];
    expect(part.thoughtSignature).toBe("SIG");
    expect(part.functionCall).toEqual({
      name: "read_file",
      args: { path: "a.txt" },
    });
  });

  it("falls back to 'unknown_tool' when a tool_result has no matching call", () => {
    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "orphan", content: "result" },
        ],
      },
    ];
    const contents = toGeminiContents(messages);
    const part = (contents[0].parts as Array<Record<string, unknown>>)[0];
    // No matching call ⇒ no id echoed (C-89: only real, matched ids are echoed).
    expect(part.functionResponse).toEqual({
      name: "unknown_tool",
      response: { result: "result" },
    });
  });

  it("does NOT echo a synthetic (gem_) tool id on the functionResponse (C-89)", () => {
    const messages: Anthropic.MessageParam[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "gem_ab12cd34_0",
            name: "read_file",
            input: { path: "a.txt" },
          },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "gem_ab12cd34_0", content: "x" },
        ],
      },
    ];
    const contents = toGeminiContents(messages);
    const part = (contents[1].parts as Array<Record<string, unknown>>)[0];
    // Matched, but synthetic ⇒ omit id; Gemini pairs by name/order instead.
    expect(part.functionResponse).toEqual({
      name: "read_file",
      response: { result: "x" },
    });
  });

  it("forwards a base64 tool_result image as an inlineData part", () => {
    const messages: Anthropic.MessageParam[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "call_1",
            name: "screenshot",
            input: {},
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "call_1",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: "image/png", data: "ZZZ" },
              },
            ],
          },
        ],
      },
    ];

    const contents = toGeminiContents(messages);
    const parts = contents[1].parts as Array<Record<string, unknown>>;
    // functionResponse first, then the inlineData image.
    expect(parts[0]).toHaveProperty("functionResponse");
    expect(parts[1]).toEqual({
      inlineData: { mimeType: "image/png", data: "ZZZ" },
    });
  });
});

describe("google · mapStopReason", () => {
  it("returns tool_use whenever there were tool calls, regardless of finishReason", () => {
    expect(mapStopReason("STOP", true)).toBe("tool_use");
    expect(mapStopReason(undefined, true)).toBe("tool_use");
  });

  it("maps MAX_TOKENS to max_tokens", () => {
    expect(mapStopReason("MAX_TOKENS", false)).toBe("max_tokens");
  });

  it("defaults to end_turn", () => {
    expect(mapStopReason("STOP", false)).toBe("end_turn");
    expect(mapStopReason(undefined, false)).toBe("end_turn");
  });
});

describe("google · thinkingConfigFor", () => {
  // Regression for the empty-/one-word-answer bug: Gemini 3.x's thinkingLevel
  // is an UPPERCASE enum on the wire. A lowercase value is silently dropped and
  // the model falls back to its empty-prone HIGH default, so these MUST be
  // uppercase — never our lowercase ThinkingEffort.
  it("maps 3.x effort to the UPPERCASE thinkingLevel enum", () => {
    expect(thinkingConfigFor("gemini-3.5-flash", "low")).toEqual({
      includeThoughts: true,
      thinkingLevel: "LOW",
    });
    expect(thinkingConfigFor("gemini-3.1-pro-preview-customtools", "medium")).toEqual({
      includeThoughts: true,
      thinkingLevel: "MEDIUM",
    });
    expect(thinkingConfigFor("gemini-3.5-flash", "high")).toEqual({
      includeThoughts: true,
      thinkingLevel: "HIGH",
    });
  });

  it("defaults 3.x to MEDIUM (never the empty-prone HIGH default) when no effort is set", () => {
    expect(thinkingConfigFor("gemini-3.5-flash", undefined)).toEqual({
      includeThoughts: true,
      thinkingLevel: "MEDIUM",
    });
  });

  it("uses a token budget for 2.5, and the provider default when no effort is set", () => {
    expect(thinkingConfigFor("gemini-2.5-pro", "medium")).toEqual({
      includeThoughts: true,
      thinkingBudget: 8192,
    });
    expect(thinkingConfigFor("gemini-2.5-pro", undefined)).toBeUndefined();
  });
});

describe("google · text thought signature round-trip", () => {
  it("re-attaches a thought signature captured on an assistant TEXT block", () => {
    const block = {
      type: "text",
      text: "All done.",
      thought_signature: "TXTSIG",
    } as unknown as Anthropic.ContentBlockParam;

    const contents = toGeminiContents([{ role: "assistant", content: [block] }]);
    const part = (contents[0].parts as Array<Record<string, unknown>>)[0];
    expect(part).toEqual({ text: "All done.", thoughtSignature: "TXTSIG" });
  });

  it("omits thoughtSignature on a plain text block that has none", () => {
    const contents = toGeminiContents([
      { role: "assistant", content: [{ type: "text", text: "hi" }] },
    ]);
    const part = (contents[0].parts as Array<Record<string, unknown>>)[0];
    expect(part).toEqual({ text: "hi" });
    expect("thoughtSignature" in part).toBe(false);
  });
});
