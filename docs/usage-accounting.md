# Usage accounting

How the orchestrator counts tokens and estimates cost per turn. Code-grounded
in [`db/usage.ts`](../services/orchestrator/src/db/usage.ts),
the `usage_events` table + `account_usage_stats` function in
[`db/schema.sql`](../services/orchestrator/src/db/schema.sql),
`MODEL_PRICING` / `estimateCostUsd` in
[`packages/api-types/src/index.ts`](../packages/api-types/src/index.ts), and the
recording/aggregation calls in
[`services/orchestrator/src/server.ts`](../services/orchestrator/src/server.ts).

## The four token classes

A turn's usage is split into four buckets so cached prompt tokens aren't billed
at the full input rate (the bug that made small tasks look like millions of
input tokens):

| Class | Column | Meaning | Priced at |
| --- | --- | --- | --- |
| `input_tokens` | `input_tokens` | **FRESH (uncached)** input only | full `input` rate |
| `output_tokens` | `output_tokens` | generated output | `output` rate |
| `cache_read_tokens` | `cache_read_tokens` | prompt tokens served from cache | `input × 0.1` |
| `cache_creation_tokens` | `cache_creation_tokens` | tokens written to the cache (Anthropic) | `input × 1.25` |

`db/usage.ts` is explicit: `inputTokens` is fresh/uncached input only; replayed
prefix tokens go into the cache buckets, not the full-price input bucket.
The provider adapters populate all four (`loop.ts`'s `usage` shape carries
`inputTokens` / `outputTokens` / `cacheReadTokens` / `cacheCreationTokens`).

## Per-model pricing (`MODEL_PRICING`)

`MODEL_PRICING` in `@uniqus/api-types` maps the provider-native model id to
approximate published list prices in **USD per 1,000,000 tokens**
(`{ input, output }`). Current entries include `claude-opus-4-8`
(`{5, 25}`), `claude-sonnet-4-6` (`{3, 15}`), `gpt-5.5` (`{1.25, 10}`),
`gpt-5.5-pro` (`{15, 120}`), `gemini-3.1-pro-preview-customtools` (`{2, 12}`),
and others. Unknown model ids fall back to `DEFAULT_PRICE` (`{ input: 3,
output: 15 }`).

Cache multipliers (relative to the model's fresh `input` rate):

- `CACHE_READ_MULTIPLIER = 0.1` — a cache read is ~10% of fresh input.
- `CACHE_WRITE_MULTIPLIER = 1.25` — a cache write (Anthropic, the one-time cost
  of populating the 5-minute cache) is 1.25× fresh input.

These are **best-effort estimates for the dashboard, not a billing figure** —
the source comments say so, and prices must be updated as providers change
them.

## Cost estimation (`estimateCostUsd`)

```
estimateCostUsd(model, input, output, cacheRead = 0, cacheCreation = 0)
```

computes:

```
inputCost = input·p.input
          + cacheRead·p.input·0.1
          + cacheCreation·p.input·1.25
total     = (inputCost + output·p.output) / 1_000_000
```

where `p = MODEL_PRICING[model] ?? DEFAULT_PRICE`. Passing only input/output
(cache args default to 0) reproduces the old full-price estimate, so callers
that don't track the cache split stay correct — just pessimistic. The dashboard
endpoint in `server.ts` calls this **per model** over the aggregate and sums
into `total_cost_usd`, deliberately pricing cached reads/writes at the
discounted rates so a heavily-cached loop isn't billed ~10× over reality.

## Per-turn `usage_events` rows

One row is written **at the end of each completed agent turn** via
`recordUsageEvent` (called from `server.ts` only when at least one of the four
token counts is > 0). Each row carries:

- `project_id`, `user_id` (the acting user / project owner)
- `provider`, `model` (provider-native id)
- `input_tokens`, `output_tokens`, `cache_read_tokens`,
  `cache_creation_tokens` (all clamped `≥ 0` and rounded)
- `elapsed_ms`

Rows are pure analytics — no plaintext, no secrets — and cascade-delete with
their project/user. The `usage_events` table is RLS-locked (all access via the
orchestrator's service-role key).

**Graceful migration:** `recordUsageEvent` first inserts the full row including
the `cache_*` columns; if the DB returns a "missing column" /
schema-cache-miss error (`isMissingCacheColumnError`, e.g. PostgREST
`PGRST204`), it retries with just the base columns so analytics keep working on
an un-migrated DB. Apply `schema.sql` to enable cache analytics.

## Aggregation for the dashboard

`getUsageAggregate(ownerId)` calls the Postgres `account_usage_stats(uid)`
function (in `schema.sql`), which sums the four token classes + `elapsed_ms` +
turn count account-wide and returns a per-model breakdown ordered by total
tokens. Aggregating **in Postgres** avoids PostgREST's per-request row cap. If
the function/table aren't migrated yet it returns zeros (the dashboard degrades
gracefully); older functions without cache columns are coalesced to 0. The API
layer (`server.ts`) then layers on `estimateCostUsd` and human labels from
`MODEL_CATALOG` to produce the `AccountUsageStats` shape consumed by the UI.
