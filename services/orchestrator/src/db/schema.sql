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
alter table users add column if not exists figma_handle text;
alter table users add column if not exists figma_connected_at timestamptz;

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

-- Per-project Supabase link. Populated when the agent provisions (or the user
-- attaches) a Supabase project. `ref` is the 20-char project ref; the anon key,
-- service_role key, db password and connection string live in project_secrets,
-- never here.
alter table projects add column if not exists supabase_project_ref text;
alter table projects add column if not exists supabase_project_name text;
alter table projects add column if not exists supabase_org_id text;

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

create index if not exists account_provider_keys_user_idx
  on account_provider_keys (user_id);

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

create index if not exists usage_events_user_idx
  on usage_events (user_id, created_at desc);

alter table usage_events enable row level security;

-- Account-wide usage rollup for the dashboard. Aggregated in Postgres so the
-- totals aren't capped by PostgREST's per-request row limit. Returns a single
-- jsonb blob: grand totals plus a per-model breakdown ordered by total tokens.
create or replace function account_usage_stats(uid uuid)
returns jsonb language sql stable as $$
  with rows as (
    select provider, model, input_tokens, output_tokens,
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
      count(*)::bigint                                  as turns
    from rows
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
      count(*)::bigint                    as turns
    from rows
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
        'turns', turns
      )) from per_model),
      '[]'::jsonb
    )
  );
$$;

-- Global, per-user design systems (Design Systems tab on the projects page).
-- Reusable token sets (color/typography/spacing/...) attached to a project (or
-- none) and injected into the agent's system prompt so generation stays
-- on-system. `tokens` is the canonical JSON artifact — shape = DesignTokens in
-- @uniqus/api-types. Created once, used across many projects.
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
-- attached bodies are injected into the agent system prompt before the project's
-- own .uniqus/skills.md (which stays the override layer). `body` = SkillLibrary
-- in @uniqus/api-types. Distinct from the code-defined curated SKILL_PACKS.
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
-- it. Row = KnowledgeDocument in @uniqus/api-types.
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
-- with membership-scoped access, NOT many people prompting one tree. owner_id on
-- projects stays the creator; org_id + the *_members tables layer shared access
-- on top. Roles are owner|admin|editor|viewer (shared enum in @uniqus/api-types).
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

-- Projects can belong to an org (P3.1). owner_id stays the creator.
alter table projects add column if not exists org_id uuid references organizations(id) on delete set null;

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
  created_by uuid references users(id) on delete set null,
  title text not null,
  prompt text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'canceled')),
  branch text,
  acceptance_criteria text,
  result_summary text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists agent_tasks_project_idx on agent_tasks (project_id, created_at desc);
create index if not exists agent_tasks_status_idx on agent_tasks (status, created_at);
drop trigger if exists agent_tasks_updated_at on agent_tasks;
create trigger agent_tasks_updated_at before update on agent_tasks
  for each row execute function touch_project_updated_at();
alter table agent_tasks enable row level security;

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
