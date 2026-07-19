import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type Stripe from "stripe";
import {
  checkoutLineItem,
  checkoutPriceProblem,
  checkoutSessionBelongsToUser,
  checkoutSuccessUrl,
  invoiceSubscriptionId,
  nonterminalGate15Subscriptions,
  paidInvoiceMapping,
  stripeCollectedInvoicePaymentCents,
  StripeBillingError,
  stripeBillingReady,
  subscriptionMapping,
} from "./stripe.js";

function configureCatalog(): void {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_placeholder");
  vi.stubEnv("WEB_ORIGIN", "http://localhost:4242");
  vi.stubEnv("STRIPE_BYOK_PRICE_ID", "price_byok");
  vi.stubEnv("STRIPE_PLUS_PRICE_ID", "price_plus");
  vi.stubEnv("STRIPE_MAX_PRICE_ID", "price_max");
}

function configurePolicies(): void {
  vi.stubEnv("TERMS_OF_SERVICE_URL", "https://gate15.dev/terms");
  vi.stubEnv("PRIVACY_POLICY_URL", "https://gate15.dev/privacy");
}

function invoice(input: {
  priceId: string;
  quantity: number;
  amountPaid: number;
}): Stripe.Invoice {
  return {
    id: "in_test",
    currency: "usd",
    amount_paid: input.amountPaid,
    lines: {
      data: [
        {
          id: "il_test",
          quantity: input.quantity,
          period: { start: 1_700_000_000, end: 1_702_592_000 },
          pricing: {
            type: "price_details",
            price_details: { price: input.priceId, product: "prod_test" },
            unit_amount_decimal: "100",
          },
        } as Stripe.InvoiceLineItem,
      ],
    },
  } as Stripe.Invoice;
}

function subscription(input: {
  id: string;
  status: Stripe.Subscription.Status;
  priceIds: string[];
  metadata?: Record<string, string>;
}): Stripe.Subscription {
  return {
    id: input.id,
    status: input.status,
    customer: "cus_test",
    metadata: input.metadata ?? {},
    cancel_at_period_end: false,
    items: {
      data: input.priceIds.map((priceId, index) => ({
        id: `si_${index}`,
        quantity: 1,
        current_period_start: 1_700_000_000,
        current_period_end: 1_702_592_000,
        price: {
          id: priceId,
          active: false,
          currency: "usd",
          unit_amount:
            priceId.includes("max")
              ? 100
              : priceId.includes("byok")
                ? 800
                : 2_000,
          type: "recurring",
          recurring: {
            interval: "month",
            interval_count: 1,
            usage_type: "licensed",
          },
        },
      })) as Stripe.SubscriptionItem[],
    },
  } as Stripe.Subscription;
}

function invoicePayment(input: {
  id: string;
  amountPaid: number | null;
  type: Stripe.InvoicePayment.Payment.Type;
  status?: string;
  invoiceId?: string;
  currency?: string;
}): Stripe.InvoicePayment {
  const payment: Stripe.InvoicePayment.Payment = { type: input.type };
  if (input.type === "payment_intent") payment.payment_intent = `pi_${input.id}`;
  if (input.type === "payment_record") payment.payment_record = `pr_${input.id}`;
  if (input.type === "charge") payment.charge = `ch_${input.id}`;
  return {
    id: input.id,
    object: "invoice_payment",
    amount_paid: input.amountPaid,
    amount_requested: input.amountPaid ?? 0,
    created: 1_700_000_000,
    currency: input.currency ?? "usd",
    invoice: input.invoiceId ?? "in_test",
    is_default: true,
    livemode: false,
    payment,
    status: input.status ?? "paid",
    status_transitions: {
      paid_at: input.status === "open" ? null : 1_700_000_000,
      canceled_at: null,
    },
  };
}

afterEach(() => vi.unstubAllEnvs());

