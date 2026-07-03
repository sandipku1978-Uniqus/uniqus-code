import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLiveOutputEstimator, type LiveUsageSplit } from "./liveUsage.js";

describe("createLiveOutputEstimator — live counter movement during streams", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function collect(): { emits: Array<{ u: LiveUsageSplit; real: boolean }>; est: ReturnType<typeof createLiveOutputEstimator> } {
    const emits: Array<{ u: LiveUsageSplit; real: boolean }> = [];
    const est = createLiveOutputEstimator((u, real) => emits.push({ u, real }));
    return { emits, est };
  }

  it("emits a low-biased estimate as chars stream (4 chars/token)", () => {
    const { emits, est } = collect();
    est.addChars(1000);
    expect(emits).toHaveLength(1);
    expect(emits[0].real).toBe(false);
    expect(emits[0].u.outputTokens).toBe(250);
  });

  it("throttles estimate emissions (~500ms), accumulating chars meanwhile", () => {
    const { emits, est } = collect();
    est.addChars(400); // emits (100 tokens)
    est.addChars(400); // within throttle window — no emit, chars still counted
    expect(emits).toHaveLength(1);
    vi.advanceTimersByTime(600);
    est.addChars(400); // window elapsed — emits cumulative 1200 chars = 300 tokens
    expect(emits).toHaveLength(2);
    expect(emits[1].u.outputTokens).toBe(300);
  });

  it("a real usage report resets the estimate and later estimates build on it", () => {
    const { emits, est } = collect();
    est.addChars(4000); // estimate: 1000 tokens
    est.onRealUsage({ inputTokens: 50, outputTokens: 1200, cacheReadTokens: 7 });
    const real = emits.at(-1)!;
    expect(real.real).toBe(true);
    expect(real.u).toEqual({
      inputTokens: 50,
      outputTokens: 1200,
      cacheReadTokens: 7,
      cacheCreationTokens: 0,
    });
    vi.advanceTimersByTime(600);
    est.addChars(400); // 100 tokens ON TOP of the real 1200
    const next = emits.at(-1)!;
    expect(next.real).toBe(false);
    expect(next.u.outputTokens).toBe(1300);
    expect(next.u.inputTokens).toBe(50); // input carried from the real report
  });

  it("tool-arg partials count only serialized growth per call id", () => {
    const { emits, est } = collect();
    est.addToolPartial("call_1", { path: "a.ts" }); // len L1 → emits
    const first = emits.at(-1)!.u.outputTokens;
    vi.advanceTimersByTime(600);
    // Same object again — no growth, no new chars (a re-emit of identical args)
    est.addToolPartial("call_1", { path: "a.ts" });
    expect(emits.at(-1)!.u.outputTokens).toBe(first);
    // Grown args — only the delta counts
    est.addToolPartial("call_1", { path: "a.ts", content: "x".repeat(400) });
    expect(emits.at(-1)!.u.outputTokens).toBeGreaterThan(first);
  });

  it("ignores empty/negative char counts and unserializable partials", () => {
    const { emits, est } = collect();
    est.addChars(0);
    est.addChars(-5);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    est.addToolPartial("c", circular);
    expect(emits).toHaveLength(0);
  });
});
