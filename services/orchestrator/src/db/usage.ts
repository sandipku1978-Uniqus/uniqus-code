import { db } from "./client.js";

/**
 * Per-turn token-usage analytics (Plan §5 — dashboard usage widgets). One row
 * is written at the end of each completed agent turn; the dashboard aggregates
 * them through the `account_usage_stats` SQL function (see schema.sql) to power
 * the total-tokens / cost / time-spent / top-models cards.
 */

export interface RecordUsageInput {
  projectId: string;
  userId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  elapsedMs: number;
}

export async function recordUsageEvent(input: RecordUsageInput): Promise<void> {
  const { error } = await db().from("usage_events").insert({
    project_id: input.projectId,
    user_id: input.userId,
    provider: input.provider,
    model: input.model,
    input_tokens: Math.max(0, Math.round(input.inputTokens)),
    output_tokens: Math.max(0, Math.round(input.outputTokens)),
    elapsed_ms: Math.max(0, Math.round(input.elapsedMs)),
  });
  if (error) throw new Error(`recordUsageEvent failed: ${error.message}`);
}

/** Per-model rollup as returned by the `account_usage_stats` SQL function. */
export interface UsagePerModel {
  model: string;
  provider: string;
  input_tokens: number;
  output_tokens: number;
  turns: number;
}

/** Raw aggregate from the DB; the API layer adds cost + display labels. */
export interface UsageAggregate {
  total_input_tokens: number;
  total_output_tokens: number;
  total_time_ms: number;
  turns: number;
  per_model: UsagePerModel[];
}

const EMPTY_AGGREGATE: UsageAggregate = {
  total_input_tokens: 0,
  total_output_tokens: 0,
  total_time_ms: 0,
  turns: 0,
  per_model: [],
};

/**
 * Account-wide usage aggregate. Computed in Postgres (so it isn't capped by
 * PostgREST's row limit) via the `account_usage_stats` function. Returns zeros
 * if the function/table haven't been migrated yet, so the dashboard degrades
 * gracefully rather than erroring.
 */
export async function getUsageAggregate(ownerId: string): Promise<UsageAggregate> {
  const { data, error } = await db().rpc("account_usage_stats", { uid: ownerId });
  if (error) {
    console.error("getUsageAggregate failed (returning zeros):", error.message);
    return EMPTY_AGGREGATE;
  }
  const raw = (data ?? {}) as Partial<UsageAggregate>;
  return {
    total_input_tokens: Number(raw.total_input_tokens ?? 0),
    total_output_tokens: Number(raw.total_output_tokens ?? 0),
    total_time_ms: Number(raw.total_time_ms ?? 0),
    turns: Number(raw.turns ?? 0),
    per_model: Array.isArray(raw.per_model)
      ? raw.per_model.map((m) => ({
          model: String(m.model),
          provider: String(m.provider),
          input_tokens: Number(m.input_tokens ?? 0),
          output_tokens: Number(m.output_tokens ?? 0),
          turns: Number(m.turns ?? 0),
        }))
      : [],
  };
}
