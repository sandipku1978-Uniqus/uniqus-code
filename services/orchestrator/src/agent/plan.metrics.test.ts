import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Sandbox } from "./sandbox.js";

const fakeProvider = vi.hoisted(() => ({
  provider: "anthropic" as const,
  streamAgentTurn: vi.fn(),
  callForcedTool: vi.fn(),
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

import { proposePlan } from "./plan.js";
import { createRunMetrics } from "../telemetry/runMetrics.js";

describe("proposePlan run metrics", () => {
  beforeEach(() => {
    fakeProvider.streamAgentTurn.mockReset();
    fakeProvider.callForcedTool.mockReset();
  });

  it("records model identity, TTFT, usage, iteration and context without prompt payloads", async () => {
    fakeProvider.streamAgentTurn.mockImplementation(async (params) => {
      params.onText?.("Planning");
      params.onUsage?.({
        inputTokens: 40,
        outputTokens: 6,
        cacheReadTokens: 10,
        cacheCreationTokens: 2,
      });
      return {
        content: [
          {
            type: "tool_use",
            id: "plan-1",
            name: "submit_plan",
            input: { summary: "Implement it", steps: [{ description: "Make the change" }] },
          },
        ],
        stopReason: "tool_use",
        toolCalls: [
          {
            id: "plan-1",
            name: "submit_plan",
            input: { summary: "Implement it", steps: [{ description: "Make the change" }] },
          },
        ],
        usage: {
          inputTokens: 40,
          outputTokens: 6,
          cacheReadTokens: 10,
          cacheCreationTokens: 2,
        },
      };
    });

    const metrics = createRunMetrics({ mode: "plan" });
    const plan = await proposePlan("Inspect and plan this change", {
      apiKey: "test-key",
      providerKeys: { anthropic: "test-key" },
      sandbox: {} as Sandbox,
      modelChoice: "anthropic:claude-sonnet-4-6",
      metrics,
    });
    const snapshot = metrics.snapshot();

    expect(plan.summary).toBe("Implement it");
    expect(snapshot.dimensions).toMatchObject({
      mode: "plan",
      provider: "anthropic",
      modelBucket: "claude_sonnet",
      routeTier: "manual",
      routeSource: "manual",
    });
    expect(snapshot.durations.providerTtftSamples).toBe(1);
    expect(snapshot.counters).toMatchObject({
      iterationCount: 1,
      modelCallCount: 1,
      freshInputTokens: 40,
      outputTokens: 6,
      cacheReadTokens: 10,
      cacheCreationTokens: 2,
      cacheHitCallCount: 1,
    });
    expect(snapshot.counters.peakSystemPromptChars).toBeGreaterThan(0);
    expect(snapshot.counters.peakToolSchemaChars).toBeGreaterThan(0);
    expect(snapshot.counters.peakEstimatedContextTokens).toBeGreaterThan(0);
    expect(JSON.stringify(snapshot)).not.toContain("Inspect and plan this change");
  });

  it("records upstream read truncation even when rendered text is under the loop cap", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "uniqus-plan-metrics-"));
    await writeFile(
      path.join(rootDir, "large.txt"),
      `HEAD\n${"x".repeat(40 * 1024)}\nTAIL`,
      "utf-8",
    );
    const usage = {
      inputTokens: 10,
      outputTokens: 2,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    };
    fakeProvider.streamAgentTurn
      .mockResolvedValueOnce({
        content: [
          { type: "tool_use", id: "read-1", name: "read_file", input: { path: "large.txt" } },
        ],
        stopReason: "tool_use",
        toolCalls: [{ id: "read-1", name: "read_file", input: { path: "large.txt" } }],
        usage,
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: "tool_use",
            id: "plan-2",
            name: "submit_plan",
            input: { summary: "Done", steps: [{ description: "Use the evidence" }] },
          },
        ],
        stopReason: "tool_use",
        toolCalls: [
          {
            id: "plan-2",
            name: "submit_plan",
            input: { summary: "Done", steps: [{ description: "Use the evidence" }] },
          },
        ],
        usage,
      });

    try {
      const metrics = createRunMetrics({ mode: "plan" });
      await proposePlan("Inspect the large file", {
        apiKey: "test-key",
        providerKeys: { anthropic: "test-key" },
        sandbox: { rootDir },
        modelChoice: "anthropic:claude-sonnet-4-6",
        metrics,
      });

      expect(metrics.snapshot().counters).toMatchObject({
        toolCallCount: 1,
        toolResultTruncatedCount: 1,
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("records a billed forced call even when forced-tool validation rejects its output", async () => {
    const investigationUsage = {
      inputTokens: 20,
      outputTokens: 3,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    };
    const forcedUsage = {
      inputTokens: 31,
      outputTokens: 7,
      cacheReadTokens: 5,
      cacheCreationTokens: 1,
    };
    fakeProvider.streamAgentTurn.mockResolvedValueOnce({
      content: [{ type: "text", text: "I have enough context." }],
      stopReason: "end_turn",
      toolCalls: [],
      usage: investigationUsage,
    });
    fakeProvider.callForcedTool.mockImplementationOnce(async (params) => {
      // Provider adapters receive usage with the billed response before they
      // validate that it contains the required submit_plan call.
      params.onUsage?.(forcedUsage);
      throw new Error("Model did not return a submit_plan tool call");
    });
    const onUsage = vi.fn();
    const metrics = createRunMetrics({ mode: "plan" });

    await expect(
      proposePlan("Inspect and plan this malformed response case", {
        apiKey: "test-key",
        providerKeys: { anthropic: "test-key" },
        sandbox: {} as Sandbox,
        modelChoice: "anthropic:claude-sonnet-4-6",
        metrics,
        onUsage,
      }),
    ).rejects.toThrow("Model did not return a submit_plan tool call");

    expect(onUsage).toHaveBeenCalledTimes(2);
    expect(onUsage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        ...forcedUsage,
        model: "claude-sonnet-4-6",
        provider: "anthropic",
      }),
    );
    expect(metrics.snapshot().counters).toMatchObject({
      modelCallCount: 2,
      providerErrorCount: 1,
      freshInputTokens: 51,
      outputTokens: 10,
      cacheReadTokens: 5,
      cacheCreationTokens: 1,
    });
  });
});
