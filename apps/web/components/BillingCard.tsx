"use client";

import { useEffect, useMemo, useState } from "react";
import type { BillingPlan, BillingStatus } from "@gate15/api-types";
import {
  createBillingCheckoutApi,
  createBillingPortalApi,
  type CheckoutBillingPlan,
} from "@/lib/api";
import { formatUsd, maxPlanCredits, subscriptionRequiresPortal } from "@/lib/billing-display";
import { toast } from "@/lib/toast";

type LoadState = "loading" | "ready" | "error";

interface BillingCardProps {
  billing: BillingStatus | null;
  loadState: LoadState;
  loadError: string | null;
  onRetry: () => void;
}

const PLAN_LABELS: Record<BillingPlan, string> = {
  free: "Free",
  byok: "BYOK",
  plus: "Plus",
  max: "Max",
};

const STATUS_LABELS: Record<BillingStatus["subscription_status"], string> = {
  none: "Trial",
  incomplete: "Checkout incomplete",
  incomplete_expired: "Checkout expired",
  trialing: "Trialing",
  active: "Active",
  past_due: "Payment past due",
  unpaid: "Unpaid",
  paused: "Paused",
  canceled: "Canceled",
};

function statusTone(status: BillingStatus["subscription_status"]): "good" | "warn" | "bad" | "neutral" {
  if (status === "active" || status === "trialing") return "good";
  if (status === "past_due" || status === "paused" || status === "incomplete") return "warn";
  if (status === "unpaid" || status === "incomplete_expired") return "bad";
  return "neutral";
}

function periodDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function navigateToHostedBilling(rawUrl: string): void {
  const target = new URL(rawUrl, window.location.origin);
  if (
    target.protocol !== "https:" ||
    !["checkout.stripe.com", "billing.stripe.com"].includes(target.hostname.toLowerCase())
  ) {
    throw new Error("Billing returned an invalid redirect URL");
  }
  window.location.assign(target.toString());
}

