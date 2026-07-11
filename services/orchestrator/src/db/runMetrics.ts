import { db } from "./client.js";
import {
  MAX_RUN_METRIC_INTEGER,
  normalizeCompletionReason,
  normalizeErrorCategory,
  normalizeModelBucket,
  normalizeProviderBucket,
  normalizeRouteSource,
  normalizeRouteTier,
  normalizeHarnessProfile,
  normalizeProfileCohort,
  normalizeRunMode,
  normalizeRunStatus,
  normalizeVerificationStatus,
  type RunMetricsSnapshot,
} from "../telemetry/runMetrics.js";

export interface RecordAgentRunMetricsInput {
  projectId: string | null;
  userId: string | null;
  metrics: RunMetricsSnapshot;
}

/** Exact DB shape: intentionally no JSON metadata or free-form text columns. */
export interface AgentRunMetricsRow {
  run_id: string;
  project_id: string | null;
  user_id: string | null;
  metrics_version: number;
  started_at: string;
  run_mode: string;
  provider: string;
  model_bucket: string;
  planner_provider: string;
  planner_model_bucket: string;
  executor_provider: string;
  executor_model_bucket: string;
  route_tier: string;
  route_source: string;
  harness_profile: string;
  profile_cohort: string;
  sandbox_ms: number;
  preflight_ms: number;
  routing_ms: number;
  provider_ttft_ms: number | null;
  provider_ttft_total_ms: number;
  provider_ttft_samples: number;
  model_ms: number;
  tool_ms: number;
  verification_ms: number;
  persistence_ms: number;
  user_wait_ms: number;
  total_ms: number;
  iteration_count: number;
  model_call_count: number;
  provider_error_count: number;
  provider_retry_count: number;
  routing_classifier_call_count: number;
  routing_classifier_timeout_count: number;
  tool_call_count: number;
  tool_error_count: number;
  tool_retry_count: number;
  tool_result_truncated_count: number;
  web_search_unit_count: number;
  estimated_web_search_unit_count: number;
  verification_check_count: number;
  verification_failure_count: number;
  compaction_count: number;
  compaction_error_count: number;
  compacted_message_count: number;
  subagent_count: number;
  subagent_error_count: number;
  subagent_progressive_count: number;
  subagent_legacy_count: number;
  files_changed_count: number;
  cache_hit_call_count: number;
  cache_miss_call_count: number;
  fresh_input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  peak_system_prompt_chars: number;
  peak_tool_schema_chars: number;
  peak_message_chars: number;
  peak_estimated_context_tokens: number;
  initial_tool_count: number;
  peak_tool_count: number;
  initial_capability_count: number;
  peak_capability_count: number;
  capability_load_count: number;
  run_status: string;
  completion_reason: string;
  error_category: string;
  final_answer_emitted: boolean;
  build_status: string;
  test_status: string;
  browser_status: string;
  verification_status: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value: string | null, field: string): string | null {
  if (value === null) return null;
  if (!UUID_PATTERN.test(value)) throw new Error(`invalid ${field}`);
  return value.toLowerCase();
}

function metricInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(MAX_RUN_METRIC_INTEGER, Math.round(value));
}

function metricTimestamp(value: unknown): string {
  if (typeof value !== "string") throw new Error("invalid metrics startedAt");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("invalid metrics startedAt");
  return parsed.toISOString();
}

/**
 * Runtime-normalize even a structurally forged snapshot before persistence.
 * Besides making inserts resilient, this is the final privacy/cardinality
 * boundary: only explicit fields and bounded enum values leave this function.
 */
