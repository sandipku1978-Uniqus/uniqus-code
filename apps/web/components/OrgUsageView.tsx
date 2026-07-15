"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { OrgUsageSummary } from "@gate15/api-types";
import { fetchOrgUsageApi } from "@/lib/api";
import { OrgMetric, OrgMetricRail, OrgPageHeader, OrgStatePanel } from "./OrgPageChrome";

function money(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function monthLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "this month";
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export default function OrgUsageView({ orgId }: { orgId: string }) {
  const [usage, setUsage] = useState<OrgUsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadGenerationRef = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    const generation = ++loadGenerationRef.current;
    setUsage(null);
    setError(null);
    try {
      const response = await fetchOrgUsageApi(orgId, signal);
      if (signal?.aborted || generation !== loadGenerationRef.current) return;
      setUsage(response.usage);
    } catch (e) {
      if (signal?.aborted || generation !== loadGenerationRef.current) return;
      setError(e instanceof Error ? e.message : "Couldn't load usage");
    }
  }, [orgId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => {
      controller.abort();
      loadGenerationRef.current += 1;
    };
  }, [load]);

  const pct =
    usage?.budget_usd && usage.budget_usd > 0
      ? Math.min(100, (usage.spend_usd / usage.budget_usd) * 100)
      : null;
  const over = usage != null && pct != null && usage.spend_usd >= (usage.budget_usd ?? Infinity);
  const nearCap = pct != null && pct >= 80 && !over;
  const status = error
    ? "Usage unavailable"
    : !usage
      ? "Calculating spend"
      : usage.budget_usd == null
        ? "No monthly cap"
        : over
          ? "Budget reached"
          : nearCap
            ? "Approaching cap"
            : "Spend on track";
  const statusTone = error ? "danger" : !usage ? "warn" : over ? "danger" : nearCap ? "warn" : "live";
  const meterTone = over ? "danger" : nearCap ? "warn" : "live";

  return (
    <div className="dash-page org-page">
      <OrgPageHeader
        index="02"
        title="Usage &"
        accent="budget"
        context="Monthly controls"
        status={status}
        statusTone={statusTone}
        lede={
          <>
            Track agent spend across every project in this organization and see how the
            workspace is pacing against its monthly spending guard.
          </>
        }
      />

      {error ? (
        <OrgStatePanel
          state="error"
          title="Usage could not be calculated"
          body={error}
          onRetry={() => void load()}
        />
      ) : !usage ? (
        <OrgStatePanel
          state="loading"
          title="Calculating organization usage"
          body="Collecting this month's snapshotted agent cost across shared projects."
        />
      ) : (
        <>
          <OrgMetricRail>
            <OrgMetric value={money(usage.spend_usd)} label="Spent this month" />
            <OrgMetric
              value={usage.budget_usd == null ? "No guard" : money(usage.budget_usd)}
              label="Monthly guard"
            />
            <OrgMetric value={usage.project_count} label="Projects" />
            <OrgMetric
              value={
                usage.budget_usd == null
                  ? "—"
                  : money(Math.max(0, usage.budget_usd - usage.spend_usd))
              }
              label="Remaining"
            />
          </OrgMetricRail>

          <div className="org-usage-layout">
            <section className="org-budget-panel">
              <div className="org-budget-head">
                <div>
                  <span className="org-section-index">Budget position</span>
                  <h2>{usage.budget_usd == null ? "Uncapped workspace" : "Monthly pacing"}</h2>
                </div>
                <span className="org-status">
                  <span className={`org-status-dot ${meterTone}`} aria-hidden="true" />
                  {status}
                </span>
              </div>

              <div className="org-budget-reading">
                <strong>{pct == null ? "∞" : `${Math.round(pct)}%`}</strong>
                <span>{pct == null ? "Monitoring only" : "of the monthly guard used"}</span>
              </div>

              {pct != null ? (
                <>
                  <div
                    className="usage-meter org-usage-meter"
                    role="progressbar"
                    aria-label="Monthly organization budget used"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(pct)}
                  >
                    <span className={meterTone} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="org-budget-scale">
                    <span>{money(usage.spend_usd)} spent</span>
                    <span>{money(usage.budget_usd ?? 0)} guard</span>
                  </div>
                </>
              ) : (
                <p className="org-budget-copy">
                  Agent runs remain available regardless of monthly spend. Add a guard in
                  organization settings to stop most new runs near a chosen target.
                </p>
              )}

              {over && (
                <p className="org-budget-alert">
                  Most new runs are paused until the guard is raised or the month resets.
                  Concurrent work can finish over the target, and recorded spend can lag.
                </p>
              )}
            </section>

            <aside className="org-facts-panel">
              <div className="org-section-head">
                <span className="org-section-index">Accounting window</span>
                <h2>{monthLabel(usage.month_start)}</h2>
                <p>A live roll-up of cost snapshots recorded by every organization project.</p>
              </div>
              <dl className="org-fact-list">
                <div>
                  <dt>Scope</dt>
                  <dd>{usage.project_count} shared projects</dd>
                </div>
                <div>
                  <dt>Resets</dt>
                  <dd>Start of each month</dd>
                </div>
                <div>
                  <dt>Enforcement</dt>
                  <dd>{usage.budget_usd == null ? "Monitoring only" : "Best-effort run guard"}</dd>
                </div>
              </dl>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
