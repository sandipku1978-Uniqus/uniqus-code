"use client";

import { useStore } from "@/lib/store";

/**
 * Tasks pane (Plan §5 — Artifact panes UI).
 *
 * Renders the agent's `todo_write` list as a first-class pane instead of an
 * inline chat message. Read-only on the user's side — the agent owns the
 * list; the user just watches it.
 */
export default function TasksPane({ onClose }: { onClose: () => void }) {
  const todos = useStore((s) => s.todos);
  const total = todos.length;
  const done = todos.filter((t) => t.status === "completed").length;
  const inFlight = todos.find((t) => t.status === "in_progress");

  return (
    <div className="pane">
      <div className="pane-header">
        <span className="label-micro">
          Tasks {total > 0 ? `· ${done}/${total}` : ""}
        </span>
        <div className="actions">
          <button
            type="button"
            onClick={onClose}
            className="icon-btn-sm"
            title="Hide tasks pane"
            style={{ width: "auto", padding: "2px 8px", fontSize: 11 }}
          >
            close
          </button>
        </div>
      </div>

      <div style={{ overflow: "auto", padding: 12, display: "grid", gap: 6 }}>
        {todos.length === 0 ? (
          <div style={{ color: "var(--text-dim)", fontSize: 12, fontStyle: "italic" }}>
            The agent will populate this pane when it has a multi-step plan.
            Today’s task is too simple? You won’t see anything here.
          </div>
        ) : (
          todos.map((t, i) => <TaskRow key={i} item={t} />)
        )}
      </div>

      {inFlight && (
        <div
          style={{
            borderTop: "1px solid var(--border-default, #2a2a36)",
            padding: "8px 12px",
            fontSize: 11.5,
            color: "var(--text-dim)",
          }}
        >
          ▶ {inFlight.activeForm}…
        </div>
      )}
    </div>
  );
}

function TaskRow({ item }: { item: { content: string; activeForm: string; status: string } }) {
  const icon =
    item.status === "completed" ? "✓" : item.status === "in_progress" ? "▶" : "·";
  const color =
    item.status === "completed"
      ? "var(--text-dim)"
      : item.status === "in_progress"
      ? "var(--accent, #a78bfa)"
      : "var(--text-primary)";
  const decoration = item.status === "completed" ? "line-through" : "none";
  const label = item.status === "in_progress" ? item.activeForm : item.content;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "16px 1fr",
        gap: 8,
        alignItems: "baseline",
        fontSize: 12.5,
        padding: "4px 6px",
        borderRadius: 4,
        background:
          item.status === "in_progress" ? "rgba(167,139,250,0.06)" : "transparent",
      }}
    >
      <span style={{ color, fontFamily: "var(--mono, monospace)", fontSize: 12 }}>{icon}</span>
      <span style={{ textDecoration: decoration, color }}>{label}</span>
    </div>
  );
}
