import { describe, expect, it } from "vitest";
import {
  BILLING_ENTITLEMENT_GRACE_MS,
  effectivePlan,
} from "./service.js";

const NOW = Date.parse("2026-07-15T12:00:00.000Z");

describe("invoice-backed billing entitlement", () => {
  it("does not trust an active Stripe status without paid-through evidence", () => {
    expect(effectivePlan("plus", "active", null, NOW)).toBe("free");
  });

  it("honors active and past-due subscriptions within the bounded paid window", () => {
    const paidThrough = new Date(NOW + 60_000).toISOString();
    expect(effectivePlan("plus", "active", paidThrough, NOW)).toBe("plus");
    expect(effectivePlan("byok", "past_due", paidThrough, NOW)).toBe("byok");
  });

  it("revokes access after the paid-through grace window", () => {
    const expired = new Date(NOW - BILLING_ENTITLEMENT_GRACE_MS - 1).toISOString();
    expect(effectivePlan("max", "past_due", expired, NOW)).toBe("free");
  });

  it("does not grant the dunning grace period to a merely active status", () => {
    const expired = new Date(NOW - 1).toISOString();
    expect(effectivePlan("plus", "active", expired, NOW)).toBe("free");
    expect(effectivePlan("plus", "past_due", expired, NOW)).toBe("plus");
  });

  it("never treats trialing, paused, or unpaid status as paid entitlement", () => {
    const future = new Date(NOW + 30 * 24 * 60 * 60 * 1_000).toISOString();
    expect(effectivePlan("plus", "trialing", future, NOW)).toBe("free");
    expect(effectivePlan("plus", "paused", future, NOW)).toBe("free");
    expect(effectivePlan("plus", "unpaid", future, NOW)).toBe("free");
  });
});
