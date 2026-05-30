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
create unique index if not exists users_guest_recovery_hash_idx
  on users (guest_recovery_hash) where guest_recovery_hash is not null;

-- Account-wide agent customization (Settings → Custom prompts & default skills).
-- custom_prompt is appended to the agent system prompt on every turn, on top of
-- the per-project .uniqus/skills.md, so the user's standing instructions apply
-- everywhere without re-typing. default_skills is the Skills markdown seeded
-- into a brand-new project's .uniqus/skills.md at creation, so those
-- conventions are in effect from the first turn. Both are plain text (NULL =
-- unset); the API caps them at 16 KB / 64 KB respectively.
alter table users add column if not exists custom_prompt text;
alter table users add column if not exists default_skills text;

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_owner_idx on projects (owner_id, updated_at desc);

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

-- Per-project GitHub repo. Populated when the user clicks "Create GitHub
-- repo" in the workspace topbar. The orchestrator creates a fresh repo via
-- the user's existing GitHub OAuth and stores the canonical web URL +
-- "owner/name" so the All Projects view can show the link.
alter table projects add column if not exists github_repo_url text;
alter table projects add column if not exists github_repo_full_name text;

-- Phase 1.x project lifecycle UX: optional emoji/letter for visual ID in
-- the picker grid and topbar. Null = render the auto-derived hash tile.
alter table projects add column if not exists icon text;

-- Deploys: one row per attempted deployment. Lets the UI show history and
-- lets the orchestrator poll status without re-asking Vercel for everything.
create table if not exists deployments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  vercel_deployment_id text not null,
  vercel_url text,
  state text not null default 'QUEUED'
    check (state in ('QUEUED', 'BUILDING', 'READY', 'ERROR', 'CANCELED')),
  error_message text,
  target text not null default 'production'
    check (target in ('production', 'preview')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists deployments_project_idx
  on deployments (project_id, created_at desc);

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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

-- Per-environment scoping (Phase 2.x). Same name can exist in multiple envs
-- with different values (e.g. STRIPE_API_KEY in 'production' vs 'development').
-- Backfilled to 'default' for existing rows; the API treats 'default' as the
-- env when callers don't specify one, so single-env projects keep working
-- without changes.
alter table project_secrets add column if not exists env text not null default 'default';

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

-- Per-turn token usage (Plan §5 — dashboard usage widgets). One row per
-- completed agent turn. user_id is the acting user (the project owner), so the
-- dashboard can aggregate per account without a join. Purely analytics — no
-- plaintext, no secrets. project_id/user_id cascade-delete with their parents.
create table if not exists usage_events (
  id bigserial primary key,
  project_id uuid references projects(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  provider text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  elapsed_ms integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists usage_events_user_idx
  on usage_events (user_id, created_at desc);

alter table usage_events enable row level security;

-- Account-wide usage rollup for the dashboard. Aggregated in Postgres so the
-- totals aren't capped by PostgREST's per-request row limit. Returns a single
-- jsonb blob: grand totals plus a per-model breakdown ordered by total tokens.
create or replace function account_usage_stats(uid uuid)
returns jsonb language sql stable as $$
  with rows as (
    select provider, model, input_tokens, output_tokens, elapsed_ms
    from usage_events where user_id = uid
  ),
  totals as (
    select
      coalesce(sum(input_tokens), 0)::bigint  as total_input_tokens,
      coalesce(sum(output_tokens), 0)::bigint as total_output_tokens,
      coalesce(sum(elapsed_ms), 0)::bigint    as total_time_ms,
      count(*)::bigint                         as turns
    from rows
  ),
  per_model as (
    select
      provider, model,
      sum(input_tokens)::bigint  as input_tokens,
      sum(output_tokens)::bigint as output_tokens,
      count(*)::bigint           as turns
    from rows
    group by provider, model
    order by (sum(input_tokens) + sum(output_tokens)) desc
  )
  select jsonb_build_object(
    'total_input_tokens',  (select total_input_tokens  from totals),
    'total_output_tokens', (select total_output_tokens from totals),
    'total_time_ms',       (select total_time_ms       from totals),
    'turns',               (select turns               from totals),
    'per_model', coalesce(
      (select jsonb_agg(jsonb_build_object(
        'model', model, 'provider', provider,
        'input_tokens', input_tokens, 'output_tokens', output_tokens, 'turns', turns
      )) from per_model),
      '[]'::jsonb
    )
  );
$$;
