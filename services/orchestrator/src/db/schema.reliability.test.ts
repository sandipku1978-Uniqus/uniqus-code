import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

describe("durable lifecycle schema", () => {
  it("claims queued tasks atomically with expiring leases", () => {
    expect(schema).toMatch(/create or replace function claim_next_agent_task/i);
    expect(schema).toMatch(/for update skip locked/i);
    expect(schema).toMatch(/lease_expires_at/i);
  });

  it("exclusively claims guests before irreversible cleanup", () => {
    expect(schema).toMatch(/guest_lifecycle_claim uuid/i);
    expect(schema).toMatch(/create or replace function claim_guest_for_deletion/i);
    expect(schema).toMatch(/account_type = 'guest'/i);
  });

  it("retains a durable erasure key until external cleanup completes", () => {
    expect(schema).toMatch(/create table if not exists cleanup_jobs/i);
    expect(schema).toMatch(/unique \(kind, resource_id\)/i);
    expect(schema).toMatch(/next_attempt_at timestamptz not null/i);
    expect(schema).toMatch(/revoke all on table cleanup_jobs from public, anon, authenticated/i);
  });

  it("persists deploy intents before a unique in-flight provider operation", () => {
    expect(schema).toMatch(/operation_key uuid not null default gen_random_uuid\(\)/i);
    expect(schema).toMatch(/state = 'CREATING'/i);
    expect(schema).toMatch(/unique index[^;]+deployments[^;]+creating/is);
  });

  it("provides cross-process CAS generations for rotated OAuth credentials", () => {
    expect(schema).toMatch(/supabase_token_generation uuid not null default gen_random_uuid\(\)/i);
    expect(schema).toMatch(/figma_token_generation uuid not null default gen_random_uuid\(\)/i);
  });
});
