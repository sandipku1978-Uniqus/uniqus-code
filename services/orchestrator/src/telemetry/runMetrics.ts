import { randomUUID } from "node:crypto";

/**
 * Privacy-safe, per-run harness telemetry.
 *
 * This module deliberately accepts only bounded dimensions, counters, and
 * durations. It has no field for prompts, messages, file paths, tool inputs or
 * outputs, commands, error messages, or connector names. Keep that invariant:
 * the persisted row is intended for product-performance analysis, not replay.
 */

export const RUN_METRIC_PHASES = [
  "sandbox",
  "preflight",
  "routing",
  "model",
  "tool",
  "verification",
  "userWait",
  "persistence",
] as const;
export type RunMetricPhase = (typeof RUN_METRIC_PHASES)[number];

export const RUN_MODES = ["agent", "plan", "plan_execution", "unknown"] as const;
export type RunMode = (typeof RUN_MODES)[number];

export const PROVIDER_BUCKETS = ["anthropic", "openai", "google", "zai", "unknown"] as const;
export type ProviderBucket = (typeof PROVIDER_BUCKETS)[number];

/** Stable families keep the analytics label set bounded as model ids change. */
export const MODEL_BUCKETS = [
  "claude_opus",
  "claude_sonnet",
  "gemini_pro",
  "gemini_flash",
  "gpt_codex",
  "gpt_general",
  "glm",
  "internal",
  "provider_other",
  "unknown",
] as const;
export type ModelBucket = (typeof MODEL_BUCKETS)[number];

export const ROUTE_TIERS = ["quick", "standard", "hard", "manual", "unknown"] as const;
export type RouteTier = (typeof ROUTE_TIERS)[number];

export const ROUTE_SOURCES = [
  "heuristic",
  "classifier",
  "manual",
  "environment",
  "static_fallback",
  "unknown",
] as const;
export type RouteSource = (typeof ROUTE_SOURCES)[number];

export const HARNESS_PROFILES = ["legacy", "progressive", "unknown"] as const;
export type HarnessProfile = (typeof HARNESS_PROFILES)[number];

export const PROFILE_COHORTS = ["treatment", "control", "ineligible", "unknown"] as const;
export type ProfileCohort = (typeof PROFILE_COHORTS)[number];

