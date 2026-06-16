import { estimateTurnCostUsd } from "@uniqus/api-types";
import { db } from "./client.js";

/**
 * Per-turn token-usage analytics (Plan §5 — dashboard usage widgets). One row
 * is written at the end of each completed agent turn; the dashboard aggregates
 * them through the `account_usage_stats` SQL function (see schema.sql) to power
 * the total-tokens / cost / time-spent / top-models cards.
 *
 * `inputTokens` is FRESH (uncached) input only. Cached prompt tokens are split
 * into their own buckets (read / creation) so the dashboard can price them at
 * the discounted cache rates instead of billing every replayed prefix token at
 * the full input rate — the bug that made small tasks look like millions of
 * input tokens.
 */

export interface RecordUsageInput {
  projectId: string;
  userId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Prompt tokens served from cache (billed ~0.1×). Defaults to 0. */
  cacheReadTokens?: number;
  /** Tokens written to the cache (Anthropic, ~1.25×). Defaults to 0. */
  cacheCreationTokens?: number;
  /**
   * Estimated USD cost SNAPSHOT for this turn (api-types estimateTurnCostUsd,
   * long-context band applied). Stored so the account total reflects the price
   * at the time, not whatever the rates are when the dashboard is later viewed.
   */
  costUsd?: number;
  elapsedMs: number;
}

/**
 * True if a Supabase/PostgREST error indicates an optional analytics column
 * (the cache_* split or the cost snapshot) hasn't been migrated yet — the
 * schema-cache miss code, or a message naming a missing column. Lets
 * recordUsageEvent fall back to a leaner insert so analytics keep working on an
 * un-migrated DB rather than dropping every usage row.
 */
function isMissingColumnError(error: { code?: string; message?: string }): boolean {
  if (error.code === "PGRST204") return true;
  const msg = (error.message ?? "").toLowerCase();
  if (
    msg.includes("cache_read_tokens") ||
    msg.includes("cache_creation_tokens") ||
    msg.includes("cost_usd")
  ) {
    return true;
  }
  return msg.includes("column") && (msg.includes("does not exist") || msg.includes("schema cache"));
}

export async function recordUsageEvent(input: RecordUsageInput): Promise<void> {
  const base = {
    project_id: input.projectId,
    user_id: input.userId,
    provider: input.provider,
    model: input.model,
    input_tokens: Math.max(0, Math.round(input.inputTokens)),
    output_tokens: Math.max(0, Math.round(input.outputTokens)),
    elapsed_ms: Math.max(0, Math.round(input.elapsedMs)),
  };
  const withCache = {
    ...base,
    cache_read_tokens: Math.max(0, Math.round(input.cacheReadTokens ?? 0)),
    cache_creation_tokens: Math.max(0, Math.round(input.cacheCreationTokens ?? 0)),
  };
  const full =
    input.costUsd === undefined
      ? withCache
      : { ...withCache, cost_usd: Math.max(0, input.costUsd) };

  // Degrade column-by-column on an un-migrated DB: full (cache + cost) →
  // cache-only → base. Each fallback only runs on a missing-column error, so a
  // fully-migrated DB inserts once and a partial one keeps the columns it has.
  let { error } = await db().from("usage_events").insert(full);
  if (error && isMissingColumnError(error) && full !== withCache) {
    ({ error } = await db().from("usage_events").insert(withCache));
  }
  if (error && isMissingColumnError(error)) {
    ({ error } = await db().from("usage_events").insert(base));
  }
  if (error) throw new Error(`recordUsageEvent failed: ${error.message}`);
}

/** Per-model rollup as returned by the `account_usage_stats` SQL function. */
export interface UsagePerModel {
  model: string;
  provider: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  /** Σ of the per-turn cost SNAPSHOTS for this model (rows that have one). */
  cost_usd: number;
  /**
   * Token sums restricted to LEGACY rows (no cost snapshot). The API layer
   * prices these at read time with estimateCostUsd and adds them to `cost_usd`,
   * so the account total still counts pre-snapshot turns.
   */
  uncosted_input_tokens: number;
  uncosted_output_tokens: number;
  uncosted_cache_read_tokens: number;
  uncosted_cache_creation_tokens: number;
  turns: number;
}

/** Raw aggregate from the DB; the API layer adds cost + display labels. */
export interface UsageAggregate {
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read_tokens: number;
  total_cache_creation_tokens: number;
  total_time_ms: number;
  turns: number;
  per_model: UsagePerModel[];
}

const EMPTY_AGGREGATE: UsageAggregate = {
  total_input_tokens: 0,
  total_output_tokens: 0,
  total_cache_read_tokens: 0,
  total_cache_creation_tokens: 0,
  total_time_ms: 0,
  turns: 0,
  per_model: [],
};

