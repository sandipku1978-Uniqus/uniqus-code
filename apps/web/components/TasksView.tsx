"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentTask, AgentTaskStatus } from "@uniqus/api-types";
import { fetchAgentTasksApi, createAgentTaskApi, cancelAgentTaskApi } from "@/lib/api";
import { toast } from "@/lib/toast";

/**
 * Durable agent-task queue (P8.1). Surfaces the persisted task queue for a
 * project: each task is an editorial row with a labelled status pill, title,
 * truncated prompt, optional mono branch, and optional acceptance criteria. A
 * create form enqueues a new task; queued/running tasks can be canceled.
 *
 * HONESTY: enqueuing a task only persists it. Actually *executing* queued tasks
 * needs the async task runner, which is OFF by default — so queued tasks do NOT
 * run automatically. A muted note near the queue says so; we never imply
 * otherwise. The view poll-refreshes (~5s) only while a task is queued/running
 * so a runner (if enabled) and external status changes are reflected live.
 *
 * House design: hairline-divided rows, mono uppercase micro-labels, magenta the
 * only brand accent, status carried by a labelled pill (running=magenta,
 * done=muted-green via --text-muted, failed=danger via --conf-low).
 */

const POLL_MS = 5000;

const STATUS_LABEL: Record<AgentTaskStatus, string> = {
  queued: "queued",
  running: "running",
  done: "done",
  failed: "failed",
  canceled: "canceled",
};

/** Pill colour by status, tokens only. */
function statusColor(status: AgentTaskStatus): string {
  switch (status) {
    case "running":
      return "var(--brand-magenta)";
    case "done":
      return "var(--conf-high)";
    case "failed":
      return "var(--conf-low)";
    case "canceled":
    case "queued":
    default:
      return "var(--text-dim)";
  }
}

function isActive(status: AgentTaskStatus): boolean {
  return status === "queued" || status === "running";
}

function truncate(s: string, max = 180): string {
  const t = s.trim();
  return t.length > max ? t.slice(0, max).trimEnd() + "…" : t;
}

