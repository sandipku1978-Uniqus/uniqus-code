import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { estimateTurnCostUsd } from "@gate15/api-types";

const fakeProvider = vi.hoisted(() => ({
  provider: "anthropic" as const,
  streamAgentTurn: vi.fn(),
}));

vi.mock("./providers/index.js", async () => {
  const actual = await vi.importActual<typeof import("./providers/index.js")>(
    "./providers/index.js",
  );
  return {
    ...actual,
    getProvider: () => fakeProvider,
  };
});

import {
  compactionBudgetPreservingAnswer,
  PLATFORM_MIN_ANSWER_TOKENS,
  PLATFORM_PROVIDER_TOOL_RESERVE_USD,
  runAgentLoop,
} from "./loop.js";
import { conservativeRequestCostUsd } from "./compact.js";

describe("agent-loop platform billing boundaries", () => {
  let rootDir: string;

  beforeEach(async () => {
    fakeProvider.streamAgentTurn.mockReset();
    rootDir = await mkdtemp(path.join(os.tmpdir(), "gate15-loop-billing-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  async function abortedRun(
    source: "platform" | "account",
    reportUsage: boolean,
  ) {
    const controller = new AbortController();
    fakeProvider.streamAgentTurn.mockImplementationOnce(async (params) => {
      if (reportUsage) {
        params.onUsage?.({
          inputTokens: 25,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        });
      }
      controller.abort();
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    });

    return await runAgentLoop("Make a small change", {
      sandbox: { rootDir },
      apiKey: "test-key",
      providerKeys: { anthropic: "test-key" },
      providerKeySources: { anthropic: source },
      platformBudgetUsd: 5,
      modelChoice: "anthropic:claude-sonnet-4-6",
      messages: [],
      signal: controller.signal,
      getPermissionMode: () => "bypass",
    });
  }

  it("retains escrow when a platform request aborts before authoritative usage", async () => {
    const result = await abortedRun("platform", false);

    expect(result.aborted).toBe(true);
    expect(result.unknownPlatformSpend).toBe(true);
  });

  it("settles exact usage after a platform receipt and never retains escrow for account keys", async () => {
    const metered = await abortedRun("platform", true);
    expect(metered.unknownPlatformSpend).toBeUndefined();
    expect(metered.usage.inputTokens).toBe(25);

    const accountFunded = await abortedRun("account", false);
    expect(accountFunded.unknownPlatformSpend).toBeUndefined();
  });

  it("prices each long-context provider request independently", async () => {
    const receipt = {
      inputTokens: 150_000,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    };
    fakeProvider.streamAgentTurn
      .mockResolvedValueOnce({
        content: [
          { type: "tool_use", id: "tool-1", name: "list_dir", input: { path: "." } },
        ],
        toolCalls: [{ id: "tool-1", name: "list_dir", input: { path: "." } }],
        usage: receipt,
        stopReason: "tool_use",
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "Done." }],
        toolCalls: [],
        usage: receipt,
        stopReason: "end_turn",
      });

    const result = await runAgentLoop("Inspect the project", {
      sandbox: { rootDir },
      apiKey: "test-key",
      providerKeys: { openai: "test-key" },
      providerKeySources: { openai: "platform" },
      platformBudgetUsd: 10,
      modelChoice: "openai:gpt-5.6-sol",
      messages: [],
      getPermissionMode: () => "bypass",
    });

    const expected = estimateTurnCostUsd("gpt-5.6-sol", receipt) * 2;
    const wronglyAggregated = estimateTurnCostUsd("gpt-5.6-sol", {
      ...receipt,
      inputTokens: receipt.inputTokens * 2,
      outputTokens: receipt.outputTokens * 2,
    });
    expect(result.leadCostUsd).toBeCloseTo(expected, 12);
    expect(result.platformCostUsd).toBeCloseTo(expected, 12);
    expect(result.leadCostUsd).toBeLessThan(wronglyAggregated);
    expect(fakeProvider.streamAgentTurn.mock.calls[0]?.[0].disableWebSearch).toBe(true);
    expect(fakeProvider.streamAgentTurn.mock.calls[1]?.[0].disableWebSearch).toBe(true);
  });

  it("quarantines a receipt-less tool turn, blocks the next platform call, and persists the stop", async () => {
    fakeProvider.streamAgentTurn.mockResolvedValueOnce({
      content: [
        { type: "tool_use", id: "tool-1", name: "list_dir", input: { path: "." } },
      ],
      toolCalls: [{ id: "tool-1", name: "list_dir", input: { path: "." } }],
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
      stopReason: "tool_use",
    });
    const persisted: Anthropic.MessageParam[] = [];

    const result = await runAgentLoop("Inspect the project", {
      sandbox: { rootDir },
      apiKey: "test-key",
      providerKeys: { anthropic: "test-key" },
      providerKeySources: { anthropic: "platform" },
      platformBudgetUsd: 5,
      modelChoice: "anthropic:claude-sonnet-4-6",
      messages: [],
      collectMessages: persisted,
      getPermissionMode: () => "bypass",
    });

    expect(fakeProvider.streamAgentTurn).toHaveBeenCalledTimes(1);
    expect(fakeProvider.streamAgentTurn.mock.calls[0]?.[0].disableWebSearch).toBe(false);
    expect(result.unknownPlatformSpend).toBe(true);
    expect(result.executionLimit).toBe("credits");
    expect(JSON.stringify(persisted)).toContain("Platform usage credits reached their safe limit");
  });

  it.each(["success", "rejection"] as const)(
    "quarantines a %s plan outcome whose platform spend has no receipt",
    async (outcome) => {
      fakeProvider.streamAgentTurn.mockResolvedValueOnce({
        content: [
          {
            type: "tool_use",
            id: "plan-1",
            name: "enter_plan_mode",
            input: { reason: "This needs a careful plan" },
          },
        ],
        toolCalls: [
          {
            id: "plan-1",
            name: "enter_plan_mode",
            input: { reason: "This needs a careful plan" },
          },
        ],
        usage: {
          inputTokens: 20,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        },
        stopReason: "tool_use",
      });
      const persisted: Anthropic.MessageParam[] = [];

      const result = await runAgentLoop("Implement the feature", {
        sandbox: { rootDir },
        apiKey: "test-key",
        providerKeys: { anthropic: "test-key" },
        providerKeySources: { anthropic: "platform" },
        platformBudgetUsd: 5,
        modelChoice: "anthropic:claude-sonnet-4-6",
        messages: [],
        collectMessages: persisted,
        requestPlan: async () => {
          if (outcome === "success") {
            return {
              text: "1. Implement it",
              platformCostUsd: 0,
              unknownPlatformSpend: true,
            };
          }
          throw Object.assign(new Error("plan approval rejected"), {
            platformCostUsd: 0,
            unknownPlatformSpend: true,
          });
        },
        getPermissionMode: () => "bypass",
      });

      expect(fakeProvider.streamAgentTurn).toHaveBeenCalledTimes(1);
      expect(result.unknownPlatformSpend).toBe(true);
      expect(result.executionLimit).toBe("credits");
      expect(JSON.stringify(persisted)).toContain(
        "Platform usage credits reached their safe limit",
      );
    },
  );

  it("continues an account-funded lead when the platform helper budget is zero", async () => {
    fakeProvider.streamAgentTurn.mockResolvedValueOnce({
      content: [{ type: "text", text: "Account-funded answer." }],
      toolCalls: [],
      usage: {
        inputTokens: 20,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
      stopReason: "end_turn",
    });

    const result = await runAgentLoop("Answer this", {
      sandbox: { rootDir },
      apiKey: "test-key",
      providerKeys: { anthropic: "test-key" },
      providerKeySources: { anthropic: "account" },
      platformBudgetUsd: 0,
      modelChoice: "anthropic:claude-sonnet-4-6",
      messages: [],
      getPermissionMode: () => "bypass",
    });

    expect(fakeProvider.streamAgentTurn).toHaveBeenCalledTimes(1);
    expect(result.executionLimit).toBeUndefined();
    expect(result.finalAnswerEmitted).toBe(true);
  });

  it("routes from the clean directive instead of inlined file contents", async () => {
    fakeProvider.streamAgentTurn.mockResolvedValueOnce({
      content: [{ type: "text", text: "Done." }],
      toolCalls: [],
      usage: {
        inputTokens: 20,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
      stopReason: "end_turn",
    });
    const onModelResolved = vi.fn();

    const result = await runAgentLoop(
      "Change the title text.\n\n@file contents: debug a subtle race condition",
      {
        sandbox: { rootDir },
        apiKey: "test-key",
        providerKeys: { anthropic: "test-key" },
        providerKeySources: { anthropic: "account" },
        modelChoice: "auto",
        routingUserMessage: "Change the title text",
        messages: [],
        onModelResolved,
        getPermissionMode: () => "bypass",
      },
    );

    expect(result.model).toBe("claude-sonnet-4-6");
    expect(onModelResolved).toHaveBeenCalledWith(
      expect.objectContaining({ tier: "quick", model: "claude-sonnet-4-6" }),
    );
  });

  it("fails closed before an env-pinned unpriced platform lead starts", async () => {
    const previous = process.env.UNIQUS_MODEL_AGENT;
    process.env.UNIQUS_MODEL_AGENT = "openai:future-unpriced-model";
    try {
      await expect(
        runAgentLoop("Answer this", {
          sandbox: { rootDir },
          apiKey: "test-key",
          providerKeys: { openai: "test-key" },
          providerKeySources: { openai: "platform" },
          platformBudgetUsd: 5,
          messages: [],
          getPermissionMode: () => "bypass",
        }),
      ).rejects.toThrow("has no explicit platform price");
      expect(fakeProvider.streamAgentTurn).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.UNIQUS_MODEL_AGENT;
      else process.env.UNIQUS_MODEL_AGENT = previous;
    }
  });

  it("leaves no compaction budget when 512 answer tokens would no longer fit", () => {
    const model = "claude-sonnet-4-6";
    const postCompactionInputTokenUpperBound = 25_000;
    const answerReserve =
      conservativeRequestCostUsd(
        model,
        postCompactionInputTokenUpperBound,
        PLATFORM_MIN_ANSWER_TOKENS,
      ) + PLATFORM_PROVIDER_TOOL_RESERVE_USD;

    expect(
      compactionBudgetPreservingAnswer({
        remainingUsd: answerReserve - 0.000001,
        leadModel: model,
        postCompactionInputTokenUpperBound,
        reserveSearch: true,
      }),
    ).toBe(0);
  });
});
