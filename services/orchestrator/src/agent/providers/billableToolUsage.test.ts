import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import {
  AnthropicAdapter,
  anthropicWebSearchBillableUsage,
} from "./anthropic.js";
import {
  collectGeminiWebSearchQueries,
  GoogleAdapter,
  geminiWebSearchBillableUsage,
  mergeGeminiWebSearchQueries,
} from "./google.js";
import {
  OpenAIAdapter,
  openAIWebSearchBillableUsage,
  toResponsesTools,
} from "./openai.js";
import { ZaiAdapter, zaiWebSearchBillableUsage, toChatTools } from "./zai.js";
import { webSearchToolForModel } from "../tools.js";

describe("provider-side web-search billing", () => {
  it("keeps platform search either request-bounded or completely absent", () => {
    expect(webSearchToolForModel("claude-sonnet-4-6")).toMatchObject({
      name: "web_search",
      max_uses: 10,
    });
    expect(toResponsesTools([], false)).toEqual([]);
    expect(toChatTools([], false)).toEqual([]);
  });

  it("uses Anthropic's authoritative server-tool request count", () => {
    expect(
      anthropicWebSearchBillableUsage({
        server_tool_use: { web_search_requests: 2 },
      }),
    ).toEqual({
      kind: "web_search",
      units: 2,
      costUsd: 0.02,
      accuracy: "exact",
    });
    expect(
      anthropicWebSearchBillableUsage({
        server_tool_use: { web_search_requests: 0 },
      }),
    ).toBeUndefined();
    expect(anthropicWebSearchBillableUsage({ server_tool_use: null })).toBeUndefined();
  });

  it("counts unique OpenAI done search actions without filtering failed status", () => {
    const items = [
      {
        id: "ws_1",
        type: "web_search_call",
        status: "failed",
        action: { type: "search", queries: ["one"] },
      },
      {
        // A duplicate done event must not double-charge.
        id: "ws_1",
        type: "web_search_call",
        status: "completed",
        action: { type: "search", queries: ["one"] },
      },
      {
        id: "ws_2",
        type: "web_search_call",
        status: "completed",
        action: { type: "search", queries: ["two"] },
      },
      {
        // Navigation inside already-returned search results is not a new search.
        id: "ws_3",
        type: "web_search_call",
        status: "completed",
        action: { type: "open_page", url: "https://example.com" },
      },
    ] as OpenAI.Responses.ResponseFunctionWebSearch[];

    expect(openAIWebSearchBillableUsage(items)).toEqual({
      kind: "web_search",
      units: 2,
      costUsd: 0.02,
      accuracy: "exact",
    });
  });

  it("de-duplicates Gemini representations while retaining repeated executions", () => {
    const executedQueries: string[] = [];
    const groundingQueries: string[] = [];
    collectGeminiWebSearchQueries(executedQueries, [" alpha ", "", "beta", "alpha", 42]);
    mergeGeminiWebSearchQueries(groundingQueries, ["alpha", "beta", "alpha"]);
    // A repeated cumulative metadata chunk must not add three more searches.
    mergeGeminiWebSearchQueries(groundingQueries, ["alpha", "beta", "alpha"]);

    expect(executedQueries).toEqual(["alpha", "beta", "alpha"]);
    expect([...groundingQueries].sort()).toEqual(["alpha", "alpha", "beta"]);
    const usage = geminiWebSearchBillableUsage({ executedQueries, groundingQueries });
    expect(usage).toMatchObject({
      kind: "web_search",
      units: 3,
      accuracy: "estimated",
    });
    expect(usage?.costUsd).toBeCloseTo(0.042);
    expect(
      geminiWebSearchBillableUsage({ executedQueries: [], groundingQueries: [] }),
    ).toBeUndefined();
  });

  it("counts a non-empty Z.ai result array as one use, never one per result", () => {
    expect(zaiWebSearchBillableUsage([])).toBeUndefined();
    expect(zaiWebSearchBillableUsage([{ link: "one" }, { link: "two" }])).toEqual({
      kind: "web_search",
      units: 1,
      costUsd: 0.01,
      accuracy: "estimated",
    });
  });
});

