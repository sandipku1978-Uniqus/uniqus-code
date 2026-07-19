import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import type {
  BillingPlan,
  BillingSubscriptionStatus,
} from "@gate15/api-types";
import type { UserRecord } from "../db/users.js";
import {
  acquireBillingCheckoutAttempt,
  applyPaidBillingInvoice,
  attachBillingCheckoutSession,
  deactivateBillingPaidAccess,
  ensureBillingAccount,
  getBillingAccount,
  getBillingAccountByCustomer,
  getBillingAccountBySubscription,
  getBillingCheckoutAttempt,
  invalidateBillingInvoice,
  recordStripeWebhookEvent,
  releaseBillingCheckoutAttempt,
  releaseBillingCheckoutSession,
  setStripeCustomer,
  stripeWebhookEventProcessed,
  syncBillingSubscription,
  terminateBillingSubscription,
} from "../db/billing.js";
import {
  dollarsToMicrousd,
  planAllowance,
  validateMaxMonthlyUsd,
} from "./plans.js";

export type CheckoutPlan = Exclude<BillingPlan, "free">;

let cachedStripe: Stripe | null = null;
const STRIPE_API_VERSION = "2026-06-24.dahlia" as const;
// Stripe validates expires_at against its own creation timestamp. Leave one
// minute above the 30-minute minimum so request latency cannot make it invalid.
const CHECKOUT_SESSION_TTL_SECONDS = 31 * 60;
const CHECKOUT_LOCK_TTL_SECONDS = CHECKOUT_SESSION_TTL_SECONDS + 60;

export class StripeBillingError extends Error {
  constructor(
    public readonly code:
      | "stripe_not_configured"
      | "stripe_webhook_not_configured"
      | "active_subscription"
      | "checkout_in_progress"
      | "invalid_plan"
      | "invalid_checkout"
      | "billing_customer_missing"
      | "stripe_mapping_error",
    message: string,
  ) {
    super(message);
    this.name = "StripeBillingError";
  }
}

class UnsupportedPaidInvoiceError extends StripeBillingError {
  constructor(message: string) {
    super("stripe_mapping_error", message);
    this.name = "UnsupportedPaidInvoiceError";
  }
}

export function stripeCatalogConfigured(): boolean {
  return Boolean(
    process.env.STRIPE_SECRET_KEY &&
      process.env.STRIPE_BYOK_PRICE_ID &&
      process.env.STRIPE_PLUS_PRICE_ID &&
      process.env.STRIPE_MAX_PRICE_ID,
  );
}

export function stripeWebhookConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
}

export function stripeCheckoutEnabled(): boolean {
  return ["1", "true"].includes(
    String(process.env.STRIPE_CHECKOUT_ENABLED ?? "").trim().toLowerCase(),
  );
}

/** Never accept money until fulfillment and supported self-service are ready. */
export function stripeBillingReady(): boolean {
  return Boolean(
    stripeCatalogConfigured() &&
      stripeWebhookConfigured() &&
      stripeCheckoutEnabled() &&
      process.env.STRIPE_PORTAL_CONFIGURATION_ID &&
      configuredWebOrigin() &&
      isHttpsPolicyUrl(process.env.TERMS_OF_SERVICE_URL) &&
      isHttpsPolicyUrl(process.env.PRIVACY_POLICY_URL),
  );
}

