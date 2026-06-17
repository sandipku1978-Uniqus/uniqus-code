"use client";

import { useEffect, useState } from "react";
import type { OrgUsageSummary } from "@uniqus/api-types";
import { fetchOrgUsageApi } from "@/lib/api";

/**
 * Organization usage (P3.5) — month-to-date agent spend across the org's projects
 * vs. its monthly cap, plus a project count. Mirrors the account usage widgets but
 * scoped to the org so an admin can see how close the team is to the budget that
 * pauses runs. House design language: a hairline card, a mono micro-label, and a
 * single magenta progress meter that turns red as the cap is approached.
 */

const eyebrow: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "var(--fs-2xs)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--text-dim)",
};

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function monthLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "this month";
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 140,
        border: "1px solid var(--border-default)",
        borderRadius: "var(--radius-lg)",
        background: "var(--bg-surface)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <span style={eyebrow}>{label}</span>
      <span style={{ fontSize: "var(--fs-xl)", fontVariantNumeric: "tabular-nums", color: "var(--text-primary)" }}>
        {value}
      </span>
    </div>
  );
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

  if (error) return <div style={{ ...eyebrow, color: "var(--text-muted)" }}>{error}</div>;
  if (!usage) return <div style={eyebrow}>Loading…</div>;

  const { spend_usd, budget_usd, project_count, month_start } = usage;
  const pct =
    budget_usd && budget_usd > 0 ? Math.min(100, (spend_usd / budget_usd) * 100) : null;
  const over = pct != null && spend_usd >= (budget_usd ?? Infinity);
  const meterColor = over
    ? "#ef4444"
    : pct != null && pct >= 80
    ? "#f59e0b"
    : "var(--brand-magenta)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={eyebrow}>● Usage</span>
        <span style={eyebrow}>{monthLabel(month_start)}</span>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", maxWidth: 640 }}>
        <Stat label="Spent this month" value={money(spend_usd)} />
        <Stat label="Monthly cap" value={budget_usd == null ? "No cap" : money(budget_usd)} />
        <Stat label="Projects" value={String(project_count)} />
      </div>

      {pct != null && (
        <div
          style={{
            maxWidth: 640,
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-lg)",
            background: "var(--bg-surface)",
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", ...eyebrow }}>
            <span>{money(spend_usd)} of {money(budget_usd ?? 0)}</span>
            <span style={{ color: meterColor }}>{Math.round(pct)}%</span>
          </div>
          <div
            style={{
              height: 8,
              borderRadius: "var(--radius-full)",
              background: "var(--bg-elev)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: "100%",
                background: meterColor,
                transition: "width 200ms ease-out",
              }}
            />
          </div>
          {over && (
            <div style={{ color: "#ef4444", fontSize: "var(--fs-xs)" }}>
              The monthly budget has been reached — new agent runs are paused until the cap is raised
              or the month resets.
            </div>
          )}
        </div>
      )}

      <div style={{ color: "var(--text-dim)", fontSize: "var(--fs-xs)", maxWidth: 640 }}>
        Spend is the sum of snapshotted agent cost across every project in this organization since the
        start of {monthLabel(month_start)}.
      </div>
    </div>
  );
}
