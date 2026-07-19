import {
  MODEL_CATALOG,
  type BillingPlan,
  type BillingStatus,
  type BillingSubscriptionStatus,
  type ModelChoice,
  type ModelProvider,
} from "@gate15/api-types";
import {
  consumeBillingCredits,
  ensureBillingAccount,
  finalizeBillingCreditReservation,
  getWalletBalance,
  reserveBillingCredits,
} from "../db/billing.js";
import {
  listAccountProviderKeys,
  type ProviderKeyPolicy,
} from "../db/providerKeys.js";
import {
  dollarsToMicrousd,
  microusdToDollars,
  planAllowance,
} from "./plans.js";

/** Bounded recovery window after the last fully paid service period. */
export const BILLING_ENTITLEMENT_GRACE_MS = 7 * 24 * 60 * 60 * 1_000;
export const DEFAULT_MAX_PLATFORM_RUN_USD = 5;
const MIN_MAX_PLATFORM_RUN_USD = 0.25;
const MAX_MAX_PLATFORM_RUN_USD = 25;

export type BillingCredentialMode = "platform" | "byok" | "hybrid";

export interface BillingRunAccess {
  plan: BillingPlan;
  credentialMode: BillingCredentialMode;
  keyPolicy: ProviderKeyPolicy;
  /** Maximum platform-funded spend this run may start from its admitted wallet. */
  platformBudgetUsd: number;
}

export class BillingAccessError extends Error {
  constructor(
    public readonly code:
      | "billing_unavailable"
      | "subscription_inactive"
      | "credits_exhausted"
      | "byok_required",
    message: string,
  ) {
    super(message);
    this.name = "BillingAccessError";
  }
}

export async function getBillingStatus(
  userId: string,
  stripeCheckoutAvailable: boolean,
): Promise<BillingStatus> {
  const account = await ensureBillingAccount(userId);
  const wallet = await getWalletBalance(userId);
  const plan = effectivePlan(
    account.plan,
    account.subscription_status,
    account.entitled_through,
  );
  const allowance = planAllowance(plan, plan === "max" ? account.max_monthly_usd : null);
  const entitledThroughMs = account.entitled_through
    ? Date.parse(account.entitled_through)
    : Number.NaN;
  const paidAccessUntil = plan !== "free" && Number.isFinite(entitledThroughMs)
    ? new Date(
        entitledThroughMs +
          (account.subscription_status === "past_due" ? BILLING_ENTITLEMENT_GRACE_MS : 0),
      ).toISOString()
    : null;
  const usage = microusdToDollars(wallet.usageMicrousd);
  const reliability = microusdToDollars(wallet.reliabilityMicrousd);
  return {
    plan,
    subscription_status: account.subscription_status,
    paid_access_active: plan !== "free",
    paid_access_until: paidAccessUntil,
    requires_byok: plan === "byok",
    byok_enabled: plan !== "free",
    checkout_available: stripeCheckoutAvailable,
    portal_available: Boolean(
      account.stripe_customer_id &&
        process.env.STRIPE_SECRET_KEY &&
        process.env.STRIPE_PORTAL_CONFIGURATION_ID,
    ),
    usage_credit_balance_usd: usage,
    reliability_credit_balance_usd: reliability,
    total_credit_balance_usd: Math.round((usage + reliability) * 100) / 100,
    monthly_usage_credits_usd: allowance.usageUsd,
    monthly_reliability_credits_usd: allowance.reliabilityUsd,
    max_monthly_usd: plan === "max" ? account.max_monthly_usd : null,
    current_period_end: account.current_period_end,
    cancel_at_period_end: account.cancel_at_period_end,
  };
}

/**
 * Fail-closed admission used before a VM or provider call starts. Free always
 * spends its Gate 15 wallet; BYOK never sees platform keys; Plus/Max prefer a
 * configured account key and charge only provider calls that fall back to us.
 */