export function toAgentRunMetricsRow(input: RecordAgentRunMetricsInput): AgentRunMetricsRow {
  const { metrics } = input;
  const d = metrics.durations;
  const c = metrics.counters;
  const o = metrics.outcome;
  return {
    run_id: uuid(metrics.runId, "metrics runId")!,
    project_id: uuid(input.projectId, "projectId"),
    user_id: uuid(input.userId, "userId"),
    metrics_version: 1,
    started_at: metricTimestamp(metrics.startedAt),
    run_mode: normalizeRunMode(metrics.dimensions?.mode),
    provider: normalizeProviderBucket(metrics.dimensions?.provider),
    model_bucket: normalizeModelBucket(metrics.dimensions?.modelBucket),
    planner_provider: normalizeProviderBucket(metrics.dimensions?.plannerProvider),
    planner_model_bucket: normalizeModelBucket(metrics.dimensions?.plannerModelBucket),
    executor_provider: normalizeProviderBucket(metrics.dimensions?.executorProvider),
    executor_model_bucket: normalizeModelBucket(metrics.dimensions?.executorModelBucket),
    route_tier: normalizeRouteTier(metrics.dimensions?.routeTier),
    route_source: normalizeRouteSource(metrics.dimensions?.routeSource),
    harness_profile: normalizeHarnessProfile(metrics.dimensions?.harnessProfile),
    profile_cohort: normalizeProfileCohort(metrics.dimensions?.profileCohort),
    sandbox_ms: metricInteger(d?.sandbox),
    preflight_ms: metricInteger(d?.preflight),
    routing_ms: metricInteger(d?.routing),
    provider_ttft_ms:
      typeof d?.providerTtft === "number" && Number.isFinite(d.providerTtft)
        ? metricInteger(d.providerTtft)
        : null,
    provider_ttft_total_ms: metricInteger(d?.providerTtftTotal),
    provider_ttft_samples: metricInteger(d?.providerTtftSamples),
    model_ms: metricInteger(d?.model),
    tool_ms: metricInteger(d?.tool),
    verification_ms: metricInteger(d?.verification),
    persistence_ms: metricInteger(d?.persistence),
    user_wait_ms: metricInteger(d?.userWait),
    total_ms: metricInteger(d?.total),
    iteration_count: metricInteger(c?.iterationCount),
    model_call_count: metricInteger(c?.modelCallCount),
    provider_error_count: metricInteger(c?.providerErrorCount),
    provider_retry_count: metricInteger(c?.providerRetryCount),
    routing_classifier_call_count: metricInteger(c?.routingClassifierCallCount),
    routing_classifier_timeout_count: metricInteger(c?.routingClassifierTimeoutCount),
    tool_call_count: metricInteger(c?.toolCallCount),
    tool_error_count: metricInteger(c?.toolErrorCount),
    tool_retry_count: metricInteger(c?.toolRetryCount),
    tool_result_truncated_count: metricInteger(c?.toolResultTruncatedCount),
    web_search_unit_count: metricInteger(c?.webSearchUnitCount),
    estimated_web_search_unit_count: metricInteger(c?.estimatedWebSearchUnitCount),
    verification_check_count: metricInteger(c?.verificationCheckCount),
    verification_failure_count: metricInteger(c?.verificationFailureCount),
    compaction_count: metricInteger(c?.compactionCount),
    compaction_error_count: metricInteger(c?.compactionErrorCount),
    compacted_message_count: metricInteger(c?.compactedMessageCount),
    subagent_count: metricInteger(c?.subagentCount),
    subagent_error_count: metricInteger(c?.subagentErrorCount),
    subagent_progressive_count: metricInteger(c?.subagentProgressiveCount),
    subagent_legacy_count: metricInteger(c?.subagentLegacyCount),
    files_changed_count: metricInteger(c?.filesChangedCount),
    cache_hit_call_count: metricInteger(c?.cacheHitCallCount),
    cache_miss_call_count: metricInteger(c?.cacheMissCallCount),
    fresh_input_tokens: metricInteger(c?.freshInputTokens),
    output_tokens: metricInteger(c?.outputTokens),
    cache_read_tokens: metricInteger(c?.cacheReadTokens),
    cache_creation_tokens: metricInteger(c?.cacheCreationTokens),
    peak_system_prompt_chars: metricInteger(c?.peakSystemPromptChars),
    peak_tool_schema_chars: metricInteger(c?.peakToolSchemaChars),
    peak_message_chars: metricInteger(c?.peakMessageChars),
    peak_estimated_context_tokens: metricInteger(c?.peakEstimatedContextTokens),
    initial_tool_count: metricInteger(c?.initialToolCount),
    peak_tool_count: metricInteger(c?.peakToolCount),
    initial_capability_count: metricInteger(c?.initialCapabilityCount),
    peak_capability_count: metricInteger(c?.peakCapabilityCount),
    capability_load_count: metricInteger(c?.capabilityLoadCount),
    run_status: normalizeRunStatus(o?.status),
    completion_reason: normalizeCompletionReason(o?.completionReason),
    error_category: normalizeErrorCategory(o?.errorCategory),
    final_answer_emitted: o?.finalAnswerEmitted === true,
    build_status: normalizeVerificationStatus(o?.verification?.build),
    test_status: normalizeVerificationStatus(o?.verification?.test),
    browser_status: normalizeVerificationStatus(o?.verification?.browser),
    verification_status: normalizeVerificationStatus(o?.verification?.overall),
  };
}

function safeErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Z0-9_]{1,24}$/i.test(code) ? code : "unknown";
}

/**
 * Best-effort analytics write. Telemetry must never make an otherwise healthy
 * agent run fail, including while the schema is being rolled out.
 */
export async function recordAgentRunMetrics(input: RecordAgentRunMetricsInput): Promise<boolean> {
  try {
    const row = toAgentRunMetricsRow(input);
    const { error } = await db()
      .from("agent_run_metrics")
      .upsert(row, { onConflict: "run_id", ignoreDuplicates: true });
    if (error) {
      console.error(`recordAgentRunMetrics failed (${safeErrorCode(error)})`);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`recordAgentRunMetrics failed (${safeErrorCode(error)})`);
    return false;
  }
}

/**
 * Mark an immediate later turn as a correction of this run without storing the
 * follow-up text. The caller is responsible for the product-level correction
 * heuristic; ownership is included in the update predicate as defense in depth.
 */
export async function markAgentRunCorrection(
  runId: string,
  userId: string,
): Promise<boolean> {
  try {
    const safeRunId = uuid(runId, "runId")!;
    const safeUserId = uuid(userId, "userId")!;
    const { error } = await db()
      .from("agent_run_metrics")
      .update({ correction_followup: true, correction_recorded_at: new Date().toISOString() })
      .eq("run_id", safeRunId)
      .eq("user_id", safeUserId);
    if (error) {
      console.error(`markAgentRunCorrection failed (${safeErrorCode(error)})`);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`markAgentRunCorrection failed (${safeErrorCode(error)})`);
    return false;
  }
}