export async function createSubscriptionCheckout(input: {
  user: UserRecord;
  plan: CheckoutPlan;
  maxMonthlyUsd?: number;
}): Promise<string> {
  assertBillingReady();
  if (!(["byok", "plus", "max"] as string[]).includes(input.plan)) {
    throw new StripeBillingError("invalid_plan", "Choose BYOK, Plus, or Max");
  }
  const account = await ensureBillingAccount(input.user.id);
  if (
    account.stripe_subscription_id &&
    !["none", "canceled", "incomplete_expired"].includes(account.subscription_status)
  ) {
    throw new StripeBillingError(
      "active_subscription",
      "This account already has a subscription. Manage it in the Stripe customer portal.",
    );
  }
  const lineItem = checkoutLineItem(input.plan, input.maxMonthlyUsd);
  await assertCheckoutPriceMatchesPlan(input.plan, String(lineItem.price));
  const attemptId = randomUUID();
  const acquired = await acquireBillingCheckoutAttempt({
    userId: input.user.id,
    attemptId,
    ttlSeconds: CHECKOUT_LOCK_TTL_SECONDS,
  });
  if (!acquired) {
    const current = await getBillingAccount(input.user.id);
    if (
      current?.stripe_subscription_id &&
      !["none", "canceled", "incomplete_expired"].includes(current.subscription_status)
    ) {
      throw new StripeBillingError(
        "active_subscription",
        "This account already has a subscription. Manage it in the Stripe customer portal.",
      );
    }
    throw new StripeBillingError(
      "checkout_in_progress",
      "A subscription Checkout is already open for this account. Finish or cancel it before starting another.",
    );
  }

  let session: Stripe.Checkout.Session | null = null;
  try {
    const customerId = account.stripe_customer_id ?? (await createStripeCustomer(input.user));
    await reconcileExistingGate15Subscription(customerId);
    const base = webBaseUrl();
    const expiresAt = Math.floor(Date.now() / 1_000) + CHECKOUT_SESSION_TTL_SECONDS;
    const cancelParams = new URLSearchParams({
      billing: "canceled",
      attempt_id: attemptId,
      plan: input.plan,
    });
    if (input.plan === "max") {
      cancelParams.set(
        "max_monthly_usd",
        String(validateMaxMonthlyUsd(input.maxMonthlyUsd ?? 100)),
      );
    }
    session = await stripe().checkout.sessions.create(
      {
        mode: "subscription",
        customer: customerId,
        payment_method_types: ["card"],
        client_reference_id: input.user.id,
        line_items: [lineItem],
        success_url: checkoutSuccessUrl(base),
        cancel_url: `${base}/settings?${cancelParams.toString()}`,
        expires_at: expiresAt,
        metadata: {
          gate15_user_id: input.user.id,
          gate15_plan: input.plan,
        },
        subscription_data: {
          metadata: {
            gate15_user_id: input.user.id,
            gate15_plan: input.plan,
          },
        },
      },
      { idempotencyKey: `gate15-checkout:${attemptId}` },
    );
    if (!session.url) throw new Error("Stripe Checkout did not return a hosted URL");
    await attachBillingCheckoutSession({
      userId: input.user.id,
      attemptId,
      stripeSessionId: session.id,
      expiresAt: new Date(expiresAt * 1_000).toISOString(),
    });
    return session.url;
  } catch (err) {
    let safeToRelease = session === null;
    if (session) {
      try {
        await stripe().checkout.sessions.expire(session.id);
        safeToRelease = true;
      } catch (expireError) {
        console.warn(
          `[billing] could not expire orphaned Checkout ${session.id}; retaining its database lock: ${errorText(expireError)}`,
        );
      }
    }
    if (safeToRelease) {
      await releaseBillingCheckoutAttempt(input.user.id, attemptId);
    }
    throw err;
  }
}

/**
 * Return subscriptions that can represent Gate 15 billing and still block a
 * new Checkout. Exact catalog prices are authoritative; Gate 15 metadata is
 * also treated as ours so a malformed or retired-price subscription fails
 * closed instead of allowing a second subscription.
 */
export function nonterminalGate15Subscriptions(
  subscriptions: Stripe.Subscription[],
): Stripe.Subscription[] {
  const gate15PriceIds = new Set(pricePlanMap().keys());
  return subscriptions.filter((subscription) => {
    if (["canceled", "incomplete_expired"].includes(subscription.status)) {
      return false;
    }
    return Boolean(
      subscription.metadata.gate15_user_id ||
        subscription.metadata.gate15_plan ||
        subscription.items.data.some((item) => gate15PriceIds.has(item.price.id)),
    );
  });
}

async function reconcileExistingGate15Subscription(customerId: string): Promise<void> {
  const candidates: Stripe.Subscription[] = [];
  for await (const subscription of stripe().subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 100,
  })) {
    if (nonterminalGate15Subscriptions([subscription]).length === 0) continue;
    // Re-read each candidate before syncing so a list/delete race cannot
    // resurrect a subscription that became terminal during this preflight.
    const current = await retrieveCurrentSubscription(subscription.id);
    if (!current || nonterminalGate15Subscriptions([current]).length === 0) continue;
    candidates.push(current);
    if (candidates.length > 1) break;
  }

  if (candidates.length === 0) return;
  if (candidates.length > 1) {
    throw new StripeBillingError(
      "stripe_mapping_error",
      `Stripe customer ${customerId} has multiple nonterminal Gate 15 subscriptions`,
    );
  }

  const existing = candidates[0];
  // Validate the exact catalog shape before sync. This ensures a subscription
  // identified by Gate 15 metadata but carrying a retired/foreign price, or a
  // catalog subscription with extra items, blocks rather than being ignored.
  subscriptionMapping(existing);
  const synced = await syncFromStripeSubscription(existing);
  if (["active", "past_due"].includes(existing.status) && !synced) {
    throw new StripeBillingError(
      "stripe_mapping_error",
      `Stripe subscription ${existing.id} conflicts with the local billing mapping`,
    );
  }
  throw new StripeBillingError(
    "active_subscription",
    "This account already has a subscription. Manage it in the Stripe customer portal.",
  );
}