export async function authorizeAiRun(
  userId: string,
  modelChoice: ModelChoice | undefined,
  options: { allowReliability?: boolean } = {},
): Promise<BillingRunAccess> {
  let account;
  let wallet;
  try {
    // Ensure the one-time grant has committed before reading its balance. A
    // concurrent Promise.all here could briefly see $0 on a brand-new account.
    account = await ensureBillingAccount(userId);
    wallet = await getWalletBalance(userId);
  } catch (err) {
    throw new BillingAccessError(
      "billing_unavailable",
      `Billing could not be verified, so no paid model call was started. ${errorText(err)}`,
    );
  }

  const plan = effectivePlan(
    account.plan,
    account.subscription_status,
    account.entitled_through,
  );
  if (plan === "byok") {
    await assertRequiredByokKeys(userId, modelChoice);
    return {
      plan,
      credentialMode: "byok",
      keyPolicy: "account-only",
      platformBudgetUsd: 0,
    };
  }

  if (plan === "free") {
    if (wallet.usageMicrousd <= 0) {
      throw new BillingAccessError(
        "credits_exhausted",
        "Your one-time Free usage credit is exhausted. Choose BYOK, Plus, or Max in Settings to continue.",
      );
    }
    return {
      plan,
      credentialMode: "platform",
      keyPolicy: "platform-only",
      platformBudgetUsd: wallet.usageMicrousd / 1_000_000,
    };
  }

  if (
    wallet.usageMicrousd > 0 ||
    (options.allowReliability === true && wallet.reliabilityMicrousd > 0)
  ) {
    return {
      plan,
      credentialMode: "hybrid",
      keyPolicy: "account-first",
      platformBudgetUsd:
        (wallet.usageMicrousd +
          (options.allowReliability === true ? wallet.reliabilityMicrousd : 0)) /
        1_000_000,
    };
  }

  // Plus/Max users can continue entirely on their own keys after their monthly
  // Gate 15 wallet is spent. Never silently let a zero wallet hit env keys.
  await assertRequiredByokKeys(userId, modelChoice);
  return {
    plan,
    credentialMode: "byok",
    keyPolicy: "account-only",
    platformBudgetUsd: 0,
  };
}

/**
 * Escrow at most one run's configured cost ceiling before the first platform
 * provider call. This bounds crash exposure without taking the user's entire
 * monthly wallet; ordinary completion refunds the unused allocation.
 */
export async function reservePlatformBillingBudget(input: {
  userId: string;
  runId: string;
  availableBudgetUsd: number;
  preferReliability: boolean;
}): Promise<number> {
  const availableMicrousd = Math.max(
    0,
    Math.floor(dollarsToMicrousd(input.availableBudgetUsd)),
  );
  const capMicrousd = Math.floor(
    dollarsToMicrousd(maxPlatformRunUsd(process.env.BILLING_MAX_PLATFORM_RUN_USD)),
  );
  const requestedMicrousd = Math.min(availableMicrousd, capMicrousd);
  if (requestedMicrousd <= 0) {
    throw new BillingAccessError(
      "credits_exhausted",
      "The remaining usage credit is too small to start another platform-funded AI run.",
    );
  }

  let reservedMicrousd: number;
  try {
    reservedMicrousd = await reserveBillingCredits({
      userId: input.userId,
      runId: input.runId,
      amountMicrousd: requestedMicrousd,
      preferredBucket: input.preferReliability ? "reliability" : "usage",
    });
  } catch (err) {
    throw new BillingAccessError("billing_unavailable", errorText(err));
  }
  if (reservedMicrousd <= 0) {
    throw new BillingAccessError(
      "credits_exhausted",
      "Your platform usage credit was exhausted before this run could start.",
    );
  }
  return reservedMicrousd / 1_000_000;
}

export function maxPlatformRunUsd(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_PLATFORM_RUN_USD;
  return Math.min(MAX_MAX_PLATFORM_RUN_USD, Math.max(MIN_MAX_PLATFORM_RUN_USD, parsed));
}

