import { beforeEach, describe, expect, it, vi } from "vitest";

const createClassifierMessage = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: createClassifierMessage };
  },
}));

import { pickAutoModel } from "./autoRouter.js";

describe("routing classifier provider boundary", () => {
  beforeEach(() => {
    createClassifierMessage.mockReset();
  });

  it("quarantines a started classifier request with a zero-token receipt", async () => {
    createClassifierMessage.mockResolvedValueOnce({
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      content: [{ type: "text", text: "STANDARD" }],
    });
    const beforeClassifier = vi.fn();
    const onClassifierUnknown = vi.fn();
    const onClassifierUsage = vi.fn();

    await pickAutoModel(
      "agent",
      {
        userMessage: "Add recent orders with pagination",
        hasImages: false,
        availableProviders: new Set(["anthropic"]),
      },
      {
        anthropicKey: "test-key",
        beforeClassifier,
        onClassifierUnknown,
        onClassifierUsage,
      },
    );

    expect(beforeClassifier).toHaveBeenCalledWith(
      expect.any(Number),
      "claude-haiku-4-5-20251001",
    );
    expect(onClassifierUnknown).toHaveBeenCalledTimes(1);
    expect(onClassifierUsage).not.toHaveBeenCalled();
  });

  it("does not quarantine when local preflight rejects before the SDK boundary", async () => {
    const onClassifierUnknown = vi.fn();

    await pickAutoModel(
      "agent",
      {
        userMessage: "Add recent orders with pagination",
        hasImages: false,
        availableProviders: new Set(["anthropic"]),
      },
      {
        anthropicKey: "test-key",
        beforeClassifier: () => {
          throw new Error("insufficient local budget");
        },
        onClassifierUnknown,
      },
    );

    expect(createClassifierMessage).not.toHaveBeenCalled();
    expect(onClassifierUnknown).not.toHaveBeenCalled();
  });
});
