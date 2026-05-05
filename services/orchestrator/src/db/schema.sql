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

-- Per-project Vercel project ID. Populated on first successful deploy so
-- subsequent deploys hit the same project and the dashboard URL is stable.
alter table projects add column if not exists vercel_project_id text;
alter table projects add column if not exists vercel_project_name text;

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
