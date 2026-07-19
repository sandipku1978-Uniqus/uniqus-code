import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integrationDescribe = databaseUrl ? describe : describe.skip;
const schemaSql = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
const testSchema = `billing_test_${process.pid}_${Math.random().toString(36).slice(2, 10)}`;
let client: Client;

function functionSql(name: string): string {
  const start = schemaSql.indexOf(`create or replace function public.${name}`);
  const end = schemaSql.indexOf("\n$$;", start);
  if (start < 0 || end < 0) throw new Error(`could not extract ${name}`);
  return schemaSql
    .slice(start, end + 4)
    .replace(`public.${name}`, `${testSchema}.${name}`)
    .replace(/set search_path = public/i, `set search_path = ${testSchema}`);
}

integrationDescribe("billing Postgres lifecycle", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(`create schema ${testSchema}`);
    await client.query(`
      set search_path = ${testSchema};
      create table users (
        id uuid primary key,
        account_type text not null,
        converted_at timestamptz,
        guest_recovery_hash text,
        guest_recovery_code_enc text,
        guest_lifecycle_claim uuid,
        guest_lifecycle_claimed_at timestamptz
      );
      create table projects (
        id uuid primary key,
        owner_id uuid,
        org_id uuid
      );
      create table billing_accounts (
        user_id uuid primary key,
        plan text not null default 'free',
        subscription_status text not null default 'none',
        stripe_customer_id text,
        stripe_subscription_id text,
        stripe_subscription_item_id text,
        max_monthly_usd integer,
        current_period_start timestamptz,
        current_period_end timestamptz,
        last_valid_invoice_id text,
        entitled_through timestamptz,
        cancel_at_period_end boolean not null default false,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create table billing_credit_grants (
        id bigserial primary key,
        user_id uuid not null,
        source_key text not null unique,
        bucket text not null,
        amount_microusd bigint not null,
        remaining_microusd bigint not null,
        suspended_microusd bigint not null default 0,
        stripe_invoice_id text,
        starts_at timestamptz not null default now(),
        expires_at timestamptz,
        created_at timestamptz not null default now()
      );
      create table billing_credit_ledger (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null,
        run_id uuid not null,
        requested_microusd bigint not null,
        usage_microusd bigint not null default 0,
        reliability_microusd bigint not null default 0,
        uncovered_microusd bigint not null default 0,
        preferred_bucket text not null,
        created_at timestamptz not null default now(),
        unique (user_id, run_id)
      );
      create table billing_credit_reservations (
        user_id uuid not null,
        run_id uuid not null,
        requested_microusd bigint not null,
        reserved_microusd bigint not null,
        preferred_bucket text not null,
        finalized_microusd bigint,
        created_at timestamptz not null default now(),
        finalized_at timestamptz,
        primary key (user_id, run_id)
      );
      create table billing_credit_reservation_items (
        user_id uuid not null,
        run_id uuid not null,
        ordinal integer not null,
        grant_id bigint not null,
        bucket text not null,
        amount_microusd bigint not null,
        refundable boolean not null default true
      );
      create table billing_invoice_invalidations (
        stripe_invoice_id text primary key,
        reason text
      );
      create table billing_trial_merges (
        guest_user_id uuid primary key,
        target_user_id uuid not null,
        merged_at timestamptz not null default now()
      );
    `);
    for (const name of [
      "apply_paid_billing_invoice",
      "deactivate_billing_paid_access",
      "reserve_billing_credits",
      "finalize_billing_credit_reservation",
      "convert_guest_account",
    ]) {
      await client.query(functionSql(name));
    }
  });

  afterAll(async () => {
    if (!client) return;
    await client.query(`drop schema if exists ${testSchema} cascade`);
    await client.end();
  });

  it("replays the same invoice without re-minting consumed credit", async () => {
    const userId = randomUUID();
    await client.query(
      `insert into ${testSchema}.users (id, account_type) values ($1, 'standard')`,
      [userId],
    );
    await client.query(
      `insert into ${testSchema}.billing_accounts
        (user_id, plan, subscription_status, stripe_subscription_id)
       values ($1, 'plus', 'active', 'sub_replay')`,
      [userId],
    );
    const apply = () =>
      client.query(
        `select ${testSchema}.apply_paid_billing_invoice(
          $1, 'sub_replay', 'in_replay', 'plus', 12000000, 2000000,
          now() - interval '1 day', now() + interval '29 days'
        )`,
        [userId],
      );

    await apply();
    await client.query(
      `update ${testSchema}.billing_credit_grants
       set remaining_microusd = 7000000
       where source_key = 'stripe-invoice:in_replay:usage'`,
    );
    await client.query(`select ${testSchema}.deactivate_billing_paid_access($1)`, [userId]);
    await apply();

    const { rows } = await client.query(
      `select remaining_microusd, suspended_microusd
       from ${testSchema}.billing_credit_grants
       where source_key = 'stripe-invoice:in_replay:usage'`,
    );
    expect(Number(rows[0].remaining_microusd)).toBe(7_000_000);
    expect(Number(rows[0].suspended_microusd)).toBe(0);
  });

  it("restores unused escrow finalized between deactivation and invoice replay", async () => {
    const userId = randomUUID();
    const runId = randomUUID();
    await client.query(
      `insert into ${testSchema}.users (id, account_type) values ($1, 'standard')`,
      [userId],
    );
    await client.query(
      `insert into ${testSchema}.billing_accounts
        (user_id, plan, subscription_status, stripe_subscription_id)
       values ($1, 'plus', 'active', 'sub_escrow_replay')`,
      [userId],
    );
    const apply = () =>
      client.query(
        `select ${testSchema}.apply_paid_billing_invoice(
          $1, 'sub_escrow_replay', 'in_escrow_replay', 'plus', 12000000, 0,
          now() - interval '1 day', now() + interval '29 days'
        )`,
        [userId],
      );

    await apply();
    const reserved = await client.query(
      `select ${testSchema}.reserve_billing_credits($1, $2, 10000000, 'usage') as amount`,
      [userId, runId],
    );
    expect(Number(reserved.rows[0].amount)).toBe(10_000_000);

    await client.query(`select ${testSchema}.deactivate_billing_paid_access($1)`, [userId]);
    await client.query(
      `select * from ${testSchema}.finalize_billing_credit_reservation($1, $2, 4000000)`,
      [userId, runId],
    );

    const suspended = await client.query(
      `select remaining_microusd, suspended_microusd
       from ${testSchema}.billing_credit_grants
       where source_key = 'stripe-invoice:in_escrow_replay:usage'`,
    );
    expect(Number(suspended.rows[0].remaining_microusd)).toBe(0);
    expect(Number(suspended.rows[0].suspended_microusd)).toBe(8_000_000);

    await apply();
    const restored = await client.query(
      `select remaining_microusd, suspended_microusd
       from ${testSchema}.billing_credit_grants
       where source_key = 'stripe-invoice:in_escrow_replay:usage'`,
    );
    expect(Number(restored.rows[0].remaining_microusd)).toBe(8_000_000);
    expect(Number(restored.rows[0].suspended_microusd)).toBe(0);
  });

  it("atomically moves projects, replays idempotently, and excludes cleanup", async () => {
    const guestId = randomUUID();
    const targetId = randomUUID();
    const otherTargetId = randomUUID();
    const projectId = randomUUID();
    await client.query(
      `insert into ${testSchema}.users (id, account_type)
       values ($1, 'guest'), ($2, 'standard'), ($3, 'standard')`,
      [guestId, targetId, otherTargetId],
    );
    await client.query(
      `insert into ${testSchema}.projects (id, owner_id) values ($1, $2)`,
      [projectId, guestId],
    );

    const converted = await client.query(
      `select ${testSchema}.convert_guest_account($1, $2) as moved`,
      [guestId, targetId],
    );
    expect(converted.rows[0].moved).toBe(1);
    const replay = await client.query(
      `select ${testSchema}.convert_guest_account($1, $2) as moved`,
      [guestId, targetId],
    );
    expect(replay.rows[0].moved).toBe(0);
    const deletedGuest = await client.query(
      `select ${testSchema}.convert_guest_account($1, $2) as moved`,
      [randomUUID(), targetId],
    );
    expect(deletedGuest.rows[0].moved).toBe(0);
    const project = await client.query(
      `select owner_id from ${testSchema}.projects where id = $1`,
      [projectId],
    );
    expect(project.rows[0].owner_id).toBe(targetId);

    const secondGuest = randomUUID();
    await client.query(
      `insert into ${testSchema}.users (id, account_type) values ($1, 'guest')`,
      [secondGuest],
    );
    await client.query(
      `insert into ${testSchema}.billing_trial_merges (guest_user_id, target_user_id)
       values ($1, $2)`,
      [secondGuest, targetId],
    );
    await expect(
      client.query(`select ${testSchema}.convert_guest_account($1, $2)`, [
        secondGuest,
        otherTargetId,
      ]),
    ).rejects.toThrow(/another account/);

    const cleanupGuest = randomUUID();
    await client.query(
      `insert into ${testSchema}.users
        (id, account_type, guest_lifecycle_claim, guest_lifecycle_claimed_at)
       values ($1, 'guest', $2, now())`,
      [cleanupGuest, randomUUID()],
    );
    await expect(
      client.query(`select ${testSchema}.convert_guest_account($1, $2)`, [
        cleanupGuest,
        targetId,
      ]),
    ).rejects.toThrow(/cleanup is already in progress/);
  });
});
