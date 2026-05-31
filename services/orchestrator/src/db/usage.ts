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
  elapsedMs: number;
}

/**
 * True if a Supabase/PostgREST error indicates the cache_* columns haven't been
 * migrated yet (the schema-cache miss code, or a message naming a missing
 * column). Lets recordUsageEvent fall back to the base insert so analytics keep
 * working on an un-migrated DB rather than dropping every usage row.
 */
function isMissingCacheColumnError(error: { code?: string; message?: string }): boolean {
  if (error.code === "PGRST204") return true;
  const msg = (error.message ?? "").toLowerCase();
  if (msg.includes("cache_read_tokens") || msg.includes("cache_creation_tokens")) return true;
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
  let { error } = await db().from("usage_events").insert(withCache);
  if (error && isMissingCacheColumnError(error)) {
    // Cache columns not migrated yet — record the base row so the dashboard
    // still gets input/output/time. Apply schema.sql to enable cache analytics.
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
      ? raw.per_model.map((m) => ({
          model: String(m.model),
          provider: String(m.provider),
          input_tokens: Number(m.input_tokens ?? 0),
          output_tokens: Number(m.output_tokens ?? 0),
          cache_read_tokens: Number(m.cache_read_tokens ?? 0),
          cache_creation_tokens: Number(m.cache_creation_tokens ?? 0),
          turns: Number(m.turns ?? 0),
        }))
      : [],
  };
}

/** Token sub-totals shared by the per-model breakdown rows below. */
interface ModelTokenTotals {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
}

/** One (date, model) bucket from {@link getDailyUsageByModel}. */
export interface DailyUsageByModelRow extends ModelTokenTotals {
  /** Calendar day in the DB's timezone, YYYY-MM-DD (from created_at). */
  date: string;
  model: string;
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
});

/** Add one event's token columns into an accumulator bucket. */
function addTokens(into: ModelTokenTotals, row: Partial<UsageEventRow>): void {
  into.input_tokens += Number(row.input_tokens ?? 0);
  into.output_tokens += Number(row.output_tokens ?? 0);
  into.cache_read_tokens += Number(row.cache_read_tokens ?? 0);
  into.cache_creation_tokens += Number(row.cache_creation_tokens ?? 0);
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
 * day (DB timezone), matching how the trend chart buckets time.
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
    const date = String(row.created_at).slice(0, 10); // YYYY-MM-DD
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