/**
 * Account-wide usage aggregate. Computed in Postgres (so it isn't capped by
 * PostgREST's row limit) via the `account_usage_stats` function. Returns zeros
 * if the function/table haven't been migrated yet, so the dashboard degrades
 * gracefully rather than erroring. Cache fields are coalesced to 0 so an older
 * `account_usage_stats` (without the cache columns) still parses cleanly.
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
    total_cache_read_tokens: Number(raw.total_cache_read_tokens ?? 0),
    total_cache_creation_tokens: Number(raw.total_cache_creation_tokens ?? 0),
    total_time_ms: Number(raw.total_time_ms ?? 0),
    turns: Number(raw.turns ?? 0),
    per_model: Array.isArray(raw.per_model)
      ? (raw.per_model as Array<Partial<UsagePerModel>>).map((m) => {
          const input_tokens = Number(m.input_tokens ?? 0);
          const output_tokens = Number(m.output_tokens ?? 0);
          const cache_read_tokens = Number(m.cache_read_tokens ?? 0);
          const cache_creation_tokens = Number(m.cache_creation_tokens ?? 0);
          return {
            model: String(m.model),
            provider: String(m.provider),
            input_tokens,
            output_tokens,
            cache_read_tokens,
            cache_creation_tokens,
            cost_usd: Number(m.cost_usd ?? 0),
            // When the SQL function predates the cost snapshot it omits the
            // uncosted_* fields; treat EVERY token as uncosted so the read-time
            // estimate prices the whole model (the pre-snapshot behavior) rather
            // than zeroing its cost.
            uncosted_input_tokens:
              m.uncosted_input_tokens === undefined ? input_tokens : Number(m.uncosted_input_tokens),
            uncosted_output_tokens:
              m.uncosted_output_tokens === undefined ? output_tokens : Number(m.uncosted_output_tokens),
            uncosted_cache_read_tokens:
              m.uncosted_cache_read_tokens === undefined
                ? cache_read_tokens
                : Number(m.uncosted_cache_read_tokens),
            uncosted_cache_creation_tokens:
              m.uncosted_cache_creation_tokens === undefined
                ? cache_creation_tokens
                : Number(m.uncosted_cache_creation_tokens),
            turns: Number(m.turns ?? 0),
          };
        })
      : [],
  };
}

/** Token sub-totals shared by the per-model breakdown rows below. */
interface ModelTokenTotals {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  /**
   * Σ of the per-turn cost (estimateTurnCostUsd) of every row in this bucket.
   * Priced PER ROW so the long-context band keys off each turn's own prompt
   * size — summing the bucket's tokens first would wrongly cross the band.
   */
  cost_usd: number;
}

/** One (date, model) bucket from {@link getDailyUsageByModel}. */
export interface DailyUsageByModelRow extends ModelTokenTotals {
  /** Calendar day in the orchestrator's LOCAL timezone, YYYY-MM-DD. */
  date: string;
  model: string;
}

/**
 * Bucket an event's `created_at` (a UTC ISO string) into a YYYY-MM-DD calendar
 * day in the orchestrator's LOCAL timezone. Slicing the raw UTC string would
 * misattribute usage by one day on non-UTC deployments (B-15); the dashboard's
 * other day-boundary logic is local-time, so match it. Built from local
 * getFullYear/Month/Date rather than toISOString (which is always UTC).
 */