/** Expire the exact open Session behind Stripe's authenticated cancel return. */
export async function cancelSubscriptionCheckout(
  userId: string,
  attemptId: string,
): Promise<{ canceled: boolean; completed: boolean; session_id?: string }> {
  assertStripeConfigured();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attemptId)) {
    throw new StripeBillingError("invalid_checkout", "Checkout attempt is invalid");
  }
  const attempt = await getBillingCheckoutAttempt(userId, attemptId);
  if (!attempt) return { canceled: false, completed: false };
  if (!attempt.stripe_session_id) {
    await releaseBillingCheckoutAttempt(userId, attemptId);
    return { canceled: true, completed: false };
  }

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe().checkout.sessions.retrieve(attempt.stripe_session_id);
  } catch (err) {
    const stripeError = err as { code?: string; statusCode?: number };
    if (stripeError.code === "resource_missing" || stripeError.statusCode === 404) {
      await releaseBillingCheckoutAttempt(userId, attemptId);
      return { canceled: true, completed: false };
    }
    throw err;
  }
  if (
    session.client_reference_id !== userId ||
    session.metadata?.gate15_user_id !== userId
  ) {
    throw new StripeBillingError(
      "stripe_mapping_error",
      "Checkout Session does not belong to this Gate 15 account",
    );
  }
  if (session.status === "complete") {
    // Fulfillment owns this lock now. Releasing it before the webhook maps the
    // subscription would briefly permit a second paid subscription.
    return { canceled: false, completed: true, session_id: session.id };
  }
  if (session.status === "open") {
    try {
      session = await stripe().checkout.sessions.expire(session.id);
    } catch (expireError) {
      // A duplicate cancel request may lose the race after both observed
      // `open`. Re-read once and accept the winner's terminal state.
      const current = await stripe().checkout.sessions.retrieve(session.id).catch(() => {
        throw expireError;
      });
      if (!checkoutSessionBelongsToUser(current, userId)) {
        throw new StripeBillingError(
          "stripe_mapping_error",
          "Checkout Session does not belong to this Gate 15 account",
        );
      }
      if (current.status === "complete") {
        return { canceled: false, completed: true, session_id: current.id };
      }
      if (current.status !== "expired") throw expireError;
      session = current;
    }
  }
  await releaseBillingCheckoutAttempt(userId, attemptId);
  return { canceled: true, completed: false };
}

export async function getSubscriptionCheckoutStatus(
  userId: string,
  sessionId: string,
): Promise<{ completed: boolean; fulfilled: boolean }> {
  assertStripeConfigured();
  const normalized = sessionId.trim();
  if (!/^cs_(?:test_|live_)?[A-Za-z0-9]+$/.test(normalized)) {
    throw new StripeBillingError("invalid_checkout", "Checkout Session is invalid");
  }
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe().checkout.sessions.retrieve(normalized);
  } catch (err) {
    const stripeError = err as { code?: string; statusCode?: number };
    if (stripeError.code === "resource_missing" || stripeError.statusCode === 404) {
      throw new StripeBillingError("invalid_checkout", "Checkout Session was not found");
    }
    throw err;
  }
  if (!checkoutSessionBelongsToUser(session, userId)) {
    throw new StripeBillingError(
      "invalid_checkout",
      "Checkout Session does not belong to this Gate 15 account",
    );
  }
  const completed = session.status === "complete";
  if (!completed) return { completed: false, fulfilled: false };

  const subscriptionId = idOf(session.subscription);
  const account = await getBillingAccount(userId);
  const entitledThrough = Date.parse(account?.entitled_through ?? "");
  return {
    completed: true,
    fulfilled: Boolean(
      subscriptionId &&
        account?.stripe_subscription_id === subscriptionId &&
        account.plan !== "free" &&
        ["active", "past_due"].includes(account.subscription_status) &&
        account.last_valid_invoice_id &&
        Number.isFinite(entitledThrough) &&
        entitledThrough >= Date.now(),
    ),
  };
}

export function checkoutSessionBelongsToUser(
  session: Stripe.Checkout.Session,
  userId: string,
): boolean {
  return (
    session.client_reference_id === userId &&
    session.metadata?.gate15_user_id === userId
  );
}

export async function createBillingPortal(userId: string): Promise<string> {
  assertStripeConfigured();
  if (!process.env.STRIPE_PORTAL_CONFIGURATION_ID) {
    throw new StripeBillingError(
      "stripe_not_configured",
      "STRIPE_PORTAL_CONFIGURATION_ID is not configured",
    );
  }
  const account = await ensureBillingAccount(userId);
  if (!account.stripe_customer_id) {
    throw new StripeBillingError(
      "billing_customer_missing",
      "No Stripe billing profile exists for this account yet.",
    );
  }
  const session = await stripe().billingPortal.sessions.create({
    customer: account.stripe_customer_id,
    configuration: process.env.STRIPE_PORTAL_CONFIGURATION_ID,
    return_url: `${webBaseUrl()}/settings`,
  });
  return session.url;
}

/** Verify and synchronously apply one Stripe webhook from its unmodified bytes. */
export async function applyStripeWebhook(rawBody: Buffer, signature: string): Promise<void> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new StripeBillingError(
      "stripe_webhook_not_configured",
      "STRIPE_WEBHOOK_SECRET is not configured",
    );
  }
  const event = stripe().webhooks.constructEvent(rawBody, signature, secret);
  if (await stripeWebhookEventProcessed(event.id)) return;
  await processStripeEvent(event);
  const object = event.data.object as { id?: string };
  await recordStripeWebhookEvent({
    eventId: event.id,
    eventType: event.type,
    objectId: object.id ?? null,
  });
}

