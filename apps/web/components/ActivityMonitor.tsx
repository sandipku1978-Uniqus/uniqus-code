"use client";

import { useMemo, useState } from "react";
import { estimateCostUsd } from "@gate15/api-types";
import { useStore, type ChatItem } from "@/lib/store";
import TodoList from "./TodoList";
import SubAgentList from "./SubAgentList";

type ToolItem = Extract<ChatItem, { kind: "tool" }>;

interface DiffTurn {
  /** Stable for the lifetime of the chat: normally the opening user message id. */
  id: string;
  prompt: string | null;
  edits: ToolItem[];
  complete: boolean;
}

function isDiffTool(item: ChatItem): item is ToolItem {
  return item.kind === "tool" && (item.name === "write_file" || item.name === "edit_file");
}

/**
 * Group file-edit tool calls by user turn. The Activity Monitor used to flatten
 * the entire conversation, reverse it, and keep only twelve entries. Besides
 * hiding larger changesets, that made old edits look like part of the current
 * run. Chat already carries explicit user/complete boundaries, so retain every
 * edit and use those boundaries as the history model instead.
 */
export function buildDiffTurns(chat: ChatItem[]): DiffTurn[] {
  const turns: DiffTurn[] = [];
  let current: DiffTurn | null = null;

  const finish = () => {
    if (!current) return;
    turns.push(current);
    current = null;
  };

  for (const item of chat) {
    if (item.kind === "user") {
      finish();
      current = { id: item.id, prompt: item.content, edits: [], complete: false };
      continue;
    }

    if (item.kind === "complete") {
      if (current) {
        current.complete = true;
        finish();
      }
      continue;
    }

    if (!isDiffTool(item)) continue;
    // Defensive fallback for a streamed/replayed tool that arrived without its
    // opening user event. Its first tool id remains stable when complete lands.
    current ??= { id: `tool:${item.id}`, prompt: null, edits: [], complete: false };
    current.edits.push(item);
  }

  finish();
  return turns;
}

function compactPrompt(prompt: string | null): string {
  const oneLine = prompt?.replace(/\s+/g, " ").trim() ?? "";
  if (!oneLine) return "Agent activity";
  return oneLine.length > 46 ? `${oneLine.slice(0, 43)}…` : oneLine;
}

function diffTurnLabel(turn: DiffTurn, index: number, latestIndex: number): string {
  const distance = latestIndex - index;
  const relative =
    distance === 0
      ? turn.complete
        ? "Latest turn"
        : "Current turn"
      : distance === 1
        ? "Previous turn"
        : `${distance} turns ago`;
  return `${relative} · ${turn.edits.length} diff${turn.edits.length === 1 ? "" : "s"} · ${compactPrompt(turn.prompt)}`;
}

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
      <span className="am-stat-value" style={accent ? { color: "var(--accent, #FF7700)" } : undefined}>
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
  // Large turns can contain scores of writes. Keep every header mounted, but
  // only split/copy a tool's content into display lines once the user opens it.
  const diff = useMemo(() => (open ? diffForTool(item) : null), [item, open]);

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
      {open && diff && (
        <pre className="am-diff-body">
          {diff.lines.map((l, i) => (
            <div
              key={i}
              className={l.sign === "+" ? "am-diff-add" : l.sign === "-" ? "am-diff-del" : "am-diff-ctx"}
            >
              <span className="am-diff-sign">{l.sign}</span>
              {l.text || " "}
            </div>
          ))}
          {diff.truncated > 0 && <div className="am-diff-more">… {diff.truncated} more lines</div>}
        </pre>
      )}
    </div>
  );
}

/**
 * The Activity Monitor — fills the Builder stage while there's no live preview
 * to show, turning the dead space into a live build dashboard: token/cost meter,
 * the agent's task list, background sub-agents, and a turn-scoped feed of edited
 * files (newest on top). A new user turn starts with an empty feed; completed
 * turns remain available in the turn picker. Yields to the real preview the
 * moment one exists (BuilderStage swaps it out). When there's no activity yet
 * it shows the "Start preview" call-to-action instead.
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

  const diffTurns = useMemo(() => buildDiffTurns(chat), [chat]);
  const latestTurnId = diffTurns.length > 0 ? diffTurns[diffTurns.length - 1].id : null;
  // Keep turns that actually have diffs, plus the newest turn even while it is
  // still empty. That last entry is what makes the feed clear immediately when
  // the user starts the next turn without cluttering history with empty runs.
  const selectableTurns = useMemo(() => {
    const latestIndex = diffTurns.length - 1;
    return diffTurns.filter((turn, index) => index === latestIndex || turn.edits.length > 0);
  }, [diffTurns]);
  const [turnSelection, setTurnSelection] = useState<{
    latestId: string | null;
    selectedId: string | null;
  }>({ latestId: null, selectedId: null });
  // Reset synchronously when a new latest turn appears. Tracking which latest
  // id the manual selection belongs to avoids an effect (and a one-frame flash
  // of the previous turn's diffs after the user presses Send).
  const selectedTurnId =
    turnSelection.latestId === latestTurnId &&
    selectableTurns.some((turn) => turn.id === turnSelection.selectedId)
      ? turnSelection.selectedId
      : latestTurnId;
  const selectedTurn =
    selectableTurns.find((turn) => turn.id === selectedTurnId) ??
    selectableTurns[selectableTurns.length - 1] ??
    null;
  const edits = selectedTurn ? selectedTurn.edits.slice().reverse() : [];
  const hasDiffHistory = diffTurns.some((turn) => turn.edits.length > 0);

  const hasActivity =
    busy || todos.length > 0 || subagents.length > 0 || liveUsage !== null || hasDiffHistory;

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

      {hasDiffHistory && selectedTurn && (
        <div className="am-section">
          <div className="am-section-head">
            <span className="am-section-title">File diffs</span>
            <span className="am-section-count">{edits.length}</span>
            {selectableTurns.length > 1 && (
              <select
                className="am-turn-picker"
                aria-label="Show file diffs from turn"
                value={selectedTurn.id}
                onChange={(event) =>
                  setTurnSelection({
                    latestId: latestTurnId,
                    selectedId: event.target.value,
                  })
                }
              >
                {selectableTurns.map((turn) => {
                  const turnIndex = diffTurns.indexOf(turn);
                  return (
                    <option key={turn.id} value={turn.id}>
                      {diffTurnLabel(turn, turnIndex, diffTurns.length - 1)}
                    </option>
                  );
                })}
              </select>
            )}
          </div>
          {edits.length > 0 ? (
            <div className="am-diff-feed" key={selectedTurn.id}>
              {edits.map((item, i) => (
                // When a new live diff becomes newest, remount the previous
                // leader as a collapsed history card. Manually opened history
                // cards keep their stable key and remain under user control.
                <DiffCard
                  key={`${item.id}:${i === 0 ? "latest" : "history"}`}
                  item={item}
                  defaultOpen={i === 0}
                />
              ))}
            </div>
          ) : (
            <div className="am-diff-empty">
              No file diffs {selectedTurn.complete ? "in" : "yet in"} this turn. Choose an earlier turn to
              review its changes.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