export const RUN_STATUSES = ["success", "error", "aborted", "unknown"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const COMPLETION_REASONS = [
  "completed",
  "max_iterations",
  "max_tokens",
  "refusal",
  "provider_error",
  "tool_error",
  "sandbox_error",
  "persistence_failed",
  "empty_terminal",
  "verification_failed",
  "permission_denied",
  "budget_exceeded",
  "timeout",
  "aborted",
  "unknown",
] as const;
export type CompletionReason = (typeof COMPLETION_REASONS)[number];

export const ERROR_CATEGORIES = [
  "none",
  "provider",
  "tool",
  "sandbox",
  "database",
  "auth",
  "permission",
  "validation",
  "timeout",
  "rate_limit",
  "budget",
  "internal",
  "unknown",
] as const;
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export const VERIFICATION_KINDS = ["build", "test", "browser", "overall"] as const;
export type VerificationKind = (typeof VERIFICATION_KINDS)[number];

export const VERIFICATION_STATUSES = ["not_run", "passed", "failed", "skipped"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const RUN_METRIC_COUNTERS = [
  "iterationCount",
  "modelCallCount",
  "providerErrorCount",
  "providerRetryCount",
  "routingClassifierCallCount",
  "routingClassifierTimeoutCount",
  "toolCallCount",
  "toolErrorCount",
  "toolRetryCount",
  "toolResultTruncatedCount",
  "webSearchUnitCount",
  "estimatedWebSearchUnitCount",
  "verificationCheckCount",
  "verificationFailureCount",
  "compactionCount",
  "compactionErrorCount",
  "compactedMessageCount",
  "subagentCount",
  "subagentErrorCount",
  "subagentProgressiveCount",
  "subagentLegacyCount",
  "filesChangedCount",
  "cacheHitCallCount",
  "cacheMissCallCount",
  "freshInputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheCreationTokens",
  "peakSystemPromptChars",
  "peakToolSchemaChars",
  "peakMessageChars",
  "peakEstimatedContextTokens",
  "initialToolCount",
  "peakToolCount",
  "initialCapabilityCount",
  "peakCapabilityCount",
  "capabilityLoadCount",
] as const;
export type RunMetricCounter = (typeof RUN_METRIC_COUNTERS)[number];

export type RunMetricCounters = Record<RunMetricCounter, number>;
export type RunMetricDurations = Record<RunMetricPhase, number>;

export interface RunMetricsDimensions {
  mode: RunMode;
  provider: ProviderBucket;
  modelBucket: ModelBucket;
  plannerProvider: ProviderBucket;
  plannerModelBucket: ModelBucket;
  executorProvider: ProviderBucket;
  executorModelBucket: ModelBucket;
  routeTier: RouteTier;
  routeSource: RouteSource;
  harnessProfile: HarnessProfile;
  profileCohort: ProfileCohort;
}

export interface RunVerificationOutcomes {
  build: VerificationStatus;
  test: VerificationStatus;
  browser: VerificationStatus;
  overall: VerificationStatus;
}

export interface RunOutcome {
  status: RunStatus;
  completionReason: CompletionReason;
  errorCategory: ErrorCategory;
  finalAnswerEmitted: boolean;
  verification: RunVerificationOutcomes;
}

export interface RunMetricsSnapshot {
  metricsVersion: 1;
  runId: string;
  startedAt: string;
  dimensions: RunMetricsDimensions;
  durations: RunMetricDurations & {
    total: number;
    /** First observed primary-provider time to first text/tool/thinking delta. */
    providerTtft: number | null;
    /** Sum + sample count support a weighted average across multi-call runs. */
    providerTtftTotal: number;
    providerTtftSamples: number;
  };
  counters: RunMetricCounters;
  outcome: RunOutcome;
}

export interface ProviderCallMetric {
  ttftMs?: number;
  error?: boolean;
  /** Explicit harness retry only; provider-SDK internal retries are not observable here. */
  retry?: boolean;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
}

export interface RunFinishInput {
  status: RunStatus;
  completionReason?: CompletionReason;
  errorCategory?: ErrorCategory;
  finalAnswerEmitted?: boolean;
}

interface PhaseState {
  active: Set<symbol>;
  activeSince: number | null;
  elapsedMs: number;
}

export interface RunMetricsOptions {
  runId?: string;
  mode?: RunMode;
  /** Monotonic clock used for durations. Injectable for deterministic tests. */
  now?: () => number;
  /** Wall clock used only for the non-sensitive started_at timestamp. */
  wallNow?: () => Date;
}

/** Postgres integer ceiling; clamping also prevents corrupted metric outliers. */
export const MAX_RUN_METRIC_INTEGER = 2_147_483_647;

function boundedInteger(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(MAX_RUN_METRIC_INTEGER, Math.round(value));
}

function emptyCounters(): RunMetricCounters {
  return Object.fromEntries(RUN_METRIC_COUNTERS.map((key) => [key, 0])) as RunMetricCounters;
}

function emptyVerification(): RunVerificationOutcomes {
  return { build: "not_run", test: "not_run", browser: "not_run", overall: "not_run" };
}

function phaseStates(): Record<RunMetricPhase, PhaseState> {
  return Object.fromEntries(
    RUN_METRIC_PHASES.map((phase) => [
      phase,
      { active: new Set<symbol>(), activeSince: null, elapsedMs: 0 },
    ]),
  ) as Record<RunMetricPhase, PhaseState>;
}

function knownValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T[number])
    : fallback;
}

export function normalizeRunMode(value: unknown): RunMode {
  return knownValue(value, RUN_MODES, "unknown");
}

export function normalizeProviderBucket(value: unknown): ProviderBucket {
  return knownValue(value, PROVIDER_BUCKETS, "unknown");
}

export function normalizeModelBucket(value: unknown): ModelBucket {
  return knownValue(value, MODEL_BUCKETS, "unknown");
}

export function normalizeRouteTier(value: unknown): RouteTier {
  return knownValue(value, ROUTE_TIERS, "unknown");
}

export function normalizeRouteSource(value: unknown): RouteSource {
  return knownValue(value, ROUTE_SOURCES, "unknown");
}

export function normalizeHarnessProfile(value: unknown): HarnessProfile {
  return knownValue(value, HARNESS_PROFILES, "unknown");
}

export function normalizeProfileCohort(value: unknown): ProfileCohort {
  return knownValue(value, PROFILE_COHORTS, "unknown");
}