async function processStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;
      const subscriptionId = idOf(session.subscription);
      if (subscriptionId) {
        const current = await retrieveCurrentSubscription(subscriptionId);
        if (current) {
          await syncFromStripeSubscription(current);
        }
      }
      return;
    }
    case "checkout.session.async_payment_failed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const subscriptionId = idOf(session.subscription);
      if (subscriptionId) {
        const current = await retrieveCurrentSubscription(subscriptionId);
        if (current) await syncFromStripeSubscription(current);
      }
      await releaseBillingCheckoutSession(session.id);
      return;
    }
    case "checkout.session.expired": {
      await releaseBillingCheckoutSession(
        (event.data.object as Stripe.Checkout.Session).id,
      );
      return;
    }
    case "invoice.paid": {
      await applyPaidInvoice(event.data.object as Stripe.Invoice);
      return;
    }
    case "invoice.payment_failed":
    case "invoice.payment_action_required": {
      const invoice = await retrieveCurrentInvoice(
        (event.data.object as Stripe.Invoice).id,
      );
      const subscriptionId = invoice ? invoiceSubscriptionId(invoice) : null;
      if (subscriptionId) {
        const current = await retrieveCurrentSubscription(subscriptionId);
        if (current) await syncFromStripeSubscription(current);
      }
      return;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.paused":
    case "customer.subscription.resumed": {
      // Stripe does not guarantee event ordering. Re-read the current object so
      // a delayed active update cannot resurrect a subscription deleted later.
      const current = await retrieveCurrentSubscription(
        (event.data.object as Stripe.Subscription).id,
      );
      if (current) await syncFromStripeSubscription(current);
      return;
    }
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const account = await resolveSubscriptionAccount(subscription);
      if (account?.stripe_subscription_id === subscription.id) {
        await terminateBillingSubscription(
          account.user_id,
          idOf(subscription.customer),
          "canceled",
        );
      }
      return;
    }
    case "invoice.voided": {
      await invalidateBillingInvoice(
        (event.data.object as Stripe.Invoice).id,
        "invoice.voided",
      );
      return;
    }
    case "credit_note.created":
    case "credit_note.updated": {
      const creditNote = event.data.object as Stripe.CreditNote;
      if (creditNote.status === "issued") {
        const invoiceId = idOf(creditNote.invoice);
        if (invoiceId) await invalidateBillingInvoice(invoiceId, event.type);
      }
      return;
    }
    case "refund.created":
    case "refund.updated": {
      const refund = event.data.object as Stripe.Refund;
      if (refund.status === "succeeded") {
        await invalidateInvoicesForPaymentIntent(
          idOf(refund.payment_intent) ??
            (await paymentIntentIdForCharge(refund.charge)),
          event.type,
        );
      }
      return;
    }
    case "charge.refunded": {
      await invalidateInvoicesForPaymentIntent(
        idOf((event.data.object as Stripe.Charge).payment_intent),
        event.type,
      );
      return;
    }
    case "charge.dispute.created": {
      const dispute = event.data.object as Stripe.Dispute;
      await invalidateInvoicesForPaymentIntent(
        idOf(dispute.payment_intent) ??
          (await paymentIntentIdForCharge(dispute.charge)),
        event.type,
      );
      return;
    }
    default:
      return;
  }
}

async function applyPaidInvoice(eventInvoice: Stripe.Invoice): Promise<void> {
  const invoice = await retrieveCurrentInvoice(eventInvoice.id);
  if (!invoice || invoice.status !== "paid") return;
  // Quantity/plan update prorations are not full monthly renewals. Only the
  // initial paid invoice and normal cycle invoice mint a complete allowance.
  if (
    invoice.billing_reason !== "subscription_create" &&
    invoice.billing_reason !== "subscription_cycle"
  ) {
    return;
  }
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return;
  const subscription = await retrieveCurrentSubscription(subscriptionId);
  if (!subscription) return;
  const synced = await syncFromStripeSubscription(subscription);
  if (!synced) return;
  let invoicePlan: ReturnType<typeof paidInvoiceMapping>;
  try {
    invoicePlan = paidInvoiceMapping(invoice, synced);
  } catch (err) {
    if (err instanceof UnsupportedPaidInvoiceError) {
      console.warn(`[billing] ignored unsupported paid invoice ${invoice.id}: ${err.message}`);
      return;
    }
    throw err;
  }
  if (
    invoicePlan.plan !== synced.plan ||
    invoicePlan.maxMonthlyUsd !== synced.maxMonthlyUsd
  ) {
    throw new StripeBillingError(
      "stripe_mapping_error",
      `Invoice ${invoice.id} does not match subscription ${subscription.id}`,
    );
  }
  const stripeCollectedCents = await stripeCollectedInvoicePaymentAmount(invoice);
  if (stripeCollectedCents < invoicePlan.expectedPaidCents) {
    // A dashboard "mark paid" / out-of-band PaymentRecord can make the
    // Invoice itself say paid without Stripe collecting the subscription
    // price. This is intentionally unsupported and must not mint credits. It
    // is a business rejection, not a transient webhook failure, so return 2xx.
    console.warn(
      `[billing] ignored paid invoice ${invoice.id}: only ${stripeCollectedCents} cents came from paid PaymentIntent-backed InvoicePayments; expected ${invoicePlan.expectedPaidCents}`,
    );
    return;
  }
  const allowance = planAllowance(invoicePlan.plan, invoicePlan.maxMonthlyUsd);
  const periodStart = toIso(invoicePlan.line.period.start);
  const periodEnd = toIso(invoicePlan.line.period.end);
  if (!periodStart || !periodEnd) {
    throw new StripeBillingError(
      "stripe_mapping_error",
      `Invoice ${invoice.id} has no complete service period`,
    );
  }
  const applied = await applyPaidBillingInvoice({
    userId: synced.userId,
    subscriptionId,
    stripeInvoiceId: invoice.id,
    plan: invoicePlan.plan,
    usageMicrousd: dollarsToMicrousd(allowance.usageUsd),
    reliabilityMicrousd: dollarsToMicrousd(allowance.reliabilityUsd),
    startsAt: periodStart,
    entitledThrough: periodEnd,
  });
  if (!applied) {
    console.warn(
      `[billing] ignored invalidated or stale paid invoice ${invoice.id}`,
    );
  }
}

