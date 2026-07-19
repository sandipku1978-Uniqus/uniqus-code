import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("./client.js", () => ({ db: mocks.db }));

import {
  deactivateBillingPaidAccess,
  terminateBillingSubscription,
} from "./billing.js";

beforeEach(() => {
  mocks.db.mockReset();
  mocks.rpc.mockReset();
  mocks.db.mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
});

describe("atomic billing de-entitlement accessors", () => {
  it("deactivates paid grants and entitlement through one RPC", async () => {
    await expect(deactivateBillingPaidAccess("user-1")).resolves.toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("deactivate_billing_paid_access", {
      p_user_id: "user-1",
    });
  });

  it("terminates the subscription and paid wallet through one RPC", async () => {
    await expect(
      terminateBillingSubscription("user-1", "cus_123", "incomplete_expired"),
    ).resolves.toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("terminate_billing_subscription", {
      p_user_id: "user-1",
      p_customer_id: "cus_123",
      p_status: "incomplete_expired",
    });
  });

  it("surfaces database failures without a partial client-side fallback", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "database unavailable" } });
    await expect(deactivateBillingPaidAccess("user-1")).rejects.toThrow(
      /deactivate billing paid access failed: database unavailable/i,
    );
  });
});
