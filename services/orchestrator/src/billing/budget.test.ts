import { describe, expect, it } from "vitest";
import { estimateTurnCostUsd } from "@gate15/api-types";
import { conservativeRequestCostUsd } from "../agent/compact.js";
import {
  affordableOutputTokensForBudget,
  PLATFORM_PROVIDER_TOOL_RESERVE_USD,
} from "../agent/loop.js";
import { estimateImageGenerationCostUsd } from "../agent/imagegen.js";
import { affordableAnthropicOutputTokens } from "./anthropic.js";

describe("platform-funded run budget", () => {
  it("caps output so the conservative request estimate fits the wallet", () => {
    const budgetUsd = 0.3;
    const inputTokens = 2_000;
    const outputTokens = affordableOutputTokensForBudget({
      model: "claude-sonnet-4-6",
      estimatedInputTokens: inputTokens,
      budgetUsd,
      requestedOutputTokens: 16_000,
      reservedCostUsd: PLATFORM_PROVIDER_TOOL_RESERVE_USD,
    });

    expect(outputTokens).toBeGreaterThan(0);
    expect(outputTokens).toBeLessThan(16_000);
    expect(
      conservativeRequestCostUsd("claude-sonnet-4-6", inputTokens, outputTokens) +
        PLATFORM_PROVIDER_TOOL_RESERVE_USD,
    ).toBeLessThanOrEqual(budgetUsd);
    expect(
      conservativeRequestCostUsd("claude-sonnet-4-6", inputTokens, outputTokens + 1) +
        PLATFORM_PROVIDER_TOOL_RESERVE_USD,
    ).toBeGreaterThan(budgetUsd);
  });

  it("prices a cold Anthropic cache write above all-fresh input", () => {
    const inputTokens = 20_000;
    const outputTokens = 1_000;
    expect(
      conservativeRequestCostUsd("claude-sonnet-4-6", inputTokens, outputTokens),
    ).toBeGreaterThan(
      estimateTurnCostUsd("claude-sonnet-4-6", { inputTokens, outputTokens }),
    );
  });

  it("applies the same conservative envelope to one-shot Anthropic calls", () => {
    const budgetUsd = 0.1;
    const inputTokens = 2_000;
    const outputTokens = affordableAnthropicOutputTokens({
      call: {
        userId: "user-1",
        runId: "run-1",
        apiKey: "platform-key",
        platformFunded: true,
        platformBudgetUsd: budgetUsd,
        providerCallStarted: false,
        settled: false,
      },
      model: "claude-sonnet-4-6",
      estimatedInputTokens: inputTokens,
      requestedOutputTokens: 16_000,
    });

    expect(
      conservativeRequestCostUsd("claude-sonnet-4-6", inputTokens, outputTokens),
    ).toBeLessThanOrEqual(budgetUsd);
    expect(
      conservativeRequestCostUsd("claude-sonnet-4-6", inputTokens, outputTokens + 1),
    ).toBeGreaterThan(budgetUsd);
  });

  it("fails closed when a platform-funded helper model has no explicit price", () => {
    expect(() =>
      affordableAnthropicOutputTokens({
        call: {
          userId: "user-1",
          runId: "run-1",
          apiKey: "platform-key",
          platformFunded: true,
          platformBudgetUsd: 1,
          providerCallStarted: false,
          settled: false,
        },
        model: "unpriced-anthropic-model",
        estimatedInputTokens: 1,
        requestedOutputTokens: 32,
      }),
    ).toThrow("no explicit platform price");
  });

  it("allows an account-funded helper model without a platform price", () => {
    expect(
      affordableAnthropicOutputTokens({
        call: {
          userId: "user-1",
          runId: "run-1",
          apiKey: "personal-key",
          platformFunded: false,
          platformBudgetUsd: 0,
          providerCallStarted: false,
          settled: false,
        },
        model: "unpriced-anthropic-model",
        estimatedInputTokens: 1,
        requestedOutputTokens: 32,
      }),
    ).toBe(32);
  });

  it("refuses a request whose prompt alone exceeds the balance", () => {
    expect(
      affordableOutputTokensForBudget({
        model: "claude-sonnet-4-6",
        estimatedInputTokens: 100_000,
        budgetUsd: 0.001,
        requestedOutputTokens: 1_000,
      }),
    ).toBe(0);
  });

  it("preflights a conservative 1K image request ceiling for the selected model", () => {
    expect(estimateImageGenerationCostUsd()).toBe(0.24576);
    expect(estimateImageGenerationCostUsd("nano-banana-pro")).toBe(0.49152);
    expect(estimateImageGenerationCostUsd("nano-banana")).toBe(0.12288);
  });
});
