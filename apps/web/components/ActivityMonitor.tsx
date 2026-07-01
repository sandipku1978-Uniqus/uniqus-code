"use client";

import { useMemo, useState } from "react";
import { estimateCostUsd } from "@uniqus/api-types";
import { useStore, type ChatItem } from "@/lib/store";
import TodoList from "./TodoList";
import SubAgentList from "./SubAgentList";

type ToolItem = Extract<ChatItem, { kind: "tool" }>;

function fmtTokens(n: number): string {
  if (n <= 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

function fmtCost(usd: number): string {
  if (usd <= 0) return "$0.00";
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(usd < 1 ? 3 : 2)}`;
}

/** A live token/cost stat cell. The inner span is keyed on `value` so it remounts
 *  (re-triggering the subtle count-up bump animation) only when the number
 *  actually changes (item 13). */
function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="am-stat">
      <span className="am-stat-value" style={accent ? { color: "var(--accent, #B21E7D)" } : undefined}>
        <span className="am-stat-value-inner" key={value}>
          {value}
        </span>
      </span>
      <span className="am-stat-label">{label}</span>
    </div>
  );
}

/** Build the diff lines for one write_file/edit_file tool call from its input. */
function diffForTool(item: ToolItem): { lines: { sign: "+" | "-" | " "; text: string }[]; truncated: number } {
  const MAX = 60;
  const input = (item.input ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  let lines: { sign: "+" | "-" | " "; text: string }[] = [];
  if (item.name === "edit_file") {
    const oldL = str(input.old_string).split("\n");
    const newL = str(input.new_string).split("\n");
    lines = [
      ...oldL.map((t) => ({ sign: "-" as const, text: t })),
      ...newL.map((t) => ({ sign: "+" as const, text: t })),
    ];
  } else {
    // write_file (or anything with `content`): show the new content as additions.
    lines = str(input.content)
      .split("\n")
      .map((t) => ({ sign: "+" as const, text: t }));
  }
  const truncated = Math.max(0, lines.length - MAX);
  return { lines: lines.slice(0, MAX), truncated };
}

function filePath(item: ToolItem): string {
  const input = (item.input ?? {}) as Record<string, unknown>;
  const p = input.path ?? input.file ?? input.file_path;
  // Treat an empty string (partial args still streaming) as "not known yet" so
  // the row shows a placeholder instead of a blank gap after "Writing" (item 4).
  const s = typeof p === "string" ? p.trim() : "";
  if (s) return s;
  return item.result === undefined ? "…" : item.name;
}

/** One file's diff card in the edited-files feed. */
function DiffCard({ item, defaultOpen }: { item: ToolItem; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const path = filePath(item);
  const added = item.lines_added ?? 0;
  const removed = item.lines_removed ?? 0;
  const running = item.result === undefined;
  const { lines, truncated } = useMemo(() => diffForTool(item), [item]);

  return (
    <div className="am-diff-card">
      <button type="button" className="am-diff-head" onClick={() => setOpen((v) => !v)}>
        <span className="am-diff-caret">{open ? "▾" : "▸"}</span>
        <span className="am-diff-verb">
          {item.name === "write_file"
            ? running
              ? "Writing"
              : "Wrote"
            : running
              ? "Editing"
              : "Edited"}
        </span>
        <span className="am-diff-path">{path}</span>
        {!running && (
          <span className="am-diff-stat">
            <span style={{ color: "var(--conf-high, #34d399)" }}>+{added}</span>{" "}
            <span style={{ color: "var(--conf-medium, #fbbf24)" }}>−{removed}</span>
          </span>
        )}
        {running && <span className="am-diff-running">writing…</span>}
      </button>
      {open && (
        <pre className="am-diff-body">
          {lines.map((l, i) => (
            <div
              key={i}
              className={l.sign === "+" ? "am-diff-add" : l.sign === "-" ? "am-diff-del" : "am-diff-ctx"}
            >
              <span className="am-diff-sign">{l.sign}</span>
              {l.text || " "}
            </div>
          ))}
          {truncated > 0 && <div className="am-diff-more">… {truncated} more lines</div>}
        </pre>
      )}
    </div>
  );
}

/**
 * The Activity Monitor — fills the Builder stage while there's no live preview
 * to show, turning the dead space into a live build dashboard: token/cost meter,
 * the agent's task list, background sub-agents, and a feed of edited files with
 * full diffs (newest on top). Yields to the real preview the moment one exists
 * (BuilderStage swaps it out). When there's no activity yet it shows the
 * "Start preview" call-to-action instead.
 */
export default function ActivityMonitor({
  onStartPreview,
  startingPreview,
}: {
  /** When provided, the idle empty-state shows a "Start preview" CTA (Builder
   *  stage). Omitted when rendered as a standalone tab (item 2). */
  onStartPreview?: () => void;
  startingPreview?: boolean;
}) {
  const busy = useStore((s) => s.busy);
  const liveUsage = useStore((s) => s.liveUsage);
  const subagents = useStore((s) => s.subagents);
  const todos = useStore((s) => s.todos);
  const chat = useStore((s) => s.chat);

  const edits = useMemo(
    () =>
      (chat.filter((c) => c.kind === "tool" && (c.name === "write_file" || c.name === "edit_file")) as ToolItem[])
        .slice()
        .reverse()
        .slice(0, 12),
    [chat],
  );

  const hasActivity =
    busy || todos.length > 0 || subagents.length > 0 || liveUsage !== null || edits.length > 0;

  if (!hasActivity) {
    // Standalone tab (no start handler): a quiet idle state, no CTA.
    if (!onStartPreview) {
      return (
        <div className="builder-empty">
          <h2>Activity Monitor</h2>
          <p>Live tokens, cost, tasks, sub-agents, and file diffs show up here the moment the agent starts working.</p>
          <span className="builder-empty-hint">Ask for something in chat to see it come alive.</span>
        </div>
      );
    }
    return (
      <div className="builder-empty">
        <h2>See your app come to life</h2>
        <p>Start a live preview to watch your app right here — it refreshes as you chat and make changes.</p>
        <button type="button" className="btn-primary btn-lg" onClick={onStartPreview} disabled={startingPreview}>
          {startingPreview ? "Starting…" : "Start preview"}
        </button>
        <span className="builder-empty-hint">
          Or just ask in chat — your preview (and a live activity monitor) appears automatically once the agent
          starts working.
        </span>
      </div>
    );
  }

  // Live totals = lead agent + every sub-agent (priced per-model).
  const fresh = (liveUsage?.input ?? 0) + subagents.reduce((a, s) => a + s.inputTokens, 0);
  const cached =
    (liveUsage?.cacheRead ?? 0) +
    (liveUsage?.cacheCreation ?? 0) +
    subagents.reduce((a, s) => a + s.cacheReadTokens + s.cacheCreationTokens, 0);
  const out = (liveUsage?.output ?? 0) + subagents.reduce((a, s) => a + s.outputTokens, 0);
  const cost =
    (liveUsage
      ? estimateCostUsd(
          liveUsage.model ?? "",
          liveUsage.input,
          liveUsage.output,
          liveUsage.cacheRead,
          liveUsage.cacheCreation,
        )
      : 0) +
    subagents.reduce(
      (a, s) => a + estimateCostUsd(s.model, s.inputTokens, s.outputTokens, s.cacheReadTokens, s.cacheCreationTokens),
      0,
    );

  return (
    <div className="activity-monitor">
      <div className="am-header">
        <span className={`am-live-dot${busy ? " pulse" : ""}`} aria-hidden />
        <span className="am-title">Activity Monitor</span>
        <span className="am-sub">{busy ? "working…" : "idle"}</span>
      </div>

      <div className="am-tokens">
        <Stat label="in" value={fmtTokens(fresh)} />
        <Stat label="cached" value={fmtTokens(cached)} />
        <Stat label="out" value={fmtTokens(out)} />
        <Stat label="cost est." value={fmtCost(cost)} accent />
      </div>

      <TodoList collapsible={false} />

      <SubAgentList />

      {edits.length > 0 && (
        <div className="am-section">
          <div className="am-section-head">
            <span className="am-section-title">Edited files</span>
            <span className="am-section-count">{edits.length}</span>
          </div>
          <div className="am-diff-feed">
            {edits.map((item, i) => (
              <DiffCard key={item.id} item={item} defaultOpen={i === 0} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
