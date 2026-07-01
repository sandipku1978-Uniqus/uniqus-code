"use client";

import { useStore, type SubAgentLive } from "@/lib/store";

function statusColor(status: SubAgentLive["status"]): string {
  return status === "done"
    ? "var(--conf-high, #34d399)"
    : status === "error"
      ? "var(--conf-low, #f87171)"
      : "var(--accent, #B21E7D)";
}

function tokenLabel(s: SubAgentLive): string {
  const total = s.inputTokens + s.cacheReadTokens + s.cacheCreationTokens + s.outputTokens;
  if (total <= 0) return "";
  return total >= 1000 ? `${(total / 1000).toFixed(1)}k tok` : `${total} tok`;
}

/**
 * The live sub-agent widget — one row per background sub-agent with its current
 * action. Shared by the Activity Monitor (desktop) and the compact strip above
 * the mobile composer. Reads `subagents` from the store; renders nothing when
 * none are running this turn.
 */
export default function SubAgentList({ compact = false }: { compact?: boolean }) {
  const subagents = useStore((s) => s.subagents);
  if (subagents.length === 0) return null;

  const running = subagents.filter((s) => s.status === "running").length;

  return (
    <div className={`subagents${compact ? " subagents-compact" : ""}`}>
      {!compact && (
        <div className="subagents-head">
          <span className="subagents-title">Sub-agents</span>
          <span className="subagents-count">
            {running > 0 ? `${running} running · ` : ""}
            {subagents.length} total
          </span>
        </div>
      )}
      <div className="subagents-list">
        {subagents.map((s) => {
          const tokens = tokenLabel(s);
          const action =
            s.status === "error"
              ? s.error || "failed"
              : s.status === "done"
                ? "done"
                : s.lastAction || "starting…";
          return (
            <div key={s.id} className="subagent-row" title={`${s.label} · ${s.model}\n${s.task}`}>
              <span
                className={`subagent-dot${s.status === "running" ? " pulse" : ""}`}
                style={{ background: statusColor(s.status) }}
                aria-hidden
              />
              <span className="subagent-name">
                #{s.index} {s.label}
              </span>
              <span className="subagent-action">{action}</span>
              {!compact && tokens && <span className="subagent-tokens">{tokens}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
