"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";

/**
 * The agent's task list (Plan §5), shared between the inline chat strip and the
 * Activity Monitor. Reads `todos` from the store. Collapsible by default (the
 * chat strip wants it tucked away); the Activity Monitor renders it always-open
 * via `collapsible={false}`.
 */
export default function TodoList({
  collapsible = true,
  defaultExpanded = false,
}: {
  collapsible?: boolean;
  defaultExpanded?: boolean;
}) {
  const todos = useStore((s) => s.todos);
  const [expanded, setExpanded] = useState(defaultExpanded);
  if (todos.length === 0) return null;

  const done = todos.filter((t) => t.status === "completed").length;
  const inFlight = todos.find((t) => t.status === "in_progress");
  const showList = !collapsible || expanded;

  const summary = (
    <span className="tasks-inline-summary">
      <span style={{ opacity: 0.6 }}>
        Tasks {done}/{todos.length}
      </span>
      {inFlight && (
        <span className="tasks-inline-active">
          <span title="In progress" role="img" aria-label="In progress">
            ▶
          </span>{" "}
          {inFlight.activeForm}
        </span>
      )}
    </span>
  );

  return (
    <div className="tasks-inline">
      {collapsible ? (
        <button type="button" className="tasks-inline-toggle" onClick={() => setExpanded((v) => !v)}>
          {summary}
          <span style={{ fontSize: 10, opacity: 0.5 }}>{expanded ? "▾" : "▸"}</span>
        </button>
      ) : (
        <div className="tasks-inline-toggle" style={{ cursor: "default" }}>
          {summary}
        </div>
      )}
      {showList && (
        <div className="tasks-inline-list">
          {todos.map((t) => {
            const icon = t.status === "completed" ? "✓" : t.status === "in_progress" ? "▶" : "·";
            const stateLabel =
              t.status === "completed"
                ? "Completed"
                : t.status === "in_progress"
                  ? "In progress"
                  : "Pending";
            const color =
              t.status === "completed"
                ? "var(--text-dim)"
                : t.status === "in_progress"
                  ? "var(--accent, #a78bfa)"
                  : "var(--text-primary)";
            const label = t.status === "in_progress" ? t.activeForm : t.content;
            return (
              <div key={`${t.content} ${t.activeForm}`} className="tasks-inline-item" style={{ color }}>
                <span
                  title={stateLabel}
                  role="img"
                  aria-label={stateLabel}
                  style={{ fontFamily: "var(--font-mono-stack)", fontSize: 11 }}
                >
                  {icon}
                </span>
                <span style={{ textDecoration: t.status === "completed" ? "line-through" : "none" }}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