async function syncFromStripeSubscription(subscription: Stripe.Subscription): Promise<{
  userId: string;
  plan: CheckoutPlan;
  maxMonthlyUsd: number | null;
  item: Stripe.SubscriptionItem;
  priceId: string;
} | null> {
  let account = await resolveSubscriptionAccount(subscription);
  const metadataUserId = subscription.metadata.gate15_user_id || null;
  if (account && metadataUserId && metadataUserId !== account.user_id) {
    throw new StripeBillingError(
      "stripe_mapping_error",
      `Stripe subscription ${subscription.id} metadata does not match its billing account`,
    );
  }
  if (!account && metadataUserId) account = await getBillingAccount(metadataUserId);
  const userId = account?.user_id ?? metadataUserId;
  if (!userId) {
    throw new StripeBillingError(
      "stripe_mapping_error",
      `Stripe subscription ${subscription.id} has no Gate 15 account mapping`,
    );
  }
  const customerId = idOf(subscription.customer);
  if (!customerId) {
    throw new StripeBillingError("stripe_mapping_error", "Subscription customer is missing");
  }
  if (account?.stripe_customer_id && account.stripe_customer_id !== customerId) {
    throw new StripeBillingError(
      "stripe_mapping_error",
      `Stripe subscription ${subscription.id} belongs to a different customer`,
    );
  }
  if (account?.stripe_subscription_id && account.stripe_subscription_id !== subscription.id) {
    console.warn(
      `[billing] ignored stale subscription ${subscription.id}; account ${userId} is mapped to ${account.stripe_subscription_id}`,
    );
    return null;
  }
  const status = subscription.status as BillingSubscriptionStatus;
  if (status === "canceled" || status === "incomplete_expired") {
    await terminateBillingSubscription(userId, customerId, status);
    return null;
  }
  const mapping = subscriptionMapping(subscription);
  // Only invalidate evidence for a price change on this already-mapped
  // subscription. The first Checkout sync can race invoice.paid; treating the
  // initial Free -> paid mapping as a change could revoke the invoice just
  // granted by the concurrent handler.
  const planChanged = Boolean(
    account?.stripe_subscription_id === subscription.id &&
      (account.plan !== mapping.plan ||
        account.max_monthly_usd !== mapping.maxMonthlyUsd),
  );
  const paidStatus = status === "active" || status === "past_due";
  if (!paidStatus || planChanged) {
    await deactivateBillingPaidAccess(userId);
  }
  await syncBillingSubscription({
    userId,
    plan: mapping.plan,
    status,
    customerId,
    subscriptionId: subscription.id,
    subscriptionItemId: mapping.item.id,
    maxMonthlyUsd: mapping.maxMonthlyUsd,
    currentPeriodStart: toIso(mapping.item.current_period_start),
    currentPeriodEnd: toIso(mapping.item.current_period_end),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  });
  if (!paidStatus) return null;
  return { userId, ...mapping };
}

export function subscriptionMapping(subscription: Stripe.Subscription): {
  plan: CheckoutPlan;
  maxMonthlyUsd: number | null;
  item: Stripe.SubscriptionItem;
  priceId: string;
} {
  if (subscription.items.data.length !== 1) {
    throw new StripeBillingError(
      "stripe_mapping_error",
      `Subscription ${subscription.id} must contain exactly one Gate 15 price`,
    );
  }
  const item = subscription.items.data[0];
  const configuredPlan = pricePlanMap().get(item.price.id);
  const metadataPlan = checkoutPlan(subscription.metadata.gate15_plan);
  if (configuredPlan && metadataPlan && configuredPlan !== metadataPlan) {
    throw new StripeBillingError(
      "stripe_mapping_error",
      `Subscription ${subscription.id} price and Gate 15 metadata disagree`,
    );
  }
  const plan = configuredPlan ?? metadataPlan;
  if (!plan) {
    throw new StripeBillingError(
      "stripe_mapping_error",
      `Subscription ${subscription.id} price is not in the current or historical Gate 15 catalog`,
    );
  }
  const maxMonthlyUsd = validateSubscriptionPriceShape(item, plan);
  return { plan, maxMonthlyUsd, item, priceId: item.price.id };
}