describe("Stripe billing readiness", () => {
  it("requires fulfillment and portal configuration before advertising Checkout", () => {
    configureCatalog();
    expect(stripeBillingReady()).toBe(false);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_placeholder");
    expect(stripeBillingReady()).toBe(false);
    vi.stubEnv("STRIPE_PORTAL_CONFIGURATION_ID", "bpc_test");
    expect(stripeBillingReady()).toBe(false);
    vi.stubEnv("STRIPE_CHECKOUT_ENABLED", "1");
    expect(stripeBillingReady()).toBe(false);
    configurePolicies();
    expect(stripeBillingReady()).toBe(true);
  });

  it("accepts the explicit textual enable value", () => {
    configureCatalog();
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_placeholder");
    vi.stubEnv("STRIPE_PORTAL_CONFIGURATION_ID", "bpc_test");
    vi.stubEnv("STRIPE_CHECKOUT_ENABLED", "true");
    configurePolicies();
    expect(stripeBillingReady()).toBe(true);
  });

  it("requires published HTTPS policy URLs", () => {
    configureCatalog();
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_placeholder");
    vi.stubEnv("STRIPE_PORTAL_CONFIGURATION_ID", "bpc_test");
    vi.stubEnv("STRIPE_CHECKOUT_ENABLED", "1");
    vi.stubEnv("TERMS_OF_SERVICE_URL", "http://gate15.dev/terms");
    vi.stubEnv("PRIVACY_POLICY_URL", "https://gate15.dev/privacy");
    expect(stripeBillingReady()).toBe(false);
  });

  it("requires an explicit origin and rejects non-HTTPS or local live returns", () => {
    configureCatalog();
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_placeholder");
    vi.stubEnv("STRIPE_PORTAL_CONFIGURATION_ID", "bpc_test");
    vi.stubEnv("STRIPE_CHECKOUT_ENABLED", "1");
    configurePolicies();

    vi.stubEnv("WEB_ORIGIN", "");
    expect(stripeBillingReady()).toBe(false);

    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_placeholder");
    for (const origin of [
      "http://app.gate15.dev",
      "https://localhost",
      "https://127.42.1.9",
    ]) {
      vi.stubEnv("WEB_ORIGIN", origin);
      expect(stripeBillingReady()).toBe(false);
    }

    vi.stubEnv("WEB_ORIGIN", "https://app.gate15.dev");
    expect(stripeBillingReady()).toBe(true);
  });

  it("rejects local policy destinations", () => {
    configureCatalog();
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_placeholder");
    vi.stubEnv("STRIPE_PORTAL_CONFIGURATION_ID", "bpc_test");
    vi.stubEnv("STRIPE_CHECKOUT_ENABLED", "1");
    vi.stubEnv("PRIVACY_POLICY_URL", "https://gate15.dev/privacy");
    for (const terms of [
      "https://localhost/terms",
      "https://policies.localhost/terms",
      "https://127.42.1.9/terms",
      "https://[::1]/terms",
    ]) {
      vi.stubEnv("TERMS_OF_SERVICE_URL", terms);
      expect(stripeBillingReady()).toBe(false);
    }
  });
});

describe("paid invoice allowance snapshot", () => {
  it("derives Max credits from the invoice line quantity", () => {
    configureCatalog();
    expect(
      paidInvoiceMapping(
        invoice({ priceId: "price_max", quantity: 150, amountPaid: 15_000 }),
      ),
    ).toMatchObject({ plan: "max", maxMonthlyUsd: 150 });
  });

  it("refuses to mint a full allowance from a discounted invoice", () => {
    configureCatalog();
    expect(() =>
      paidInvoiceMapping(
        invoice({ priceId: "price_plus", quantity: 1, amountPaid: 1_000 }),
      ),
    ).toThrow(/collected less than/);
  });

  it("supports legacy invoice price fields during the pinned API migration", () => {
    configureCatalog();
    const legacy = invoice({ priceId: "ignored", quantity: 1, amountPaid: 2_000 });
    const line = legacy.lines.data[0] as Stripe.InvoiceLineItem & {
      price?: { id: string };
    };
    line.pricing = null;
    line.price = { id: "price_plus" };
    expect(paidInvoiceMapping(legacy)).toMatchObject({ plan: "plus" });
  });
});