describe("provider adapters emit cumulative search usage once", () => {
  it("emits Anthropic's final authoritative usage", async () => {
    const adapter = new AnthropicAdapter("test");
    const stream = {
      on: vi.fn(),
      finalMessage: vi.fn(async () => ({
        content: [],
        stop_reason: "end_turn",
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          server_tool_use: { web_fetch_requests: 0, web_search_requests: 2 },
        },
      })),
    };
    Object.assign(adapter as object, {
      client: { messages: { stream: vi.fn(() => stream) } },
    });
    const onBillableToolUsage = vi.fn();

    await adapter.streamAgentTurn({
      model: "claude-sonnet-4-6",
      system: "",
      tools: [],
      messages: [],
      maxTokens: 32,
      onBillableToolUsage,
    });

    expect(onBillableToolUsage).toHaveBeenCalledTimes(1);
    expect(onBillableToolUsage).toHaveBeenCalledWith({
      kind: "web_search",
      units: 2,
      costUsd: 0.02,
      accuracy: "exact",
    });
  });

  it("emits OpenAI done search IDs as one cumulative total", async () => {
    const adapter = new OpenAIAdapter("test");
    async function* events() {
      for (const id of ["ws_1", "ws_1", "ws_2"]) {
        yield {
          type: "response.output_item.done",
          output_index: 0,
          sequence_number: 0,
          item: {
            id,
            type: "web_search_call",
            status: "failed",
            action: { type: "search", queries: [id] },
          },
        };
      }
    }
    Object.assign(adapter as object, {
      client: { responses: { create: vi.fn(async () => events()) } },
    });
    const onBillableToolUsage = vi.fn();

    await adapter.streamAgentTurn({
      model: "gpt-5.5",
      system: "",
      tools: [],
      messages: [],
      maxTokens: 32,
      onBillableToolUsage,
    });

    expect(onBillableToolUsage).toHaveBeenCalledTimes(1);
    expect(onBillableToolUsage).toHaveBeenCalledWith({
      kind: "web_search",
      units: 2,
      costUsd: 0.02,
      accuracy: "exact",
    });
  });

  it("emits Gemini's union of tool-call and grounding queries", async () => {
    const adapter = new GoogleAdapter("test");
    async function* chunks() {
      yield {
        candidates: [
          {
            content: {
              parts: [
                {
                  toolCall: {
                    toolType: "GOOGLE_SEARCH_WEB",
                    args: { queries: [" alpha ", "beta"] },
                  },
                },
              ],
            },
            groundingMetadata: { webSearchQueries: ["beta", "gamma"] },
          },
        ],
      };
    }
    Object.assign(adapter as object, {
      ai: { models: { generateContentStream: vi.fn(async () => chunks()) } },
    });
    const onBillableToolUsage = vi.fn();

    await adapter.streamAgentTurn({
      model: "gemini-3.5-flash",
      system: "",
      tools: [],
      messages: [],
      maxTokens: 32,
      onBillableToolUsage,
    });

    expect(onBillableToolUsage).toHaveBeenCalledTimes(1);
    expect(onBillableToolUsage.mock.calls[0]?.[0]).toMatchObject({
      kind: "web_search",
      units: 3,
      accuracy: "estimated",
    });
    expect(onBillableToolUsage.mock.calls[0]?.[0].costUsd).toBeCloseTo(0.042);
  });

  it("reports authoritative OpenAI usage before a failed response throws", async () => {
    const adapter = new OpenAIAdapter("test");
    async function* events() {
      yield {
        type: "response.failed",
        sequence_number: 0,
        response: {
          id: "resp_failed",
          error: { code: "server_error", message: "failed after billing" },
          usage: {
            input_tokens: 120,
            input_tokens_details: { cached_tokens: 20, cache_write_tokens: 0 },
            output_tokens: 7,
            output_tokens_details: { reasoning_tokens: 0 },
            total_tokens: 127,
          },
        },
      };
    }
    Object.assign(adapter as object, {
      client: { responses: { create: vi.fn(async () => events()) } },
    });
    const onUsage = vi.fn();

    await expect(
      adapter.streamAgentTurn({
        model: "gpt-5.5",
        system: "",
        tools: [],
        messages: [],
        maxTokens: 32,
        onUsage,
      }),
    ).rejects.toThrow("failed after billing");
    expect(onUsage).toHaveBeenCalledWith({
      inputTokens: 100,
      outputTokens: 7,
      cacheReadTokens: 20,
      cacheCreationTokens: 0,
    });
  });

  it("emits one estimated Z.ai use for any non-empty result array", async () => {
    const adapter = new ZaiAdapter("test");
    async function* chunks() {
      yield {
        web_search: [{ link: "one" }, { link: "two" }],
        choices: [],
      };
    }
    Object.assign(adapter as object, {
      client: { chat: { completions: { create: vi.fn(async () => chunks()) } } },
    });
    const onBillableToolUsage = vi.fn();

    await adapter.streamAgentTurn({
      model: "glm-5.2",
      system: "",
      tools: [],
      messages: [],
      maxTokens: 32,
      onBillableToolUsage,
    });

    expect(onBillableToolUsage).toHaveBeenCalledTimes(1);
    expect(onBillableToolUsage).toHaveBeenCalledWith({
      kind: "web_search",
      units: 1,
      costUsd: 0.01,
      accuracy: "estimated",
    });
  });
});