function localDayKey(createdAt: string): string {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return String(createdAt).slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** One (project, model) bucket from {@link getUsageByProjectByModel}. */
export interface ProjectUsageByModelRow extends ModelTokenTotals {
  project_id: string;
  project_name: string;
  model: string;
  /** Provider for this model (from usage_events.provider). */
  provider: string;
  /** Number of usage_events (turns) in this (project, model) bucket. */
  turns: number;
}

/** Page size when sweeping usage_events; PostgREST caps a request at 1000. */
const USAGE_PAGE_SIZE = 1000;

const ZERO_TOTALS = (): ModelTokenTotals => ({
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
  cost_usd: 0,
});

/**
 * Add one event's token columns into an accumulator bucket, plus its per-turn
 * estimated cost (long-context band applied to this row's own prompt size).
 * Recomputed from the token split rather than read from the stored cost_usd
 * snapshot, so the breakdown works even on a DB where cost_usd isn't migrated.
 */
function addTokens(into: ModelTokenTotals, row: Partial<UsageEventRow>): void {
  const input_tokens = Number(row.input_tokens ?? 0);
  const output_tokens = Number(row.output_tokens ?? 0);
  const cache_read_tokens = Number(row.cache_read_tokens ?? 0);
  const cache_creation_tokens = Number(row.cache_creation_tokens ?? 0);
  into.input_tokens += input_tokens;
  into.output_tokens += output_tokens;
  into.cache_read_tokens += cache_read_tokens;
  into.cache_creation_tokens += cache_creation_tokens;
  into.cost_usd += estimateTurnCostUsd(String(row.model ?? ""), {
    inputTokens: input_tokens,
    outputTokens: output_tokens,
    cacheReadTokens: cache_read_tokens,
    cacheCreationTokens: cache_creation_tokens,
  });
}

/** Raw usage_events columns the breakdown sweeps read. */
interface UsageEventRow {
  project_id: string | null;
  /** Selected only by the by-project sweep; absent in the daily sweep. */
  provider?: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  created_at: string;
  projects?: { name: string | null } | { name: string | null }[] | null;
}

/**
 * Sweep every usage_events row for `userId` (optionally only those on/after
 * `sinceIso`), paging past PostgREST's per-request row cap so the breakdown
 * isn't silently truncated for heavy accounts. `select` chooses the columns
 * (and any embedded `projects` join). Returns [] and logs on error so the
 * dashboard degrades gracefully like getUsageAggregate.
 */
async function sweepUsageEvents(
  userId: string,
  select: string,
  sinceIso?: string,
): Promise<UsageEventRow[]> {
  const rows: UsageEventRow[] = [];
  for (let from = 0; ; from += USAGE_PAGE_SIZE) {
    let query = db()
      .from("usage_events")
      .select(select)
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .range(from, from + USAGE_PAGE_SIZE - 1);
    if (sinceIso) query = query.gte("created_at", sinceIso);
    const { data, error } = await query;
    if (error) {
      console.error("sweepUsageEvents failed (returning partial):", error.message);
      break;
    }
    const page = (data ?? []) as unknown as UsageEventRow[];
    rows.push(...page);
    if (page.length < USAGE_PAGE_SIZE) break;
  }
  return rows;
}

/**
 * Per-day, per-model token breakdown for the last `days` days for `userId`,
 * ordered by date (oldest-first). The server prices each model row with its
 * existing estimateCostUsd to build AccountUsageStats.daily — so this returns
 * token/model splits, not cost. `date` is created_at truncated to the calendar
 * day in the orchestrator's LOCAL timezone, matching how the trend chart buckets
 * time (see localDayKey / B-15).
 */
export async function getDailyUsageByModel(
  userId: string,
  days = 30,
): Promise<DailyUsageByModelRow[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const rows = await sweepUsageEvents(
    userId,
    "model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, created_at",
    since,
  );
  // Bucket per (date, model). Map insertion order follows created_at because
  // the sweep is ordered ascending, so the date order is already oldest-first.
  const buckets = new Map<string, DailyUsageByModelRow>();
  for (const row of rows) {
    const date = localDayKey(String(row.created_at)); // local-time YYYY-MM-DD (B-15)
    const model = String(row.model);
    const key = `${date} ${model}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { date, model, ...ZERO_TOTALS() };
      buckets.set(key, bucket);
    }
    addTokens(bucket, row);
  }
  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Pull the project name out of an embedded PostgREST `projects` join. */
function projectName(projects: UsageEventRow["projects"]): string {
  if (!projects) return "";
  const rel = Array.isArray(projects) ? projects[0] : projects;
  return rel?.name ?? "";
}

/**
 * Per-project, per-model token breakdown across all of `userId`'s usage
 * (LEFT JOIN projects for the display name). Per-model rows so the server can
 * price each model correctly with estimateCostUsd before rolling up into
 * AccountUsageStats.by_project. Rows with no surviving project (deleted) carry
 * an empty project_name; the server decides how to label them.
 */
export async function getUsageByProjectByModel(
  userId: string,
): Promise<ProjectUsageByModelRow[]> {
  const rows = await sweepUsageEvents(
    userId,
    "project_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, created_at, projects(name)",
  );
  const buckets = new Map<string, ProjectUsageByModelRow>();
  for (const row of rows) {
    const projectId = row.project_id ?? "";
    const model = String(row.model);
    const key = `${projectId} ${model}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        project_id: projectId,
        project_name: projectName(row.projects),
        model,
        provider: String(row.provider ?? ""),
        turns: 0,
        ...ZERO_TOTALS(),
      };
      buckets.set(key, bucket);
    }
    addTokens(bucket, row);
    bucket.turns += 1;
  }
  return [...buckets.values()];
}
