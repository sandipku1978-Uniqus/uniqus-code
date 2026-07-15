-- Milestone 1.4 control-plane schema.
-- Run this once in your Supabase project's SQL editor.

create extension if not exists "pgcrypto";

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  workos_id text unique not null,
  email text not null,
  display_name text,
  created_at timestamptz not null default now()
);

create index if not exists users_workos_id_idx on users (workos_id);

-- GitHub OAuth: token is stored AES-256-GCM encrypted (orchestrator-side key).
-- The DB never sees plaintext. github_login is the GitHub username, kept in
-- plain text so we can show "Connected as @octocat" without round-tripping
-- the API on every page load.
alter table users add column if not exists github_access_token text;
alter table users add column if not exists github_login text;
alter table users add column if not exists github_connected_at timestamptz;

-- Vercel OAuth: same encryption pattern. team_id is null when the user
-- installed the integration on their personal account; otherwise the token
-- is scoped to that team. user_id is Vercel's stable numeric ID.
alter table users add column if not exists vercel_access_token text;
alter table users add column if not exists vercel_user_id text;
alter table users add column if not exists vercel_user_login text;
alter table users add column if not exists vercel_team_id text;
alter table users add column if not exists vercel_connected_at timestamptz;

-- Supabase OAuth (account-level, per-user). Unlike Vercel, Supabase access
-- tokens EXPIRE (~1h) and refresh tokens ROTATE (single-use), so we persist the
-- refresh token + an expiry and refresh on demand (see supabase.ts). Both
-- tokens are AES-256-GCM encrypted with the same key as the other OAuth tokens.
-- org_id/org_name are the Supabase organization picked as the default place to
-- create projects (stored in plaintext only for "Connected to <org>" display).
alter table users add column if not exists supabase_access_token text;
alter table users add column if not exists supabase_refresh_token text;
alter table users add column if not exists supabase_token_expires_at timestamptz;
-- Refresh writes compare this opaque generation before replacing a rotated
-- credential pair. It is the cross-process CAS token for OAuth refreshes.
alter table users add column if not exists supabase_token_generation uuid not null default gen_random_uuid();
alter table users add column if not exists supabase_org_id text;
alter table users add column if not exists supabase_org_name text;
alter table users add column if not exists supabase_connected_at timestamptz;

-- Figma OAuth (account-level, per-user). Used to read a Figma file's styles and
-- infer a design system from it. Like Supabase, Figma access tokens EXPIRE and
-- ship a refresh token, so we persist both (AES-256-GCM encrypted) plus expiry
-- and refresh on demand (see figma.ts). figma_handle is the Figma username,
-- plaintext, only for "Connected as <handle>" display.
alter table users add column if not exists figma_access_token text;
alter table users add column if not exists figma_refresh_token text;
alter table users add column if not exists figma_token_expires_at timestamptz;
alter table users add column if not exists figma_token_generation uuid not null default gen_random_uuid();
alter table users add column if not exists figma_handle text;
alter table users add column if not exists figma_connected_at timestamptz;

-- Durable erasure outbox. The minimal cleanup key survives deletion of the
-- user-visible project/document row, so transient Storage/host failures remain
-- observable and retryable across orchestrator restarts (B27).
create table if not exists cleanup_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('project', 'knowledge')),
  resource_id uuid not null,
  owner_id uuid,
  storage_paths text[] not null default '{}',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, resource_id)
);
alter table cleanup_jobs enable row level security;
revoke all on table cleanup_jobs from public, anon, authenticated;
create index if not exists cleanup_jobs_due_idx on cleanup_jobs(next_attempt_at, created_at);

-- Guest / education accounts. A guest signs up with no Google account and no
-- email — districts control what students can sign into, so this is the only
-- way to get students using the product before a district approves it.
-- A guest is a normal users row (everything is owner_id-scoped, so a guest
-- gets full capability parity for free) with account_type='guest' and a NULL
-- workos_id. The unique constraint on workos_id still holds — Postgres treats
-- NULLs as distinct — and upsertUser's onConflict only runs for WorkOS users.
alter table users alter column workos_id drop not null;
alter table users add column if not exists account_type text not null default 'standard'
  check (account_type in ('standard', 'guest'));
-- Recovery code: how a guest gets back into their account on another device
-- (kids on shared/managed Chromebooks that wipe cookies). Stored two ways —
-- a sha256 hash for the indexed restore lookup, and an AES-256-GCM ciphertext
-- (same key/helper as the OAuth tokens) so a logged-in guest can re-view it.
-- Re-viewing is not a security downgrade: holding the session cookie already
-- grants full access. Both columns are nulled when a guest converts.
alter table users add column if not exists guest_recovery_hash text;
alter table users add column if not exists guest_recovery_code_enc text;
-- Inactivity cleanup: there is no hard calendar expiry, but a guest account
-- untouched for GUEST_INACTIVE_DAYS enters a grace period, and is deleted if
-- still untouched and unconverted GUEST_GRACE_DAYS later. converted_at is set
-- when the guest signs in with Google and their projects move to the real
-- account; a converted row is dead for auth purposes.
alter table users add column if not exists last_active_at timestamptz;
alter table users add column if not exists grace_started_at timestamptz;
alter table users add column if not exists converted_at timestamptz;
-- Exclusive lifecycle claim: once cleanup owns a guest, authentication and
-- conversion cannot race irreversible project teardown. A later sweeper may
-- resume an abandoned claim after one hour because cleanup is idempotent.
alter table users add column if not exists guest_lifecycle_claim uuid;
alter table users add column if not exists guest_lifecycle_claimed_at timestamptz;
create unique index if not exists users_guest_recovery_hash_idx
  on users (guest_recovery_hash) where guest_recovery_hash is not null;