describe("Stripe payload compatibility and request validation", () => {
  it("reads the legacy invoice subscription field", () => {
    expect(
      invoiceSubscriptionId({
        id: "in_legacy",
        subscription: "sub_legacy",
      } as Stripe.Invoice & { subscription: string }),
    ).toBe("sub_legacy");
  });

  it("returns a typed client error for an invalid Max amount", () => {
    configureCatalog();
    try {
      checkoutLineItem("max", 105);
      throw new Error("expected checkoutLineItem to reject");
    } catch (err) {
      expect(err).toBeInstanceOf(StripeBillingError);
      expect((err as StripeBillingError).code).toBe("invalid_plan");
    }
  });

  it("returns Checkout to the billing card after Stripe", () => {
    expect(checkoutSuccessUrl("https://app.gate15.dev")).toBe(
      "https://app.gate15.dev/settings?billing=success&session_id={CHECKOUT_SESSION_ID}#billing-settings",
    );
  });
});

describe("existing Stripe subscription reconciliation", () => {
  it("finds exact Gate 15 prices while ignoring foreign and terminal subscriptions", () => {
    configureCatalog();
    const active = subscription({
      id: "sub_active",
      status: "active",
      priceIds: ["price_plus"],
    });
    const matches = nonterminalGate15Subscriptions([
      subscription({ id: "sub_foreign", status: "active", priceIds: ["price_other"] }),
      subscription({ id: "sub_canceled", status: "canceled", priceIds: ["price_plus"] }),
      subscription({
        id: "sub_expired",
        status: "incomplete_expired",
        priceIds: ["price_plus"],
      }),
      active,
    ]);
    expect(matches.map((item) => item.id)).toEqual(["sub_active"]);
  });

  it("maps a retired price from immutable Gate 15 plan metadata after validating its amount", () => {
    configureCatalog();
    const historical = subscription({
      id: "sub_historical",
      status: "active",
      priceIds: ["price_retired_plus"],
      metadata: { gate15_user_id: "user_test", gate15_plan: "plus" },
    });
    expect(nonterminalGate15Subscriptions([historical])).toEqual([historical]);
    expect(subscriptionMapping(historical)).toMatchObject({
      plan: "plus",
      priceId: "price_retired_plus",
    });
  });

  it("accepts an explicitly configured historical price without metadata", () => {
    configureCatalog();
    vi.stubEnv("STRIPE_PLUS_HISTORICAL_PRICE_IDS", "price_plus_2025, price_plus_2026");
    expect(
      subscriptionMapping(
        subscription({
          id: "sub_historical",
          status: "active",
          priceIds: ["price_plus_2025"],
        }),
      ),
    ).toMatchObject({ plan: "plus", priceId: "price_plus_2025" });
  });

  it("fails closed for a foreign price with no Gate 15 metadata", () => {
    configureCatalog();
    expect(() =>
      subscriptionMapping(
        subscription({ id: "sub_foreign", status: "active", priceIds: ["price_other"] }),
      ),
    ).toThrow(/not in the current or historical/);
  });

  it("rejects a catalog subscription containing an additional item", () => {
    configureCatalog();
    expect(() =>
      subscriptionMapping(
        subscription({
          id: "sub_extra_item",
          status: "active",
          priceIds: ["price_plus", "price_other"],
        }),
      ),
    ).toThrow(/exactly one Gate 15 price/);
  });
});

