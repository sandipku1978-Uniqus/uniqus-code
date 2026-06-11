"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useStore } from "@/lib/store";
import {
  deployProjectApi,
  disconnectVercelApi,
  downloadProjectZipApi,
  fetchDeployTargetApi,
  fetchSecretsApi,
  fetchVercelStatus,
  flyDeployApi,
  listDeploymentsApi,
  vercelOauthStartUrl,
  type DeploymentSummary,
  type DeployTargetSummary,
  type VercelStatus,
} from "@/lib/api";
import type { DeploymentState } from "@uniqus/api-types";
import Modal from "./Modal";
import { toast } from "@/lib/toast";

type EnvRow = { id: number; key: string; value: string };
let envIdSeq = 1;

export default function DeployButton({
  projectId,
  label: restingLabel = "Deploy",
}: {
  projectId: string;
  /**
   * Word shown on the resting button before anything is deployed. Defaults to
   * "Deploy"; the beginner-facing Builder view passes "Publish". Only the
   * resting `!live` case uses it — every live/error state stays verbatim so
   * deploy status remains truthful.
   */
  label?: string;
}) {
  const live = useStore((s) => s.deployment);
  const redeploySuggested = useStore((s) => s.redeploySuggested);
  const setRedeploySuggested = useStore((s) => s.setRedeploySuggested);
  const [open, setOpen] = useState(false);

  // Lift the Vercel-connected status to the resting button so the prerequisite
  // is discoverable BEFORE the modal opens — the user shouldn't have to open
  // the dialog and click "Deploy" only to be told "Connect Vercel first".
  const [vercel, setVercel] = useState<VercelStatus | null>(null);

  useEffect(() => {
    let cancel = false;
    fetchVercelStatus()
      .then((s) => {
        if (!cancel) setVercel(s);
      })
      .catch(() => {
        if (!cancel)
          setVercel({ connected: false, user_login: null, team_id: null, connected_at: null });
      });
    return () => {
      cancel = true;
    };
  }, []);

  const needsVercel = vercel !== null && !vercel.connected;

  const label = useMemo(() => {
    if (needsVercel) return "Connect Vercel";
    if (!live) return restingLabel;
    if (live.state === "READY") return "Redeploy";
    if (live.state === "ERROR") return "Failed";
    if (live.state === "CANCELED") return "Canceled";
    return "Deploying…";
  }, [needsVercel, live, restingLabel]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setRedeploySuggested(false);
          setOpen(true);
        }}
        className="toggle-btn"
        title={
          needsVercel
            ? "Connect Vercel to deploy this project"
            : "Deploy this project to Vercel"
        }
        data-on={live?.state === "READY"}
        data-suggested={redeploySuggested || undefined}
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
      {open && (
        <DeployModal
          projectId={projectId}
          initialVercel={vercel}
          onVercelChange={setVercel}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function DeployModal({
  projectId,
  initialVercel,
  onVercelChange,
  onClose,
}: {
  projectId: string;
  initialVercel: VercelStatus | null;
  onVercelChange: (status: VercelStatus) => void;
  onClose: () => void;
}) {
  const live = useStore((s) => s.deployment);
  const setDeployment = useStore((s) => s.setDeployment);
  const setRedeploySuggested = useStore((s) => s.setRedeploySuggested);
  const project = useStore((s) => s.project);
  const searchParams = useSearchParams();

  // Seed from the status the button already fetched so the modal opens without
  // a "checking…" flash; still re-fetch on the post-OAuth flag below.
  const [vercel, setVercelState] = useState<VercelStatus | null>(initialVercel);
  const [history, setHistory] = useState<DeploymentSummary[] | null>(null);
  const [envRows, setEnvRows] = useState<EnvRow[]>([
    { id: envIdSeq++, key: "", value: "" },
  ]);
  const [target, setTarget] = useState<"production" | "preview">("production");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Confirmations (UI/UX audit §D): unlinking Vercel and shipping to production
  // both deserve a deliberate step.
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [confirmProd, setConfirmProd] = useState(false);
  // Names of the project's existing secrets, for the "Add from Secrets" picker.
  const [secretNames, setSecretNames] = useState<string[]>([]);
  // "Take your code with you" handoff (E2/E3).
  const [downloading, setDownloading] = useState(false);
  const [embedCopied, setEmbedCopied] = useState(false);
  // Project shape → which deploy target fits (E1). When the shape needs a
  // long-running container (python/go/node-server), surface the Fly.io path
  // (the adapter + API already exist; only this UI was missing).
  const [deployTarget, setDeployTarget] = useState<DeployTargetSummary | null>(null);
  const [flyAppName, setFlyAppName] = useState("");
  const [flyRegion, setFlyRegion] = useState("");
  const [flyBusy, setFlyBusy] = useState(false);

  useEffect(() => {
    fetchDeployTargetApi(projectId)
      .then(setDeployTarget)
      .catch(() => setDeployTarget(null));
  }, [projectId]);

  async function deployFly(): Promise<void> {
    const name = flyAppName.trim();
    if (!/^[a-z0-9-]{2,30}$/.test(name)) {
      setError("App name must be 2–30 chars: lowercase letters, numbers, dashes.");
      return;
    }
    setError(null);
    const env: Record<string, string> = {};
    for (const r of envRows) {
      const k = r.key.trim();
      if (!k && !r.value) continue;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
        setError(`env key "${k || "(empty)"}" is invalid — must match [A-Za-z_][A-Za-z0-9_]*`);
        return;
      }
      env[k] = r.value;
    }
    setFlyBusy(true);
    try {
      const r = await flyDeployApi(projectId, {
        app_name: name,
        region: flyRegion.trim() || undefined,
        env_vars: env,
      });
      if (r.ok) toast.success(`Deployed to ${r.url}`);
      else toast.error("Fly deploy did not complete");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error(`Fly deploy failed: ${msg}`);
    } finally {
      setFlyBusy(false);
    }
  }

  const downloadZip = async () => {
    setDownloading(true);
    try {
      await downloadProjectZipApi(projectId, project?.name ?? "project");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  };

  const deployedUrl = live?.state === "READY" && live.vercel_url ? `https://${live.vercel_url}` : null;
  const embedSnippet = deployedUrl
    ? `<iframe src="${deployedUrl}" width="100%" height="600" style="border:0" loading="lazy" title="${(project?.name ?? "app").replace(/"/g, "")}"></iframe>`
    : "";
  const copyEmbed = () => {
    navigator.clipboard
      ?.writeText(embedSnippet)
      .then(() => {
        setEmbedCopied(true);
        window.setTimeout(() => setEmbedCopied(false), 1500);
      })
      .catch(() => toast.error("Couldn't copy"));
  };

  // Keep the resting button's status in sync with whatever the modal learns.
  function setVercel(status: VercelStatus): void {
    setVercelState(status);
    onVercelChange(status);
  }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vercelFlag]);

  useEffect(() => {
    listDeploymentsApi(projectId)
      .then((r) => setHistory(r.deployments))
      .catch(() => setHistory([]));
  }, [projectId, live?.state]);

  // Pull the project's secret NAMES (never values — those stay server-side) so
  // the user can wire a deploy env var to an existing secret in one click,
  // instead of re-typing the same credentials in two places (§D).
  useEffect(() => {
    fetchSecretsApi(projectId)
      .then((r) => setSecretNames(Array.from(new Set(r.secrets.map((s) => s.name)))))
      .catch(() => setSecretNames([]));
  }, [projectId]);

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
    setConfirmDisconnect(false);
    try {
      await disconnectVercelApi();
      setVercel({ connected: false, user_login: null, team_id: null, connected_at: null });
      toast.success("Vercel disconnected");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error(`Couldn't disconnect Vercel: ${msg}`);
    }
  }

  // Entry point for the Deploy/Retry buttons: production deploys go through a
  // confirm first; preview deploys ship immediately.
  function requestDeploy(): void {
    if (target === "production") {
      setConfirmProd(true);
      return;
    }
    void deployNow();
  }

  async function deployNow(): Promise<void> {
    setConfirmProd(false);
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
      setRedeploySuggested(false);
      setDeployment({
        id: r.deployment_id,
        state: r.state,
        vercel_url: r.vercel_url ?? null,
        error_message: null,
        inspector_url: r.inspector_url ?? null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error(`Deploy failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  // Append a deploy env row keyed to an existing project secret. The value is
  // left for the user (secret values are never returned to the client).
  function addEnvFromSecret(name: string): void {
    if (!name) return;
    setEnvRows((rows) => {
      const filtered = rows.filter((r) => r.key.trim() || r.value.trim());
      return [...filtered, { id: envIdSeq++, key: name, value: "" }];
    });
  }

  return (
    <>
    <Modal
      title={
        <>
          Deploy <span style={{ color: "var(--text-muted)" }}>{project?.name}</span>
        </>
      }
      onClose={onClose}
      width={560}
      footer={
        <div className="modal-actions">
          <button
            type="button"
            onClick={requestDeploy}
            className="btn-primary"
            disabled={busy || !vercel?.connected}
          >
            {busy
              ? "Deploying…"
              : target === "production"
              ? "Deploy to production"
              : "Deploy preview"}
          </button>
        </div>
      }
    >
      {/* Fly.io branch (E1): the project shape needs a long-running container,
          which Vercel's serverless model can't host. The adapter already
          exists server-side — this surfaces it. */}
      {deployTarget?.recommended === "fly" && (
        <div
          style={{
            padding: "10px 12px",
            border: "1px solid var(--brand-magenta, #c026d3)",
            borderRadius: 6,
            marginBottom: 12,
            background: "color-mix(in srgb, var(--brand-magenta, #c026d3) 6%, transparent)",
          }}
        >
          <div style={{ fontSize: 12, marginBottom: 8 }}>
            This is a <strong>{deployTarget.shape}</strong> app — it needs a long-running
            container, which Vercel can&apos;t host. Deploy it to <strong>Fly.io</strong> instead.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <input
              type="text"
              value={flyAppName}
              onChange={(e) => setFlyAppName(e.target.value)}
              placeholder="app-name (a–z, 0–9, -)"
              aria-label="Fly app name"
              style={{ flex: "1 1 180px", fontSize: 12, padding: "6px 8px" }}
            />
            <input
              type="text"
              value={flyRegion}
              onChange={(e) => setFlyRegion(e.target.value)}
              placeholder="region (optional, e.g. iad)"
              aria-label="Fly region"
              style={{ flex: "0 1 160px", fontSize: 12, padding: "6px 8px" }}
            />
            <button
              type="button"
              className="btn-primary"
              onClick={() => void deployFly()}
              disabled={flyBusy}
              style={{ fontSize: 12, padding: "6px 12px" }}
            >
              {flyBusy ? "Deploying…" : "Deploy to Fly"}
            </button>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
            Set a <code>FLY_API_TOKEN</code> in this project&apos;s Secrets first. Build logs
            stream into the chat. Env vars added below are passed through.
          </div>
        </div>
      )}

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
            onClick={() => setConfirmDisconnect(true)}
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
          {live.state === "ERROR" && (
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 8 }}>
              <button
                type="button"
                onClick={() => void deployNow()}
                className="btn-secondary"
                style={{ fontSize: 11, padding: "4px 10px" }}
                disabled={busy || !vercel?.connected}
              >
                Retry deploy
              </button>
              {live.inspector_url && (
                <a
                  href={live.inspector_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  style={{ fontSize: 11, color: "var(--accent)" }}
                >
                  Open build logs ↗
                </a>
              )}
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
                aria-label="Environment variable name"
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
                type="password"
                aria-label="Environment variable value"
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
                aria-label="Remove environment variable"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() =>
              setEnvRows((rows) => [...rows, { id: envIdSeq++, key: "", value: "" }])
            }
            className="btn-ghost"
            style={{ fontSize: 11 }}
            disabled={busy}
          >
            + Add variable
          </button>
          {secretNames.length > 0 && (
            <label style={{ fontSize: 11, color: "var(--text-muted)", display: "flex", gap: 6, alignItems: "center" }}>
              Add from Secrets:
              <select
                value=""
                onChange={(e) => {
                  addEnvFromSecret(e.target.value);
                  e.target.value = "";
                }}
                disabled={busy}
                aria-label="Add an environment variable from Project Secrets"
                style={{ ...modalFieldStyle, padding: "4px 6px" }}
              >
                <option value="">choose…</option>
                {secretNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {secretNames.length > 0 && (
          <div className="field-hint" style={{ marginTop: 4 }}>
            Picking a secret fills the key; enter its value here (secret values are never
            shown).
          </div>
        )}
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

      {/* Take your code with you (E2 zip · E3 embed). A handoff path that
          doesn't depend on Vercel — useful for private-cloud / intranet. */}
      <div style={{ marginTop: 18, borderTop: "1px solid var(--border-default)", paddingTop: 14 }}>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
          Take your code with you
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            className="btn-secondary"
            style={{ fontSize: 12, padding: "6px 12px" }}
            onClick={() => void downloadZip()}
            disabled={downloading}
            title="Download this project's source as a .zip (no node_modules or secrets)"
          >
            {downloading ? "Preparing…" : "⬇ Download .zip"}
          </button>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
            Source only — excludes <code>node_modules</code>, build output, and <code>.env</code> files.
          </span>
        </div>

        {deployedUrl ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
              Embed (paste into a page, wiki, or intranet that allow-lists this origin)
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
              <code
                style={{
                  flex: 1,
                  fontSize: 11,
                  padding: "8px 10px",
                  background: "var(--bg-code)",
                  borderRadius: 4,
                  overflowX: "auto",
                  whiteSpace: "nowrap",
                }}
              >
                {embedSnippet}
              </code>
              <button
                type="button"
                className="btn-secondary"
                style={{ fontSize: 12, padding: "6px 12px", flex: "0 0 auto" }}
                onClick={copyEmbed}
              >
                {embedCopied ? "Copied ✓" : "Copy"}
              </button>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
              The destination site must allow this origin in its frame policy
              (<code>Content-Security-Policy: frame-ancestors</code>).
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 8 }}>
            Deploy first to get an embeddable <code>&lt;iframe&gt;</code> snippet.
          </div>
        )}
      </div>
    </Modal>

    {confirmDisconnect && (
      <Modal
        title="Disconnect Vercel?"
        width={460}
        onClose={() => setConfirmDisconnect(false)}
        footer={
          <>
            <span />
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setConfirmDisconnect(false)}>
                Cancel
              </button>
              <button type="button" className="btn-danger" onClick={disconnect}>
                Disconnect Vercel
              </button>
            </div>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--text-muted)" }}>
          This unlinks Vercel from your account. You’ll need to reconnect (and re-enter env
          vars) before the next deploy. Already-deployed sites stay live.
        </p>
      </Modal>
    )}

    {confirmProd && (
      <Modal
        title="Deploy to production?"
        width={460}
        onClose={() => setConfirmProd(false)}
        footer={
          <>
            <span />
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setConfirmProd(false)}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={() => void deployNow()}>
                Deploy to production
              </button>
            </div>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--text-muted)" }}>
          This publishes <strong>{project?.name}</strong> to your live production URL
          {live?.vercel_url ? (
            <>
              {" "}(<code>{live.vercel_url}</code>)
            </>
          ) : null}
          . Choose “Preview” instead for a throwaway URL.
        </p>
      </Modal>
    )}
    </>
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
