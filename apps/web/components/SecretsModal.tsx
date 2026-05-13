"use client";

import { useEffect, useState } from "react";
import {
  deleteSecretApi,
  fetchSecretsApi,
  upsertSecretApi,
  type SecretSummary,
} from "@/lib/api";

/**
 * Secrets manager (Plan §6).
 *
 * Stores per-project secrets encrypted at rest. The agent never sees
 * plaintext values — it asks for one by name via `get_secret` and the
 * orchestrator plumbs the value into a sandbox .env file. Every read +
 * write here writes an audit_events row.
 */
export default function SecretsModal({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const [secrets, setSecrets] = useState<SecretSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  // Same secret name can exist per env (default / development / staging /
  // production / etc.). Defaults to "default" so single-env projects never
  // see this knob unless they want to.
  const [env, setEnv] = useState("default");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setError(null);
    try {
      const r = await fetchSecretsApi(projectId);
      setSecrets(r.secrets);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const onAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
      setError("Name must match [A-Z_][A-Z0-9_]*");
      return;
    }
    if (!value) {
      setError("Value is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await upsertSecretApi(projectId, {
        name,
        value,
        env,
        description: description || null,
      });
      setName("");
      setValue("");
      setDescription("");
      // Keep the selected env so the user can add several secrets to one env
      // back-to-back without re-picking.
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (s: SecretSummary) => {
    if (!confirm(`Delete secret ${s.name} (env=${s.env})?`)) return;
    try {
      await deleteSecretApi(projectId, s.name, s.env);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(720px, 100%)",
          maxHeight: "85vh",
          background: "var(--bg-surface, #16161e)",
          border: "1px solid var(--border-default, #2a2a36)",
          borderRadius: 8,
          display: "grid",
          gridTemplateRows: "auto 1fr auto",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--border-default, #2a2a36)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Project Secrets</div>
            <div style={{ color: "var(--text-dim, #999)", fontSize: 11.5 }}>
              Encrypted at rest · Agent reads via <code>get_secret</code>; values are NEVER returned to the chat
            </div>
          </div>
          <button onClick={onClose} className="icon-btn-sm" title="Close">
            ✕
          </button>
        </div>

        <div style={{ padding: 16, overflow: "auto", display: "grid", gap: 16 }}>
          <form onSubmit={onAdd} style={{ display: "grid", gap: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600 }}>Add or update secret</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 160px", gap: 8 }}>
              <input
                type="text"
                value={name}
                onChange={(e) =>
                  setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))
                }
                placeholder="STRIPE_API_KEY"
                style={inputStyle}
              />
              <input
                type="text"
                value={env}
                onChange={(e) =>
                  setEnv(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))
                }
                placeholder="env (default)"
                title="Environment slot — default, development, staging, production, etc."
                style={inputStyle}
                list="uniqus-secret-env-options"
              />
              <datalist id="uniqus-secret-env-options">
                <option value="default" />
                <option value="development" />
                <option value="staging" />
                <option value="production" />
              </datalist>
            </div>
            <input
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="value (write-only — won't be shown again)"
              style={inputStyle}
            />
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description (visible to the agent in list_secrets)"
              style={inputStyle}
            />
            <div>
              <button type="submit" disabled={saving} className="send-btn" style={{ padding: "4px 12px" }}>
                {saving ? "Saving…" : "Save secret"}
              </button>
            </div>
          </form>

          <div>
            <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8 }}>
              Configured ({secrets.length})
            </div>
            {loading ? (
              <div style={{ color: "var(--text-dim)", fontSize: 12 }}>Loading…</div>
            ) : secrets.length === 0 ? (
              <div style={{ color: "var(--text-dim)", fontSize: 12 }}>
                None yet. Add the credentials your generated code will need at runtime
                (Stripe keys, Slack tokens, DATABASE_URL, etc.).
              </div>
            ) : (
              <div style={{ display: "grid", gap: 6 }}>
                {secrets.map((s) => (
                  <div
                    key={s.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      gap: 12,
                      padding: "8px 10px",
                      border: "1px solid var(--border-default, #2a2a36)",
                      borderRadius: 6,
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <code style={{ fontSize: 12 }}>{s.name}</code>
                        <span
                          style={{
                            fontSize: 10,
                            color: "var(--text-dim)",
                            border: "1px solid var(--border-default, #2a2a36)",
                            borderRadius: 4,
                            padding: "0 6px",
                            fontFamily: "var(--mono, monospace)",
                          }}
                          title="Environment slot"
                        >
                          {s.env}
                        </span>
                      </div>
                      {s.description && (
                        <div style={{ color: "var(--text-dim)", fontSize: 10.5 }}>
                          {s.description}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => onDelete(s)}
                      className="icon-btn-sm"
                      style={{ width: "auto", padding: "2px 8px", fontSize: 11 }}
                      title={`Delete ${s.name} (env=${s.env})`}
                    >
                      delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            padding: "10px 16px",
            borderTop: "1px solid var(--border-default, #2a2a36)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ fontSize: 11, color: error ? "var(--conf-low, #c0392b)" : "var(--text-dim)" }}>
            {error ?? "Audit-logged · AES-256-GCM encrypted"}
          </div>
          <button onClick={onClose} className="icon-btn-sm" style={{ width: "auto", padding: "4px 12px" }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--bg-base, #0d0d12)",
  color: "var(--text-primary, #e6e6ee)",
  border: "1px solid var(--border-default, #2a2a36)",
  borderRadius: 6,
  padding: "6px 10px",
  fontFamily: "var(--mono, monospace)",
  fontSize: 12.5,
};
