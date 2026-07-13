"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { FlowStep } from "@gate15/api-types";
import { useStore } from "@/lib/store";
import { toast } from "@/lib/toast";
import {
  listFlowsApi,
  createFlowApi,
  deleteFlowApi,
  runFlowApi,
  type ProjectFlow,
} from "@/lib/api";

/**
 * P2 live "Preview (Agent)" view. Renders the agent driving the running app
 * frame-by-frame — the screenshot stream from `interact_preview` / `run_flow`
 * (the `agent_preview_frame` WS events the store collects in `agentPreview`) —
 * so the user watches the interaction happen, like a screen-share, instead of an
 * opaque "Interact Preview" tool row.
 *
 * Below the live view is the saved smoke-flow library (P2.4): replay a flow
 * one-click (streams back into this same view) or describe a new one. Each flow
 * carries a compact evidence card — the last replay's pass/fail.
 */

const STEP_TYPES: FlowStep["type"][] = [
  "navigate",
  "click",
  "type",
  "fill",
  "select",
  "press",
  "scroll",
  "wait",
  "wait_for_text",
  "assert_text",
  "assert_url",
  "assert_visible",
];

const needsSelector = (t: FlowStep["type"]): boolean =>
  ["click", "type", "fill", "select", "press", "assert_visible"].includes(t);
const needsValue = (t: FlowStep["type"]): boolean =>
  ["type", "fill", "select", "press", "wait_for_text", "assert_text", "assert_url"].includes(t);

function statusColor(status: string | null): string {
  if (status === "pass") return "var(--conf-high)";
  if (status === "fail") return "var(--conf-medium)";
  if (status === "error") return "var(--conf-low)";
  return "var(--text-muted)";
}

