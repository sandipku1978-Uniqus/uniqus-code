import { beforeEach, describe, expect, it, vi } from "vitest";

const billingDb = vi.hoisted(() => ({
  reserve: vi.fn(),
  finalize: vi.fn(),
  consume: vi.fn(),
}));

vi.mock("../db/billing.js", () => ({
  consumeBillingCredits: billingDb.consume,
  ensureBillingAccount: vi.fn(),
  finalizeBillingCreditReservation: billingDb.finalize,
  getWalletBalance: vi.fn(),
  reserveBillingCredits: billingDb.reserve,
}));

vi.mock("../db/providerKeys.js", () => ({
  listAccountProviderKeys: vi.fn(),
}));

import {
  BillingAccessError,
  chargeAiUsage,
  maxPlatformRunUsd,
  reservePlatformBillingBudget,
} from "./service.js";

const settlement = (overrides: Record<string, unknown> = {}) => ({
  reservationFound: true,
  chargedMicrousd: 0,
  uncoveredMicrousd: 0,
  usageMicrousd: 1_000_000,
  reliabilityMicrousd: 0,
  ...overrides,
});

describe("platform credit reservations", () => {
  beforeEach(() => {
    billingDb.reserve.mockReset();
    billingDb.finalize.mockReset();
    billingDb.consume.mockReset();
  });

  it("uses a $5 default run ceiling with bounded env overrides", () => {
    expect(maxPlatformRunUsd(undefined)).toBe(5);
    expect(maxPlatformRunUsd("bad")).toBe(5);
    expect(maxPlatformRunUsd("0.01")).toBe(0.25);
    expect(maxPlatformRunUsd("12.5")).toBe(12.5);
    expect(maxPlatformRunUsd("100")).toBe(25);
  });

  it("escrows only the run ceiling and returns the exact reserved budget", async () => {
    billingDb.reserve.mockResolvedValue(4_250_000);

    await expect(
      reservePlatformBillingBudget({
        userId: "user-1",
        runId: "run-1",
        availableBudgetUsd: 18,
        preferReliability: true,
      }),
    ).resolves.toBe(4.25);

    expect(billingDb.reserve).toHaveBeenCalledWith({
      userId: "user-1",
      runId: "run-1",
      amountMicrousd: 5_000_000,
      preferredBucket: "reliability",
    });
  });

  it("fails closed when the wallet cannot fund any reservation", async () => {
    billingDb.reserve.mockResolvedValue(0);
    await expect(
      reservePlatformBillingBudget({
        userId: "user-1",
        runId: "run-1",
        availableBudgetUsd: 1,
        preferReliability: false,
      }),
    ).rejects.toBeInstanceOf(BillingAccessError);
  });

  it("finalizes a zero-cost run so all escrow can be refunded", async () => {
    billingDb.finalize.mockResolvedValue(settlement());

    await chargeAiUsage({
      userId: "user-1",
      runId: "run-1",
      costUsd: 0,
    });

    expect(billingDb.finalize).toHaveBeenCalledWith({
      userId: "user-1",
      runId: "run-1",
      actualMicrousd: 0,
    });
    expect(billingDb.consume).not.toHaveBeenCalled();
  });

  it("retains the bounded reservation when a platform request has no usage receipt", async () => {
    billingDb.finalize.mockResolvedValue(settlement({ chargedMicrousd: 5_000_000 }));

    await chargeAiUsage({
      userId: "user-1",
      runId: "run-1",
      costUsd: 0,
      unknownPlatformSpend: true,
      reservedBudgetUsd: 5,
    });

    expect(billingDb.finalize).toHaveBeenCalledWith({
      userId: "user-1",
      runId: "run-1",
      actualMicrousd: 5_000_000,
    });
  });

  it("keeps an ordinary failed rolling-deploy fallback out of reliability credit", async () => {
    billingDb.finalize.mockResolvedValue(
      settlement({ reservationFound: false }),
    );
    billingDb.consume.mockResolvedValue({
      chargedMicrousd: 250_000,
      uncoveredMicrousd: 0,
      usageMicrousd: 750_000,
      reliabilityMicrousd: 0,
    });

    await chargeAiUsage({
      userId: "user-1",
      runId: "run-1",
      costUsd: 0.25,
    });

    expect(billingDb.consume).toHaveBeenCalledWith({
      userId: "user-1",
      runId: "run-1",
      amountMicrousd: 250_000,
      preferredBucket: "usage",
    });
  });
});