/** Price/quantity/period as they were actually invoiced, not today's subscription. */
export function paidInvoiceMapping(
  invoice: Stripe.Invoice,
  expected?: { plan: CheckoutPlan; maxMonthlyUsd: number | null; priceId: string },
): {
  plan: CheckoutPlan;
  maxMonthlyUsd: number | null;
  line: Stripe.InvoiceLineItem;
  expectedPaidCents: number;
} {
  const matches = invoice.lines.data.filter((line) => {
    const priceId = invoiceLinePriceId(line);
    return priceId
      ? expected
        ? priceId === expected.priceId
        : pricePlanMap().has(priceId)
      : false;
  });
  if (matches.length !== 1) {
    throw new StripeBillingError(
      "stripe_mapping_error",
      `Invoice ${invoice.id} must contain exactly one Gate 15 subscription line`,
    );
  }
  if (invoice.currency !== "usd") {
    throw new StripeBillingError("stripe_mapping_error", "Gate 15 invoices must be in USD");
  }
  const line = matches[0];
  const priceId = invoiceLinePriceId(line);
  const plan = expected?.plan ?? (priceId ? pricePlanMap().get(priceId) : undefined);
  if (!plan) {
    throw new StripeBillingError(
      "stripe_mapping_error",
      `Invoice ${invoice.id} price is not in the Gate 15 catalog`,
    );
  }
  let maxMonthlyUsd: number | null = expected?.maxMonthlyUsd ?? null;
  let expectedPaidCents: number;
  if (plan === "byok") {
    expectedPaidCents = 800;
  } else if (plan === "plus") {
    expectedPaidCents = 2000;
  } else {
    const lineMax = validateMaxMonthlyUsd(line.quantity ?? 0);
    if (maxMonthlyUsd !== null && maxMonthlyUsd !== lineMax) {
      throw new StripeBillingError(
        "stripe_mapping_error",
        `Invoice ${invoice.id} Max quantity does not match its subscription`,
      );
    }
    maxMonthlyUsd = lineMax;
    expectedPaidCents = maxMonthlyUsd * 100;
  }
  // Promotions are intentionally unsupported until allowances can be scaled to
  // collected revenue. Never mint a full wallet from a discounted/zero invoice.
  if (invoice.amount_paid < expectedPaidCents) {
    throw new UnsupportedPaidInvoiceError(
      `Invoice ${invoice.id} collected less than the configured ${plan} price`,
    );
  }
  return { plan, maxMonthlyUsd, line, expectedPaidCents };
}

async function resolveSubscriptionAccount(subscription: Stripe.Subscription) {
  const bySubscription = await getBillingAccountBySubscription(subscription.id);
  if (bySubscription) return bySubscription;
  const customerId = idOf(subscription.customer);
  return customerId ? await getBillingAccountByCustomer(customerId) : null;
}

async function retrieveCurrentSubscription(id: string): Promise<Stripe.Subscription | null> {
  try {
    return await stripe().subscriptions.retrieve(id);
  } catch (err) {
    const stripeError = err as { code?: string; statusCode?: number };
    if (stripeError.code === "resource_missing" || stripeError.statusCode === 404) return null;
    throw err;
  }
}

async function retrieveCurrentInvoice(id: string): Promise<Stripe.Invoice | null> {
  try {
    return await stripe().invoices.retrieve(id);
  } catch (err) {
    const stripeError = err as { code?: string; statusCode?: number };
    if (stripeError.code === "resource_missing" || stripeError.statusCode === 404) return null;
    throw err;
  }
}

/** Sum only successful Stripe PaymentIntent allocations for this exact invoice. */
export function stripeCollectedInvoicePaymentCents(input: {
  invoiceId: string;
  currency: string;
  payments: Stripe.InvoicePayment[];
}): number {
  const seen = new Set<string>();
  let total = 0;
  for (const payment of input.payments) {
    if (seen.has(payment.id)) continue;
    seen.add(payment.id);
    const amount = payment.amount_paid;
    if (
      payment.status !== "paid" ||
      payment.currency !== input.currency ||
      idOf(payment.invoice) !== input.invoiceId ||
      payment.payment.type !== "payment_intent" ||
      !idOf(payment.payment.payment_intent) ||
      typeof amount !== "number" ||
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      !Number.isSafeInteger(total + amount)
    ) {
      continue;
    }
    total += amount;
  }
  return total;
}

async function stripeCollectedInvoicePaymentAmount(invoice: Stripe.Invoice): Promise<number> {
  const payments = await stripe()
    .invoicePayments.list({
      invoice: invoice.id,
      payment: { type: "payment_intent" },
      status: "paid",
      limit: 100,
    })
    .autoPagingToArray({ limit: 1_000 });
  return stripeCollectedInvoicePaymentCents({
    invoiceId: invoice.id,
    currency: invoice.currency,
    payments,
  });
}