export default function BillingCard({
  billing,
  loadState,
  loadError,
  onRetry,
}: BillingCardProps) {
  const [busy, setBusy] = useState<CheckoutBillingPlan | "portal" | null>(null);
  const [maxMonthly, setMaxMonthly] = useState(100);

  useEffect(() => {
    if (billing?.max_monthly_usd != null) {
      setMaxMonthly(billing.max_monthly_usd);
      return;
    }
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("plan") !== "max") return;
    const requested = Number(params.get("max_monthly_usd"));
    if (
      Number.isInteger(requested) &&
      requested >= 100 &&
      requested <= 200 &&
      requested % 10 === 0
    ) {
      setMaxMonthly(requested);
    }
  }, [billing?.max_monthly_usd]);

  const selectedMaxCredits = useMemo(() => maxPlanCredits(maxMonthly), [maxMonthly]);

  async function startCheckout(plan: CheckoutBillingPlan): Promise<void> {
    if (!billing?.checkout_available || busy) return;
    setBusy(plan);
    try {
      const { url } = await createBillingCheckoutApi({
        plan,
        ...(plan === "max" ? { max_monthly_usd: maxMonthly } : {}),
      });
      navigateToHostedBilling(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't open secure checkout");
      setBusy(null);
    }
  }

  async function openPortal(): Promise<void> {
    if (!billing?.portal_available || busy) return;
    setBusy("portal");
    try {
      const { url } = await createBillingPortalApi();
      navigateToHostedBilling(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't open billing management");
      setBusy(null);
    }
  }

  async function choosePlan(plan: CheckoutBillingPlan): Promise<void> {
    if (!billing || busy) return;
    // Checkout creates subscriptions. Exact proration credit deltas are not
    // implemented yet, so an existing subscriber uses the Portal to cancel at
    // period end and returns here after access ends to start the new plan.
    if (subscriptionRequiresPortal(billing.subscription_status)) {
      if (billing.portal_available) await openPortal();
      return;
    }
    await startCheckout(plan);
  }

  if (loadState === "error") {
    return (
      <div className="settings-card billing-card">
        <h2>Plan &amp; billing</h2>
        <p className="settings-card-sub">Manage your Gate 15 plan and model-usage wallet.</p>
        <div className="async-error" role="alert">
          <p>Billing status is unavailable. No plan change has been made.</p>
          <code>{loadError ?? "Unknown billing error"}</code>
          <button type="button" className="btn-secondary" onClick={onRetry}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (loadState === "loading" || !billing) {
    return (
      <div className="settings-card billing-card" aria-busy="true">
        <h2>Plan &amp; billing</h2>
        <p className="settings-card-sub">Manage your Gate 15 plan and model-usage wallet.</p>
        <div className="billing-loading" role="status">
          <span className="skeleton" />
          <span className="skeleton" />
          <span className="skeleton" />
          <span className="sr-only">Loading billing status</span>
        </div>
      </div>
    );
  }

  const periodEnd = periodDate(billing.current_period_end);
  const paidAccessUntil = periodDate(billing.paid_access_until);
  const allowance = billing.monthly_usage_credits_usd + billing.monthly_reliability_credits_usd;
  const remainingPercent = billing.monthly_usage_credits_usd > 0
    ? Math.max(0, Math.min(100, (billing.usage_credit_balance_usd / billing.monthly_usage_credits_usd) * 100))
    : 0;
  const needsPortalForPlanChanges = subscriptionRequiresPortal(billing.subscription_status);
  const planChangesUsePortal = needsPortalForPlanChanges && billing.portal_available;
  const planSelectionAvailable = needsPortalForPlanChanges
    ? billing.portal_available
    : billing.checkout_available;
  const accessInterrupted = !billing.paid_access_active && needsPortalForPlanChanges;
  const statusLabel = accessInterrupted
    ? "Paid access inactive"
    : billing.plan === "free" && billing.subscription_status === "none"
      ? "Free trial"
      : STATUS_LABELS[billing.subscription_status];

  return (
    <div className="settings-card billing-card" aria-busy={busy !== null}>
      <div className="billing-card-head">
        <div>
          <h2>Plan &amp; billing</h2>
          <p className="settings-card-sub">
            Gate 15-funded model usage stops at its wallet edge; BYOK usage stays on your provider account.
          </p>
        </div>
        <div className="billing-current-plan" aria-label={`Current plan: ${PLAN_LABELS[billing.plan]}`}>
          <span>{PLAN_LABELS[billing.plan]}</span>
          <strong className={`billing-status ${accessInterrupted ? "bad" : statusTone(billing.subscription_status)}`}>
            <i aria-hidden="true" />
            {statusLabel}
          </strong>
        </div>
      </div>

      {billing.cancel_at_period_end && (
        <div className="billing-notice warn" role="status">
          Your subscription is set to cancel{periodEnd ? ` on ${periodEnd}` : " at period end"}.
          You can resume it from the billing portal.
        </div>
      )}

      {accessInterrupted && (
        <div className="billing-notice warn" role="status">
          Stripe reports {STATUS_LABELS[billing.subscription_status].toLowerCase()}, but no valid paid
          invoice currently backs access. Open the billing portal to resolve payment before starting more work.
        </div>
      )}

      {billing.requires_byok ? (
        <div className="billing-byok-summary">
          <span className="billing-metric-label">Model billing</span>
          <strong>Your provider keys</strong>
          <p>
            BYOK uses your provider accounts without a Gate 15 model wallet. Anthropic is
            required for every session because it powers internal planning and compaction;
            add the selected model&apos;s provider key for manual choices.
          </p>
        </div>
      ) : (
        <>
          <div className="billing-wallet" aria-label="Model credit wallet">
            <div>
              <span className="billing-metric-label">Build balance</span>
              <strong>{formatUsd(billing.usage_credit_balance_usd)}</strong>
              <small>{billing.plan === "free" ? "one-time trial credit" : "available for new work"}</small>
            </div>
            <div>
              <span className="billing-metric-label">Retry/correction reserve</span>
              <strong>{formatUsd(billing.reliability_credit_balance_usd)}</strong>
              <small>immediate broken-work follow-ups only</small>
            </div>
            <div>
              <span className="billing-metric-label">Wallet total</span>
              <strong>{formatUsd(billing.total_credit_balance_usd)}</strong>
              <small>two separate credit buckets</small>
            </div>
          </div>
          <div className="billing-meter-copy">
            <span>{Math.round(remainingPercent)}% of the build balance remains</span>
            <span>
              {billing.plan === "free"
                ? `${formatUsd(billing.monthly_usage_credits_usd)} once`
                : `${formatUsd(allowance)} granted each billing cycle`}
            </span>
          </div>
          <div
            className="billing-meter"
            role="progressbar"
            aria-label="Build credits remaining"
            aria-valuemin={0}
            aria-valuemax={billing.monthly_usage_credits_usd}
            aria-valuenow={Math.min(billing.usage_credit_balance_usd, billing.monthly_usage_credits_usd)}
          >
            <span style={{ width: `${remainingPercent}%` }} />
          </div>
        </>
      )}

      <div className="billing-cycle-row">
        <div>
          <span className="billing-metric-label">Billing cycle</span>
          <strong>
            {accessInterrupted
              ? "Action required in the billing portal"
              : billing.subscription_status === "past_due"
                ? paidAccessUntil
                  ? `Payment past due · grace access ends ${paidAccessUntil}`
                  : "Payment past due · update your payment method"
              : periodEnd
              ? `${billing.cancel_at_period_end ? "Access ends" : "Renews"} ${periodEnd}`
              : billing.plan === "free"
                ? "No card required"
                : "Awaiting subscription date"}
          </strong>
        </div>
        {billing.portal_available && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void openPortal()}
            disabled={busy !== null}
          >
            {busy === "portal" ? "Opening…" : "Manage billing"}
          </button>
        )}
      </div>

      <div className="billing-plan-picker">
        <div className="billing-plan-picker-head">
          <span className="billing-metric-label">Choose a paid plan</span>
          <p>
            {needsPortalForPlanChanges
              ? planChangesUsePortal
                ? "To change tiers, cancel at period end in Stripe, then return here after the current subscription ends."
                : "Billing management is temporarily unavailable. Your current subscription is unchanged."
              : "Checkout and payment details are handled securely by Stripe."}
          </p>
        </div>

        <PlanRow
          name="BYOK"
          price="$8 / month"
          description="Provider-key access with no Gate 15 wallet. Anthropic is required for internal work; add the provider key for each manual model you use."
          current={billing.plan === "byok"}
          disabled={!planSelectionAvailable || busy !== null}
          busy={busy === "byok" || busy === "portal"}
          actionLabel={planChangesUsePortal ? "Cancel to switch later" : undefined}
          onChoose={() => void choosePlan("byok")}
        />
        <PlanRow
          name="Plus"
          price="$20 / month"
          description="$12 build balance plus a $2 retry/correction reserve for immediate broken-work follow-ups each month. BYOK remains available."
          current={billing.plan === "plus"}
          featured
          disabled={!planSelectionAvailable || busy !== null}
          busy={busy === "plus" || busy === "portal"}
          actionLabel={planChangesUsePortal ? "Cancel to switch later" : undefined}
          onChoose={() => void choosePlan("plus")}
        />
        <div className={`billing-plan-row max${billing.plan === "max" ? " current" : ""}`}>
          <div className="billing-plan-copy">
            <div className="billing-plan-title">
              <strong>Max</strong>
              <span>{formatUsd(maxMonthly)} / month</span>
              {billing.plan === "max" && <em>Current</em>}
            </div>
            <p>
              {formatUsd(selectedMaxCredits.usage)} build balance + {formatUsd(selectedMaxCredits.reliability)} retry/correction reserve
              ({formatUsd(selectedMaxCredits.total)} total credits) each month.
            </p>
            <label className="billing-max-control">
              <span>
                {billing.plan === "max" ? "Current monthly commitment" : "Monthly commitment"}
                <output htmlFor="billing-max-range">{formatUsd(maxMonthly)}</output>
              </span>
              <input
                id="billing-max-range"
                type="range"
                min={100}
                max={200}
                step={10}
                value={maxMonthly}
                onChange={(event) => setMaxMonthly(Number(event.target.value))}
                disabled={busy !== null || billing.plan === "max"}
              />
              <span className="billing-max-ends" aria-hidden="true">
                <span>$100</span>
                <span>$200</span>
              </span>
            </label>
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void choosePlan("max")}
            disabled={
              billing.plan === "max" ||
              !planSelectionAvailable ||
              busy !== null
            }
          >
            {billing.plan === "max"
              ? "Current plan"
              : busy === "max" || busy === "portal"
                ? "Opening…"
                : planChangesUsePortal
                  ? "Cancel to switch later"
                  : `Choose ${formatUsd(maxMonthly)}`}
          </button>
        </div>
      </div>

      {!needsPortalForPlanChanges && !billing.checkout_available && (
        <p className="billing-unavailable" role="status">
          Secure checkout is temporarily unavailable. Your current plan and credits are unchanged.
        </p>
      )}

      {needsPortalForPlanChanges && !billing.portal_available && (
        <p className="billing-unavailable" role="status">
          Billing management is temporarily unavailable. Your current subscription is unchanged; retry later or contact support.
        </p>
      )}
    </div>
  );
}

function PlanRow({
  name,
  price,
  description,
  current,
  featured = false,
  disabled,
  busy,
  actionLabel,
  onChoose,
}: {
  name: string;
  price: string;
  description: string;
  current: boolean;
  featured?: boolean;
  disabled: boolean;
  busy: boolean;
  actionLabel?: string;
  onChoose: () => void;
}) {
  return (
    <div className={`billing-plan-row${featured ? " featured" : ""}${current ? " current" : ""}`}>
      <div className="billing-plan-copy">
        <div className="billing-plan-title">
          <strong>{name}</strong>
          <span>{price}</span>
          {featured && !current && <em>Recommended</em>}
          {current && <em>Current</em>}
        </div>
        <p>{description}</p>
      </div>
      <button
        type="button"
        className={featured && !current ? "btn-primary" : "btn-secondary"}
        onClick={onChoose}
        disabled={current || disabled}
      >
        {current ? "Current plan" : busy ? "Opening…" : actionLabel ?? `Choose ${name}`}
      </button>
    </div>
  );
}
