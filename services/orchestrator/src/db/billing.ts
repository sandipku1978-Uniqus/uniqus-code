import type {
  BillingPlan,
  BillingSubscriptionStatus,
} from "@gate15/api-types";
import { FREE_TRIAL_CREDITS_USD, dollarsToMicrousd } from "../billing/plans.js";
import { db } from "./client.js";

export type CreditBucket = "usage" | "reliability";
export type TerminalBillingSubscriptionStatus = Extract<
  BillingSubscriptionStatus,
  "canceled" | "incomplete_expired"
>;

export interface BillingAccountRecord {
  user_id: string;
  plan: BillingPlan;
  subscription_status: BillingSubscriptionStatus;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_subscription_item_id: string | null;
  max_monthly_usd: number | null;
  current_period_start: string | null;
  current_period_end: string | null;
  last_valid_invoice_id: string | null;
  entitled_through: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
}

export interface WalletBalance {
  usageMicrousd: number;
  reliabilityMicrousd: number;
}

export interface CreditSettlement extends WalletBalance {
  chargedMicrousd: number;
  uncoveredMicrousd: number;
}

export interface CreditReservationSettlement extends CreditSettlement {
  reservationFound: boolean;
}

export interface SubscriptionSyncInput {
  userId: string;
  plan: BillingPlan;
  status: BillingSubscriptionStatus;
  customerId: string;
  subscriptionId: string;
  subscriptionItemId: string | null;
  maxMonthlyUsd: number | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

/** Lazily provisions the internal Free account and its one-time $3 wallet. */
export async function ensureBillingAccount(userId: string): Promise<BillingAccountRecord> {
  const { error: accountError } = await db()
    .from("billing_accounts")
    .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
  if (accountError) throw new Error(`ensure billing account failed: ${accountError.message}`);

  const freeAmount = dollarsToMicrousd(FREE_TRIAL_CREDITS_USD);
  const { error: grantError } = await db()
    .from("billing_credit_grants")
    .upsert(
      {
        user_id: userId,
        source_key: `free-trial:${userId}`,
        bucket: "usage",
        amount_microusd: freeAmount,
        remaining_microusd: freeAmount,
      },
      { onConflict: "source_key", ignoreDuplicates: true },
    );
  if (grantError) throw new Error(`ensure free credit grant failed: ${grantError.message}`);

  const account = await getBillingAccount(userId);
  if (!account) throw new Error("billing account was not created");
  return account;
}

export async function getBillingAccount(userId: string): Promise<BillingAccountRecord | null> {
  const { data, error } = await db()
    .from("billing_accounts")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`get billing account failed: ${error.message}`);
  return (data as BillingAccountRecord | null) ?? null;
}

export async function getBillingAccountByCustomer(
  customerId: string,
): Promise<BillingAccountRecord | null> {
  const { data, error } = await db()
    .from("billing_accounts")
    .select("*")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (error) throw new Error(`get billing customer failed: ${error.message}`);
  return (data as BillingAccountRecord | null) ?? null;
}

export async function getBillingAccountBySubscription(
  subscriptionId: string,
): Promise<BillingAccountRecord | null> {
  const { data, error } = await db()
    .from("billing_accounts")
    .select("*")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();
  if (error) throw new Error(`get billing subscription failed: ${error.message}`);
  return (data as BillingAccountRecord | null) ?? null;
}

export async function setStripeCustomer(userId: string, customerId: string): Promise<void> {
  await ensureBillingAccount(userId);
  const { error } = await db()
    .from("billing_accounts")
    .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) throw new Error(`set Stripe customer failed: ${error.message}`);
}

