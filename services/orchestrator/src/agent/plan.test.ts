import { describe, it, expect } from "vitest";
import { mapPlannerCallsWithBarriers, normalizePlan } from "./plan.js";

describe("normalizePlan — defends the UI against malformed model output", () => {
  it("passes a well-formed plan through unchanged", () => {
    const plan = {
      summary: "Build it",
      plain_summary: "You'll get a thing",
      steps: [{ description: "Step 1", files: ["a.ts"], success_criteria: "it builds" }],
      wireframe: "+--+",
    };
    expect(normalizePlan(plan)).toEqual(plan);
  });

  it("never throws on a missing/non-array steps (the crash bug) → empty array", () => {
    // A truncated GLM tool-call safeParseJson's to {} — steps undefined.
    expect(normalizePlan({}).steps).toEqual([]);
    expect(normalizePlan({ summary: "x" }).steps).toEqual([]);
    expect(normalizePlan({ summary: "x", steps: null }).steps).toEqual([]);
    expect(normalizePlan({ summary: "x", steps: { description: "oops" } }).steps).toEqual([]);
    expect(normalizePlan(undefined).steps).toEqual([]);
    expect(normalizePlan("not json at all").steps).toEqual([]);
  });

  it("parses steps delivered as a JSON string", () => {
    const out = normalizePlan({ summary: "x", steps: '[{"description":"a"},{"description":"b"}]' });
    expect(out.steps).toEqual([{ description: "a" }, { description: "b" }]);
  });

  it("coerces an array of bare strings into PlanSteps and drops empties", () => {
    const out = normalizePlan({ summary: "x", steps: ["first", "  ", "second"] });
    expect(out.steps).toEqual([{ description: "first" }, { description: "second" }]);
  });

  it("sanitizes per-step fields (files must be string[], success_criteria a string)", () => {
    const out = normalizePlan({
      summary: "x",
      steps: [{ description: "a", files: ["a.ts", 5, null], success_criteria: 42 }],
    });
    expect(out.steps).toEqual([{ description: "a", files: ["a.ts"] }]);
  });

  it("accepts the whole plan delivered as a JSON string", () => {
    const out = normalizePlan('{"summary":"S","steps":[{"description":"a"}]}');
    expect(out.summary).toBe("S");
    expect(out.steps).toEqual([{ description: "a" }]);
  });

  it("always yields a non-empty summary string", () => {
    expect(typeof normalizePlan({}).summary).toBe("string");
    expect(normalizePlan({}).summary.length).toBeGreaterThan(0);
    expect(normalizePlan({ plain_summary: "P" }).summary).toBe("P");
    expect(normalizePlan({ summary: 123 as unknown }).summary).toBe("Proposed plan");
  });

  it("carries deliverables through, dropping non-string/empty entries", () => {
    const out = normalizePlan({
      summary: "x",
      steps: [],
      deliverables: ["A booking page", "  ", 42, null],
    });
    expect(out.deliverables).toEqual(["A booking page"]);
    // Absent/empty → field omitted entirely, not an empty array.
    expect(normalizePlan({ summary: "x", steps: [] }).deliverables).toBeUndefined();
    expect(
      normalizePlan({ summary: "x", steps: [], deliverables: "not an array" }).deliverables,
    ).toBeUndefined();
  });

  it("carries open_questions through, dropping non-string/empty entries", () => {
    const out = normalizePlan({
      summary: "x",
      steps: [],
      open_questions: ["Use Postgres or SQLite?", "  ", 42, null],
    });
    expect(out.open_questions).toEqual(["Use Postgres or SQLite?"]);
    // Absent/empty → field omitted entirely, not an empty array.
    expect(normalizePlan({ summary: "x", steps: [] }).open_questions).toBeUndefined();
    expect(
      normalizePlan({ summary: "x", steps: [], open_questions: "not an array" }).open_questions,
    ).toBeUndefined();
  });
});

describe("mapPlannerCallsWithBarriers", () => {
  it("bounds parallel reads and preserves provider result order", async () => {
    const calls = [18, 2, 12, 1, 8, 3];
    let active = 0;
    let peak = 0;

    const results = await mapPlannerCallsWithBarriers(
      calls,
      () => true,
      async (delay, index) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, delay));
        active--;
        return `result-${index}`;
      },
      2,
    );

    expect(peak).toBe(2);
    expect(results).toEqual(calls.map((_, index) => `result-${index}`));
  });

  it("waits at non-read barriers before starting the following read group", async () => {
    const calls = [
      { name: "read-a", safe: true },
      { name: "read-b", safe: true },
      { name: "barrier", safe: false },
      { name: "read-c", safe: true },
    ];
    const events: string[] = [];

    const results = await mapPlannerCallsWithBarriers(
      calls,
      (call) => call.safe,
      async (call) => {
        events.push(`start:${call.name}`);
        await new Promise((resolve) => setTimeout(resolve, call.name === "read-a" ? 8 : 1));
        events.push(`end:${call.name}`);
        return call.name;
      },
      4,
    );

    const barrierStart = events.indexOf("start:barrier");
    const barrierEnd = events.indexOf("end:barrier");
    expect(barrierStart).toBeGreaterThan(events.indexOf("end:read-a"));
    expect(barrierStart).toBeGreaterThan(events.indexOf("end:read-b"));
    expect(events.indexOf("start:read-c")).toBeGreaterThan(barrierEnd);
    expect(results).toEqual(calls.map((call) => call.name));
  });
});
