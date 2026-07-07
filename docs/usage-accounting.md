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
| `cache_read_tokens` | `cache_read_tokens` | prompt tokens served from cache | `cacheRead` rate (default `input × 0.1`) |
| `cache_creation_tokens` | `cache_creation_tokens` | tokens written to the cache (Anthropic) | `cacheWrite` rate (default `input × 1.25`) |

Each row also stores a `cost_usd` **snapshot** — the turn's estimated cost priced
at record time (long-context band applied; see below). It's NULL on rows written
before the snapshot shipped; those are priced at read time from the token columns.

`db/usage.ts` is explicit: `inputTokens` is fresh/uncached input only; replayed
prefix tokens go into the cache buckets, not the full-price input bucket.
The provider adapters populate all four (`loop.ts`'s `usage` shape carries
`inputTokens` / `outputTokens` / `cacheReadTokens` / `cacheCreationTokens`).

## Per-model pricing (`MODEL_PRICING`)

`MODEL_PRICING` in `@uniqus/api-types` maps the provider-native model id to a
`ModelPrice` in **USD per 1,000,000 tokens**: a base `{ input, output }`, an
optional per-model `{ cacheRead, cacheWrite }` override, and an optional
`longContext` band. Current bases include `claude-opus-4-8` (`{5, 25}`),
`claude-sonnet-4-6` (`{3, 15}`), `glm-5.2` (`{1.4, 4.4}`, Z.ai), `gpt-5.5`
(`{5, 30}`), `gemini-3.1-pro-preview-customtools`
(`{2, 12}`), and others. Unknown model ids fall back to `DEFAULT_PRICE`
(`{ input: 3, output: 15 }`).

Cache rates default to multiples of the model's fresh `input` rate (a model only
sets `cacheRead`/`cacheWrite` when its cache pricing diverges — e.g. `glm-5.2`
sets `cacheRead: 0.26`, since Z.ai's cached-input rate is ~0.26× fresh input,
not the 0.1× default; it has no separate cache-write line):

- `CACHE_READ_MULTIPLIER = 0.1` — a cache read is ~10% of fresh input. Accurate
  across providers for the cache tokens we measure (Anthropic 0.1×, OpenAI 0.1×,
  Gemini's *implicit* cache is a 90% discount = 0.1×).
- `CACHE_WRITE_MULTIPLIER = 1.25` — a cache write (Anthropic, the one-time cost
  of populating the 5-minute cache) is 1.25× fresh input. (The 1-hour cache, 2×,
  isn't used.)

**Long-context bands** (`longContext: { thresholdTokens, above }`): providers
charge a premium once a turn's *prompt* (fresh input + both cache buckets)
exceeds a threshold — Anthropic/Google at 200K, OpenAI at 272K — repricing the
WHOLE turn at ~2× input / ~1.5× output. The `above` rates are stored absolutely
but track the ×2 / ×1.5 multiples of the base (e.g. Gemini 3.1 Pro 2/12 → 4/18).
Models whose context can't exceed the threshold (Opus, 200K) or that price flat
(Flash, the `*-pro` single tier, or GLM-5.2's 1M-token window) have no band.

These are **best-effort estimates for the dashboard, not a billing figure** —
the source comments say so, and prices must be updated as providers change them.

## Cost estimation (`estimateCostUsd` / `estimateTurnCostUsd`)

Two estimators share one rate engine (`costUsdFromRates`):

```
estimateTurnCostUsd(model, { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens })
```

prices ONE turn and **applies the long-context band** (keyed off that turn's
prompt size). This is the most precise figure and is what the orchestrator
snapshots onto each `usage_events.cost_usd` at record time, and what the chat
shows as "≈ $X est." per run.

```
estimateCostUsd(model, input, output, cacheRead = 0, cacheCreation = 0)
```

prices at the model's **base rates with no band**. Use it for an AGGREGATE of
many turns (account/day/project), where the per-turn prompt size is unknowable —
summing tokens first and then banding would wrongly cross the threshold. Passing
only input/output reproduces the old full-price estimate.

Both compute:

```
total = (input·input_rate
       + cacheRead·cacheRead_rate          (default input·0.1)
       + cacheCreation·cacheWrite_rate     (default input·1.25)
       + output·output_rate) / 1_000_000
```

where the rates come from `MODEL_PRICING[model] ?? DEFAULT_PRICE` (and the
`longContext.above` band for `estimateTurnCostUsd` past the threshold).

## Per-turn `usage_events` rows

One row is written **at the end of each completed agent turn** via
`recordUsageEvent` (called from `server.ts` only when at least one of the four
token counts is > 0). Each row carries:

- `project_id`, `user_id` (the acting user / project owner)
- `provider`, `model` (provider-native id)
- `input_tokens`, `output_tokens`, `cache_read_tokens`,
  `cache_creation_tokens` (all clamped `≥ 0` and rounded)
- `cost_usd` — the `estimateTurnCostUsd` snapshot for this turn (NULL on rows
  written before the snapshot shipped)
- `elapsed_ms`

Rows are pure analytics — no plaintext, no secrets — and cascade-delete with
their project/user. The `usage_events` table is RLS-locked (all access via the
orchestrator's service-role key).

**Graceful migration:** `recordUsageEvent` inserts the full row (cache split +
`cost_usd`) and, on a "missing column" / schema-cache-miss error
(`isMissingColumnError`, e.g. PostgREST `PGRST204`), degrades column-by-column —
full → cache-only → base — so analytics keep working on a partially- or
un-migrated DB. Apply `schema.sql` to enable the cache + cost columns.

## Aggregation for the dashboard

`getUsageAggregate(ownerId)` calls the Postgres `account_usage_stats(uid)`
function (in `schema.sql`), which sums the token classes + `elapsed_ms` + turn
count account-wide and returns a per-model breakdown ordered by total tokens.
Aggregating **in Postgres** avoids PostgREST's per-request row cap. Per model it
also returns `cost_usd` (the Σ of stored per-turn snapshots) and `uncosted_*`
token sums (legacy rows that have no snapshot).

The API layer (`server.ts`) prices each model as **`cost_usd` snapshot +
`estimateCostUsd(uncosted_* tokens)`** — exact, band-aware spend for recorded
turns, plus a flat read-time estimate for pre-snapshot rows so the total never
under-counts history. The per-day and per-project breakdowns instead sweep the
rows and price **per row** with `estimateTurnCostUsd` (band applied to each
turn), since they need a token-size context the account aggregate can't carry.
If the function/table aren't migrated the aggregate returns zeros (the dashboard
degrades gracefully); an older function without the new fields falls back to
pricing the full token sums (the pre-snapshot behavior). Human labels come from
`MODEL_CATALOG`, producing the `AccountUsageStats` shape the UI consumes.
