import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  compactionTriggerTokens,
  compactionKeepTokens,
  contextWindowTokensForModel,
  estimateFixedPromptTokens,
  estimateMessageTokens,
  estimatedRequestTokens,
} from "./compact.js";

describe("compaction request accounting", () => {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: "x".repeat(3_300) },
    { role: "assistant", content: [{ type: "text", text: "y".repeat(3_300) }] },
  ];

  it("counts the fixed system/tool prefix in addition to message history", () => {
    expect(estimateMessageTokens(messages)).toBe(2_000);
    expect(estimatedRequestTokens(messages, { fixedTokens: 7_500 })).toBe(9_500);
  });

  it("estimates serialized tools as part of the fixed prefix", () => {
    const fixed = estimateFixedPromptTokens("system", [
      { name: "read_file", description: "z".repeat(330), input_schema: { type: "object" } },
    ]);
    expect(fixed).toBeGreaterThan(100);
  });

  it("uses the smaller of the configured threshold and model headroom", () => {
    expect(compactionTriggerTokens({ contextWindowTokens: 100_000, reserveTokens: 20_000 })).toBe(
      80_000,
    );
    expect(compactionTriggerTokens({ contextWindowTokens: 500_000, reserveTokens: 20_000 })).toBe(
      150_000,
    );
    expect(compactionTriggerTokens({ contextWindowTokens: 10_000, reserveTokens: 20_000 })).toBe(1);
    expect(
      compactionKeepTokens({
        contextWindowTokens: 100_000,
        reserveTokens: 20_000,
        fixedTokens: 30_000,
      }),
    ).toBe(42_000);
  });

  it("uses conservative model-family context windows", () => {
    expect(contextWindowTokensForModel("claude-opus-4-8")).toBe(200_000);
    expect(contextWindowTokensForModel("claude-sonnet-4-6")).toBe(1_000_000);
    expect(contextWindowTokensForModel("gpt-5.6-sol")).toBe(400_000);
    expect(contextWindowTokensForModel("unknown-model")).toBe(200_000);
  });
});
