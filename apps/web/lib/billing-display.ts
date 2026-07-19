import type { BillingStatus, BillingSubscriptionStatus } from "@gate15/api-types";

export type BillingCheckoutPlan = "byok" | "plus" | "max";

export interface BillingSelection {
  plan: BillingCheckoutPlan;
  maxMonthlyUsd?: number;
}

const CHECKOUT_ALLOWED_STATUSES = new Set<BillingSubscriptionStatus>([
  "none",
  "canceled",
  "incomplete_expired",
]);

/** Existing Stripe subscriptions must be changed or repaired in the Portal. */
export function subscriptionRequiresPortal(status: BillingSubscriptionStatus): boolean {
  return !CHECKOUT_ALLOWED_STATUSES.has(status);
}

/** True after Checkout's subscription sync and any paid credit grant are visible. */
export function billingActivationReady(billing: BillingStatus): boolean {
  // The effective plan flips only after the invoice-backed entitlement RPC
  // commits. Never infer fulfillment from a Checkout return or raw Stripe
  // subscription status, and do not use a mutable remaining balance as proof.
  return billing.paid_access_active && billing.plan !== "free";
}

/** Preserve exact-session verification when Checkout completes on its cancel URL. */
export function completedCheckoutSearch(search: string, sessionId: string): string {
  const params = new URLSearchParams(search);
  params.set("billing", "success");
  params.set("session_id", sessionId);
  params.delete("attempt_id");
  return params.toString();
}

export function isBillingCancelReturn(value: string | null | undefined): boolean {
  return value === "cancel" || value === "canceled" || value === "cancelled";
}

export function isBillingCheckoutReturn(value: string | null | undefined): boolean {
  return value === "success" || isBillingCancelReturn(value);
}

/** Pricing-page and Settings preview of the server-enforced Max allowance. */
export function maxPlanCredits(monthlyUsd: number): {
  usage: number;
  reliability: number;
  total: number;
} {
  const usage = roundUsd(monthlyUsd * 0.85 - 10);
  const reliability = roundUsd(monthlyUsd * 0.1);
  return { usage, reliability, total: roundUsd(usage + reliability) };
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function maxSettingsHref(monthlyUsd: number): string {
  return billingSettingsHref({ plan: "max", maxMonthlyUsd: monthlyUsd });
}

/** Keep pricing intent through WorkOS auth and guest-account conversion. */
export function parseBillingSelection(
  plan: string | null | undefined,
  maxMonthlyUsd: string | number | null | undefined,
): BillingSelection | null {
  if (plan !== "byok" && plan !== "plus" && plan !== "max") return null;
  if (plan !== "max") return { plan };

  const requested = Number(maxMonthlyUsd);
  const normalized = Number.isInteger(requested) && requested >= 100 && requested <= 200 && requested % 10 === 0
    ? requested
    : 100;
  return { plan, maxMonthlyUsd: normalized };
}

export function billingSettingsHref(selection: BillingSelection | null): string {
  if (!selection) return "/settings#billing-settings";
  return `${selectionPath("/settings", "plan", selection)}#billing-settings`;
}

export function billingLoginHref(
  selection: BillingSelection | null,
  returnToBilling = false,
): string {
  if (selection) return selectionPath("/login", "plan", selection);
  return returnToBilling ? "/login?billing_settings=1" : "/login";
}

export function billingPostAuthHref(
  selection: BillingSelection | null,
  convertFailed = false,
  returnToBilling = false,
): string {
  const params = new URLSearchParams();
  if (convertFailed) params.set("convert", "failed");
  if (returnToBilling && !selection) params.set("billing_settings", "1");
  appendSelection(params, "billing_plan", selection);
  const query = params.toString();
  return query ? `/projects?${query}` : "/projects";
}

export function billingGuestConvertHref(
  selection: BillingSelection | null,
  returnToBilling = false,
): string {
  if (selection) return selectionPath("/api/guest/convert", "billing_plan", selection);
  return returnToBilling ? "/api/guest/convert?billing_settings=1" : "/api/guest/convert";
}

function selectionPath(
  path: string,
  planParam: "plan" | "billing_plan",
  selection: BillingSelection,
): string {
  const params = new URLSearchParams();
  appendSelection(params, planParam, selection);
  return `${path}?${params.toString()}`;
}

function appendSelection(
  params: URLSearchParams,
  planParam: "plan" | "billing_plan",
  selection: BillingSelection | null,
): void {
  if (!selection) return;
  params.set(planParam, selection.plan);
  if (selection.plan === "max") {
    params.set("max_monthly_usd", String(selection.maxMonthlyUsd ?? 100));
  }
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}
