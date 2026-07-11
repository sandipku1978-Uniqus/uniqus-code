"use client";

import { useEffect, useState } from "react";
import type { OrgUsageSummary } from "@uniqus/api-types";
import { fetchOrgUsageApi } from "@/lib/api";

/**
 * Organization usage (P3.5) — month-to-date agent spend across the org's projects
 * vs. its monthly cap, plus a project count. Mirrors the account usage widgets but
 * scoped to the org so an admin can see how close the team is to the budget that
 * pauses runs. Same page chrome as the other dashboard sub-pages (.dash-page +
 * .coll-head + .metric-strip), with a magenta progress meter that ambers then
 * reds as the cap is approached.
 */

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function monthLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "this month";
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export default function OrgUsageView({ orgId }: { orgId: string }) {
  const [usage, setUsage] = useState<OrgUsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setUsage(null);
    setError(null);
    fetchOrgUsageApi(orgId)
      .then((r) => {
        if (alive) setUsage(r.usage);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "Couldn't load usage");
      });
    return () => {
      alive = false;
    };
  }, [orgId]);

  if (error) {
    return (
      <div className="dash-page org-page">
        <span className="page-eyebrow">Workspace</span>
        <h1>Usage</h1>
        <div className="dash-card">
          <p className="card-sub" style={{ marginBottom: 0 }}>{error}</p>
        </div>
      </div>
    );
  }
  if (!usage) {
    return (
      <div className="dash-page org-page">
        <span className="page-eyebrow">Workspace</span>
        <h1>Usage</h1>
        <div className="dash-card">
          <p className="card-sub" style={{ marginBottom: 0 }}>Loading…</p>
        </div>
      </div>
    );
  }

  const { spend_usd, budget_usd, project_count, month_start } = usage;
  const pct =
    budget_usd && budget_usd > 0 ? Math.min(100, (spend_usd / budget_usd) * 100) : null;
  const over = pct != null && spend_usd >= (budget_usd ?? Infinity);
  const meterColor = over
    ? "var(--conf-low)"
    : pct != null && pct >= 80
    ? "var(--conf-medium)"
    : "var(--brand-magenta)";

  return (
    <div className="dash-page org-page">
      <header className="coll-head">
        <span className="page-eyebrow">Workspace</span>
        <h1>
          Usage &amp; <span className="grad">budget</span>
        </h1>
        <p className="lede">
          Agent spend across every project in this organization, tracked against its
          monthly cap. {monthLabel(month_start)} to date.
        </p>
      </header>

      <div className="metric-strip">
        <MetricCell value={money(spend_usd)} label="Spent this month" />
        <MetricCell value={budget_usd == null ? "No cap" : money(budget_usd)} label="Monthly cap" />
        <MetricCell value={project_count} label="Projects" />
        <MetricCell
          value={budget_usd == null ? "—" : money(Math.max(0, budget_usd - spend_usd))}
          label="Remaining"
        />
      </div>

      {pct != null && (
        <div className="dash-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
            <span className="page-eyebrow" style={{ margin: 0 }}>
              {money(spend_usd)} of {money(budget_usd ?? 0)}
            </span>
            <span className="page-eyebrow" style={{ margin: 0, color: meterColor }}>
              {Math.round(pct)}%
            </span>
          </div>
          <div className="usage-meter">
            <span style={{ width: `${pct}%`, background: meterColor }} />
          </div>
          {over && (
            <p style={{ color: "var(--conf-low)", fontSize: 12, margin: "10px 0 0" }}>
              The monthly budget has been reached — new agent runs are paused until the cap
              is raised or the month resets.
            </p>
          )}
        </div>
      )}

      <p style={{ color: "var(--text-muted)", fontSize: 12.5, lineHeight: 1.6, marginTop: 4 }}>
        Spend is the sum of snapshotted agent cost across every project in this organization
        since the start of {monthLabel(month_start)}.
      </p>
    </div>
  );
}

function MetricCell({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="metric-cell">
      <span className="metric-value">{value}</span>
      <span className="metric-label">{label}</span>
    </div>
  );
}