export function normalizeRunStatus(value: unknown): RunStatus {
  return knownValue(value, RUN_STATUSES, "unknown");
}

export function normalizeCompletionReason(value: unknown): CompletionReason {
  return knownValue(value, COMPLETION_REASONS, "unknown");
}

export function normalizeErrorCategory(value: unknown): ErrorCategory {
  return knownValue(value, ERROR_CATEGORIES, "unknown");
}

export function normalizeVerificationStatus(value: unknown): VerificationStatus {
  return knownValue(value, VERIFICATION_STATUSES, "not_run");
}

/**
 * Collapse a provider-native model id into a small stable family. The original
 * id is intentionally discarded so env overrides cannot create unbounded
 * labels or put user-controlled text in telemetry.
 */
export function modelBucketFor(providerValue: unknown, modelValue: unknown): ModelBucket {
  const provider = normalizeProviderBucket(providerValue);
  if (typeof modelValue !== "string") return "unknown";
  const model = modelValue.toLowerCase();
  if (model.includes("haiku") || model.includes("compact") || model.includes("classif")) {
    return "internal";
  }
  if (provider === "anthropic") {
    if (model.includes("opus")) return "claude_opus";
    if (model.includes("sonnet")) return "claude_sonnet";
    return "provider_other";
  }
  if (provider === "google") {
    if (model.includes("flash")) return "gemini_flash";
    if (model.includes("pro")) return "gemini_pro";
    return "provider_other";
  }
  if (provider === "openai") {
    if (model.includes("codex")) return "gpt_codex";
    if (model.startsWith("gpt-")) return "gpt_general";
    return "provider_other";
  }
  if (provider === "zai") return model.includes("glm") ? "glm" : "provider_other";
  return "unknown";
}

function mergeVerificationStatus(
  current: VerificationStatus,
  next: VerificationStatus,
): VerificationStatus {
  if (current === "failed" || next === "failed") return "failed";
  if (current === "passed" || next === "passed") return "passed";
  if (current === "skipped" || next === "skipped") return "skipped";
  return "not_run";
}

/**
 * Mutable collector designed to be created once at the run boundary and passed
 * into preflight/loop helpers. Concurrent spans of the same phase are measured
 * as their wall-clock union, not summed, so parallel tool reads do not make a
 * run look slower than it was.
 */
export class RunMetricsCollector {
  readonly runId: string;
  readonly startedAt: string;

  private readonly now: () => number;
  private readonly startedAtMonotonic: number;
  private readonly phases = phaseStates();
  private readonly counters = emptyCounters();
  private readonly verification = emptyVerification();
  private readonly verificationChecks: Record<
    Exclude<VerificationKind, "overall">,
    Map<string, VerificationStatus>
  > = {
    build: new Map(),
    test: new Map(),
    browser: new Map(),
  };
  private readonly verificationLegacyGuards = new Map<symbol, Exclude<VerificationKind, "overall">>();
  private dimensions: RunMetricsDimensions;
  private providerTtftMs: number | null = null;
  private providerTtftTotalMs = 0;
  private providerTtftSamples = 0;
  private finishedAt: number | null = null;
  private outcome: Omit<RunOutcome, "verification"> = {
    status: "unknown",
    completionReason: "unknown",
    errorCategory: "none",
    finalAnswerEmitted: false,
  };

  constructor(options: RunMetricsOptions = {}) {
    this.runId = options.runId ?? randomUUID();
    this.now = options.now ?? (() => performance.now());
    this.startedAtMonotonic = this.now();
    this.startedAt = (options.wallNow?.() ?? new Date()).toISOString();
    this.dimensions = {
      mode: normalizeRunMode(options.mode),
      provider: "unknown",
      modelBucket: "unknown",
      plannerProvider: "unknown",
      plannerModelBucket: "unknown",
      executorProvider: "unknown",
      executorModelBucket: "unknown",
      routeTier: "unknown",
      routeSource: "unknown",
      harnessProfile: "unknown",
      profileCohort: "unknown",
    };
  }

  setMode(mode: unknown): void {
    if (this.finishedAt === null) this.dimensions.mode = normalizeRunMode(mode);
  }

  setModel(provider: unknown, model: unknown): void {
    if (this.finishedAt !== null) return;
    this.dimensions.provider = normalizeProviderBucket(provider);
    this.dimensions.modelBucket = modelBucketFor(provider, model);
  }

