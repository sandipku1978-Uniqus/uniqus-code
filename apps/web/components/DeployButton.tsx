"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useStore } from "@/lib/store";
import {
  deployProjectApi,
  disconnectVercelApi,
  fetchVercelStatus,
  listDeploymentsApi,
  vercelOauthStartUrl,
  type DeploymentSummary,
  type VercelStatus,
} from "@/lib/api";
import type { DeploymentState } from "@uniqus/api-types";

type EnvRow = { id: number; key: string; value: string };
let envIdSeq = 1;

export default function DeployButton({ projectId }: { projectId: string }) {
  const live = useStore((s) => s.deployment);
  const [open, setOpen] = useState(false);

  const label = useMemo(() => {
    if (!live) return "Deploy";
    if (live.state === "READY") return "Live";
    if (live.state === "ERROR") return "Failed";
    if (live.state === "CANCELED") return "Canceled";
    return "Deploying…";
  }, [live]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="toggle-btn"
        title="Deploy this project to Vercel"
        data-on={live?.state === "READY"}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polygon points="12 2 22 22 2 22 12 2" />
        </svg>
        <span>{label}</span>
      </button>
      {open && <DeployModal projectId={projectId} onClose={() => setOpen(false)} />}
    </>
  );
}

function DeployModal({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const live = useStore((s) => s.deployment);
  const setDeployment = useStore((s) => s.setDeployment);
  const project = useStore((s) => s.project);
  const searchParams = useSearchParams();

  const [vercel, setVercel] = useState<VercelStatus | null>(null);
  const [history, setHistory] = useState<DeploymentSummary[] | null>(null);
  const [envRows, setEnvRows] = useState<EnvRow[]>([
    { id: envIdSeq++, key: "", value: "" },
  ]);
  const [target, setTarget] = useState<"production" | "preview">("production");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The Vercel callback redirects back with `?vercel=connected|error&...`.
  // Refresh status whenever that flag changes so the modal reflects the
  // post-callback state without a manual reload.
  const vercelFlag = searchParams?.get("vercel") ?? null;

  useEffect(() => {
    fetchVercelStatus()
      .then(setVercel)
      .catch(() =>
        setVercel({ connected: false, user_login: null, team_id: null, connected_at: null }),
      );
  }, [vercelFlag]);

  useEffect(() => {
    listDeploymentsApi(projectId)
      .then((r) => setHistory(r.deployments))
      .catch(() => setHistory([]));
  }, [projectId, live?.state]);

  // If the user just completed an OAuth dance, surface error reason if any.
  useEffect(() => {
    if (vercelFlag === "error") {
      const reason = searchParams?.get("reason") ?? "unknown";
      setError(`Vercel connect failed: ${reason}`);
    }
  }, [vercelFlag, searchParams]);

  function startConnect(): void {
    if (typeof window === "undefined") return;
    // Bring the user back to the workspace — same path they're on now —
    // so the modal can re-open cleanly via the connected/error flag.
    window.location.href = vercelOauthStartUrl(window.location.href);
  }

  async function disconnect(): Promise<void> {
    try {
      await disconnectVercelApi();
      setVercel({ connected: false, user_login: null, team_id: null, connected_at: null });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deployNow(): Promise<void> {
    setError(null);
    if (!vercel?.connected) {
      setError("Connect Vercel first.");
      return;
    }
    const env: Record<string, string> = {};
    for (const r of envRows) {
      const k = r.key.trim();
      const v = r.value;
      if (!k && !v) continue;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
        setError(
          `env key "${k || "(empty)"}" is invalid — must match [A-Za-z_][A-Za-z0-9_]*`,
        );
        return;
      }
      env[k] = v;
    }
    setBusy(true);
    try {
      const r = await deployProjectApi(projectId, { env, target });
      setDeployment({
        id: r.deployment_id,
        state: r.state,
        vercel_url: r.vercel_url ?? null,
        error_message: null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // Close on Escape so the modal feels like a dialog, not a stuck panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 100,
        display: "grid",
        placeItems: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(560px, 92vw)",
          maxHeight: "85vh",
          overflow: "auto",
          background: "var(--bg-base, #0c0c10)",
          border: "1px solid var(--border-default)",
          borderRadius: 10,
          padding: 18,
          color: "var(--text-primary)",
          boxShadow: "0 24px 48px rgba(0,0,0,0.6)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <h2 style={{ fontSize: 16, margin: 0 }}>
            Deploy <span style={{ color: "var(--text-muted)" }}>{project?.name}</span>
          </h2>
          <button onClick={onClose} className="btn-ghost" style={{ fontSize: 12 }}>
            Close
          </button>
        </div>

        {/* Vercel connection */}
        {vercel === null ? (
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            checking Vercel connection…
          </div>
        ) : vercel.connected ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 10px",
              border: "1px solid var(--border-default)",
              borderRadius: 6,
              background: "var(--bg-elev)",
              marginBottom: 12,
            }}
          >
            <span style={{ fontSize: 12 }}>
              Connected as{" "}
              <strong>@{vercel.user_login || "vercel"}</strong>
              {vercel.team_id ? (
                <span style={{ color: "var(--text-muted)" }}> · team scope</span>
              ) : (
                <span style={{ color: "var(--text-muted)" }}> · personal scope</span>
              )}
            </span>
            <button
              type="button"
              onClick={disconnect}
              className="btn-ghost"
              style={{ fontSize: 11 }}
            >
              Disconnect
            </button>
          </div>
        ) : (
          <div
            style={{
              padding: "10px 12px",
              border: "1px dashed var(--border-default)",
              borderRadius: 6,
              marginBottom: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Connect Vercel to deploy this project to your account.
            </span>
            <button
              type="button"
              className="btn-primary"
              onClick={startConnect}
              style={{ fontSize: 12, padding: "6px 10px" }}
            >
              Connect Vercel
            </button>
          </div>
        )}

        {/* Live deploy banner — only when there's an in-progress / latest deploy. */}
        {live && (
          <div
            style={{
              padding: "8px 10px",
              border: "1px solid var(--border-default)",
              borderRadius: 6,
              marginBottom: 12,
              fontSize: 12,
              background:
                live.state === "READY"
                  ? "rgba(80, 200, 120, 0.08)"
                  : live.state === "ERROR"
                  ? "rgba(220, 90, 90, 0.08)"
                  : "var(--bg-elev)",
            }}
          >
            <div>
              <strong>{stateLabel(live.state)}</strong>
              {live.vercel_url && (
                <>
                  {" · "}
                  <a
                    href={`https://${live.vercel_url}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {live.vercel_url}
                  </a>
                </>
              )}
            </div>
            {live.error_message && (
              <div style={{ color: "var(--conf-low)", marginTop: 6 }}>
                {live.error_message}
              </div>
            )}
          </div>
        )}

        {/* Env editor */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
            Environment variables — applied to the deployed app
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {envRows.map((r, idx) => (
              <div key={r.id} style={{ display: "flex", gap: 6 }}>
                <input
                  value={r.key}
                  onChange={(e) =>
                    setEnvRows((rows) =>
                      rows.map((x, i) =>
                        i === idx ? { ...x, key: e.target.value } : x,
                      ),
                    )
                  }
                  placeholder="KEY"
                  style={{
                    ...modalFieldStyle,
                    flex: "0 0 36%",
                    fontFamily: "monospace",
                    textTransform: "none",
                  }}
                  disabled={busy}
                />
                <input
                  value={r.value}
                  onChange={(e) =>
                    setEnvRows((rows) =>
                      rows.map((x, i) =>
                        i === idx ? { ...x, value: e.target.value } : x,
                      ),
                    )
                  }
                  placeholder="value"
                  style={{ ...modalFieldStyle, flex: 1 }}
                  disabled={busy}
                />
                <button
                  type="button"
                  onClick={() =>
                    setEnvRows((rows) =>
                      rows.length === 1
                        ? [{ id: envIdSeq++, key: "", value: "" }]
                        : rows.filter((_, i) => i !== idx),
                    )
                  }
                  className="btn-ghost"
                  style={{ fontSize: 11, padding: "0 8px" }}
                  disabled={busy}
                  title="Remove row"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() =>
              setEnvRows((rows) => [...rows, { id: envIdSeq++, key: "", value: "" }])
            }
            className="btn-ghost"
            style={{ fontSize: 11, marginTop: 6 }}
            disabled={busy}
          >
            + Add variable
          </button>
        </div>

        {/* Target */}
        <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
          {(["production", "preview"] as const).map((t) => (
            <label
              key={t}
              style={{
                fontSize: 12,
                display: "flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
              }}
            >
              <input
                type="radio"
                name="deploy-target"
                value={t}
                checked={target === t}
                onChange={() => setTarget(t)}
                disabled={busy}
              />
              {t === "production" ? "Production" : "Preview (one-off URL)"}
            </label>
          ))}
        </div>

        {error && (
          <div
            style={{
              color: "var(--conf-low)",
              fontSize: 12,
              marginBottom: 10,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={deployNow}
            className="btn-primary"
            disabled={busy || !vercel?.connected}
          >
            {busy ? "Deploying…" : "Deploy now"}
          </button>
        </div>

        {/* History */}
        {history && history.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div
              style={{
                fontSize: 12,
                color: "var(--text-muted)",
                marginBottom: 6,
              }}
            >
              Recent deploys
            </div>
            <div style={{ display: "grid", gap: 4 }}>
              {history.slice(0, 6).map((d) => (
                <div
                  key={d.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    fontSize: 11,
                    padding: "6px 8px",
                    border: "1px solid var(--border-default)",
                    borderRadius: 4,
                  }}
                >
                  <span>
                    <strong>{stateLabel(d.state)}</strong>
                    <span style={{ color: "var(--text-muted)" }}>
                      {" "}
                      · {d.target}
                    </span>
                  </span>
                  {d.vercel_url ? (
                    <a
                      href={`https://${d.vercel_url}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {d.vercel_url}
                    </a>
                  ) : (
                    <span style={{ color: "var(--text-muted)" }}>(no url yet)</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function stateLabel(state: DeploymentState): string {
  switch (state) {
    case "READY":
      return "Live";
    case "ERROR":
      return "Failed";
    case "CANCELED":
      return "Canceled";
    case "BUILDING":
      return "Building";
    case "QUEUED":
      return "Queued";
  }
}

const modalFieldStyle: React.CSSProperties = {
  background: "var(--bg-elev)",
  border: "1px solid var(--border-default)",
  borderRadius: 6,
  padding: "6px 8px",
  color: "var(--text-primary)",
  fontSize: 12,
  fontFamily: "inherit",
};