export async function assertCanConfigureByok(userId: string): Promise<void> {
  const account = await ensureBillingAccount(userId);
  const plan = effectivePlan(
    account.plan,
    account.subscription_status,
    account.entitled_through,
  );
  if (plan === "free") {
    throw new BillingAccessError(
      "subscription_inactive",
      "Provider keys are available on BYOK, Plus, and Max plans.",
    );
  }
}

/** Settle a platform-funded cost against the durable, atomic wallet ledger. */
export async function chargeAiUsage(input: {
  userId: string;
  runId: string;
  costUsd: number;
  /** Provider request started but returned no trustworthy usage receipt. */
  unknownPlatformSpend?: boolean;
  /** Exact amount escrowed for this run; retained when spend is unknowable. */
  reservedBudgetUsd?: number;
}): Promise<void> {
  const settlementCostUsd = input.unknownPlatformSpend
    ? Math.max(
        Number.isFinite(input.costUsd) ? input.costUsd : 0,
        Number.isFinite(input.reservedBudgetUsd) ? input.reservedBudgetUsd ?? 0 : 0,
      )
    : input.costUsd;
  const amountMicrousd =
    Number.isFinite(settlementCostUsd) && settlementCostUsd > 0
      ? Math.ceil(dollarsToMicrousd(settlementCostUsd))
      : 0;
  if (input.unknownPlatformSpend && amountMicrousd > 0) {
    console.warn(
      `[billing] retaining bounded escrow for run ${input.runId}; provider spend is unknown`,
    );
  }
  let settlement = await finalizeBillingCreditReservation({
    userId: input.userId,
    runId: input.runId,
    actualMicrousd: amountMicrousd,
  });
  if (!settlement.reservationFound) {
    if (amountMicrousd === 0) return;
    // Compatibility for an already-running pre-escrow orchestrator during a
    // rolling deploy. Every new platform path reserves before provider spend.
    console.warn(`[billing] settling unreserved legacy run ${input.runId}`);
    settlement = {
      reservationFound: false,
      ...(await consumeBillingCredits({
        userId: input.userId,
        runId: input.runId,
        amountMicrousd,
        // Reliability credit is reserved only for an explicitly identified
        // immediate correction. A legacy, unreserved run has no such admission
        // decision to replay, so even an error must fall back to ordinary usage.
        preferredBucket: "usage",
      })),
    };
  }
  if (settlement.uncoveredMicrousd > 0) {
    console.warn(
      `[billing] run ${input.runId} exceeded its admitted wallet by ` +
        `$${microusdToDollars(settlement.uncoveredMicrousd).toFixed(2)}`,
    );
  }
}

export function effectivePlan(
  storedPlan: BillingPlan,
  status: BillingSubscriptionStatus,
  entitledThrough: string | null,
  nowMs = Date.now(),
): BillingPlan {
  if (storedPlan === "free") return "free";
  if ((status !== "active" && status !== "past_due") || !entitledThrough) return "free";
  const paidThroughMs = Date.parse(entitledThrough);
  if (!Number.isFinite(paidThroughMs)) return "free";
  const graceMs = status === "past_due" ? BILLING_ENTITLEMENT_GRACE_MS : 0;
  return nowMs <= paidThroughMs + graceMs ? storedPlan : "free";
}

async function assertRequiredByokKeys(
  userId: string,
  modelChoice: ModelChoice | undefined,
): Promise<void> {
  let configured: Set<ModelProvider>;
  try {
    configured = new Set(await listAccountProviderKeys(userId));
  } catch (err) {
    throw new BillingAccessError("billing_unavailable", errorText(err));
  }
  const required = new Set<ModelProvider>(["anthropic"]);
  const explicit = MODEL_CATALOG.find((option) => option.id === modelChoice)?.provider;
  if (explicit) required.add(explicit);
  const missing = [...required].filter((provider) => !configured.has(provider));
  if (missing.length === 0) return;
  throw new BillingAccessError(
    "byok_required",
    `Add your ${missing.join(" and ")} API key${missing.length > 1 ? "s" : ""} in Settings before using this plan. Anthropic is required for Auto and internal planning/compaction.`,
  );
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
