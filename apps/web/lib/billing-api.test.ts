import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  createBillingCheckoutApi,
  fetchBillingCheckoutStatusApi,
} from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("billing API errors", () => {
  it("surfaces the backend error text and code instead of a JSON blob", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({
        error: "This account already has a subscription. Manage it in the Stripe customer portal.",
        code: "active_subscription",
      }),
      {
        status: 409,
        headers: { "Content-Type": "application/json" },
      },
    )));

    await expect(createBillingCheckoutApi({ plan: "plus" })).rejects.toMatchObject({
      name: "ApiError",
      message: "This account already has a subscription. Manage it in the Stripe customer portal.",
      status: 409,
      code: "active_subscription",
    } satisfies Partial<ApiError>);
  });

  it("verifies the exact returned Checkout Session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ completed: true, fulfilled: true }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchBillingCheckoutStatusApi("cs_test_returned")).resolves.toEqual({
      completed: true,
      fulfilled: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/api/billing/checkout/status?session_id=cs_test_returned",
      ),
      expect.objectContaining({ credentials: "include" }),
    );
  });
});