export default function TasksView({ projectId }: { projectId: string }) {
  const [tasks, setTasks] = useState<AgentTask[] | null>(null);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [branch, setBranch] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [busy, setBusy] = useState(false);
  // Per-task cancel-in-flight set so canceling one task doesn't block canceling
  // another (a single id would silently no-op the second click).
  const [cancelingIds, setCancelingIds] = useState<Set<string>>(() => new Set());

  // Keep the latest load() in a ref so the polling interval (set up once) always
  // calls the current closure without re-creating the interval each render.
  const loadRef = useRef<() => Promise<void>>(async () => {});

  const load = useCallback(async () => {
    try {
      const { tasks } = await fetchAgentTasksApi(projectId);
      setTasks(tasks);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load tasks");
      setTasks((prev) => prev ?? []);
    }
  }, [projectId]);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasActive = useMemo(() => (tasks ?? []).some((t) => isActive(t.status)), [tasks]);

  // Poll only while something is in flight; clear on unmount / when it settles.
  useEffect(() => {
    if (!hasActive) return;
    const id = setInterval(() => {
      void loadRef.current();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [hasActive]);

  async function create() {
    const t = title.trim();
    const p = prompt.trim();
    if (!t || !p || busy) return;
    setBusy(true);
    try {
      await createAgentTaskApi(projectId, {
        title: t,
        prompt: p,
        branch: branch.trim() || undefined,
        acceptance_criteria: acceptance.trim() || undefined,
      });
      setTitle("");
      setPrompt("");
      setBranch("");
      setAcceptance("");
      toast.success("Task queued");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create task");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(task: AgentTask) {
    if (cancelingIds.has(task.id)) return;
    setCancelingIds((prev) => new Set(prev).add(task.id));
    try {
      await cancelAgentTaskApi(projectId, task.id);
      setTasks((prev) =>
        prev?.map((x) => (x.id === task.id ? { ...x, status: "canceled" } : x)) ?? null,
      );
      toast.success("Task canceled");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't cancel");
    } finally {
      setCancelingIds((prev) => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
    }
  }

  const eyebrow: React.CSSProperties = {
    fontFamily: "var(--font-mono)",
    fontSize: "var(--fs-2xs)",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "var(--text-dim)",
  };

  const microLabel: React.CSSProperties = {
    fontFamily: "var(--font-mono)",
    fontSize: "var(--fs-2xs)",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "var(--text-dim)",
  };

  const fieldStyle: React.CSSProperties = {
    width: "100%",
    background: "var(--bg-elev)",
    border: "1px solid var(--border-default)",
    borderRadius: "var(--radius-md)",
    color: "var(--text-primary)",
    padding: "8px 10px",
    fontSize: "var(--fs-md)",
  };

  const canCreate = !!title.trim() && !!prompt.trim() && !busy;
  const queuedCount = (tasks ?? []).filter((t) => t.status === "queued").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 640 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={eyebrow}>● Agent tasks</span>
        {tasks && (
          <span style={{ ...eyebrow, fontVariantNumeric: "tabular-nums" }}>
            {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
          </span>
        )}
      </div>

      {/* Create form */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          border: "1px solid var(--border-default)",
          borderRadius: "var(--radius-lg)",
          background: "var(--bg-surface)",
          padding: 14,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label htmlFor="task-title" style={microLabel}>
            Title
          </label>
          <input
            id="task-title"
            className="ui-input"
            placeholder="Short, descriptive task name"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={fieldStyle}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label htmlFor="task-prompt" style={microLabel}>
            Prompt
          </label>
          <textarea
            id="task-prompt"
            className="ui-input"
            placeholder="What should the agent do?"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            style={{ ...fieldStyle, resize: "vertical", lineHeight: 1.5 }}
          />
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 200 }}>
            <label htmlFor="task-branch" style={microLabel}>
              Branch (optional)
            </label>
            <input
              id="task-branch"
              className="ui-input"
              placeholder="feature/my-branch"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              style={{ ...fieldStyle, fontFamily: "var(--font-mono)" }}
            />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label htmlFor="task-acceptance" style={microLabel}>
            Acceptance criteria (optional)
          </label>
          <textarea
            id="task-acceptance"
            className="ui-input"
            placeholder="How do we know the task is done?"
            value={acceptance}
            onChange={(e) => setAcceptance(e.target.value)}
            rows={3}
            style={{ ...fieldStyle, resize: "vertical", lineHeight: 1.5 }}
          />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void create()}
            disabled={!canCreate}
          >
            {busy ? "Creating…" : "Create task"}
          </button>
        </div>
      </div>

      {/* Honesty note about the async runner */}
      {queuedCount > 0 && (
        <div style={{ ...eyebrow, color: "var(--text-dim)", textTransform: "none", letterSpacing: "normal" }}>
          Queued tasks run when the async task runner is enabled.
        </div>
      )}

      {/* Task list — hairline-divided editorial rows */}
      {tasks === null ? (
        <div style={eyebrow}>Loading…</div>
      ) : tasks.length === 0 ? (
        <div
          style={{
            border: "1px dashed var(--border-default)",
            borderRadius: "var(--radius-lg)",
            padding: 24,
            textAlign: "center",
            color: "var(--text-dim)",
            fontSize: "var(--fs-sm)",
          }}
        >
          No tasks yet. Queue one with the form above.
        </div>
      ) : (
        <div
          style={{
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-lg)",
            overflow: "hidden",
            background: "var(--bg-surface)",
          }}
        >
          {tasks.map((task, i) => {
            const color = statusColor(task.status);
            return (
              <div
                key={task.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  padding: "12px 14px",
                  borderTop: i === 0 ? "none" : "1px solid var(--border-light)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "var(--fs-2xs)",
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        color,
                        background: "color-mix(in srgb, currentColor 12%, transparent)",
                        border: "1px solid color-mix(in srgb, currentColor 30%, transparent)",
                        borderRadius: "var(--radius-full)",
                        padding: "3px 10px",
                        flex: "0 0 auto",
                      }}
                    >
                      {STATUS_LABEL[task.status]}
                    </span>
                    <span
                      style={{
                        color: "var(--text-primary)",
                        fontSize: "var(--fs-md)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        minWidth: 0,
                      }}
                    >
                      {task.title}
                    </span>
                  </div>

                  <div
                    style={{
                      color: "var(--text-muted)",
                      fontSize: "var(--fs-sm)",
                      lineHeight: 1.5,
                    }}
                  >
                    {truncate(task.prompt)}
                  </div>

                  {(task.branch || task.acceptance_criteria) && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 2 }}>
                      {task.branch && (
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                          <span style={microLabel}>Branch</span>
                          <span
                            style={{
                              fontFamily: "var(--font-mono)",
                              fontSize: "var(--fs-xs)",
                              color: "var(--text-muted)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {task.branch}
                          </span>
                        </div>
                      )}
                      {task.acceptance_criteria && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <span style={microLabel}>Acceptance</span>
                          <span
                            style={{
                              fontSize: "var(--fs-xs)",
                              color: "var(--text-dim)",
                              lineHeight: 1.5,
                            }}
                          >
                            {truncate(task.acceptance_criteria, 240)}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {task.status === "failed" && task.error && (
                    <div
                      style={{
                        fontSize: "var(--fs-xs)",
                        color: "var(--conf-low)",
                        lineHeight: 1.5,
                      }}
                    >
                      {truncate(task.error, 240)}
                    </div>
                  )}
                </div>

                {isActive(task.status) && (
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => void cancel(task)}
                    disabled={cancelingIds.has(task.id)}
                    style={{ flex: "0 0 auto", color: "var(--text-dim)", padding: "4px 10px" }}
                  >
                    {cancelingIds.has(task.id) ? "Canceling…" : "Cancel"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
