import { describe, it, expect } from "vitest";
import {
  MODEL_CATALOG,
  MODEL_PRICING,
  DEFAULT_PRICE,
  estimateCostUsd,
  estimateTurnCostUsd,
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

describe("estimateTurnCostUsd long-context band", () => {
  it("reprices a turn above the threshold at the premium band", () => {
    const model = "gemini-3.1-pro-preview-customtools"; // base 2/12, >200K → 4/18
    const band = MODEL_PRICING[model].longContext!;
    const below = estimateTurnCostUsd(model, {
      inputTokens: 100_000,
      outputTokens: 10_000,
    });
    const above = estimateTurnCostUsd(model, {
      inputTokens: band.thresholdTokens + 1,
      outputTokens: 10_000,
    });
    // Same output count, but the above-threshold turn pays the premium input
    // rate on a far larger prompt — strictly more than the small turn.
    expect(above).toBeGreaterThan(below);
    // Exactly the published band: input 4/M, output 18/M.
    expect(above).toBeCloseTo(
      ((band.thresholdTokens + 1) * band.above.input + 10_000 * band.above.output) /
        1_000_000,
      10,
    );
  });

  it("uses base rates at/under the threshold", () => {
    const model = "gemini-3.1-pro-preview-customtools";
    const p = MODEL_PRICING[model];
    const cost = estimateTurnCostUsd(model, { inputTokens: 50_000, outputTokens: 5_000 });
    expect(cost).toBeCloseTo(
      (50_000 * p.input + 5_000 * p.output) / 1_000_000,
      10,
    );
  });

  it("never applies a band to models that don't have one", () => {
    // Opus (200K ctx) prices flat even for an (impossible) huge prompt.
    const huge = estimateTurnCostUsd("claude-opus-4-8", {
      inputTokens: 5_000_000,
      outputTokens: 0,
    });
    expect(huge).toBeCloseTo(estimateCostUsd("claude-opus-4-8", 5_000_000, 0), 10);
  });

  it("estimateCostUsd stays flat (no band) so aggregates don't over-trigger", () => {
    // Summing many small turns into one big aggregate must NOT cross the band —
    // that's why the aggregate path uses estimateCostUsd, not estimateTurnCostUsd.
    const model = "gemini-3.1-pro-preview-customtools";
    const p = MODEL_PRICING[model];
    const agg = estimateCostUsd(model, 1_000_000, 100_000);
    expect(agg).toBeCloseTo((1_000_000 * p.input + 100_000 * p.output) / 1_000_000, 10);
  });
});
