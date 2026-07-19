import { beforeEach, describe, expect, it, vi } from "vitest";

const billing = vi.hoisted(() => ({
  authorize: vi.fn(),
  charge: vi.fn(),
  reserve: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock("./service.js", () => ({
  BillingAccessError: class BillingAccessError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
      this.name = "BillingAccessError";
    }
  },
  authorizeAiRun: billing.authorize,
  chargeAiUsage: billing.charge,
  reservePlatformBillingBudget: billing.reserve,
}));

vi.mock("../db/providerKeys.js", () => ({
  resolveProviderKeysForUserWithSources: billing.resolve,
}));

import {
  beginMeteredAnthropicCall,
  markMeteredAnthropicCallStarted,
  releaseMeteredAnthropicCall,
  settleMeteredAnthropicCall,
} from "./anthropic.js";

const access = (platformBudgetUsd: number, accountOnly = false) => ({
  plan: accountOnly ? "byok" : "plus",
  credentialMode: accountOnly ? "byok" : "hybrid",
  keyPolicy: accountOnly ? "account-only" : "account-first",
  platformBudgetUsd,
});

const resolved = (source: "platform" | "account", key: string) => ({
  keys: { anthropic: key },
  sources: { anthropic: source, openai: "missing", google: "missing", zai: "missing" },
});

describe("one-shot Anthropic billing admission", () => {
  beforeEach(() => {
    billing.authorize.mockReset();
    billing.charge.mockReset();
    billing.charge.mockResolvedValue(undefined);
    billing.reserve.mockReset();
    billing.reserve.mockImplementation(async (input: { availableBudgetUsd: number }) =>
      input.availableBudgetUsd,
    );
    billing.resolve.mockReset();
  });

  it("uses atomic escrow without an account-wide run lease", async () => {
    billing.authorize.mockResolvedValue(access(0.42));
    billing.resolve.mockResolvedValue(resolved("platform", "platform-key"));

    const call = await beginMeteredAnthropicCall("user-1");

    expect(billing.authorize).toHaveBeenCalledTimes(1);
    expect(billing.resolve).toHaveBeenCalledTimes(1);
    expect(billing.reserve).toHaveBeenCalledWith({
      userId: "user-1",
      runId: call.runId,
      availableBudgetUsd: 0.42,
      preferReliability: false,
    });
    expect(call).toMatchObject({
      apiKey: "platform-key",
      platformFunded: true,
      platformBudgetUsd: 0.42,
    });
  });

  it("does not reserve Gate 15 credit for an account-funded call", async () => {
    billing.authorize.mockResolvedValue(access(0, true));
    billing.resolve.mockResolvedValue(resolved("account", "account-key"));

    const call = await beginMeteredAnthropicCall("user-1");

    expect(call).toMatchObject({ apiKey: "account-key", platformFunded: false });
    expect(billing.reserve).not.toHaveBeenCalled();
  });

  it("refunds escrow when local validation stops before the provider boundary", async () => {
    billing.authorize.mockResolvedValue(access(0.42));
    billing.resolve.mockResolvedValue(resolved("platform", "platform-key"));
    const call = await beginMeteredAnthropicCall("user-1");

    await releaseMeteredAnthropicCall(call);

    expect(billing.charge).toHaveBeenCalledWith({
      userId: "user-1",
      runId: call.runId,
      costUsd: 0,
      unknownPlatformSpend: false,
      reservedBudgetUsd: 0.42,
    });
  });

  it("retains bounded escrow when a started request returns no usage", async () => {
    billing.authorize.mockResolvedValue(access(0.42));
    billing.resolve.mockResolvedValue(resolved("platform", "platform-key"));
    const call = await beginMeteredAnthropicCall("user-1");
    markMeteredAnthropicCallStarted(call);

    await releaseMeteredAnthropicCall(call);

    expect(billing.charge).toHaveBeenCalledWith({
      userId: "user-1",
      runId: call.runId,
      costUsd: 0,
      unknownPlatformSpend: true,
      reservedBudgetUsd: 0.42,
    });
  });

  it("treats an all-zero provider usage object as an unknown receipt", async () => {
    billing.authorize.mockResolvedValue(access(0.42));
    billing.resolve.mockResolvedValue(resolved("platform", "platform-key"));
    const call = await beginMeteredAnthropicCall("user-1");
    markMeteredAnthropicCallStarted(call);

    await settleMeteredAnthropicCall({ call, model: "claude-sonnet-4-6", usage: {} });

    expect(billing.charge).toHaveBeenCalledWith({
      userId: "user-1",
      runId: call.runId,
      costUsd: 0,
      unknownPlatformSpend: true,
      reservedBudgetUsd: 0.42,
    });
  });
});
