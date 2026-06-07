"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import {
  fetchSupabaseStatus,
  fetchSupabaseProjects,
  supabaseOauthStartUrl,
  type SupabaseStatus,
  type SupabaseProjectInfo,
} from "@/lib/api";

/**
 * Databases tab on the projects page. Account-level view of the Supabase
 * databases the connected account owns. The agent provisions a database per
 * project from inside a workspace (supabase.provision_database); this is the
 * place to connect Supabase and see what exists.
 */
export default function DatabasesView({ isGuest }: { isGuest: boolean }) {
  const [status, setStatus] = useState<SupabaseStatus | null>(null);
  const [projects, setProjects] = useState<SupabaseProjectInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadProjects = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchSupabaseProjects()
      .then((r) => setProjects(Array.isArray(r.projects) ? r.projects : []))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (isGuest) return;
    fetchSupabaseStatus()
      .then((s) => {
        setStatus(s);
        if (s.connected) loadProjects();
      })
      .catch(() => setStatus({ connected: false, org_id: null, org_name: null, connected_at: null }));
  }, [isGuest, loadProjects]);

  const returnTo =
    typeof window !== "undefined" ? window.location.origin + "/projects" : "/projects";

  return (
    <div style={{ maxWidth: 880 }}>
      <h1 style={{ margin: "0 0 6px" }}>Databases</h1>
      <p className="lede" style={{ marginTop: 0 }}>
        Postgres databases provisioned through your connected Supabase account.
        Inside a project, ask the agent to “create a database” and it’ll appear here.
      </p>

      {isGuest ? (
        <div style={cardStyle}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
            Sign in with an account to connect Supabase and create databases.
          </p>
        </div>
      ) : status === null ? (
        <div style={cardStyle}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>Checking connection…</p>
        </div>
      ) : !status.connected ? (
        <div style={cardStyle}>
          <h2 style={{ margin: "0 0 6px", fontSize: 15 }}>Connect Supabase</h2>
          <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
            Connect your Supabase account so the agent can create a Postgres
            database for a project and wire its keys automatically.
          </p>
          <a
            href={supabaseOauthStartUrl(returnTo)}
            className="btn-primary"
            style={{ fontSize: 13, padding: "8px 14px", textDecoration: "none" }}
          >
            Connect Supabase
          </a>
        </div>
      ) : (
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
              Connected{status.org_name ? <> · <strong style={{ color: "var(--text-primary)" }}>{status.org_name}</strong></> : null}
            </span>
            <button
              type="button"
              onClick={loadProjects}
              disabled={loading}
              className="btn-ghost"
              style={{ fontSize: 12 }}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {error ? (
            <p style={{ margin: 0, fontSize: 13, color: "var(--conf-medium, #d98a3d)" }}>{error}</p>
          ) : projects === null ? (
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>Loading databases…</p>
          ) : projects.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
              No databases yet. Open a project and ask the agent to create a
              Supabase database — it’ll provision one and wire the env vars.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {projects.map((p) => (
                <div
                  key={p.ref ?? p.id ?? p.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "10px 12px",
                    background: "var(--bg-dark)",
                    border: "1px solid var(--border-default)",
                    borderRadius: "var(--radius-sm)",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                      {p.name ?? p.ref ?? "(unnamed)"}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "ui-monospace,Menlo,Consolas,monospace" }}>
                      {p.ref}
                      {p.region ? ` · ${p.region}` : ""}
                    </div>
                  </div>
                  <StatusBadge status={p.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status?: string }) {
  const healthy = status === "ACTIVE_HEALTHY";
  const color = healthy ? "var(--conf-high, #3ea76a)" : "var(--conf-medium, #d98a3d)";
  return (
    <span
      style={{
        flexShrink: 0,
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: 0.3,
        textTransform: "uppercase",
        color,
        border: `1px solid ${color}`,
        borderRadius: 999,
        padding: "2px 8px",
        whiteSpace: "nowrap",
      }}
    >
      {healthy ? "Healthy" : (status ?? "unknown").replace(/_/g, " ").toLowerCase()}
    </span>
  );
}

const cardStyle: CSSProperties = {
  background: "var(--bg-surface)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-md)",
  padding: 18,
};