async function invalidateInvoicesForPaymentIntent(
  paymentIntentId: string | null,
  reason: string,
): Promise<void> {
  if (!paymentIntentId) return;
  const payments = await stripe().invoicePayments.list({
    payment: { type: "payment_intent", payment_intent: paymentIntentId },
    limit: 100,
  });
  for (const payment of payments.data) {
    const invoiceId = idOf(payment.invoice);
    if (invoiceId) await invalidateBillingInvoice(invoiceId, reason);
  }
}

async function paymentIntentIdForCharge(
  charge: string | Stripe.Charge | null,
): Promise<string | null> {
  if (!charge) return null;
  if (typeof charge !== "string") return idOf(charge.payment_intent);
  const current = await stripe().charges.retrieve(charge);
  return idOf(current.payment_intent);
}

async function createStripeCustomer(user: UserRecord): Promise<string> {
  const customer = await stripe().customers.create(
    {
      email: user.email,
      name: user.display_name ?? undefined,
      metadata: { gate15_user_id: user.id },
    },
    { idempotencyKey: `gate15-customer:${user.id}` },
  );
  await setStripeCustomer(user.id, customer.id);
  return customer.id;
}

export function checkoutLineItem(
  plan: CheckoutPlan,
  maxMonthlyUsd?: number,
): Stripe.Checkout.SessionCreateParams.LineItem {
  const prices = priceCatalog();
  if (plan === "max") {
    try {
      return { price: prices.max, quantity: validateMaxMonthlyUsd(maxMonthlyUsd ?? 100) };
    } catch (err) {
      throw new StripeBillingError(
        "invalid_plan",
        err instanceof Error ? err.message : "Choose a Max amount between $100 and $200",
      );
    }
  }
  return { price: plan === "byok" ? prices.byok : prices.plus, quantity: 1 };
}

/** Validate the remote Stripe object before opening a Session that can take money. */
export function checkoutPriceProblem(plan: CheckoutPlan, price: Stripe.Price): string | null {
  return priceShapeProblem(plan, price, true);
}

function priceShapeProblem(
  plan: CheckoutPlan,
  price: Stripe.Price,
  requireActive: boolean,
): string | null {
  const expectedCents = plan === "byok" ? 800 : plan === "plus" ? 2_000 : 100;
  if (requireActive && !price.active) return "price is inactive";
  if (price.currency !== "usd" || price.unit_amount !== expectedCents) {
    return plan === "max"
      ? "Max must use a recurring $1 USD unit price"
      : `${plan.toUpperCase()} must use the documented recurring USD amount`;
  }
  if (
    price.type !== "recurring" ||
    price.recurring?.interval !== "month" ||
    price.recurring.interval_count !== 1
  ) {
    return "price must recur every month";
  }
  if (price.recurring.usage_type !== "licensed") return "price must use licensed billing";
  return null;
}

async function assertCheckoutPriceMatchesPlan(
  plan: CheckoutPlan,
  priceId: string,
): Promise<void> {
  const price = await stripe().prices.retrieve(priceId);
  const problem = checkoutPriceProblem(plan, price);
  if (problem) {
    throw new StripeBillingError(
      "stripe_mapping_error",
      `Configured ${plan} Stripe price ${priceId} is invalid: ${problem}`,
    );
  }
}

function validateSubscriptionPriceShape(
  item: Stripe.SubscriptionItem,
  plan: CheckoutPlan,
): number | null {
  const problem = priceShapeProblem(plan, item.price, false);
  if (problem) {
    throw new StripeBillingError(
      "stripe_mapping_error",
      `Subscription item ${item.id} does not match the ${plan} price shape: ${problem}`,
    );
  }
  if (plan === "max") return validateMaxMonthlyUsd(item.quantity ?? 0);
  if ((item.quantity ?? 0) !== 1) {
    throw new StripeBillingError(
      "stripe_mapping_error",
      `${plan.toUpperCase()} subscriptions must have quantity 1`,
    );
  }
  return null;
}

export function checkoutSuccessUrl(base: string): string {
  return `${base}/settings?billing=success&session_id={CHECKOUT_SESSION_ID}#billing-settings`;
}

export function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const legacy = invoice as Stripe.Invoice & {
    subscription?: string | Stripe.Subscription | null;
  };
  return idOf(
    invoice.parent?.subscription_details?.subscription ?? legacy.subscription ?? null,
  );
}

function invoiceLinePriceId(line: Stripe.InvoiceLineItem): string | null {
  const legacy = line as Stripe.InvoiceLineItem & {
    price?: string | Stripe.Price | null;
    plan?: string | Stripe.Plan | null;
  };
  return idOf(
    line.pricing?.price_details?.price ?? legacy.price ?? legacy.plan ?? null,
  );
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (typeof value === "string") return value;
  return value?.id ?? null;
}

function checkoutPlan(value: string | null | undefined): CheckoutPlan | null {
  return value === "byok" || value === "plus" || value === "max" ? value : null;
}

