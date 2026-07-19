import { describe, expect, it } from "vitest";
import { assertPlatformModelPriced, RunPlatformSpend } from "./runSpend.js";

describe("RunPlatformSpend", () => {
  it("tracks run and externally settled receipts without double settlement", () => {
    const spend = new RunPlatformSpend(5);
    spend.record(1.25);
    spend.record(0.5, true);

    expect(spend.runCostUsd).toBe(1.25);
    expect(spend.knownCostUsd).toBe(1.75);
    expect(spend.delegate(1)).toBe(1);
    expect(spend.remaining()).toBe(2.25);
    spend.finishDelegation(1, false);
    expect(spend.remaining()).toBe(3.25);
  });

  it("quarantines all remaining platform allocation after unknown spend", () => {
    const spend = new RunPlatformSpend(5);
    spend.record(1);
    spend.quarantineUnknown();

    expect(spend.hasUnknownSpend).toBe(true);
    expect(spend.remaining()).toBe(0);
    expect(spend.runCostUsd).toBe(1);
  });

  it("uses analytics fallback prices only for account-funded models", () => {
    expect(() =>
      assertPlatformModelPriced("future-unpriced-model", true, "vision helper"),
    ).toThrow("has no explicit platform price");
    expect(() =>
      assertPlatformModelPriced("future-unpriced-model", false, "vision helper"),
    ).not.toThrow();
  });

  it("never returns an unknown child allocation for parent reuse", () => {
    const spend = new RunPlatformSpend(5);
    const childAllocation = spend.delegate(2.5);

    expect(spend.remaining()).toBe(2.5);
    spend.finishDelegation(childAllocation, true);

    expect(spend.hasUnknownSpend).toBe(true);
    expect(spend.remaining()).toBe(0);
  });
});