create or replace function claim_guest_for_deletion(
  p_guest_id uuid,
  p_grace_cutoff timestamptz,
  p_claim uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare claimed_count integer;
begin
  update users
     set guest_lifecycle_claim = p_claim,
         guest_lifecycle_claimed_at = now()
   where id = p_guest_id
     and account_type = 'guest'
     and converted_at is null
     and grace_started_at < p_grace_cutoff
     and (
       guest_lifecycle_claim is null
       or guest_lifecycle_claimed_at < now() - interval '1 hour'
     );
  get diagnostics claimed_count = row_count;
  return claimed_count = 1;
end;
$$;
revoke all on function claim_guest_for_deletion(uuid, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function claim_guest_for_deletion(uuid, timestamptz, uuid)
  to service_role;

-- Account-wide agent customization (Settings → Custom prompts & default skills).
-- custom_prompt is appended to the agent system prompt on every turn, on top of
-- the per-project .uniqus/skills.md, so the user's standing instructions apply
-- everywhere without re-typing. default_skills is the Skills markdown seeded
-- into a brand-new project's .uniqus/skills.md at creation, so those
-- conventions are in effect from the first turn. Both are plain text (NULL =
-- unset); the API caps them at 16 KB / 64 KB respectively.
alter table users add column if not exists custom_prompt text;
alter table users add column if not exists default_skills text;
-- Library skills (from the account Skill Library) to AUTO-ATTACH to every NEW
-- project on creation — the "use on every project" toggle in the Skills tab. On
-- project create the orchestrator seeds projects.skill_library_ids from this
-- list, so a default skill is active on the first turn without re-selecting it.
alter table users add column if not exists default_skill_library_ids uuid[]
  not null default '{}';

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_owner_idx on projects (owner_id, updated_at desc);

-- Trust state for the per-project `.uniqus/skills.md` prompt extension.
-- Normal user-created/edited skills are trusted. If a GitHub/ZIP import contains
-- `.uniqus/skills.md`, the orchestrator marks it `untrusted_import` and excludes
-- it from the agent system prompt until the user explicitly saves it in Gate 15.
alter table projects add column if not exists skills_trust text not null default 'trusted'
  check (skills_trust in ('trusted', 'untrusted_import'));
-- Exact bytes approved through a human-authenticated UI/API save. A trusted
-- state without a digest is deliberately fail-closed until the user re-saves.
alter table projects add column if not exists skills_trusted_sha256 text;

-- Touch updated_at on every row that owns an updated_at column.
create or replace function touch_project_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Per-project Vercel project ID. Populated on first successful deploy so
-- subsequent deploys hit the same project and the dashboard URL is stable.
alter table projects add column if not exists vercel_project_id text;
alter table projects add column if not exists vercel_project_name text;
alter table projects add column if not exists vercel_team_id text;

-- Per-project Supabase link. Populated when the agent provisions (or the user
-- attaches) a Supabase project. `ref` is the 20-char project ref; the anon key,
-- service_role key, db password and connection string live in project_secrets,
-- never here.
alter table projects add column if not exists supabase_project_ref text;
alter table projects add column if not exists supabase_project_name text;
alter table projects add column if not exists supabase_org_id text;
-- Durable create intent. Supabase's project-create API has no idempotency key,
-- so an ambiguous response must be reconciled to a concrete ref before retry.
alter table projects add column if not exists supabase_provisioning_token uuid;
alter table projects add column if not exists supabase_provisioning_started_at timestamptz;
alter table projects add column if not exists supabase_provisioning_name text;
alter table projects add column if not exists supabase_provisioning_org_id text;

-- Per-project GitHub repo. Populated when the user clicks "Create GitHub
-- repo" in the workspace topbar. The orchestrator creates a fresh repo via
-- the user's existing GitHub OAuth and stores the canonical web URL +
-- "owner/name" so the All Projects view can show the link.
alter table projects add column if not exists github_repo_url text;
alter table projects add column if not exists github_repo_full_name text;

-- Phase 1.x project lifecycle UX: optional emoji/letter for visual ID in
-- the picker grid and topbar. Null = render the auto-derived hash tile.
alter table projects add column if not exists icon text;

-- Branch the project is linked to on its remote (GitHub). Surfaced in the All
-- Projects view's card alongside the latest deploy state. Null = unknown; the
-- UI falls back to 'main'. Populated by the import / repo-link flow.
alter table projects add column if not exists linked_branch text;

-- Origin remote URL captured when a GitHub import preserves git metadata (P1.1).
-- PAT-free (any injected token is scrubbed before storing). Null = not tracked.
alter table projects add column if not exists github_remote_url text;

-- Deploys: one row per attempted deployment. Lets the UI show history and
-- lets the orchestrator poll status without re-asking Vercel for everything.
create table if not exists deployments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  vercel_deployment_id text,
  operation_key uuid not null default gen_random_uuid(),
  vercel_url text,
  state text not null default 'QUEUED'
    check (state in ('CREATING', 'QUEUED', 'BUILDING', 'READY', 'ERROR', 'CANCELED')),
  error_message text,
  target text not null default 'production'
    check (target in ('production', 'preview')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists deployments_project_idx
  on deployments (project_id, created_at desc);
alter table deployments alter column vercel_deployment_id drop not null;
alter table deployments add column if not exists operation_key uuid not null default gen_random_uuid();
alter table deployments drop constraint if exists deployments_state_check;
alter table deployments add constraint deployments_state_check
  check (state in ('CREATING', 'QUEUED', 'BUILDING', 'READY', 'ERROR', 'CANCELED'));
create unique index if not exists deployments_operation_key_idx on deployments (operation_key);
create unique index if not exists deployments_one_creating_per_project_idx
  on deployments (project_id) where state = 'CREATING';

drop trigger if exists deployments_updated_at on deployments;
create trigger deployments_updated_at
  before update on deployments
  for each row execute function touch_project_updated_at();

alter table deployments enable row level security;

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_owner_idx on projects (owner_id, updated_at desc);

create table if not exists messages (
  id bigserial primary key,
  project_id uuid not null references projects(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists messages_project_idx on messages (project_id, id);

-- Multiple chat threads per project (Phase 2.x). Each session is one
-- continuous conversation history; switching sessions in the workspace
-- topbar swaps which messages the agent loop sees, without resetting the
-- VM or the sandbox files. Pre-existing messages keep session_id NULL —
-- the backend lazily migrates them into a "Default" session per project
-- on first read.
create table if not exists chat_sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text,
  -- Model-facing compacted prefix. Raw messages are never deleted; the cursor
  -- says which raw id the snapshot covers so reconnects can load snapshot+tail
  -- without paying to summarize the same history again.
  compacted_history jsonb,
  compacted_through_message_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table chat_sessions add column if not exists compacted_history jsonb;
alter table chat_sessions add column if not exists compacted_through_message_id bigint;

create index if not exists chat_sessions_project_idx
  on chat_sessions (project_id, updated_at desc);

-- Prevent two concurrent `ensureDefaultSession` calls from each creating a
-- "Default" row for the same project. Without this, the read-then-insert in
-- chatSessions.ts can race when two WS clients connect at the same time
-- right after a project is created. We still keep the application-level
-- read-then-insert path because the unique violation is rare and we want
-- to return the *existing* row instead of failing.
create unique index if not exists chat_sessions_one_default_per_project
  on chat_sessions (project_id)
  where title = 'Default';

drop trigger if exists chat_sessions_updated_at on chat_sessions;
create trigger chat_sessions_updated_at
  before update on chat_sessions
  for each row execute function touch_project_updated_at();

alter table chat_sessions enable row level security;

alter table messages add column if not exists session_id uuid
  references chat_sessions(id) on delete cascade;
create index if not exists messages_session_idx on messages (session_id, id);

-- Touch updated_at on every project mutation
create or replace function touch_project_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists projects_updated_at on projects;
create trigger projects_updated_at
  before update on projects
  for each row execute function touch_project_updated_at();

-- ── Row Level Security ────────────────────────────────────────────────────────
-- All access goes through the orchestrator using the service_role key, which
-- bypasses RLS. We enable RLS with no policies so the anon/authenticated keys
-- can't read or write anything — defense in depth in case a future feature
-- accidentally uses one of those keys from the browser.

alter table users enable row level security;
alter table projects enable row level security;
alter table messages enable row level security;

-- Per-project encrypted secrets (Plan §1, §6).
-- Values are AES-256-GCM encrypted with OAUTH_TOKEN_ENCRYPTION_KEY (same key
-- as third-party OAuth tokens; see auth/encrypt.ts). Never log or surface
-- plaintext values to the agent — connectors read them server-side and
-- pass ephemeral handles to the agent loop.
create table if not exists project_secrets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  encrypted_value text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, name)
);

create index if not exists project_secrets_project_idx
  on project_secrets (project_id, name);

-- Bring-Your-Own-Key (F7): per-account provider API keys, AES-256-GCM encrypted
-- with the same master key as project_secrets. One row per (account, provider).
-- Plaintext is never stored or returned; the key never enters the agent/VM.
create table if not exists account_provider_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null check (provider in ('anthropic', 'openai', 'google')),
  encrypted_value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

-- Z.ai is selectable through BYOK. Existing installations still carry the
-- original three-provider check, so replace it idempotently.
alter table account_provider_keys
  drop constraint if exists account_provider_keys_provider_check;
alter table account_provider_keys
  add constraint account_provider_keys_provider_check
  check (provider in ('anthropic', 'openai', 'google', 'zai'));

create index if not exists account_provider_keys_user_idx
  on account_provider_keys (user_id);

-- Server-private credential material. No client policy is intentional: the
-- service-role connection is the only supported access path.
alter table account_provider_keys enable row level security;
alter table account_provider_keys force row level security;
revoke all on table account_provider_keys from anon, authenticated;

-- Per-environment scoping (Phase 2.x). Same name can exist in multiple envs
-- with different values (e.g. STRIPE_API_KEY in 'production' vs 'development').
-- Backfilled to 'default' for existing rows; the API treats 'default' as the
-- env when callers don't specify one, so single-env projects keep working
-- without changes.
alter table project_secrets add column if not exists env text not null default 'default';
-- Destination policy for generic HTTP credential injection. This is written by
-- an owner/admin action in the Secrets UI; it is never part of model tool input.
alter table project_secrets add column if not exists allowed_hosts text[]
  not null default '{}'::text[];

-- Replace the (project_id, name) uniqueness with (project_id, name, env). The
-- existing constraint name is auto-generated by Postgres — different across
-- installations — so we drop by introspection. Idempotent.
do $$
declare old_constraint text;
begin
  select conname into old_constraint
  from pg_constraint
  where conrelid = 'project_secrets'::regclass
    and contype = 'u'
    and conname not like '%_env_%';
  if old_constraint is not null then
    execute format('alter table project_secrets drop constraint %I', old_constraint);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'project_secrets'::regclass
      and conname = 'project_secrets_project_id_name_env_key'
  ) then
    alter table project_secrets
      add constraint project_secrets_project_id_name_env_key
      unique (project_id, name, env);
  end if;
end$$;

drop trigger if exists project_secrets_updated_at on project_secrets;
create trigger project_secrets_updated_at
  before update on project_secrets
  for each row execute function touch_project_updated_at();

alter table project_secrets enable row level security;

-- Audit log for every secret access + every connector invocation
-- (Plan §1.6, §6 — "every connector invocation emits a tenant-scoped audit
-- event"). Actor is the user_id when the request originated from the web
-- app, or null when it was a scheduled-job runner (Phase 3+).
create table if not exists audit_events (
  id bigserial primary key,
  project_id uuid references projects(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  kind text not null check (
    kind in (
      'secret_read', 'secret_write', 'secret_delete',
      'connector_invoke', 'connector_invoke_error',
      'checkpoint_create', 'checkpoint_restore'
    )
  ),
  target text not null,         -- secret name / connector method / commit ref
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_project_idx
  on audit_events (project_id, created_at desc);

alter table audit_events enable row level security;

-- Per-call token usage (Plan §5 — dashboard usage widgets). A top-level task
-- can emit lead, planner, sub-agent, classifier, compaction, or media rows; the
-- shared run_id groups those billed calls into one user-visible turn. user_id is
-- the acting user, so account aggregation needs no join. Purely analytics — no
-- plaintext or secrets. project_id/user_id cascade-delete with their parents.
create table if not exists usage_events (
  id bigserial primary key,
  -- Correlates every lead/planner/sub-agent/auxiliary billed call to one
  -- top-level harness run, enabling exact snapshotted cost-per-task rollups.
  -- Deliberately no FK: usage rows may land before the best-effort metrics row.
  run_id uuid,
  project_id uuid references projects(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  provider text not null,
  model text not null,
  -- input_tokens is FRESH (uncached) input only. Cached prompt tokens are split
  -- into the cache_* columns below so the dashboard prices them at the cheaper
  -- cache rates instead of charging every replayed prefix token at full price.
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_creation_tokens integer not null default 0,
  -- Estimated USD cost SNAPSHOT for this turn, priced at record time with the
  -- turn's exact split + long-context band (api-types estimateTurnCostUsd). NULL
  -- for rows written before this shipped — the dashboard prices those at read
  -- time from the token columns instead (see account_usage_stats / usage.ts).
  cost_usd numeric,
  elapsed_ms integer not null default 0,
  created_at timestamptz not null default now()
);

-- Idempotent migration for tables created before the cache split shipped.
alter table usage_events add column if not exists cache_read_tokens integer not null default 0;
alter table usage_events add column if not exists cache_creation_tokens integer not null default 0;
-- Idempotent migration for the per-turn cost snapshot (left NULL on old rows).
alter table usage_events add column if not exists cost_usd numeric;
alter table usage_events add column if not exists run_id uuid;

create index if not exists usage_events_user_idx
  on usage_events (user_id, created_at desc);
-- Supports project-scoped cost sweeps and the org month-to-date aggregate
-- without scanning unrelated accounts' historical usage.
create index if not exists usage_events_project_created_idx
  on usage_events (project_id, created_at desc);
create index if not exists usage_events_run_idx
  on usage_events (run_id)
  where run_id is not null;

alter table usage_events enable row level security;

-- Privacy-safe harness efficiency/quality telemetry. One row per top-level
-- agent or plan run. This is intentionally a wide, explicit table: there is no
-- generic metadata/payload column where prompts, source code, file paths,
-- commands, tool arguments/results, connector names, secrets, or error text
-- could accidentally be stored. Text dimensions are bounded by CHECKs so
-- dashboards cannot accumulate user-controlled, high-cardinality labels.
create table if not exists agent_run_metrics (
  id bigserial primary key,
  run_id uuid unique not null,
  project_id uuid references projects(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  metrics_version smallint not null default 1 check (metrics_version = 1),
  started_at timestamptz not null,

  run_mode text not null check (run_mode in ('agent', 'plan', 'plan_execution', 'unknown')),
  provider text not null check (provider in ('anthropic', 'openai', 'google', 'zai', 'unknown')),
  model_bucket text not null check (model_bucket in (
    'claude_opus', 'claude_sonnet', 'gemini_pro', 'gemini_flash',
    'gpt_codex', 'gpt_general', 'glm', 'internal', 'provider_other', 'unknown'
  )),
  planner_provider text not null check (planner_provider in ('anthropic', 'openai', 'google', 'zai', 'unknown')),
  planner_model_bucket text not null check (planner_model_bucket in (
    'claude_opus', 'claude_sonnet', 'gemini_pro', 'gemini_flash',
    'gpt_codex', 'gpt_general', 'glm', 'internal', 'provider_other', 'unknown'
  )),
  executor_provider text not null check (executor_provider in ('anthropic', 'openai', 'google', 'zai', 'unknown')),
  executor_model_bucket text not null check (executor_model_bucket in (
    'claude_opus', 'claude_sonnet', 'gemini_pro', 'gemini_flash',
    'gpt_codex', 'gpt_general', 'glm', 'internal', 'provider_other', 'unknown'
  )),
  route_tier text not null check (route_tier in ('quick', 'standard', 'hard', 'manual', 'unknown')),
  route_source text not null check (route_source in (
    'heuristic', 'classifier', 'manual', 'environment', 'static_fallback', 'unknown'
  )),
  harness_profile text not null check (harness_profile in ('legacy', 'progressive', 'unknown')),
  profile_cohort text not null check (profile_cohort in ('treatment', 'control', 'ineligible', 'unknown')),

  -- Phase timings are wall-clock unions. For example, three concurrent read
  -- tools contribute the batch's elapsed wall time, not the sum of all three.
  sandbox_ms integer not null default 0 check (sandbox_ms >= 0),
  preflight_ms integer not null default 0 check (preflight_ms >= 0),
  routing_ms integer not null default 0 check (routing_ms >= 0),
  provider_ttft_ms integer check (provider_ttft_ms >= 0),
  provider_ttft_total_ms integer not null default 0 check (provider_ttft_total_ms >= 0),
  provider_ttft_samples integer not null default 0 check (provider_ttft_samples >= 0),
  model_ms integer not null default 0 check (model_ms >= 0),
  tool_ms integer not null default 0 check (tool_ms >= 0),
  verification_ms integer not null default 0 check (verification_ms >= 0),
  persistence_ms integer not null default 0 check (persistence_ms >= 0),
  -- Time intentionally spent waiting for an answer to ask_user. Kept separate
  -- from harness work so interactive pauses do not inflate efficiency latency.
  user_wait_ms integer not null default 0 check (user_wait_ms >= 0),
  total_ms integer not null default 0 check (total_ms >= 0),

  iteration_count integer not null default 0 check (iteration_count >= 0),
  model_call_count integer not null default 0 check (model_call_count >= 0),
  provider_error_count integer not null default 0 check (provider_error_count >= 0),
  provider_retry_count integer not null default 0 check (provider_retry_count >= 0),
  routing_classifier_call_count integer not null default 0 check (routing_classifier_call_count >= 0),
  routing_classifier_timeout_count integer not null default 0 check (routing_classifier_timeout_count >= 0),
  tool_call_count integer not null default 0 check (tool_call_count >= 0),
  tool_error_count integer not null default 0 check (tool_error_count >= 0),
  tool_retry_count integer not null default 0 check (tool_retry_count >= 0),
  tool_result_truncated_count integer not null default 0 check (tool_result_truncated_count >= 0),
  web_search_unit_count integer not null default 0 check (web_search_unit_count >= 0),
  estimated_web_search_unit_count integer not null default 0 check (estimated_web_search_unit_count >= 0),
  verification_check_count integer not null default 0 check (verification_check_count >= 0),
  verification_failure_count integer not null default 0 check (verification_failure_count >= 0),
  compaction_count integer not null default 0 check (compaction_count >= 0),
  compaction_error_count integer not null default 0 check (compaction_error_count >= 0),
  compacted_message_count integer not null default 0 check (compacted_message_count >= 0),
  subagent_count integer not null default 0 check (subagent_count >= 0),
  subagent_error_count integer not null default 0 check (subagent_error_count >= 0),
  subagent_progressive_count integer not null default 0 check (subagent_progressive_count >= 0),
  subagent_legacy_count integer not null default 0 check (subagent_legacy_count >= 0),
  files_changed_count integer not null default 0 check (files_changed_count >= 0),

  cache_hit_call_count integer not null default 0 check (cache_hit_call_count >= 0),
  cache_miss_call_count integer not null default 0 check (cache_miss_call_count >= 0),
  fresh_input_tokens integer not null default 0 check (fresh_input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cache_read_tokens integer not null default 0 check (cache_read_tokens >= 0),
  cache_creation_tokens integer not null default 0 check (cache_creation_tokens >= 0),
  -- Size gauges only: measured content is never stored.
  peak_system_prompt_chars integer not null default 0 check (peak_system_prompt_chars >= 0),
  peak_tool_schema_chars integer not null default 0 check (peak_tool_schema_chars >= 0),
  peak_message_chars integer not null default 0 check (peak_message_chars >= 0),
  peak_estimated_context_tokens integer not null default 0 check (peak_estimated_context_tokens >= 0),
  initial_tool_count integer not null default 0 check (initial_tool_count >= 0),
  peak_tool_count integer not null default 0 check (peak_tool_count >= 0),
  initial_capability_count integer not null default 0 check (initial_capability_count >= 0),
  peak_capability_count integer not null default 0 check (peak_capability_count >= 0),
  capability_load_count integer not null default 0 check (capability_load_count >= 0),

  run_status text not null check (run_status in ('success', 'error', 'aborted', 'unknown')),
  completion_reason text not null check (completion_reason in (
    'completed', 'empty_terminal', 'max_iterations', 'max_tokens', 'refusal', 'provider_error',
    'tool_error', 'sandbox_error', 'verification_failed', 'persistence_failed', 'permission_denied',
    'budget_exceeded', 'timeout', 'aborted', 'unknown'
  )),
  error_category text not null check (error_category in (
    'none', 'provider', 'tool', 'sandbox', 'database', 'auth', 'permission',
    'validation', 'timeout', 'rate_limit', 'budget', 'internal', 'unknown'
  )),
  final_answer_emitted boolean not null default false,
  build_status text not null check (build_status in ('not_run', 'passed', 'failed', 'skipped')),
  test_status text not null check (test_status in ('not_run', 'passed', 'failed', 'skipped')),
  browser_status text not null check (browser_status in ('not_run', 'passed', 'failed', 'skipped')),
  verification_status text not null check (verification_status in ('not_run', 'passed', 'failed', 'skipped')),
  -- May be marked later when the next user turn is classified as a correction;
  -- the follow-up text itself is never retained here.
  correction_followup boolean not null default false,
  correction_recorded_at timestamptz,
  created_at timestamptz not null default now()
);

-- Idempotent additions for hosts that applied an earlier draft of the harness
-- metrics table during rollout.
alter table agent_run_metrics add column if not exists harness_profile text not null default 'unknown'
  check (harness_profile in ('legacy', 'progressive', 'unknown'));
alter table agent_run_metrics add column if not exists profile_cohort text not null default 'unknown'
  check (profile_cohort in ('treatment', 'control', 'ineligible', 'unknown'));
alter table agent_run_metrics add column if not exists planner_provider text not null default 'unknown'
  check (planner_provider in ('anthropic', 'openai', 'google', 'zai', 'unknown'));
alter table agent_run_metrics add column if not exists planner_model_bucket text not null default 'unknown'
  check (planner_model_bucket in (
    'claude_opus', 'claude_sonnet', 'gemini_pro', 'gemini_flash',
    'gpt_codex', 'gpt_general', 'glm', 'internal', 'provider_other', 'unknown'
  ));
alter table agent_run_metrics add column if not exists executor_provider text not null default 'unknown'
  check (executor_provider in ('anthropic', 'openai', 'google', 'zai', 'unknown'));
alter table agent_run_metrics add column if not exists executor_model_bucket text not null default 'unknown'
  check (executor_model_bucket in (
    'claude_opus', 'claude_sonnet', 'gemini_pro', 'gemini_flash',
    'gpt_codex', 'gpt_general', 'glm', 'internal', 'provider_other', 'unknown'
  ));
alter table agent_run_metrics add column if not exists initial_tool_count integer not null default 0
  check (initial_tool_count >= 0);
alter table agent_run_metrics add column if not exists peak_tool_count integer not null default 0
  check (peak_tool_count >= 0);
alter table agent_run_metrics add column if not exists initial_capability_count integer not null default 0
  check (initial_capability_count >= 0);
alter table agent_run_metrics add column if not exists peak_capability_count integer not null default 0
  check (peak_capability_count >= 0);
alter table agent_run_metrics add column if not exists capability_load_count integer not null default 0
  check (capability_load_count >= 0);
alter table agent_run_metrics add column if not exists subagent_progressive_count integer not null default 0
  check (subagent_progressive_count >= 0);
alter table agent_run_metrics add column if not exists subagent_legacy_count integer not null default 0
  check (subagent_legacy_count >= 0);
alter table agent_run_metrics add column if not exists user_wait_ms integer not null default 0
  check (user_wait_ms >= 0);
alter table agent_run_metrics add column if not exists web_search_unit_count integer not null default 0
  check (web_search_unit_count >= 0);
alter table agent_run_metrics add column if not exists estimated_web_search_unit_count integer not null default 0
  check (estimated_web_search_unit_count >= 0);
alter table agent_run_metrics add column if not exists correction_followup boolean not null default false;
alter table agent_run_metrics add column if not exists correction_recorded_at timestamptz;

-- `ADD COLUMN IF NOT EXISTS ... CHECK` only installs the CHECK when the column
-- itself is new. Install named constraints when absent so a host that briefly ran
-- an earlier draft with the column but without its bound gets the same privacy
-- and non-negative guarantees as a fresh database.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'agent_run_metrics'::regclass
      and conname = 'agent_run_metrics_harness_profile_check'
  ) then
    alter table agent_run_metrics add constraint agent_run_metrics_harness_profile_check
      check (harness_profile in ('legacy', 'progressive', 'unknown'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'agent_run_metrics'::regclass
      and conname = 'agent_run_metrics_profile_cohort_check'
  ) then
    alter table agent_run_metrics add constraint agent_run_metrics_profile_cohort_check
      check (profile_cohort in ('treatment', 'control', 'ineligible', 'unknown'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'agent_run_metrics'::regclass
      and conname = 'agent_run_metrics_planner_provider_check'
  ) then
    alter table agent_run_metrics add constraint agent_run_metrics_planner_provider_check
      check (planner_provider in ('anthropic', 'openai', 'google', 'zai', 'unknown'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'agent_run_metrics'::regclass
      and conname = 'agent_run_metrics_planner_model_bucket_check'
  ) then
    alter table agent_run_metrics add constraint agent_run_metrics_planner_model_bucket_check
      check (planner_model_bucket in (
        'claude_opus', 'claude_sonnet', 'gemini_pro', 'gemini_flash',
        'gpt_codex', 'gpt_general', 'glm', 'internal', 'provider_other', 'unknown'
      ));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'agent_run_metrics'::regclass
      and conname = 'agent_run_metrics_executor_provider_check'
  ) then
    alter table agent_run_metrics add constraint agent_run_metrics_executor_provider_check
      check (executor_provider in ('anthropic', 'openai', 'google', 'zai', 'unknown'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'agent_run_metrics'::regclass
      and conname = 'agent_run_metrics_executor_model_bucket_check'
  ) then
    alter table agent_run_metrics add constraint agent_run_metrics_executor_model_bucket_check
      check (executor_model_bucket in (
        'claude_opus', 'claude_sonnet', 'gemini_pro', 'gemini_flash',
        'gpt_codex', 'gpt_general', 'glm', 'internal', 'provider_other', 'unknown'
      ));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'agent_run_metrics'::regclass
      and conname = 'agent_run_metrics_initial_tool_count_check'
  ) then
    alter table agent_run_metrics add constraint agent_run_metrics_initial_tool_count_check
      check (initial_tool_count >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'agent_run_metrics'::regclass
      and conname = 'agent_run_metrics_peak_tool_count_check'
  ) then
    alter table agent_run_metrics add constraint agent_run_metrics_peak_tool_count_check
      check (peak_tool_count >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'agent_run_metrics'::regclass
      and conname = 'agent_run_metrics_initial_capability_count_check'
  ) then
    alter table agent_run_metrics add constraint agent_run_metrics_initial_capability_count_check
      check (initial_capability_count >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'agent_run_metrics'::regclass
      and conname = 'agent_run_metrics_peak_capability_count_check'
  ) then
    alter table agent_run_metrics add constraint agent_run_metrics_peak_capability_count_check
      check (peak_capability_count >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'agent_run_metrics'::regclass
      and conname = 'agent_run_metrics_capability_load_count_check'
  ) then
    alter table agent_run_metrics add constraint agent_run_metrics_capability_load_count_check
      check (capability_load_count >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'agent_run_metrics'::regclass
      and conname = 'agent_run_metrics_subagent_progressive_count_check'
  ) then
    alter table agent_run_metrics add constraint agent_run_metrics_subagent_progressive_count_check
      check (subagent_progressive_count >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'agent_run_metrics'::regclass
      and conname = 'agent_run_metrics_subagent_legacy_count_check'
  ) then
    alter table agent_run_metrics add constraint agent_run_metrics_subagent_legacy_count_check
      check (subagent_legacy_count >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'agent_run_metrics'::regclass
      and conname = 'agent_run_metrics_user_wait_ms_check'
  ) then
    alter table agent_run_metrics add constraint agent_run_metrics_user_wait_ms_check
      check (user_wait_ms >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'agent_run_metrics'::regclass
      and conname = 'agent_run_metrics_web_search_unit_count_check'
  ) then
    alter table agent_run_metrics add constraint agent_run_metrics_web_search_unit_count_check
      check (web_search_unit_count >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'agent_run_metrics'::regclass
      and conname = 'agent_run_metrics_estimated_web_search_unit_count_check'
  ) then
    alter table agent_run_metrics add constraint agent_run_metrics_estimated_web_search_unit_count_check
      check (estimated_web_search_unit_count >= 0);
  end if;
end$$;

-- Widen the completion enum only when an earlier definition is still present;
-- a no-op reapply should not drop/revalidate a CHECK over the whole table.
do $$
declare completion_definition text;
begin
  select pg_get_constraintdef(oid) into completion_definition
  from pg_constraint
  where conrelid = 'agent_run_metrics'::regclass
    and conname = 'agent_run_metrics_completion_reason_check';
  if completion_definition is null
     or position('empty_terminal' in completion_definition) = 0
     or position('max_tokens' in completion_definition) = 0
     or position('refusal' in completion_definition) = 0
     or position('persistence_failed' in completion_definition) = 0 then
    alter table agent_run_metrics
      drop constraint if exists agent_run_metrics_completion_reason_check;
    alter table agent_run_metrics
      add constraint agent_run_metrics_completion_reason_check check (
        completion_reason in (
          'completed', 'empty_terminal', 'max_iterations', 'max_tokens', 'refusal',
          'provider_error', 'tool_error', 'sandbox_error', 'verification_failed',
          'persistence_failed', 'permission_denied', 'budget_exceeded', 'timeout',
          'aborted', 'unknown'
        )
      );
  end if;
end$$;

create index if not exists agent_run_metrics_user_idx
  on agent_run_metrics (user_id, started_at desc);
create index if not exists agent_run_metrics_project_idx
  on agent_run_metrics (project_id, started_at desc);

alter table agent_run_metrics enable row level security;

-- Account-wide usage rollup for the dashboard. Aggregated in Postgres so the
-- totals aren't capped by PostgREST's per-request row limit. Returns a single
-- jsonb blob: grand totals plus a per-model breakdown ordered by total tokens.
create or replace function account_usage_stats(uid uuid)
returns jsonb language sql stable as $$
  with usage_rows as (
    select run_id, provider, model, input_tokens, output_tokens,
           cache_read_tokens, cache_creation_tokens, cost_usd, elapsed_ms
    from usage_events where user_id = uid
  ),
  totals as (
    select
      coalesce(sum(input_tokens), 0)::bigint           as total_input_tokens,
      coalesce(sum(output_tokens), 0)::bigint          as total_output_tokens,
      coalesce(sum(cache_read_tokens), 0)::bigint      as total_cache_read_tokens,
      coalesce(sum(cache_creation_tokens), 0)::bigint  as total_cache_creation_tokens,
      coalesce(sum(elapsed_ms), 0)::bigint             as total_time_ms,
      -- Modern rows: one user task can emit lead/planner/sub-agent/aux calls,
      -- so count its run UUID once. Legacy NULL rows retain one-row=one-turn.
      (count(distinct run_id) + count(*) filter (where run_id is null))::bigint as turns
    from usage_rows
  ),
  per_model as (
    select
      provider, model,
      sum(input_tokens)::bigint           as input_tokens,
      sum(output_tokens)::bigint          as output_tokens,
      sum(cache_read_tokens)::bigint      as cache_read_tokens,
      sum(cache_creation_tokens)::bigint  as cache_creation_tokens,
      -- Snapshotted per-turn cost for rows that have it; the API layer adds a
      -- read-time estimate for the legacy (NULL-cost) rows using the uncosted_*
      -- token sums below, so the dashboard total never under-counts old turns.
      coalesce(sum(cost_usd), 0)::double precision      as cost_usd,
      coalesce(sum(input_tokens)          filter (where cost_usd is null), 0)::bigint as uncosted_input_tokens,
      coalesce(sum(output_tokens)         filter (where cost_usd is null), 0)::bigint as uncosted_output_tokens,
      coalesce(sum(cache_read_tokens)     filter (where cost_usd is null), 0)::bigint as uncosted_cache_read_tokens,
      coalesce(sum(cache_creation_tokens) filter (where cost_usd is null), 0)::bigint as uncosted_cache_creation_tokens,
      (count(distinct run_id) + count(*) filter (where run_id is null))::bigint as turns,
      count(*)::bigint                    as calls
    from usage_rows
    group by provider, model
    order by (sum(input_tokens) + sum(output_tokens) + sum(cache_read_tokens)) desc
  )
  select jsonb_build_object(
    'total_input_tokens',           (select total_input_tokens           from totals),
    'total_output_tokens',          (select total_output_tokens          from totals),
    'total_cache_read_tokens',      (select total_cache_read_tokens      from totals),
    'total_cache_creation_tokens',  (select total_cache_creation_tokens  from totals),
    'total_time_ms',                (select total_time_ms                from totals),
    'turns',                        (select turns                        from totals),
    'per_model', coalesce(
      (select jsonb_agg(jsonb_build_object(
        'model', model, 'provider', provider,
        'input_tokens', input_tokens, 'output_tokens', output_tokens,
        'cache_read_tokens', cache_read_tokens,
        'cache_creation_tokens', cache_creation_tokens,
        'cost_usd', cost_usd,
        'uncosted_input_tokens', uncosted_input_tokens,
        'uncosted_output_tokens', uncosted_output_tokens,
        'uncosted_cache_read_tokens', uncosted_cache_read_tokens,
        'uncosted_cache_creation_tokens', uncosted_cache_creation_tokens,
        'turns', turns,
        'calls', calls
      )) from per_model),
      '[]'::jsonb
    )
  );
$$;

-- Global, per-user design systems (Design Systems tab on the projects page).
-- Reusable token sets (color/typography/spacing/...) attached to a project (or
-- none) and injected into the agent's system prompt so generation stays
-- on-system. `tokens` is the canonical JSON artifact — shape = DesignTokens in
-- @gate15/api-types. Created once, used across many projects.
create table if not exists design_systems (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  tokens jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists design_systems_user_idx
  on design_systems (user_id, updated_at desc);

drop trigger if exists design_systems_updated_at on design_systems;
create trigger design_systems_updated_at
  before update on design_systems
  for each row execute function touch_project_updated_at();

alter table design_systems enable row level security;

-- Which design system a project uses (null = none). ON DELETE SET NULL so
-- deleting a design system detaches it from projects rather than deleting them.
alter table projects add column if not exists design_system_id uuid
  references design_systems(id) on delete set null;

-- Global, per-user Skill libraries (Skills tab on the projects page). Reusable
-- markdown rule-sets the user authors once and ATTACHES to many projects. The
-- attached skills are advertised by name/description and their bodies are loaded
-- on demand before the project's own .uniqus/skills.md (the override layer).
-- `body` = SkillLibrary
-- in @gate15/api-types. Distinct from the code-defined curated SKILL_PACKS.
create table if not exists skill_libraries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  description text,
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists skill_libraries_user_idx
  on skill_libraries (user_id, updated_at desc);

drop trigger if exists skill_libraries_updated_at on skill_libraries;
create trigger skill_libraries_updated_at
  before update on skill_libraries
  for each row execute function touch_project_updated_at();

alter table skill_libraries enable row level security;

-- Account-level Knowledge library: documents the user uploads once (regulations,
-- research papers, datasets, specs, …) and the agent can reference across ALL of
-- their projects via the `knowledge_search` tool. The raw file lives in object
-- storage (storage_path); `content` holds the extracted plain text that powers
-- search. `content` is intentionally a separate column so list queries can skip
-- it. Row = KnowledgeDocument in @gate15/api-types.
create table if not exists knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  description text,
  file_name text not null,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0,
  storage_path text not null,
  content text not null default '',
  char_count integer not null default 0,
  extracted boolean not null default false,
  -- Server-side full-text search vector over title + note + extracted text, so
  -- knowledge_search filters/stems in Postgres and only matching rows' bodies
  -- ever leave the DB (never the whole library). Stored + GIN-indexed.
  content_fts tsvector generated always as (
    to_tsvector(
      'english',
      coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(content, '')
    )
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists knowledge_documents_user_idx
  on knowledge_documents (user_id, updated_at desc);

create index if not exists knowledge_documents_fts_idx
  on knowledge_documents using gin (content_fts);

drop trigger if exists knowledge_documents_updated_at on knowledge_documents;
create trigger knowledge_documents_updated_at
  before update on knowledge_documents
  for each row execute function touch_project_updated_at();

alter table knowledge_documents enable row level security;

-- Which library skills a project has attached (additive — a project can attach
-- several). Stored as a uuid[] rather than a junction table to keep attach/detach
-- a single-row update; dangling ids (after a skill is deleted) are harmless
-- because resolution re-checks ownership per turn and skips anything missing.
alter table projects add column if not exists skill_library_ids uuid[]
  not null default '{}'::uuid[];

-- ── Teams / organizations + RBAC (P3.1) ───────────────────────────────────────
-- The collaboration model is task-intake + review + branch/session isolation
-- with membership-scoped access, NOT many people prompting one tree. For an org
-- project, org/project membership is the sole authority; projects.owner_id is
-- historical/recovery metadata and grants no access. Roles are
-- owner|admin|editor|viewer (shared enum in @gate15/api-types).
create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references users(id) on delete cascade,
  -- Org-wide monthly spend cap in USD (P3.5). NULL = no cap.
  monthly_budget_usd numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists organizations_owner_idx on organizations (owner_id);
drop trigger if exists organizations_updated_at on organizations;
create trigger organizations_updated_at before update on organizations
  for each row execute function touch_project_updated_at();
alter table organizations enable row level security;

create table if not exists org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'editor' check (role in ('owner', 'admin', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index if not exists org_members_org_idx on org_members (org_id);
create index if not exists org_members_user_idx on org_members (user_id);
alter table org_members enable row level security;

-- Organization row + initial owner are one transaction, so a crash cannot
-- leave an organization that nobody can administer.
create or replace function create_organization_with_owner(
  p_name text,
  p_owner_id uuid
) returns setof organizations language plpgsql as $$
declare
  created organizations;
begin
  insert into organizations (name, owner_id)
    values (p_name, p_owner_id)
    returning * into created;
  insert into org_members (org_id, user_id, role)
    values (created.id, p_owner_id, 'owner');
  return next created;
end;
$$;

create table if not exists project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'editor' check (role in ('owner', 'admin', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);
create index if not exists project_members_project_idx on project_members (project_id);
create index if not exists project_members_user_idx on project_members (user_id);
alter table project_members enable row level security;

-- Serialize direct project-owner demotions/removals on the parent row so two
-- concurrent requests cannot both observe another owner and orphan the direct
-- membership set. Parent deletion cascades remain allowed.
create or replace function prevent_last_project_owner_removal()
returns trigger language plpgsql as $$
begin
  if old.role <> 'owner' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.role = 'owner' then return new; end if;
  perform 1 from projects where id = old.project_id for update;
  if not found then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if not exists (
    select 1 from project_members
    where project_id = old.project_id and role = 'owner' and id <> old.id
  ) then
    raise exception 'project must retain at least one direct owner' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists project_members_retain_owner on project_members;
create trigger project_members_retain_owner
  before delete or update of role on project_members
  for each row execute function prevent_last_project_owner_removal();

-- Projects can belong to an org (P3.1). owner_id is authoritative only while
-- the project is personal; organization access comes from live membership.
alter table projects add column if not exists org_id uuid references organizations(id) on delete set null;
create index if not exists projects_org_idx on projects (org_id);

-- A concurrent pair of owner demotions/removals must not orphan an org. Locking
-- the parent row serializes both transactions; the second sees the first one's
-- committed change and is rejected. Cascades from deleting the parent are
-- allowed because the organization row is no longer visible to the trigger.
create or replace function prevent_last_org_owner_removal()
returns trigger language plpgsql as $$
begin
  if old.role <> 'owner' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.role = 'owner' then return new; end if;
  perform 1 from organizations where id = old.org_id for update;
  if not found then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if not exists (
    select 1 from org_members
    where org_id = old.org_id and role = 'owner' and id <> old.id
  ) then
    raise exception 'organization must retain at least one owner' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists org_members_retain_owner on org_members;
create trigger org_members_retain_owner
  before delete or update of role on org_members
  for each row execute function prevent_last_org_owner_removal();

-- Dissolving an org is a single transaction: its projects become personal
-- projects owned by the deleting org owner before the organization/members are
-- removed. No project falls back to a stale creator.
create or replace function delete_organization_with_recovery(
  p_org_id uuid,
  p_recovery_owner_id uuid
) returns void language plpgsql as $$
begin
  perform 1 from organizations where id = p_org_id for update;
  if not found then raise exception 'organization not found'; end if;
  if not exists (
    select 1 from org_members
    where org_id = p_org_id and user_id = p_recovery_owner_id and role = 'owner'
  ) then
    raise exception 'recovery account must be an organization owner' using errcode = '42501';
  end if;
  update projects
    set owner_id = p_recovery_owner_id, org_id = null
    where org_id = p_org_id;
  delete from organizations where id = p_org_id;
end;
$$;

-- User deletion must use explicit ownership transfer/offboarding instead of
-- cascading away durable organizations or projects through a historical
-- creator foreign key.
alter table organizations alter column owner_id drop not null;
alter table organizations drop constraint if exists organizations_owner_id_fkey;
alter table organizations add constraint organizations_owner_id_fkey
  foreign key (owner_id) references users(id) on delete set null;
alter table projects alter column owner_id drop not null;
alter table projects drop constraint if exists projects_owner_id_fkey;
alter table projects add constraint projects_owner_id_fkey
  foreign key (owner_id) references users(id) on delete set null;
alter table projects drop constraint if exists projects_personal_owner_required;
alter table projects add constraint projects_personal_owner_required
  check (org_id is not null or owner_id is not null);

-- Constant-size budget gate: sum in Postgres instead of paging every usage row
-- through the orchestrator on every agent turn. Defined only after projects has
-- org_id so a fresh, top-to-bottom schema apply succeeds.
create or replace function org_month_to_date_spend_usd(oid uuid, since_ts timestamptz)
returns numeric language sql stable as $$
  select coalesce(sum(u.cost_usd), 0)
  from usage_events u
  join projects p on p.id = u.project_id
  where p.org_id = oid and u.created_at >= since_ts;
$$;

-- ── Comments (P3.4) ───────────────────────────────────────────────────────────
-- A teammate can comment on a preview element (reusing selectedElement
-- descriptors as target_ref), a file, a checkpoint, a PR, or the project at large.
create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  target_kind text not null check (target_kind in ('element', 'file', 'checkpoint', 'pr', 'general')),
  target_ref text,
  body text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists comments_project_idx on comments (project_id, created_at desc);
alter table comments enable row level security;

-- ── Checkpoint / interaction artifacts (P2.3) ────────────────────────────────
-- Evidence captured during a turn (interact_preview runs, screenshots, console/
-- network findings, a11y) tied to a checkpoint + session so it persists as proof
-- of what the agent tried — feeds PR bundles (P1.3) and async review packets (P8.3).
create table if not exists checkpoint_artifacts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  session_id uuid references chat_sessions(id) on delete cascade,
  checkpoint_sha text,
  kind text not null check (kind in ('interaction', 'screenshot', 'console', 'network', 'a11y', 'flow')),
  summary text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists checkpoint_artifacts_project_idx on checkpoint_artifacts (project_id, created_at desc);
create index if not exists checkpoint_artifacts_session_idx on checkpoint_artifacts (session_id, created_at desc);
alter table checkpoint_artifacts enable row level security;

-- ── Saved smoke-flows (P2.4) ─────────────────────────────────────────────────
-- Per-project replayable interaction flows ("create an invoice and mark it
-- paid"). `steps` is a FlowStep[] (the same action vocabulary interact_preview
-- drives). The agent records a flow after building a feature (save_flow) and
-- replays it after later changes (run_flow); the user can also replay one-click
-- from the Preview (Agent) tab. last_* hold the most recent replay as a compact
-- evidence card — pass/fail + when + a one-line summary.
create table if not exists project_flows (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  created_by uuid references users(id) on delete set null,
  name text not null,
  description text,
  steps jsonb not null default '[]'::jsonb,
  start_path text,
  last_status text check (last_status in ('pass', 'fail', 'error')),
  last_run_at timestamptz,
  last_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, name)
);
create index if not exists project_flows_project_idx on project_flows (project_id, updated_at desc);
drop trigger if exists project_flows_updated_at on project_flows;
create trigger project_flows_updated_at before update on project_flows
  for each row execute function touch_project_updated_at();
alter table project_flows enable row level security;

-- ── Durable agent task queue (P8.1) ──────────────────────────────────────────
-- Survives restarts (unlike the in-memory background-shell-job Map). One row per
-- queued/running/done agent task, optionally on its own branch with a review packet.
create table if not exists agent_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  org_id uuid references organizations(id) on delete set null,
  created_by uuid not null references users(id) on delete cascade,
  title text not null,
  prompt text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'canceled')),
  branch text,
  acceptance_criteria text,
  result_summary text,
  error text,
  worker_id text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  attempt integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table agent_tasks add column if not exists worker_id text;
alter table agent_tasks add column if not exists lease_expires_at timestamptz;
alter table agent_tasks add column if not exists heartbeat_at timestamptz;
alter table agent_tasks add column if not exists attempt integer not null default 0;
create index if not exists agent_tasks_project_idx on agent_tasks (project_id, created_at desc);
create index if not exists agent_tasks_status_idx on agent_tasks (status, created_at);
create index if not exists agent_tasks_lease_idx
  on agent_tasks (lease_expires_at)
  where status = 'running';
drop trigger if exists agent_tasks_updated_at on agent_tasks;
create trigger agent_tasks_updated_at before update on agent_tasks
  for each row execute function touch_project_updated_at();
alter table agent_tasks enable row level security;

-- Multi-worker-safe claim with crash recovery. Expired running rows become
-- eligible again; FOR UPDATE SKIP LOCKED guarantees one owner across instances.
create or replace function claim_next_agent_task(
  p_worker_id text,
  p_lease_seconds integer default 120
)
returns setof agent_tasks
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_worker_id is null or btrim(p_worker_id) = '' then
    raise exception 'worker id is required';
  end if;
  return query
  with candidate as (
    select id
      from agent_tasks
     where status = 'queued'
        or (status = 'running' and (lease_expires_at is null or lease_expires_at < now()))
     order by created_at asc
     for update skip locked
     limit 1
  )
  update agent_tasks as task
     set status = 'running',
         worker_id = p_worker_id,
         heartbeat_at = now(),
         lease_expires_at = now()
           + make_interval(secs => greatest(30, least(p_lease_seconds, 3600))),
         attempt = task.attempt + 1,
         error = null
    from candidate
   where task.id = candidate.id
  returning task.*;
end;
$$;
revoke all on function claim_next_agent_task(text, integer) from public, anon, authenticated;
grant execute on function claim_next_agent_task(text, integer) to service_role;

-- Existing installations used ON DELETE SET NULL, which could turn a queued
-- user task into an apparently system-owned task after account offboarding.
-- Fail closed for any legacy rows and cascade future creator deletion instead.
update agent_tasks
  set status = 'canceled', error = 'task creator no longer exists'
  where created_by is null and status in ('queued', 'running');
alter table agent_tasks drop constraint if exists agent_tasks_created_by_fkey;
alter table agent_tasks add constraint agent_tasks_created_by_fkey
  foreign key (created_by) references users(id) on delete cascade;

-- ── Expand audit kinds (P10.3) ───────────────────────────────────────────────
-- Idempotently widen audit_events.kind to cover login, project CRUD, role
-- changes, deploys, preview shares, GitHub actions, DB lifecycle, and org events.
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'audit_events'::regclass and contype = 'c' and conname like '%kind%';
  if c is not null then execute format('alter table audit_events drop constraint %I', c); end if;
  alter table audit_events add constraint audit_events_kind_check check (
    kind in (
      'secret_read', 'secret_write', 'secret_delete',
      'connector_invoke', 'connector_invoke_error',
      'checkpoint_create', 'checkpoint_restore',
      'login', 'logout',
      'project_create', 'project_update', 'project_delete',
      'member_invite', 'member_remove', 'role_change',
      'deploy', 'preview_share', 'github_action', 'db_lifecycle',
      'org_create', 'org_update'
    )
  );
end$$;
