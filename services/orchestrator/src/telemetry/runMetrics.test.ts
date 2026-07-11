import { describe, expect, it } from "vitest";
import {
  MAX_RUN_METRIC_INTEGER,
  RunMetricsCollector,
  modelBucketFor,
} from "./runMetrics.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const STARTED_AT = new Date("2026-07-11T10:00:00.000Z");

function testCollector(clock: { now: number }): RunMetricsCollector {
  return new RunMetricsCollector({
    runId: RUN_ID,
    mode: "agent",
    now: () => clock.now,
    wallNow: () => STARTED_AT,
  });
}

describe("RunMetricsCollector", () => {
  it("measures concurrent phase spans as wall-clock union", () => {
    const clock = { now: 0 };
    const metrics = testCollector(clock);
    const stopFirst = metrics.startPhase("tool");
    clock.now = 5;
    const stopSecond = metrics.startPhase("tool");
    clock.now = 10;
    stopFirst();
    stopFirst(); // stops are idempotent
    clock.now = 20;
    stopSecond();

    clock.now = 25;
    const stopThird = metrics.startPhase("tool");
    clock.now = 30;
    stopThird();

    const snapshot = metrics.finish({ status: "success", finalAnswerEmitted: true });
    expect(snapshot.durations.tool).toBe(25); // [0,20] union + [25,30]
    expect(snapshot.durations.total).toBe(30);
  });

  it("closes open spans on finish and cannot mutate afterward", () => {
    const clock = { now: 100 };
    const metrics = testCollector(clock);
    metrics.startPhase("model");
    clock.now = 145;
    const first = metrics.finish({ status: "error", errorCategory: "provider" });
    expect(first.durations.model).toBe(45);
    expect(first.outcome).toMatchObject({
      status: "error",
      completionReason: "unknown",
      errorCategory: "provider",
    });

    metrics.increment("toolCallCount", 10);
    metrics.observeContextSize({ systemPromptChars: 999 });
    clock.now = 900;
    const second = metrics.finish({ status: "success" });
    expect(second).toEqual(first);
  });

  it("preserves an explicit empty-terminal failure reason", () => {
    const clock = { now: 0 };
    const metrics = testCollector(clock);
    const snapshot = metrics.finish({
      status: "error",
      completionReason: "empty_terminal",
      errorCategory: "provider",
      finalAnswerEmitted: false,
    });
    expect(snapshot.outcome).toMatchObject({
      status: "error",
      completionReason: "empty_terminal",
      errorCategory: "provider",
      finalAnswerEmitted: false,
    });
  });

  it("records bounded execution, cache, compaction, subagent, and outcome signals", () => {
    const clock = { now: 0 };
    const metrics = testCollector(clock);
    metrics.setModel("google", "gemini-3.5-flash");
    metrics.setRoute("standard", "classifier");
    metrics.increment("iterationCount", 2);
    metrics.recordRoutingClassifier();
    metrics.recordProviderCall({
      ttftMs: 125.4,
      retry: true,
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 900,
        cacheCreationTokens: 10,
      },
    });
    metrics.recordProviderCall({ ttftMs: 75, error: true, usage: { inputTokens: 20 } });
    metrics.recordToolCall({ error: true, retry: true, truncated: true });
    metrics.recordCompaction({ messagesCompacted: 14 });
    metrics.recordSubagent({ failed: true });
    metrics.recordSubagentProfile("progressive");
    metrics.recordSubagentProfile("legacy");
    metrics.recordFilesChanged(3);
    metrics.observeContextSize({
      systemPromptChars: 10_000,
      toolSchemaChars: 5_000,
      messageChars: 20_000,
      estimatedContextTokens: 9_000,
    });
    metrics.observeContextSize({ systemPromptChars: 100 }); // gauges retain the peak
    metrics.recordVerification("build", "passed");
    metrics.recordVerification("test", "failed");
    metrics.recordVerification("browser", "skipped");

    const snapshot = metrics.finish({ status: "success", finalAnswerEmitted: true });
    expect(snapshot.dimensions).toEqual({
      mode: "agent",
      provider: "google",
      modelBucket: "gemini_flash",
      plannerProvider: "unknown",
      plannerModelBucket: "unknown",
      executorProvider: "unknown",
      executorModelBucket: "unknown",
      routeTier: "standard",
      routeSource: "classifier",
      harnessProfile: "unknown",
      profileCohort: "unknown",
    });
    expect(snapshot.durations).toMatchObject({
      providerTtft: 125,
      providerTtftTotal: 200,
      providerTtftSamples: 2,
    });
    expect(snapshot.counters).toMatchObject({
      iterationCount: 2,
      modelCallCount: 2,
      providerErrorCount: 1,
      providerRetryCount: 1,
      routingClassifierCallCount: 1,
      toolCallCount: 1,
      toolErrorCount: 1,
      toolRetryCount: 1,
      toolResultTruncatedCount: 1,
      compactionCount: 1,
      compactedMessageCount: 14,
      subagentCount: 1,
      subagentErrorCount: 1,
      subagentProgressiveCount: 1,
      subagentLegacyCount: 1,
      filesChangedCount: 3,
      cacheHitCallCount: 1,
      cacheMissCallCount: 1,
      freshInputTokens: 120,
      outputTokens: 50,
      cacheReadTokens: 900,
      cacheCreationTokens: 10,
      peakSystemPromptChars: 10_000,
      verificationCheckCount: 2,
      verificationFailureCount: 1,
    });
    expect(snapshot.outcome).toEqual({
      status: "error",
      completionReason: "verification_failed",
      errorCategory: "tool",
      finalAnswerEmitted: true,
      verification: { build: "passed", test: "failed", browser: "skipped", overall: "failed" },
    });
  });

  it("clamps bad or extreme numeric observations", () => {
    const clock = { now: 0 };
    const metrics = testCollector(clock);
    metrics.increment("iterationCount", -1);
    metrics.increment("iterationCount", Number.NaN);
    metrics.increment("iterationCount", Number.POSITIVE_INFINITY);
    metrics.increment("outputTokens", MAX_RUN_METRIC_INTEGER + 1000);
    metrics.observeProviderTtft(-5);
    metrics.observeProviderTtft(Number.NaN);
    const snapshot = metrics.finish({ status: "aborted" });
    expect(snapshot.counters.iterationCount).toBe(0);
    expect(snapshot.counters.outputTokens).toBe(MAX_RUN_METRIC_INTEGER);
    expect(snapshot.durations.providerTtft).toBeNull();
    expect(snapshot.outcome.completionReason).toBe("aborted");
  });

  it("always discards provider-native model ids into bounded families", () => {
    expect(modelBucketFor("anthropic", "claude-opus-4-8")).toBe("claude_opus");
    expect(modelBucketFor("openai", "gpt-5.3-codex")).toBe("gpt_codex");
    expect(modelBucketFor("zai", "glm-5.2")).toBe("glm");
    expect(modelBucketFor("attacker-provider", "SECRET-user-label")).toBe("unknown");
  });

  it("stops measured phases even when an operation rejects", async () => {
    const clock = { now: 0 };
    const metrics = testCollector(clock);
    await expect(
      metrics.measure("preflight", async () => {
        clock.now = 17;
        throw new Error("expected");
      }),
    ).rejects.toThrow("expected");
    expect(metrics.snapshot().durations.preflight).toBe(17);
  });

  it("only lets the same verification check clear its failure", () => {
    const clock = { now: 0 };
    const metrics = testCollector(clock);
    metrics.recordVerificationAttempt("test", "failed", "suite-a")();
    metrics.recordVerificationAttempt("test", "passed", "suite-b")();

    let snapshot = metrics.snapshot();
    expect(snapshot.outcome.verification.test).toBe("failed");

    metrics.recordVerificationAttempt("test", "passed", "suite-a")();

    snapshot = metrics.finish({ status: "success" });
    expect(snapshot.outcome.verification.test).toBe("passed");
    expect(snapshot.outcome.verification.overall).toBe("passed");
    expect(snapshot.counters.verificationCheckCount).toBe(3);
    expect(snapshot.counters.verificationFailureCount).toBe(1);
  });

  it("does not let skipped evidence clear a prior failure or double-count a legacy hook", () => {
    const clock = { now: 0 };
    const metrics = testCollector(clock);
    metrics.recordVerificationAttempt("browser", "failed", "interaction")();

    const clear = metrics.recordVerificationAttempt("browser", "skipped", "screenshot");
    metrics.recordVerification("browser", "passed"); // synchronous legacy socket observer
    clear();

    const snapshot = metrics.finish({ status: "success" });
    expect(snapshot.outcome.verification.browser).toBe("failed");
    expect(snapshot.counters.verificationCheckCount).toBe(1);
    expect(snapshot.counters.verificationFailureCount).toBe(1);
  });

  it("lets passive evidence clear only its own prior failure", () => {
    const clock = { now: 0 };
    const metrics = testCollector(clock);
    metrics.recordVerificationAttempt("browser", "failed", "screenshot-a")();
    metrics.recordVerificationAttempt("browser", "evidence", "screenshot-b")();
    expect(metrics.snapshot().outcome.verification.browser).toBe("failed");

    metrics.recordVerificationAttempt("browser", "evidence", "screenshot-a")();
    const snapshot = metrics.finish({ status: "success" });
    expect(snapshot.outcome.verification.browser).toBe("passed");
    expect(snapshot.counters.verificationCheckCount).toBe(2);
    expect(snapshot.counters.verificationFailureCount).toBe(1);
  });

  it("marks a completed answer with an unresolved verification failure", () => {
    const clock = { now: 0 };
    const metrics = testCollector(clock);
    metrics.recordVerification("build", "failed");
    const snapshot = metrics.finish({
      status: "success",
      completionReason: "completed",
      finalAnswerEmitted: true,
    });
    expect(snapshot.outcome).toMatchObject({
      status: "error",
      completionReason: "verification_failed",
      errorCategory: "tool",
      finalAnswerEmitted: true,
    });
  });

  it("measures user-wait spans independently for active-time subtraction", () => {
    const clock = { now: 0 };
    const metrics = testCollector(clock);
    const stopWait = metrics.startPhase("userWait");
    clock.now = 40;
    stopWait();
    const snapshot = metrics.finish({ status: "success" });
    expect(snapshot.durations.userWait).toBe(40);
    expect(snapshot.durations.total).toBe(40);
  });

  it("records bounded progressive-profile attribution and monotonic expansion", () => {
    const clock = { now: 0 };
    const metrics = testCollector(clock);
    metrics.setHarnessProfile("progressive", "treatment");
    metrics.observeInitialHarness(9, 1);
    metrics.recordCapabilityLoad(14, 2);
    metrics.recordCapabilityLoad(20, 4);
    const snapshot = metrics.finish({ status: "success" });
    expect(snapshot.dimensions).toMatchObject({
      harnessProfile: "progressive",
      profileCohort: "treatment",
    });
    expect(snapshot.counters).toMatchObject({
      initialToolCount: 9,
      peakToolCount: 20,
      initialCapabilityCount: 1,
      peakCapabilityCount: 4,
      capabilityLoadCount: 2,
    });
  });

  it("separates exact and estimated provider-side search units", () => {
    const metrics = testCollector({ now: 0 });
    metrics.recordBillableToolUsage(2, "exact");
    metrics.recordBillableToolUsage(3, "estimated");
    const snapshot = metrics.finish({ status: "success" });
    expect(snapshot.counters.webSearchUnitCount).toBe(5);
    expect(snapshot.counters.estimatedWebSearchUnitCount).toBe(3);
  });
});