  setPhaseModel(phase: "planner" | "executor", provider: unknown, model: unknown): void {
    if (this.finishedAt !== null) return;
    const normalizedProvider = normalizeProviderBucket(provider);
    const bucket = modelBucketFor(provider, model);
    if (phase === "planner") {
      this.dimensions.plannerProvider = normalizedProvider;
      this.dimensions.plannerModelBucket = bucket;
    } else {
      this.dimensions.executorProvider = normalizedProvider;
      this.dimensions.executorModelBucket = bucket;
    }
    // Preserve the historical primary fields as the most recently active main
    // phase (executor for plan+execute, planner for plan-only).
    this.dimensions.provider = normalizedProvider;
    this.dimensions.modelBucket = bucket;
  }

  setRoute(tier: unknown, source: unknown): void {
    if (this.finishedAt !== null) return;
    this.dimensions.routeTier = normalizeRouteTier(tier);
    this.dimensions.routeSource = normalizeRouteSource(source);
  }

  setHarnessProfile(profile: unknown, cohort: unknown): void {
    if (this.finishedAt !== null) return;
    this.dimensions.harnessProfile = normalizeHarnessProfile(profile);
    this.dimensions.profileCohort = normalizeProfileCohort(cohort);
  }

  observeInitialHarness(toolCount: number, capabilityCount: number): void {
    if (this.finishedAt !== null) return;
    const tools = boundedInteger(toolCount);
    const capabilities = boundedInteger(capabilityCount);
    this.counters.initialToolCount = tools;
    this.counters.initialCapabilityCount = capabilities;
    this.counters.peakToolCount = Math.max(this.counters.peakToolCount, tools);
    this.counters.peakCapabilityCount = Math.max(
      this.counters.peakCapabilityCount,
      capabilities,
    );
  }

  recordCapabilityLoad(toolCount: number, capabilityCount: number): void {
    if (this.finishedAt !== null) return;
    this.increment("capabilityLoadCount");
    this.counters.peakToolCount = Math.max(
      this.counters.peakToolCount,
      boundedInteger(toolCount),
    );
    this.counters.peakCapabilityCount = Math.max(
      this.counters.peakCapabilityCount,
      boundedInteger(capabilityCount),
    );
  }

  /** Start an idempotently-stoppable phase span. */
  startPhase(phase: RunMetricPhase): () => void {
    if (this.finishedAt !== null) return () => undefined;
    const state = this.phases[phase];
    const token = Symbol(phase);
    const started = this.now();
    if (state.active.size === 0) state.activeSince = started;
    state.active.add(token);
    let stopped = false;
    return () => {
      if (stopped || this.finishedAt !== null) return;
      stopped = true;
      if (!state.active.delete(token)) return;
      if (state.active.size === 0 && state.activeSince !== null) {
        state.elapsedMs += Math.max(0, this.now() - state.activeSince);
        state.activeSince = null;
      }
    };
  }

  async measure<T>(phase: RunMetricPhase, operation: () => Promise<T>): Promise<T> {
    const stop = this.startPhase(phase);
    try {
      return await operation();
    } finally {
      stop();
    }
  }

  increment(counter: RunMetricCounter, amount = 1): void {
    if (this.finishedAt !== null) return;
    this.counters[counter] = boundedInteger(this.counters[counter] + boundedInteger(amount));
  }

  /** Set a peak-size gauge without retaining any of the measured content. */
  observeContextSize(input: {
    systemPromptChars?: number;
    toolSchemaChars?: number;
    messageChars?: number;
    estimatedContextTokens?: number;
  }): void {
    if (this.finishedAt !== null) return;
    const observations: Array<[RunMetricCounter, number | undefined]> = [
      ["peakSystemPromptChars", input.systemPromptChars],
      ["peakToolSchemaChars", input.toolSchemaChars],
      ["peakMessageChars", input.messageChars],
      ["peakEstimatedContextTokens", input.estimatedContextTokens],
    ];
    for (const [counter, value] of observations) {
      if (value === undefined) continue;
      this.counters[counter] = Math.max(this.counters[counter], boundedInteger(value));
    }
  }

  observeProviderTtft(durationMs: number): void {
    if (this.finishedAt !== null || !Number.isFinite(durationMs) || durationMs < 0) return;
    const bounded = boundedInteger(durationMs);
    if (this.providerTtftMs === null) this.providerTtftMs = bounded;
    this.providerTtftTotalMs = boundedInteger(this.providerTtftTotalMs + bounded);
    this.providerTtftSamples = boundedInteger(this.providerTtftSamples + 1);
  }