export default function AgentPreviewPanel() {
  const agentPreview = useStore((s) => s.agentPreview);
  const previews = useStore((s) => s.previews);
  const projectId = useStore((s) => s.project?.id ?? null);
  const markSeen = useStore((s) => s.markAgentPreviewSeen);

  const { frames, active, flowName, callId } = agentPreview;

  // Mark the tab seen on mount (it's only mounted when active) so the badge clears.
  useEffect(() => {
    markSeen();
  }, [markSeen, frames.length]);

  // Which frame to show. `pinned === null` follows the latest (live); clicking a
  // thumbnail pins it. A new run (callId change) resumes following.
  const [pinned, setPinned] = useState<number | null>(null);
  useEffect(() => {
    setPinned(null);
  }, [callId]);

  // When following (not pinned), show the most recent frame that actually has an
  // image — the final "done" frame can be imageless if its screenshot failed.
  const lastWithImage = (() => {
    for (let i = frames.length - 1; i >= 0; i--) if (frames[i].image) return frames[i];
    return undefined;
  })();
  const shown =
    pinned !== null && frames[pinned]
      ? frames[pinned]
      : (lastWithImage ?? frames[frames.length - 1]);
  const following = pinned === null;

  // ── Saved flows ───────────────────────────────────────────────────────────
  const [flows, setFlows] = useState<ProjectFlow[]>([]);
  const [runningFlowId, setRunningFlowId] = useState<string | null>(null);
  const server = previews[0] ?? null;

  const refreshFlows = useCallback(() => {
    if (!projectId) return;
    listFlowsApi(projectId)
      .then((r) => setFlows(r.flows))
      .catch(() => {});
  }, [projectId]);

  useEffect(() => {
    refreshFlows();
  }, [refreshFlows]);

  // When an agent-driven run finishes, a saved flow's last_status may have just
  // changed — refresh so the evidence cards stay current.
  const wasActive = useRef(active);
  useEffect(() => {
    if (wasActive.current && !active) refreshFlows();
    wasActive.current = active;
  }, [active, refreshFlows]);

  const replay = useCallback(
    (flow: ProjectFlow) => {
      if (!projectId) return;
      if (!server) {
        toast.info("Start the app (Run) before replaying a flow.");
        return;
      }
      setRunningFlowId(flow.id);
      runFlowApi(projectId, flow.id, { server_id: server.id })
        .then((r) => {
          const msg = `Flow “${flow.name}” — ${r.status.toUpperCase()} (${r.summary})`;
          if (r.status === "pass") toast.success(msg);
          else toast.error(msg);
          refreshFlows();
        })
        .catch((e) => toast.error(e instanceof Error ? e.message : "Flow replay failed"))
        .finally(() => setRunningFlowId(null));
    },
    [projectId, server, refreshFlows],
  );

  const remove = useCallback(
    (flow: ProjectFlow) => {
      if (!projectId) return;
      deleteFlowApi(projectId, flow.id)
        .then(() => refreshFlows())
        .catch(() => {});
    },
    [projectId, refreshFlows],
  );

  const [composing, setComposing] = useState(false);

  return (
    <div style={wrap}>
      {/* ── Live view ─────────────────────────────────────────────────────── */}
      <div style={stage}>
        <div style={stageBar}>
          <span style={liveDot(active)} />
          <span style={{ fontWeight: 600, fontSize: 12 }}>
            {active ? "Agent is interacting" : frames.length ? "Last interaction" : "Preview (Agent)"}
          </span>
          {flowName && (
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>· flow “{flowName}”</span>
          )}
          {shown && (
            <span style={urlPill} title={shown.url}>
              {shown.url}
            </span>
          )}
          {!following && active && (
            <button type="button" className="btn-secondary" style={jumpBtn} onClick={() => setPinned(null)}>
              ● Jump to live
            </button>
          )}
        </div>

        <div style={canvas}>
          {shown && shown.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`data:${shown.mime};base64,${shown.image}`}
              alt={shown.label}
              style={frameImg}
            />
          ) : (
            <div style={emptyState}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>🖱️</div>
              <h3 style={{ margin: "0 0 6px", fontSize: 15 }}>Watch the agent use your app</h3>
              <p style={{ margin: 0, fontSize: 13, color: "var(--text-dim)", lineHeight: 1.6, maxWidth: 360 }}>
                When the agent tests a change — filling a form, signing in, clicking through a
                flow — each step shows up here live, like a screen-share. You can also replay a
                saved flow below.
              </p>
            </div>
          )}
        </div>

        {shown && (
          <div style={caption}>
            <span style={stepBadge(shown.ok)}>{shown.ok ? "✓" : "✗"}</span>
            <span style={{ fontSize: 12, fontWeight: 500 }}>{shown.label}</span>
            {shown.detail && (
              <span style={{ fontSize: 11, color: "var(--conf-low)" }}>— {shown.detail}</span>
            )}
            <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-muted)" }}>
              step {(pinned ?? frames.length - 1) + 1} / {frames.length}
            </span>
          </div>
        )}

        {frames.length > 1 && (
          <div style={filmstrip}>
            {frames.map((f, i) => {
              const isActive = (pinned ?? frames.length - 1) === i;
              return (
                <button
                  key={`${f.seq}-${i}`}
                  type="button"
                  onClick={() => setPinned(i)}
                  title={f.label}
                  style={thumbBtn(isActive, f.ok)}
                >
                  {f.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`data:${f.mime};base64,${f.image}`} alt={f.label} style={thumbImg} />
                  ) : (
                    <span style={{ fontSize: 10 }}>—</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Saved flows (P2.4) ────────────────────────────────────────────── */}
      <div style={flowsPanel}>
        <div style={flowsHeader}>
          <span style={{ fontWeight: 600, fontSize: 12 }}>Saved flows</span>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            replayable checks the agent can re-run
          </span>
          <button
            type="button"
            className="btn-secondary"
            style={{ marginLeft: "auto", fontSize: 11, padding: "3px 9px" }}
            onClick={() => setComposing((v) => !v)}
          >
            {composing ? "Cancel" : "+ Describe a flow"}
          </button>
        </div>

        {composing && (
          <FlowComposer
            disabled={!projectId}
            onSave={async (draft) => {
              if (!projectId) return;
              try {
                await createFlowApi(projectId, draft);
                toast.success(`Saved flow “${draft.name}”`);
                setComposing(false);
                refreshFlows();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Could not save flow");
              }
            }}
          />
        )}

        {flows.length === 0 && !composing ? (
          <p style={{ margin: "8px 2px", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
            No saved flows yet. The agent saves one after it verifies a multi-step feature, or you
            can describe one above. Replaying a flow re-drives it and reports pass/fail.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {flows.map((flow) => (
              <div key={flow.id} style={flowRow}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {flow.name}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {flow.steps.length} steps
                    </span>
                    {flow.last_status && (
                      <span style={evidenceBadge(flow.last_status)} title={flow.last_summary ?? ""}>
                        {flow.last_status}
                      </span>
                    )}
                  </div>
                  {flow.description && (
                    <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {flow.description}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ fontSize: 11, padding: "4px 10px" }}
                  disabled={runningFlowId !== null || !server}
                  title={server ? "Replay this flow against the running app" : "Start the app first"}
                  onClick={() => replay(flow)}
                >
                  {runningFlowId === flow.id ? "Replaying…" : "▶ Replay"}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ fontSize: 11, padding: "4px 8px" }}
                  title="Delete flow"
                  onClick={() => remove(flow)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Flow composer (describe a flow) ──────────────────────────────────────────

function FlowComposer({
  onSave,
  disabled,
}: {
  onSave: (draft: { name: string; description?: string; steps: FlowStep[]; start_path?: string }) => void;
  disabled?: boolean;
}) {
  const [name, setName] = useState("");
  const [startPath, setStartPath] = useState("");
  const [steps, setSteps] = useState<FlowStep[]>([{ type: "click", selector: "" }]);

  const update = (i: number, patch: Partial<FlowStep>) =>
    setSteps((s) => s.map((st, idx) => (idx === i ? { ...st, ...patch } : st)));
  const addStep = () => setSteps((s) => [...s, { type: "click", selector: "" }]);
  const removeStep = (i: number) => setSteps((s) => (s.length > 1 ? s.filter((_, idx) => idx !== i) : s));

  const valid = name.trim().length > 0 && steps.length > 0;

  return (
    <div style={composer}>
      <input
        style={input}
        placeholder="Flow name (e.g. “sign up + log in”)"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        style={input}
        placeholder="Start path (optional, e.g. /login)"
        value={startPath}
        onChange={(e) => setStartPath(e.target.value)}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 2 }}>
        {steps.map((st, i) => (
          <div key={i} style={{ display: "flex", gap: 5, alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)", width: 16, textAlign: "right" }}>
              {i + 1}
            </span>
            <select
              style={{ ...input, width: 120, flex: "none" }}
              value={st.type}
              onChange={(e) => update(i, { type: e.target.value as FlowStep["type"] })}
            >
              {STEP_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            {st.type === "navigate" ? (
              <input
                style={input}
                placeholder="url or /path"
                value={st.url ?? ""}
                onChange={(e) => update(i, { url: e.target.value })}
              />
            ) : (
              <>
                {needsSelector(st.type) && (
                  <input
                    style={input}
                    placeholder="CSS selector"
                    value={st.selector ?? ""}
                    onChange={(e) => update(i, { selector: e.target.value })}
                  />
                )}
                {needsValue(st.type) && (
                  <input
                    style={input}
                    placeholder={st.type === "press" ? "key (Enter)" : "value / text"}
                    value={st.value ?? ""}
                    onChange={(e) => update(i, { value: e.target.value })}
                  />
                )}
              </>
            )}
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: 11, padding: "3px 7px", flex: "none" }}
              onClick={() => removeStep(i)}
              title="Remove step"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
        <button type="button" className="btn-secondary" style={{ fontSize: 11, padding: "4px 10px" }} onClick={addStep}>
          + Step
        </button>
        <button
          type="button"
          className="btn-secondary"
          style={{ fontSize: 11, padding: "4px 12px", marginLeft: "auto", opacity: valid && !disabled ? 1 : 0.5 }}
          disabled={!valid || disabled}
          onClick={() =>
            onSave({
              name: name.trim(),
              description: undefined,
              steps,
              start_path: startPath.trim() || undefined,
            })
          }
        >
          Save flow
        </button>
      </div>
    </div>
  );
}

// ── styles ───────────────────────────────────────────────────────────────────

const wrap: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  minHeight: 0,
  background: "var(--bg-base)",
};
const stage: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  flex: 1,
};
const stageBar: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 12px",
  borderBottom: "1px solid var(--border-default)",
};
const urlPill: CSSProperties = {
  fontSize: 11,
  fontFamily: "var(--font-mono-stack, ui-monospace, Menlo, monospace)",
  color: "var(--text-muted)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  maxWidth: 320,
};
const jumpBtn: CSSProperties = {
  marginLeft: "auto",
  fontSize: 11,
  padding: "3px 9px",
  color: "var(--conf-low)",
};
const canvas: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "auto",
  background: "var(--bg-code)",
  padding: 10,
};
const frameImg: CSSProperties = {
  maxWidth: "100%",
  maxHeight: "100%",
  objectFit: "contain",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-default)",
  boxShadow: "0 8px 28px rgba(0,0,0,0.35)",
};
const emptyState: CSSProperties = {
  textAlign: "center",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  padding: 24,
};
const caption: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "7px 12px",
  borderTop: "1px solid var(--border-default)",
};
const filmstrip: CSSProperties = {
  display: "flex",
  gap: 6,
  padding: "8px 12px",
  overflowX: "auto",
  borderTop: "1px solid var(--border-default)",
  background: "var(--bg-surface)",
};
const flowsPanel: CSSProperties = {
  borderTop: "1px solid var(--border-default)",
  padding: "10px 12px",
  maxHeight: "38%",
  overflowY: "auto",
  background: "var(--bg-surface)",
  flex: "none",
};
const flowsHeader: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 8,
};
const flowRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "7px 9px",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-sm)",
  background: "var(--bg-base)",
};
const composer: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: 10,
  marginBottom: 10,
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-sm)",
  background: "var(--bg-base)",
};
const input: CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: 12,
  padding: "6px 8px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-default)",
  background: "var(--bg-elev)",
  color: "var(--text-primary)",
};

const liveDot = (on: boolean): CSSProperties => ({
  width: 8,
  height: 8,
  borderRadius: "50%",
  flex: "none",
  background: on ? "var(--conf-low)" : "var(--text-muted)",
  animation: on ? "pulse-dot 1.4s ease-in-out infinite" : "none",
});
const stepBadge = (ok: boolean): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 16,
  height: 16,
  borderRadius: "50%",
  fontSize: 10,
  flex: "none",
  color: "#fff",
  background: ok ? "var(--conf-high)" : "var(--conf-low)",
});
const thumbBtn = (active: boolean, ok: boolean): CSSProperties => ({
  flex: "none",
  width: 96,
  height: 60,
  padding: 0,
  borderRadius: "var(--radius-sm)",
  overflow: "hidden",
  cursor: "pointer",
  background: "var(--bg-code)",
  border: `2px solid ${active ? "var(--accent-primary)" : ok ? "var(--border-default)" : "var(--conf-low)"}`,
});
const thumbImg: CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block",
};
const evidenceBadge = (status: string): CSSProperties => ({
  fontSize: 10,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  padding: "1px 6px",
  borderRadius: 999,
  color: statusColor(status),
  border: `1px solid ${statusColor(status)}`,
});
