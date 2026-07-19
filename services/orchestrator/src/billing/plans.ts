import type { BillingPlan } from "@gate15/api-types";

export const FREE_TRIAL_CREDITS_USD = 3;
export const BYOK_MONTHLY_PRICE_USD = 8;
export const PLUS_MONTHLY_PRICE_USD = 20;
export const PLUS_USAGE_CREDITS_USD = 12;
export const PLUS_RELIABILITY_CREDITS_USD = 2;
export const MAX_MIN_MONTHLY_USD = 100;
export const MAX_MAX_MONTHLY_USD = 200;
export const MAX_PRICE_STEP_USD = 10;

export interface PlanAllowance {
  usageUsd: number;
  reliabilityUsd: number;
}

/**
 * Max preserves the requested contribution curve before Stripe fees:
 * $15 at $100 and $20 at $200. Ten percent funds explicit retry/correction
 * follow-ups (the same share as Plus), and the
 * rest of the model allowance is ordinary spendable usage credit.
 */
export function maxAllowance(monthlyUsd: number): PlanAllowance {
  const price = validateMaxMonthlyUsd(monthlyUsd);
  return {
    usageUsd: roundUsd(price * 0.85 - 10),
    reliabilityUsd: roundUsd(price * 0.1),
  };
}

export function planAllowance(
  plan: BillingPlan,
  maxMonthlyUsd: number | null = null,
): PlanAllowance {
  switch (plan) {
    case "free":
      return { usageUsd: FREE_TRIAL_CREDITS_USD, reliabilityUsd: 0 };
    case "byok":
      return { usageUsd: 0, reliabilityUsd: 0 };
    case "plus":
      return {
        usageUsd: PLUS_USAGE_CREDITS_USD,
        reliabilityUsd: PLUS_RELIABILITY_CREDITS_USD,
      };
    case "max":
      return maxAllowance(maxMonthlyUsd ?? MAX_MIN_MONTHLY_USD);
  }
}

export function validateMaxMonthlyUsd(value: number): number {
  if (!Number.isInteger(value)) {
    throw new Error("Max monthly price must be a whole dollar amount");
  }
  if (value < MAX_MIN_MONTHLY_USD || value > MAX_MAX_MONTHLY_USD) {
    throw new Error(
      `Max monthly price must be between $${MAX_MIN_MONTHLY_USD} and $${MAX_MAX_MONTHLY_USD}`,
    );
  }
  if (value % MAX_PRICE_STEP_USD !== 0) {
    throw new Error(`Max monthly price must use $${MAX_PRICE_STEP_USD} increments`);
  }
  return value;
}

export function dollarsToMicrousd(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error("credit amount must be non-negative");
  return Math.round(value * 1_000_000);
}

export function microusdToDollars(value: number): number {
  return roundUsd(Math.max(0, value) / 1_000_000);
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}