  recordProviderCall(metric: ProviderCallMetric = {}): void {
    this.increment("modelCallCount");
    if (metric.error) this.increment("providerErrorCount");
    if (metric.retry) this.increment("providerRetryCount");
    if (metric.ttftMs !== undefined) this.observeProviderTtft(metric.ttftMs);

    const usage = metric.usage;
    if (!usage) return;
    this.increment("freshInputTokens", usage.inputTokens ?? 0);
    this.increment("outputTokens", usage.outputTokens ?? 0);
    this.increment("cacheReadTokens", usage.cacheReadTokens ?? 0);
    this.increment("cacheCreationTokens", usage.cacheCreationTokens ?? 0);
    if ((usage.cacheReadTokens ?? 0) > 0) this.increment("cacheHitCallCount");
    else this.increment("cacheMissCallCount");
  }

  recordRoutingClassifier(input: { timedOut?: boolean } = {}): void {
    this.increment("routingClassifierCallCount");
    if (input.timedOut) this.increment("routingClassifierTimeoutCount");
  }

  recordToolCall(input: { error?: boolean; retry?: boolean; truncated?: boolean } = {}): void {
    this.increment("toolCallCount");
    if (input.error) this.increment("toolErrorCount");
    if (input.retry) this.increment("toolRetryCount");
    if (input.truncated) this.increment("toolResultTruncatedCount");
  }

  recordBillableToolUsage(
    units: number,
    accuracy: "exact" | "estimated",
  ): void {
    this.increment("webSearchUnitCount", units);
    if (accuracy === "estimated") {
      this.increment("estimatedWebSearchUnitCount", units);
    }
  }

  recordCompaction(input: { failed?: boolean; messagesCompacted?: number } = {}): void {
    this.increment("compactionCount");
    if (input.failed) this.increment("compactionErrorCount");
    this.increment("compactedMessageCount", input.messagesCompacted ?? 0);
  }

  recordSubagent(input: { failed?: boolean } = {}): void {
    this.increment("subagentCount");
    if (input.failed) this.increment("subagentErrorCount");
  }

  recordSubagentError(): void {
    this.increment("subagentErrorCount");
  }

  recordSubagentProfile(profile: "progressive" | "legacy"): void {
    this.increment(
      profile === "progressive"
        ? "subagentProgressiveCount"
        : "subagentLegacyCount",
    );
  }

  recordFilesChanged(count: number): void {
    this.increment("filesChangedCount", count);
  }

  recordVerification(kind: VerificationKind, status: VerificationStatus): void {
    if (this.finishedAt !== null) return;
    // The loop owns verification accounting. The interactive socket hook still
    // calls this legacy method for UI-era compatibility; an active guard means
    // that synchronous duplicate must not count or overwrite the keyed result.
    if (
      kind !== "overall" &&
      Array.from(this.verificationLegacyGuards.values()).includes(kind)
    ) {
      return;
    }
    const normalized = normalizeVerificationStatus(status);
    // Keep the final outcome for each verification kind. A failed test followed
    // by a successful rerun is a repaired result, while the separate failure
    // counter still captures the extra iteration it cost.
    if (normalized !== "not_run") this.verification[kind] = normalized;
    if (kind !== "overall" && normalized !== "not_run" && normalized !== "skipped") {
      this.increment("verificationCheckCount");
      if (normalized === "failed") this.increment("verificationFailureCount");
    }
  }

