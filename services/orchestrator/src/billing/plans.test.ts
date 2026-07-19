import { describe, expect, it } from "vitest";
import {
  dollarsToMicrousd,
  maxAllowance,
  microusdToDollars,
  planAllowance,
  validateMaxMonthlyUsd,
} from "./plans.js";

describe("billing plan economics", () => {
  it("keeps Plus at $12 usage plus $2 reliability", () => {
    expect(planAllowance("plus")).toEqual({ usageUsd: 12, reliabilityUsd: 2 });
  });

  it("preserves the requested Max endpoints", () => {
    expect(maxAllowance(100)).toEqual({ usageUsd: 75, reliabilityUsd: 10 });
    expect(maxAllowance(200)).toEqual({ usageUsd: 160, reliabilityUsd: 20 });
  });

  it("scales Max linearly between the endpoints", () => {
    expect(maxAllowance(150)).toEqual({ usageUsd: 117.5, reliabilityUsd: 15 });
  });

  it("rejects an out-of-range or non-step Max amount", () => {
    expect(() => validateMaxMonthlyUsd(90)).toThrow(/between/);
    expect(() => validateMaxMonthlyUsd(205)).toThrow(/between/);
    expect(() => validateMaxMonthlyUsd(125)).toThrow(/increments/);
  });

  it("round-trips wallet amounts through integer microdollars", () => {
    expect(dollarsToMicrousd(12.34)).toBe(12_340_000);
    expect(microusdToDollars(12_340_000)).toBe(12.34);
  });
});
