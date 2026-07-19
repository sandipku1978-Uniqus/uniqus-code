import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

function sqlFunction(name: string): string {
  const start = schema.indexOf(`create or replace function public.${name}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = schema.indexOf("\n$$;", start);
  expect(end).toBeGreaterThan(start);
  return schema.slice(start, end + 4);
}

describe("Stripe billing schema invariants", () => {
  it("requires durable invoice evidence for paid entitlement", () => {
    expect(schema).toMatch(/last_valid_invoice_id text/i);
    expect(schema).toMatch(/entitled_through timestamptz/i);
    expect(schema).toMatch(/create table if not exists billing_invoice_invalidations/i);
    expect(schema).toMatch(/create or replace function public\.apply_paid_billing_invoice/i);
    expect(schema).toMatch(
      /apply_paid_billing_invoice[\s\S]+subscription_status not in \('active', 'past_due'\)[\s\S]+return false/i,
    );
  });

  it("serializes paid grants and reversals on the same invoice lock", () => {
    const lock = /hashtextextended\('billing-invoice:' \|\| p_invoice_id, 0\)/gi;
    expect(schema.match(lock)).toHaveLength(2);
    expect(schema).toMatch(
      /invalidate_billing_invoice[\s\S]+insert into billing_invoice_invalidations[\s\S]+set remaining_microusd = 0[\s\S]+set last_valid_invoice_id = null/i,
    );
  });

  it("keeps reversal tombstones and Checkout locks server-private", () => {
    for (const table of [
      "billing_invoice_invalidations",
      "billing_checkout_attempts",
    ]) {
      expect(schema).toMatch(
        new RegExp(`alter table ${table} force row level security`, "i"),
      );
      expect(schema).toMatch(
        new RegExp(`revoke all on table ${table} from public, anon, authenticated`, "i"),
      );
    }
    expect(schema).toMatch(
      /revoke all on function public\.invalidate_billing_invoice\(text, text\)[\s\S]+from public, anon, authenticated/i,
    );
    expect(schema).toMatch(
      /grant execute on function public\.invalidate_billing_invoice\(text, text\)[\s\S]+to service_role/i,
    );
  });

  it("atomically permits only one unexpired Checkout attempt per account", () => {
    expect(schema).toMatch(/user_id uuid primary key references users/i);
    expect(schema).toMatch(/create or replace function public\.acquire_billing_checkout_attempt/i);
    expect(schema).toMatch(/on conflict \(user_id\) do nothing/i);
    expect(schema).toMatch(/subscription_status not in \('none', 'canceled', 'incomplete_expired'\)/i);
  });

  it("atomically deactivates paid access without losing subscription mapping", () => {
    const provision = sqlFunction("apply_paid_billing_invoice");
    const deactivate = sqlFunction("deactivate_billing_paid_access");
    const walletLock = /pg_advisory_xact_lock\(hashtextextended\(p_user_id::text, 0\)\)/i;

    expect(provision).toMatch(walletLock);
    expect(deactivate).toMatch(walletLock);
    expect(deactivate).toMatch(
      /update billing_credit_reservation_items i[\s\S]+set refundable = false[\s\S]+g\.stripe_invoice_id is not null[\s\S]+r\.finalized_microusd is null[\s\S]+update billing_credit_grants/i,
    );
    expect(deactivate).toMatch(
      /update billing_credit_grants[\s\S]+suspended_microusd[\s\S]+user_id = p_user_id[\s\S]+stripe_invoice_id is not null[\s\S]+remaining_microusd > 0/i,
    );
    expect(deactivate).toMatch(
      /update billing_accounts[\s\S]+last_valid_invoice_id = null[\s\S]+entitled_through = null[\s\S]+where user_id = p_user_id/i,
    );
    expect(deactivate).not.toMatch(/stripe_subscription_id\s*=\s*null/i);
    expect(deactivate).not.toMatch(/subscription_status\s*=/i);
    expect(deactivate).not.toMatch(/plan\s*=\s*'free'/i);
  });

  it("replays a valid invoice by restoring only suspended unspent allowance", () => {
    const provision = sqlFunction("apply_paid_billing_invoice");
    expect(schema).toMatch(/suspended_microusd bigint not null default 0/i);
    expect(provision).toMatch(
      /on conflict \(source_key\) do update[\s\S]+remaining_microusd \+ billing_credit_grants\.suspended_microusd[\s\S]+suspended_microusd = 0/i,
    );
    expect(provision).toMatch(
      /set refundable = true[\s\S]+g\.stripe_invoice_id = p_invoice_id[\s\S]+r\.finalized_microusd is null/i,
    );
    expect(provision).not.toMatch(/on conflict \(source_key\) do nothing/i);
  });

  it("atomically revokes paid grants while transitioning a terminal plan to Free", () => {
    const terminate = sqlFunction("terminate_billing_subscription");

    expect(terminate).toMatch(
      /p_status not in \('canceled', 'incomplete_expired'\)/i,
    );
    expect(terminate).toMatch(
      /pg_advisory_xact_lock\(hashtextextended\(p_user_id::text, 0\)\)[\s\S]+update billing_credit_grants[\s\S]+stripe_invoice_id is not null[\s\S]+update billing_accounts/i,
    );
    expect(terminate).toMatch(
      /update billing_credit_reservation_items i[\s\S]+set refundable = false[\s\S]+g\.stripe_invoice_id is not null[\s\S]+r\.finalized_microusd is null[\s\S]+update billing_credit_grants/i,
    );
    expect(terminate).toMatch(/set plan = 'free'[\s\S]+subscription_status = p_status/i);
    expect(terminate).toMatch(
      /stripe_customer_id = coalesce\(p_customer_id, stripe_customer_id\)/i,
    );
    expect(terminate).toMatch(
      /stripe_subscription_id = null[\s\S]+last_valid_invoice_id = null[\s\S]+entitled_through = null/i,
    );
  });

  it("keeps paid-access deactivation RPCs service-role-only", () => {
    for (const signature of [
      "deactivate_billing_paid_access\\(uuid\\)",
      "terminate_billing_subscription\\(uuid, text, text\\)",
    ]) {
      expect(schema).toMatch(
        new RegExp(`revoke all on function public\\.${signature}[\\s\\S]+from public, anon, authenticated`, "i"),
      );
      expect(schema).toMatch(
        new RegExp(`grant execute on function public\\.${signature}[\\s\\S]+to service_role`, "i"),
      );
    }
  });

  it("escrows a bounded run budget and refunds only still-valid allocations", () => {
    const reserve = sqlFunction("reserve_billing_credits");
    const finalize = sqlFunction("finalize_billing_credit_reservation");

    expect(schema).toMatch(/create table if not exists billing_credit_reservations/i);
    expect(schema).toMatch(/create table if not exists billing_credit_reservation_items/i);
    expect(reserve).toMatch(
      /pg_advisory_xact_lock\(hashtextextended\(p_user_id::text, 0\)\)[\s\S]+set remaining_microusd = remaining_microusd - v_take[\s\S]+insert into billing_credit_reservation_items/i,
    );
    expect(finalize).toMatch(
      /pg_advisory_xact_lock\(hashtextextended\(p_user_id::text, 0\)\)[\s\S]+v_item\.refundable[\s\S]+g\.remaining_microusd \+ v_refund[\s\S]+insert into billing_credit_ledger/i,
    );
    expect(finalize).toMatch(
      /greatest\(p_actual_microusd - v_reservation\.reserved_microusd, 0\)/i,
    );
  });

  it("suspends transiently deactivated escrow without reviving stale paid grants", () => {
    const provision = sqlFunction("apply_paid_billing_invoice");
    const finalize = sqlFunction("finalize_billing_credit_reservation");

    expect(finalize).toMatch(
      /v_item\.refundable[\s\S]+set suspended_microusd = least\([\s\S]+g\.suspended_microusd \+ v_refund[\s\S]+g\.stripe_invoice_id is not null/i,
    );
    expect(finalize).toMatch(
      /not exists \([\s\S]+billing_invoice_invalidations[\s\S]+i\.stripe_invoice_id = g\.stripe_invoice_id[\s\S]+a\.plan in \('byok', 'plus', 'max'\)[\s\S]+a\.stripe_subscription_id is not null[\s\S]+a\.last_valid_invoice_id is null/i,
    );
    // Suspended credit becomes spendable only through the exact invoice replay;
    // apply also rechecks the account's current subscription and plan above it.
    expect(provision).toMatch(
      /g\.stripe_invoice_id = p_invoice_id[\s\S]+on conflict \(source_key\) do update[\s\S]+billing_credit_grants\.suspended_microusd/i,
    );
    expect(provision).toMatch(
      /stripe_subscription_id is distinct from p_subscription_id[\s\S]+plan is distinct from p_plan[\s\S]+return false/i,
    );
  });

  it("cannot resurrect Free trial credit after a guest-account merge", () => {
    const merge = sqlFunction("convert_guest_account");

    expect(merge).toMatch(
      /pg_advisory_xact_lock[\s\S]+update billing_credit_reservation_items i[\s\S]+set refundable = false[\s\S]+free-trial:[\s\S]+r\.finalized_microusd is null[\s\S]+set remaining_microusd = v_merged_remaining/i,
    );
    expect(merge).toMatch(
      /v_existing_target <> p_target_user_id[\s\S]+update projects[\s\S]+set converted_at = now\(\)/i,
    );
    expect(merge).toMatch(
      /select account_type, converted_at, guest_lifecycle_claim[\s\S]+for update[\s\S]+v_guest_lifecycle_claim is not null[\s\S]+cleanup is already in progress/i,
    );
    expect(merge).toMatch(/if not found then[\s\S]+return 0/i);
    expect(merge).not.toMatch(/p_claim/i);
    expect(schema).toMatch(
      /revoke all on function public\.convert_guest_account\(uuid, uuid\)[\s\S]+to service_role/i,
    );
  });

  it("keeps credit escrow tables and RPCs server-private", () => {
    for (const table of [
      "billing_credit_reservations",
      "billing_credit_reservation_items",
    ]) {
      expect(schema).toMatch(new RegExp(`alter table ${table} force row level security`, "i"));
      expect(schema).toMatch(
        new RegExp(`revoke all on table ${table} from public, anon, authenticated`, "i"),
      );
    }
    for (const signature of [
      "reserve_billing_credits\\(uuid, uuid, bigint, text\\)",
      "finalize_billing_credit_reservation\\(uuid, uuid, bigint\\)",
    ]) {
      expect(schema).toMatch(
        new RegExp(`revoke all on function public\\.${signature}[\\s\\S]+from public, anon, authenticated`, "i"),
      );
      expect(schema).toMatch(
        new RegExp(`grant execute on function public\\.${signature}[\\s\\S]+to service_role`, "i"),
      );
    }
  });
});