  /**
   * Record a real verification execution under a privacy-safe in-memory
   * fingerprint. Only a successful rerun of that same check can clear its
   * failure; an unrelated passing check in the same broad category cannot.
   *
   * The returned cleanup bounds a compatibility guard around the synchronous
   * `onToolResult` hook, whose legacy server observer would otherwise double
   * count this same result. No fingerprint is persisted.
   */
  recordVerificationAttempt(
    kind: Exclude<VerificationKind, "overall">,
    status: VerificationStatus | "evidence",
    fingerprint: string,
  ): () => void {
    if (this.finishedAt !== null) return () => undefined;
    const passiveEvidence = status === "evidence";
    const normalized = passiveEvidence ? "skipped" : normalizeVerificationStatus(status);
    const checks = this.verificationChecks[kind];
    const boundedFingerprint = /^[a-z0-9:_-]{1,64}$/i.test(fingerprint)
      ? fingerprint
      : "invalid";
    const key =
      checks.has(boundedFingerprint) || checks.size < 128
        ? boundedFingerprint
        : "overflow";
    const previous = checks.get(key);
    if (passiveEvidence) {
      // A plain screenshot is not a general browser assertion, but a successful
      // rerun of the exact screenshot that previously returned an HTTP error
      // does prove that specific failure was repaired.
      if (previous === "failed") checks.set(key, "passed");
      else if (previous === undefined) checks.set(key, "skipped");
    } else if (normalized !== "not_run") {
      if (normalized === "skipped") {
        // A skipped/denied attempt is evidence-free and must never clear an
        // earlier failure (or a prior pass) for the same check.
        if (previous === undefined) checks.set(key, "skipped");
      } else if (key === "overflow" && previous === "failed") {
        // Once distinct checks overflow the bound, stay conservative: a pass
        // from an unknown check cannot prove which overflowed failure it reran.
      } else {
        checks.set(key, normalized);
      }
    }
    if (
      (passiveEvidence && previous === "failed") ||
      (!passiveEvidence && normalized !== "not_run" && normalized !== "skipped")
    ) {
      this.increment("verificationCheckCount");
      if (normalized === "failed") this.increment("verificationFailureCount");
    }
    this.verification[kind] = Array.from(checks.values()).reduce(
      mergeVerificationStatus,
      "not_run",
    );

    const guard = Symbol(kind);
    this.verificationLegacyGuards.set(guard, kind);
    return () => {
      this.verificationLegacyGuards.delete(guard);
    };
  }

  finish(input: RunFinishInput): RunMetricsSnapshot {
    if (this.finishedAt === null) {
      const ended = this.now();
      const status = normalizeRunStatus(input.status);
      this.finishedAt = ended;
      for (const phase of RUN_METRIC_PHASES) {
        const state = this.phases[phase];
        if (state.active.size > 0 && state.activeSince !== null) {
          state.elapsedMs += Math.max(0, ended - state.activeSince);
          state.active.clear();
          state.activeSince = null;
        }
      }
      if (this.verification.overall === "not_run") {
        this.verification.overall = [
          this.verification.build,
          this.verification.test,
          this.verification.browser,
        ].reduce(mergeVerificationStatus, "not_run");
      }
      const requestedCompletionReason =
        input.completionReason === undefined
          ? status === "success"
            ? "completed"
            : status === "aborted"
              ? "aborted"
              : "unknown"
          : normalizeCompletionReason(input.completionReason);
      const unresolvedVerificationFailure =
        status === "success" && this.verification.overall === "failed";
      this.outcome = {
        status: unresolvedVerificationFailure ? "error" : status,
        completionReason:
          unresolvedVerificationFailure && requestedCompletionReason === "completed"
            ? "verification_failed"
            : requestedCompletionReason,
        errorCategory: unresolvedVerificationFailure
          ? "tool"
          : input.errorCategory === undefined
            ? status === "success"
              ? "none"
              : "unknown"
            : normalizeErrorCategory(input.errorCategory),
        finalAnswerEmitted: input.finalAnswerEmitted === true,
      };
    }
    return this.snapshot();
  }

  snapshot(): RunMetricsSnapshot {
    const now = this.finishedAt ?? this.now();
    const durations = Object.fromEntries(
      RUN_METRIC_PHASES.map((phase) => {
        const state = this.phases[phase];
        const openMs =
          state.active.size > 0 && state.activeSince !== null ? Math.max(0, now - state.activeSince) : 0;
        return [phase, boundedInteger(state.elapsedMs + openMs)];
      }),
    ) as RunMetricDurations;
    return {
      metricsVersion: 1,
      runId: this.runId,
      startedAt: this.startedAt,
      dimensions: { ...this.dimensions },
      durations: {
        ...durations,
        total: boundedInteger(now - this.startedAtMonotonic),
        providerTtft: this.providerTtftMs,
        providerTtftTotal: this.providerTtftTotalMs,
        providerTtftSamples: this.providerTtftSamples,
      },
      counters: { ...this.counters },
      outcome: {
        ...this.outcome,
        verification: { ...this.verification },
      },
    };
  }
}

export function createRunMetrics(options: RunMetricsOptions = {}): RunMetricsCollector {
  return new RunMetricsCollector(options);
}
