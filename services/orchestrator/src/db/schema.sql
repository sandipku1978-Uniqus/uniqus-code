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
