import { describe, expect, it } from "vitest";
import type { BillingStatus } from "@gate15/api-types";
import {
  billingActivationReady,
  billingGuestConvertHref,
  billingLoginHref,
  billingPostAuthHref,
  billingSettingsHref,
  completedCheckoutSearch,
  formatUsd,
  isBillingCancelReturn,
  isBillingCheckoutReturn,
  maxPlanCredits,
  maxSettingsHref,
  parseBillingSelection,
  subscriptionRequiresPortal,
} from "./billing-display";

describe("Max plan display economics", () => {
  it("matches the configured endpoint allowances", () => {
    expect(maxPlanCredits(100)).toEqual({ usage: 75, reliability: 10, total: 85 });
    expect(maxPlanCredits(200)).toEqual({ usage: 160, reliability: 20, total: 180 });
  });

  it("keeps the split exact at an intermediate $10 step", () => {
    expect(maxPlanCredits(150)).toEqual({ usage: 117.5, reliability: 15, total: 132.5 });
    expect(formatUsd(117.5)).toBe("$117.50");
    expect(formatUsd(15)).toBe("$15");
  });

  it("carries the selected commitment from pricing into Settings", () => {
    expect(maxSettingsHref(150)).toBe(
      "/settings?plan=max&max_monthly_usd=150#billing-settings",
    );
  });

  it("keeps a validated selection through login and guest conversion", () => {
    const selection = parseBillingSelection("max", "150");
    expect(selection).toEqual({ plan: "max", maxMonthlyUsd: 150 });
    expect(billingLoginHref(selection)).toBe("/login?plan=max&max_monthly_usd=150");
    expect(billingPostAuthHref(selection)).toBe(
      "/projects?billing_plan=max&max_monthly_usd=150",
    );
    expect(billingGuestConvertHref(selection)).toBe(
      "/api/guest/convert?billing_plan=max&max_monthly_usd=150",
    );
    expect(billingSettingsHref(selection)).toBe(
      "/settings?plan=max&max_monthly_usd=150#billing-settings",
    );
  });

  it("keeps a generic billing return through guest conversion", () => {
    expect(billingLoginHref(null, true)).toBe("/login?billing_settings=1");
    expect(billingPostAuthHref(null, false, true)).toBe(
      "/projects?billing_settings=1",
    );
    expect(billingGuestConvertHref(null, true)).toBe(
      "/api/guest/convert?billing_settings=1",
    );
    expect(billingSettingsHref(null)).toBe("/settings#billing-settings");
  });

  it("does not carry arbitrary redirects or invalid plan values", () => {
    expect(parseBillingSelection("https://example.com", "200")).toBeNull();
    expect(parseBillingSelection("max", "999")).toEqual({
      plan: "max",
      maxMonthlyUsd: 100,
    });
  });
});

describe("billing UI contract", () => {
  it("uses Checkout only when the backend permits a new subscription", () => {
    expect(subscriptionRequiresPortal("none")).toBe(false);
    expect(subscriptionRequiresPortal("canceled")).toBe(false);
    expect(subscriptionRequiresPortal("incomplete_expired")).toBe(false);
    expect(subscriptionRequiresPortal("incomplete")).toBe(true);
    expect(subscriptionRequiresPortal("unpaid")).toBe(true);
    expect(subscriptionRequiresPortal("paused")).toBe(true);
    expect(subscriptionRequiresPortal("active")).toBe(true);
  });

  it("waits for invoice-backed entitlement after subscription activation", () => {
    const activePlus: BillingStatus = {
      plan: "plus",
      subscription_status: "active",
      paid_access_active: false,
      paid_access_until: null,
      requires_byok: false,
      byok_enabled: true,
      checkout_available: true,
      portal_available: true,
      usage_credit_balance_usd: 12,
      reliability_credit_balance_usd: 0,
      total_credit_balance_usd: 12,
      monthly_usage_credits_usd: 12,
      monthly_reliability_credits_usd: 2,
      max_monthly_usd: null,
      current_period_end: null,
      cancel_at_period_end: false,
    };
    expect(billingActivationReady(activePlus)).toBe(false);
    expect(billingActivationReady({
      ...activePlus,
      paid_access_active: true,
    })).toBe(true);
  });

  it("keeps exact-session verification when a completed Checkout returns via cancel", () => {
    expect(
      completedCheckoutSearch(
        "?billing=canceled&attempt_id=attempt-1&plan=plus",
        "cs_test_completed",
      ),
    ).toBe("billing=success&plan=plus&session_id=cs_test_completed");
  });

  it("lets the return handler own every recognized Checkout return", () => {
    expect(isBillingCheckoutReturn("success")).toBe(true);
    for (const result of ["cancel", "canceled", "cancelled"]) {
      expect(isBillingCancelReturn(result)).toBe(true);
      expect(isBillingCheckoutReturn(result)).toBe(true);
    }
    expect(isBillingCheckoutReturn("unknown")).toBe(false);
  });
});