export async function syncBillingSubscription(input: SubscriptionSyncInput): Promise<void> {
  await ensureBillingAccount(input.userId);
  const { error } = await db()
    .from("billing_accounts")
    .update({
      plan: input.plan,
      subscription_status: input.status,
      stripe_customer_id: input.customerId,
      stripe_subscription_id: input.subscriptionId,
      stripe_subscription_item_id: input.subscriptionItemId,
      max_monthly_usd: input.maxMonthlyUsd,
      current_period_start: input.currentPeriodStart,
      current_period_end: input.currentPeriodEnd,
      cancel_at_period_end: input.cancelAtPeriodEnd,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", input.userId);
  if (error) throw new Error(`sync Stripe subscription failed: ${error.message}`);
}

/**
 * Atomically revoke every paid grant and transition a terminal subscription to
 * Free. The Stripe Customer mapping is retained for Portal history and reuse.
 */
export async function terminateBillingSubscription(
  userId: string,
  customerId: string | null,
  status: TerminalBillingSubscriptionStatus = "canceled",
): Promise<boolean> {
  const { data, error } = await db().rpc("terminate_billing_subscription", {
    p_user_id: userId,
    p_customer_id: customerId,
    p_status: status,
  });
  if (error) throw new Error(`terminate Stripe subscription failed: ${error.message}`);
  return data === true;
}

/**
 * Atomically suspend every unspent paid grant and paid-through watermark while keeping
 * the Stripe subscription mapping and its latest lifecycle status intact.
 */
export async function deactivateBillingPaidAccess(userId: string): Promise<boolean> {
  const { data, error } = await db().rpc("deactivate_billing_paid_access", {
    p_user_id: userId,
  });
  if (error) throw new Error(`deactivate billing paid access failed: ${error.message}`);
  return data === true;
}

/**
 * Atomically validate a fully paid invoice, revoke Free, mint its allowance,
 * and advance the account's paid-through watermark unless it was invalidated.
 */
export async function applyPaidBillingInvoice(input: {
  userId: string;
  subscriptionId: string;
  stripeInvoiceId: string;
  plan: Exclude<BillingPlan, "free">;
  usageMicrousd: number;
  reliabilityMicrousd: number;
  startsAt: string;
  entitledThrough: string;
}): Promise<boolean> {
  const { data, error } = await db().rpc("apply_paid_billing_invoice", {
    p_user_id: input.userId,
    p_subscription_id: input.subscriptionId,
    p_invoice_id: input.stripeInvoiceId,
    p_plan: input.plan,
    p_usage_microusd: Math.max(0, Math.round(input.usageMicrousd)),
    p_reliability_microusd: Math.max(0, Math.round(input.reliabilityMicrousd)),
    p_starts_at: input.startsAt,
    p_entitled_through: input.entitledThrough,
  });
  if (error) throw new Error(`apply paid billing invoice failed: ${error.message}`);
  return data === true;
}

/** Make invoice invalidation durable even when it arrives before invoice.paid. */
export async function invalidateBillingInvoice(
  stripeInvoiceId: string,
  reason: string,
): Promise<void> {
  const { error } = await db().rpc("invalidate_billing_invoice", {
    p_invoice_id: stripeInvoiceId,
    p_reason: reason,
  });
  if (error) throw new Error(`invalidate billing invoice failed: ${error.message}`);
}

/** Acquire the one-open-Checkout-per-account lock in the database. */
export async function acquireBillingCheckoutAttempt(input: {
  userId: string;
  attemptId: string;
  ttlSeconds?: number;
}): Promise<boolean> {
  const { data, error } = await db().rpc("acquire_billing_checkout_attempt", {
    p_user_id: input.userId,
    p_attempt_id: input.attemptId,
    p_ttl_seconds: input.ttlSeconds ?? 1_860,
  });
  if (error) throw new Error(`acquire billing Checkout attempt failed: ${error.message}`);
  return data === true;
}

/** Attach the Stripe session and align the durable lock to its exact expiry. */
export async function attachBillingCheckoutSession(input: {
  userId: string;
  attemptId: string;
  stripeSessionId: string;
  expiresAt: string;
}): Promise<void> {
  const { data, error } = await db()
    .from("billing_checkout_attempts")
    .update({
      stripe_session_id: input.stripeSessionId,
      expires_at: input.expiresAt,
    })
    .eq("user_id", input.userId)
    .eq("attempt_id", input.attemptId)
    .gt("expires_at", new Date().toISOString())
    .select("user_id")
    .maybeSingle();
  if (error) throw new Error(`attach Stripe Checkout session failed: ${error.message}`);
  if (!data) throw new Error("billing Checkout attempt expired before its session was attached");
}

export async function releaseBillingCheckoutAttempt(
  userId: string,
  attemptId: string,
): Promise<void> {
  const { error } = await db()
    .from("billing_checkout_attempts")
    .delete()
    .eq("user_id", userId)
    .eq("attempt_id", attemptId);
  if (error) throw new Error(`release billing Checkout attempt failed: ${error.message}`);
}

export async function releaseBillingCheckoutSession(stripeSessionId: string): Promise<void> {
  const { error } = await db()
    .from("billing_checkout_attempts")
    .delete()
    .eq("stripe_session_id", stripeSessionId);
  if (error) throw new Error(`release Stripe Checkout session failed: ${error.message}`);
}

export async function getBillingCheckoutAttempt(
  userId: string,
  attemptId: string,
): Promise<{ stripe_session_id: string | null; expires_at: string } | null> {
  const { data, error } = await db()
    .from("billing_checkout_attempts")
    .select("stripe_session_id, expires_at")
    .eq("user_id", userId)
    .eq("attempt_id", attemptId)
    .maybeSingle();
  if (error) throw new Error(`read billing Checkout attempt failed: ${error.message}`);
  return (data as { stripe_session_id: string | null; expires_at: string } | null) ?? null;
}

export async function getWalletBalance(userId: string): Promise<WalletBalance> {
  const { data, error } = await db()
    .from("billing_credit_grants")
    .select("bucket, remaining_microusd, starts_at, expires_at")
    .eq("user_id", userId)
    .gt("remaining_microusd", 0);
  if (error) throw new Error(`get billing balance failed: ${error.message}`);
  const now = Date.now();
  let usageMicrousd = 0;
  let reliabilityMicrousd = 0;
  for (const row of (data ?? []) as Array<{
    bucket: CreditBucket;
    remaining_microusd: number | string;
    starts_at: string;
    expires_at: string | null;
  }>) {
    if (Date.parse(row.starts_at) > now) continue;
    if (row.expires_at && Date.parse(row.expires_at) <= now) continue;
    const amount = integer(row.remaining_microusd);
    if (row.bucket === "reliability") reliabilityMicrousd += amount;
    else usageMicrousd += amount;
  }
  return { usageMicrousd, reliabilityMicrousd };
}

export async function consumeBillingCredits(input: {
  userId: string;
  runId: string;
  amountMicrousd: number;
  preferredBucket: CreditBucket;
}): Promise<CreditSettlement> {
  const { data, error } = await db().rpc("consume_billing_credits", {
    p_user_id: input.userId,
    p_run_id: input.runId,
    p_amount_microusd: Math.max(0, Math.ceil(input.amountMicrousd)),
    p_preferred_bucket: input.preferredBucket,
  });
  if (error) throw new Error(`consume billing credits failed: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        charged_microusd: number | string;
        uncovered_microusd: number | string;
        usage_remaining_microusd: number | string;
        reliability_remaining_microusd: number | string;
      }
    | null;
  if (!row) throw new Error("consume billing credits returned no settlement");
  return {
    chargedMicrousd: integer(row.charged_microusd),
    uncoveredMicrousd: integer(row.uncovered_microusd),
    usageMicrousd: integer(row.usage_remaining_microusd),
    reliabilityMicrousd: integer(row.reliability_remaining_microusd),
  };
}

/** Remove a bounded provider-call budget from the live wallet before spend. */
export async function reserveBillingCredits(input: {
  userId: string;
  runId: string;
  amountMicrousd: number;
  preferredBucket: CreditBucket;
}): Promise<number> {
  const { data, error } = await db().rpc("reserve_billing_credits", {
    p_user_id: input.userId,
    p_run_id: input.runId,
    p_amount_microusd: Math.max(0, Math.ceil(input.amountMicrousd)),
    p_preferred_bucket: input.preferredBucket,
  });
  if (error) throw new Error(`reserve billing credits failed: ${error.message}`);
  return integer(data as number | string | null);
}

/** Charge actual spend and return the unused portion of an existing escrow. */
export async function finalizeBillingCreditReservation(input: {
  userId: string;
  runId: string;
  actualMicrousd: number;
}): Promise<CreditReservationSettlement> {
  const { data, error } = await db().rpc("finalize_billing_credit_reservation", {
    p_user_id: input.userId,
    p_run_id: input.runId,
    p_actual_microusd: Math.max(0, Math.ceil(input.actualMicrousd)),
  });
  if (error) throw new Error(`finalize billing reservation failed: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        reservation_found: boolean;
        charged_microusd: number | string;
        uncovered_microusd: number | string;
        usage_remaining_microusd: number | string;
        reliability_remaining_microusd: number | string;
      }
    | null;
  if (!row) throw new Error("finalize billing reservation returned no settlement");
  return {
    reservationFound: row.reservation_found === true,
    chargedMicrousd: integer(row.charged_microusd),
    uncoveredMicrousd: integer(row.uncovered_microusd),
    usageMicrousd: integer(row.usage_remaining_microusd),
    reliabilityMicrousd: integer(row.reliability_remaining_microusd),
  };
}

export async function recordStripeWebhookEvent(input: {
  eventId: string;
  eventType: string;
  objectId?: string | null;
}): Promise<void> {
  const { error } = await db()
    .from("stripe_webhook_events")
    .upsert(
      {
        event_id: input.eventId,
        event_type: input.eventType,
        object_id: input.objectId ?? null,
      },
      { onConflict: "event_id", ignoreDuplicates: true },
    );
  if (error) throw new Error(`record Stripe webhook event failed: ${error.message}`);
}

export async function stripeWebhookEventProcessed(eventId: string): Promise<boolean> {
  const { data, error } = await db()
    .from("stripe_webhook_events")
    .select("event_id")
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) throw new Error(`read Stripe webhook event failed: ${error.message}`);
  return Boolean(data);
}

/** Atomically merge trial credit, project ownership, and the guest lifecycle. */
export async function convertGuestAccount(
  guestUserId: string,
  targetUserId: string,
): Promise<number> {
  const { data, error } = await db().rpc("convert_guest_account", {
    p_guest_user_id: guestUserId,
    p_target_user_id: targetUserId,
  });
  if (error) throw new Error(`convert guest account failed: ${error.message}`);
  return integer(data as number | string | null);
}

function integer(value: number | string | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed));
}