describe("Checkout catalog and return validation", () => {
  it("keeps catalog provisioning on the same monthly licensed cadence", () => {
    const setup = readFileSync(
      new URL("../../../../scripts/setup-stripe-catalog.mjs", import.meta.url),
      "utf8",
    );
    expect(setup).toMatch(/candidate\.recurring\?\.interval_count === 1/);
    expect(setup).toMatch(/candidate\.recurring\?\.usage_type === "licensed"/);
    expect(setup).toContain('.replace(/\\.$/, "")');
    expect(setup).toContain('.replace(/^\\[|\\]$/g, "")');
    expect(setup).toContain('/^127(?:\\.\\d{1,3}){3}$/.test(hostname)');
  });

  it("rejects a mispriced or non-monthly configured Price before Checkout", () => {
    expect(
      checkoutPriceProblem("plus", {
        active: true,
        currency: "usd",
        unit_amount: 1_000,
        type: "recurring",
        recurring: { interval: "month" },
      } as Stripe.Price),
    ).toMatch(/documented/);
  });

  it("rejects bimonthly and metered Prices", () => {
    const base = {
      active: true,
      currency: "usd",
      unit_amount: 2_000,
      type: "recurring",
      recurring: {
        interval: "month",
        interval_count: 1,
        usage_type: "licensed",
      },
    } as Stripe.Price;
    expect(
      checkoutPriceProblem("plus", {
        ...base,
        recurring: { ...base.recurring!, interval_count: 2 },
      }),
    ).toMatch(/every month/);
    expect(
      checkoutPriceProblem("plus", {
        ...base,
        recurring: { ...base.recurring!, usage_type: "metered" },
      }),
    ).toMatch(/licensed/);
  });

  it("accepts an inactive historical Price when mapping an existing subscription", () => {
    configureCatalog();
    vi.stubEnv("STRIPE_PLUS_HISTORICAL_PRICE_IDS", "price_plus_2025");
    expect(
      subscriptionMapping(
        subscription({ id: "sub_historical", status: "active", priceIds: ["price_plus_2025"] }),
      ),
    ).toMatchObject({ plan: "plus", priceId: "price_plus_2025" });
  });

  it("requires both Stripe ownership fields on the return Session", () => {
    const session = {
      client_reference_id: "user-1",
      metadata: { gate15_user_id: "user-1" },
    } as unknown as Stripe.Checkout.Session;
    expect(checkoutSessionBelongsToUser(session, "user-1")).toBe(true);
    expect(checkoutSessionBelongsToUser(session, "user-2")).toBe(false);
  });

  it("retains a successful Checkout mapping for the browser return race", () => {
    const source = readFileSync(new URL("./stripe.ts", import.meta.url), "utf8");
    const successful = source.slice(
      source.indexOf('case "checkout.session.completed"'),
      source.indexOf('case "checkout.session.async_payment_failed"'),
    );
    expect(successful).not.toContain("releaseBillingCheckoutSession");
    expect(source.slice(source.indexOf('case "checkout.session.async_payment_failed"')))
      .toContain("releaseBillingCheckoutSession(session.id)");
  });

  it("rechecks a duplicate cancel race before reporting an expiry error", () => {
    const source = readFileSync(new URL("./stripe.ts", import.meta.url), "utf8");
    const cancel = source.slice(
      source.indexOf("export async function cancelSubscriptionCheckout"),
      source.indexOf("export async function getSubscriptionCheckoutStatus"),
    );
    expect(cancel).toMatch(
      /sessions\.expire\(session\.id\)[\s\S]+catch \(expireError\)[\s\S]+sessions\.retrieve\(session\.id\)[\s\S]+current\.status === "complete"[\s\S]+current\.status !== "expired"/,
    );
  });
});

describe("Stripe-collected invoice payment evidence", () => {
  it("counts paid PaymentIntent allocations for the exact invoice", () => {
    expect(
      stripeCollectedInvoicePaymentCents({
        invoiceId: "in_test",
        currency: "usd",
        payments: [invoicePayment({ id: "one", amountPaid: 2_000, type: "payment_intent" })],
      }),
    ).toBe(2_000);
  });

  it("does not count out-of-band PaymentRecords or direct Charges", () => {
    expect(
      stripeCollectedInvoicePaymentCents({
        invoiceId: "in_test",
        currency: "usd",
        payments: [
          invoicePayment({ id: "record", amountPaid: 2_000, type: "payment_record" }),
          invoicePayment({ id: "charge", amountPaid: 2_000, type: "charge" }),
        ],
      }),
    ).toBe(0);
  });

  it("ignores unpaid, foreign-invoice, wrong-currency, and duplicate evidence", () => {
    const valid = invoicePayment({ id: "valid", amountPaid: 800, type: "payment_intent" });
    expect(
      stripeCollectedInvoicePaymentCents({
        invoiceId: "in_test",
        currency: "usd",
        payments: [
          valid,
          valid,
          invoicePayment({
            id: "open",
            amountPaid: 800,
            type: "payment_intent",
            status: "open",
          }),
          invoicePayment({
            id: "foreign",
            amountPaid: 800,
            type: "payment_intent",
            invoiceId: "in_other",
          }),
          invoicePayment({
            id: "eur",
            amountPaid: 800,
            type: "payment_intent",
            currency: "eur",
          }),
        ],
      }),
    ).toBe(800);
  });
});
