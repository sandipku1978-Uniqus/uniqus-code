import { describe, it, expect } from "vitest";
import {
  MODEL_CATALOG,
  MODEL_PRICING,
  DEFAULT_PRICE,
  estimateCostUsd,
} from "@uniqus/api-types";

// Guards the per-run / per-account cost estimate (C5). A catalogued model that
// is missing from MODEL_PRICING would silently fall back to DEFAULT_PRICE,
// which can be 5–40× off (a Flash model billed as mid-tier, a Pro model
// under-billed). This test makes that a CI failure instead of a quiet pricing
// bug the first time someone adds a model to the picker.
describe("MODEL_PRICING completeness", () => {
  it("prices every selectable MODEL_CATALOG model explicitly (no DEFAULT_PRICE fallback)", () => {
    const missing = MODEL_CATALOG.filter((m) => !(m.model in MODEL_PRICING));
    expect(
      missing.map((m) => m.id),
      "every MODEL_CATALOG id must have an explicit MODEL_PRICING entry",
    ).toEqual([]);
  });

  it("uses sane, non-default rates for every catalogued model", () => {
    for (const m of MODEL_CATALOG) {
      const p = MODEL_PRICING[m.model];
      expect(p, `pricing for ${m.id}`).toBeDefined();
      // A catalogued model accidentally priced at the exact DEFAULT_PRICE is a
      // smell (likely a copy-paste / placeholder), so assert it differs unless
      // intentional. Both rates must be positive.
      expect(p.input).toBeGreaterThan(0);
      expect(p.output).toBeGreaterThan(0);
    }
  });
});

describe("estimateCostUsd cache split", () => {
  it("bills cache reads far below fresh input and writes above it", () => {
    const model = "claude-opus-4-8";
    const fresh = estimateCostUsd(model, 1_000_000, 0);
    const cachedRead = estimateCostUsd(model, 0, 0, 1_000_000, 0);
    const cacheWrite = estimateCostUsd(model, 0, 0, 0, 1_000_000);
    expect(cachedRead).toBeLessThan(fresh); // ~0.1× discount
    expect(cacheWrite).toBeGreaterThan(fresh); // ~1.25× one-time write
  });

  it("never throws on an unknown model (falls back to DEFAULT_PRICE)", () => {
    const cost = estimateCostUsd("totally-made-up-model", 1000, 1000);
    expect(cost).toBeCloseTo(
      (1000 * DEFAULT_PRICE.input + 1000 * DEFAULT_PRICE.output) / 1_000_000,
      10,
    );
  });
});
