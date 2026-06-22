import { describe, it, expect } from "vitest";
import {
  AGENT_TYPES,
  AGENT_TYPE_KEYS,
  MAX_SUB_AGENTS_PER_CALL,
  buildSubAgentPreamble,
  parseAgentSpecs,
  formatSubAgentReports,
  SPAWN_AGENTS_TOOL,
  type SubAgentRunReport,
} from "./subagents.js";

// Stand-in for router.isValidChoice: accept only catalog-ish "provider:model".
const isValidModel = (m: string) => /^(anthropic|openai|google|zai):/.test(m);

describe("parseAgentSpecs", () => {
  it("parses a single well-formed spec", () => {
    const specs = parseAgentSpecs(
      [{ type: "backend", task: "build the API", model: "zai:glm-5.2", instructions: "be terse" }],
      isValidModel,
    );
    expect(specs).toEqual([
      { type: "backend", task: "build the API", model: "zai:glm-5.2", instructions: "be terse" },
    ]);
  });

  it("coerces an unknown/missing type to the blank-slate 'general'", () => {
    expect(parseAgentSpecs([{ type: "wizard", task: "x" }], isValidModel)[0].type).toBe("general");
    expect(parseAgentSpecs([{ task: "x" }], isValidModel)[0].type).toBe("general");
  });

  it("drops a non-resolvable or 'auto' model (=> undefined)", () => {
    expect(parseAgentSpecs([{ type: "audit", task: "x", model: "auto" }], isValidModel)[0].model).toBeUndefined();
    expect(parseAgentSpecs([{ type: "audit", task: "x", model: "gpt-banana" }], isValidModel)[0].model).toBeUndefined();
    expect(parseAgentSpecs([{ type: "audit", task: "x", model: "openai:gpt-5.5" }], isValidModel)[0].model).toBe(
      "openai:gpt-5.5",
    );
  });

  it("skips entries with no task and keeps the rest", () => {
    const specs = parseAgentSpecs(
      [{ type: "audit", task: "" }, { type: "design", task: "  style it  " }],
      isValidModel,
    );
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({ type: "design", task: "style it" });
  });

  it("throws on a non-array, empty array, or all-empty-task batch", () => {
    expect(() => parseAgentSpecs(undefined, isValidModel)).toThrow(/non-empty array/);
    expect(() => parseAgentSpecs([], isValidModel)).toThrow(/non-empty array/);
    expect(() => parseAgentSpecs([{ type: "audit" }], isValidModel)).toThrow(/non-empty 'task'/);
  });

  it("caps the batch at MAX_SUB_AGENTS_PER_CALL", () => {
    const many = Array.from({ length: MAX_SUB_AGENTS_PER_CALL + 3 }, (_, i) => ({
      type: "general",
      task: `task ${i}`,
    }));
    expect(parseAgentSpecs(many, isValidModel)).toHaveLength(MAX_SUB_AGENTS_PER_CALL);
  });
});

describe("buildSubAgentPreamble", () => {
  it("includes the persona and, when present, the lead agent's extra instructions", () => {
    const withExtra = buildSubAgentPreamble(AGENT_TYPES.audit, "focus on auth");
    expect(withExtra).toContain(AGENT_TYPES.audit.label);
    expect(withExtra).toContain("REVIEW and AUDIT");
    expect(withExtra).toContain("focus on auth");
    expect(withExtra).toMatch(/cannot spawn further sub-agents|EXCEPT the ability to spawn/i);
  });

  it("omits the instructions block when none given", () => {
    const plain = buildSubAgentPreamble(AGENT_TYPES.general);
    expect(plain).not.toMatch(/Additional instructions/);
  });
});

describe("SPAWN_AGENTS_TOOL schema", () => {
  it("enumerates exactly the registry's types and matches AGENT_TYPE_KEYS", () => {
    const enumVals = (SPAWN_AGENTS_TOOL.input_schema as any).properties.agents.items.properties.type.enum;
    expect(enumVals).toEqual(AGENT_TYPE_KEYS);
    expect(enumVals).toContain("general"); // blank slate present
    expect((SPAWN_AGENTS_TOOL.input_schema as any).required).toContain("agents");
  });
});

describe("formatSubAgentReports", () => {
  const base: SubAgentRunReport = {
    index: 1,
    type: "backend",
    task: "build the API",
    model: "glm-5.2",
    report: "Added /api/users.",
    aborted: false,
  };

  it("renders a single report with its task, model, and body", () => {
    const out = formatSubAgentReports([base], 1);
    expect(out).toContain("Sub-agent finished");
    expect(out).toContain("build the API");
    expect(out).toContain("glm-5.2");
    expect(out).toContain("Added /api/users.");
  });

  it("flags FAILED and ABORTED runs distinctly", () => {
    const failed = formatSubAgentReports([{ ...base, report: "", error: "boom" }], 1);
    expect(failed).toMatch(/FAILED/);
    expect(failed).toContain("boom");
    const aborted = formatSubAgentReports([{ ...base, aborted: true }], 1);
    expect(aborted).toMatch(/ABORTED/);
  });

  it("notes when the requested batch was capped", () => {
    const out = formatSubAgentReports([base], MAX_SUB_AGENTS_PER_CALL + 2);
    expect(out).toMatch(/only the first 1 ran/);
  });
});