function pricePlanMap(): Map<string, CheckoutPlan> {
  const result = new Map<string, CheckoutPlan>();
  const add = (plan: CheckoutPlan, ids: Array<string | undefined>): void => {
    for (const raw of ids) {
      for (const id of String(raw ?? "").split(",")) {
        const normalized = id.trim();
        if (!normalized) continue;
        const existing = result.get(normalized);
        if (existing && existing !== plan) {
          throw new StripeBillingError(
            "stripe_mapping_error",
            `Stripe price ${normalized} is configured for both ${existing} and ${plan}`,
          );
        }
        result.set(normalized, plan);
      }
    }
  };
  add("byok", [
    process.env.STRIPE_BYOK_PRICE_ID,
    process.env.STRIPE_BYOK_HISTORICAL_PRICE_IDS,
  ]);
  add("plus", [
    process.env.STRIPE_PLUS_PRICE_ID,
    process.env.STRIPE_PLUS_HISTORICAL_PRICE_IDS,
  ]);
  add("max", [
    process.env.STRIPE_MAX_PRICE_ID,
    process.env.STRIPE_MAX_HISTORICAL_PRICE_IDS,
  ]);
  return result;
}

function priceCatalog(): { byok: string; plus: string; max: string } {
  assertCatalogConfigured();
  return {
    byok: process.env.STRIPE_BYOK_PRICE_ID!,
    plus: process.env.STRIPE_PLUS_PRICE_ID!,
    max: process.env.STRIPE_MAX_PRICE_ID!,
  };
}

function isHttpsPolicyUrl(value: string | undefined): boolean {
  try {
    const parsed = new URL(String(value ?? ""));
    const hostname = parsed.hostname
      .toLowerCase()
      .replace(/\.$/, "")
      .replace(/^\[|\]$/g, "");
    const isLocal =
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      /^127(?:\.\d{1,3}){3}$/.test(hostname) ||
      hostname === "::1";
    return (
      parsed.protocol === "https:" &&
      Boolean(hostname) &&
      !isLocal &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

function assertCatalogConfigured(): void {
  if (!stripeCatalogConfigured()) {
    throw new StripeBillingError(
      "stripe_not_configured",
      "Set STRIPE_SECRET_KEY and the BYOK, Plus, and Max Stripe Price IDs",
    );
  }
}

function assertStripeConfigured(): void {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new StripeBillingError("stripe_not_configured", "STRIPE_SECRET_KEY is not set");
  }
}

function assertBillingReady(): void {
  assertCatalogConfigured();
  if (!stripeCheckoutEnabled()) {
    throw new StripeBillingError(
      "stripe_not_configured",
      "Set STRIPE_CHECKOUT_ENABLED=1 after Stripe fulfillment and webhooks are ready",
    );
  }
  if (!stripeWebhookConfigured()) {
    throw new StripeBillingError(
      "stripe_webhook_not_configured",
      "Set STRIPE_WEBHOOK_SECRET before enabling Checkout",
    );
  }
  if (!process.env.STRIPE_PORTAL_CONFIGURATION_ID) {
    throw new StripeBillingError(
      "stripe_not_configured",
      "Set STRIPE_PORTAL_CONFIGURATION_ID before enabling Checkout",
    );
  }
  if (!configuredWebOrigin()) {
    throw new StripeBillingError(
      "stripe_not_configured",
      "Set WEB_ORIGIN to the public Gate 15 HTTPS origin before enabling live Checkout",
    );
  }
  if (!isHttpsPolicyUrl(process.env.TERMS_OF_SERVICE_URL)) {
    throw new StripeBillingError(
      "stripe_not_configured",
      "Set TERMS_OF_SERVICE_URL to the published HTTPS terms before enabling Checkout",
    );
  }
  if (!isHttpsPolicyUrl(process.env.PRIVACY_POLICY_URL)) {
    throw new StripeBillingError(
      "stripe_not_configured",
      "Set PRIVACY_POLICY_URL to the published HTTPS privacy policy before enabling Checkout",
    );
  }
}

function stripe(): Stripe {
  if (cachedStripe) return cachedStripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new StripeBillingError("stripe_not_configured", "STRIPE_SECRET_KEY is not set");
  cachedStripe = new Stripe(key, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 2,
  });
  return cachedStripe;
}

function webBaseUrl(): string {
  const origin = configuredWebOrigin();
  if (!origin) {
    throw new StripeBillingError(
      "stripe_not_configured",
      "WEB_ORIGIN is missing or invalid for this Stripe mode",
    );
  }
  return origin;
}

function configuredWebOrigin(): string | null {
  const value = process.env.WEB_ORIGIN?.split(",")[0]?.trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    ) {
      return null;
    }
    const hostname = parsed.hostname
      .toLowerCase()
      .replace(/\.$/, "")
      .replace(/^\[|\]$/g, "");
    const isLocal =
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      /^127(?:\.\d{1,3}){3}$/.test(hostname) ||
      hostname === "::1";
    const isTestKey = /^(?:sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY ?? "");
    if (!isTestKey && (parsed.protocol !== "https:" || isLocal)) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function toIso(seconds: number | null | undefined): string | null {
  return typeof seconds === "number" ? new Date(seconds * 1000).toISOString() : null;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
