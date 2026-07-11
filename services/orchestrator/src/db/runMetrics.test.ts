import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RunMetricsCollector, MAX_RUN_METRIC_INTEGER } from "../telemetry/runMetrics.js";

const dbMocks = vi.hoisted(() => ({
  from: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  firstEq: vi.fn(),
  secondEq: vi.fn(),
}));

vi.mock("./client.js", () => ({ db: () => ({ from: dbMocks.from }) }));

import {
  markAgentRunCorrection,
  recordAgentRunMetrics,
  toAgentRunMetricsRow,
} from "./runMetrics.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

function completedSnapshot() {
  const metrics = new RunMetricsCollector({
    runId: RUN_ID,
    mode: "plan_execution",
    now: () => 5,
    wallNow: () => new Date("2026-07-11T12:00:00.000Z"),
  });
  metrics.setPhaseModel("planner", "google", "gemini-3.1-pro-preview");
  metrics.setPhaseModel("executor", "anthropic", "claude-sonnet-4-6");
  metrics.setRoute("standard", "heuristic");
  metrics.setHarnessProfile("progressive", "treatment");
  metrics.increment("iterationCount", 2);
  metrics.recordSubagentProfile("progressive");
  metrics.recordSubagentProfile("legacy");
  metrics.recordBillableToolUsage(3, "estimated");
  return metrics.finish({ status: "success", finalAnswerEmitted: true });
}

beforeEach(() => {
  vi.restoreAllMocks();
  for (const mock of Object.values(dbMocks)) mock.mockReset();
  dbMocks.from.mockReturnValue({ upsert: dbMocks.upsert, update: dbMocks.update });
  dbMocks.update.mockReturnValue({ eq: dbMocks.firstEq });
  dbMocks.firstEq.mockReturnValue({ eq: dbMocks.secondEq });
});

describe("toAgentRunMetricsRow", () => {
  it("maps a snapshot to explicit snake-case analytics columns", () => {
    const row = toAgentRunMetricsRow({
      projectId: PROJECT_ID,
      userId: USER_ID,
      metrics: completedSnapshot(),
    });
    expect(row).toMatchObject({
      run_id: RUN_ID,
      project_id: PROJECT_ID,
      user_id: USER_ID,
      metrics_version: 1,
      started_at: "2026-07-11T12:00:00.000Z",
      run_mode: "plan_execution",
      provider: "anthropic",
      model_bucket: "claude_sonnet",
      planner_provider: "google",
      planner_model_bucket: "gemini_pro",
      executor_provider: "anthropic",
      executor_model_bucket: "claude_sonnet",
      route_tier: "standard",
      route_source: "heuristic",
      harness_profile: "progressive",
      profile_cohort: "treatment",
      iteration_count: 2,
      subagent_progressive_count: 1,
      subagent_legacy_count: 1,
      web_search_unit_count: 3,
      estimated_web_search_unit_count: 3,
      run_status: "success",
      completion_reason: "completed",
      error_category: "none",
      final_answer_emitted: true,
    });
  });

  it("drops unknown/free-form fields and normalizes forged dimensions", () => {
    const snapshot = completedSnapshot() as ReturnType<typeof completedSnapshot> &
      Record<string, unknown>;
    const secret = "SECRET_PROMPT_AND_TOOL_PAYLOAD";
    snapshot.prompt = secret;
    snapshot.toolPayload = { command: secret, path: secret };
    snapshot.dimensions = {
      ...snapshot.dimensions,
      provider: secret,
      modelBucket: secret,
      routeTier: secret,
      routeSource: secret,
    } as typeof snapshot.dimensions;
    snapshot.outcome = {
      ...snapshot.outcome,
      errorCategory: secret,
    } as typeof snapshot.outcome;

    const row = toAgentRunMetricsRow({ projectId: null, userId: null, metrics: snapshot });
    expect(row.provider).toBe("unknown");
    expect(row.model_bucket).toBe("unknown");
    expect(row.route_tier).toBe("unknown");
    expect(row.route_source).toBe("unknown");
    expect(row.error_category).toBe("unknown");
    expect(JSON.stringify(row)).not.toContain(secret);
  });

  it("clamps forged metric values at the persistence boundary", () => {
    const snapshot = completedSnapshot();
    snapshot.counters.toolCallCount = Number.POSITIVE_INFINITY;
    snapshot.counters.outputTokens = MAX_RUN_METRIC_INTEGER + 100;
    snapshot.durations.tool = -20;
    snapshot.durations.userWait = 37;
    snapshot.durations.providerTtft = Number.NaN;
    const row = toAgentRunMetricsRow({ projectId: null, userId: null, metrics: snapshot });
    expect(row.tool_call_count).toBe(0);
    expect(row.output_tokens).toBe(MAX_RUN_METRIC_INTEGER);
    expect(row.tool_ms).toBe(0);
    expect(row.user_wait_ms).toBe(37);
    expect(row.provider_ttft_ms).toBeNull();
  });

  it("rejects invalid identity values instead of placing them in telemetry", () => {
    expect(() =>
      toAgentRunMetricsRow({
        projectId: "not-a-project-id",
        userId: USER_ID,
        metrics: completedSnapshot(),
      }),
    ).toThrow("invalid projectId");
  });

  it("keeps every explicit persistence field backed by a schema column", () => {
    const row = toAgentRunMetricsRow({
      projectId: PROJECT_ID,
      userId: USER_ID,
      metrics: completedSnapshot(),
    });
    const schema = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
    const table = schema.match(
      /create table if not exists agent_run_metrics \(([\s\S]*?)\n\);/,
    )?.[1];
    expect(table).toBeDefined();
    const columns = new Set(
      [...(table ?? "").matchAll(/^\s{2}([a-z_]+)\s+/gm)].map((match) => match[1]),
    );
    for (const field of Object.keys(row)) expect(columns.has(field), field).toBe(true);
  });
});

describe("agent run metric persistence", () => {
  it("writes idempotently by run_id", async () => {
    dbMocks.upsert.mockResolvedValue({ error: null });
    const metrics = completedSnapshot();
    await expect(recordAgentRunMetrics({ projectId: PROJECT_ID, userId: USER_ID, metrics })).resolves.toBe(
      true,
    );
    expect(dbMocks.from).toHaveBeenCalledWith("agent_run_metrics");
    expect(dbMocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ run_id: RUN_ID, user_id: USER_ID }),
      { onConflict: "run_id", ignoreDuplicates: true },
    );
  });

  it("fails open and logs only a bounded database error code", async () => {
    dbMocks.upsert.mockResolvedValue({
      error: { code: "42P01", message: "SECRET database details must not be logged" },
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      recordAgentRunMetrics({ projectId: PROJECT_ID, userId: USER_ID, metrics: completedSnapshot() }),
    ).resolves.toBe(false);
    expect(log).toHaveBeenCalledWith("recordAgentRunMetrics failed (42P01)");
    expect(JSON.stringify(log.mock.calls)).not.toContain("SECRET");
  });

  it("marks correction quality feedback without accepting follow-up text", async () => {
    dbMocks.secondEq.mockResolvedValue({ error: null });
    await expect(markAgentRunCorrection(RUN_ID, USER_ID)).resolves.toBe(true);
    expect(dbMocks.update).toHaveBeenCalledWith({
      correction_followup: true,
      correction_recorded_at: expect.any(String),
    });
    expect(dbMocks.firstEq).toHaveBeenCalledWith("run_id", RUN_ID);
    expect(dbMocks.secondEq).toHaveBeenCalledWith("user_id", USER_ID);
  });
});
