"use client";

import { useEffect, useState } from "react";
import Modal from "./Modal";
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
    <Modal
      title="Project Secrets"
      subtitle={
        <>
          Encrypted at rest · Agent reads via <code>get_secret</code>; values are NEVER returned to the chat
        </>
      }
      onClose={onClose}
      width={720}
      bodyStyle={{ display: "grid", gap: 16 }}
      footer={
        <>
          <div className={`modal-status${error ? " error" : ""}`}>
            {error ?? "Audit-logged · AES-256-GCM encrypted"}
          </div>
          <div className="modal-actions">
            <button onClick={onClose} className="btn-secondary">
              Close
            </button>
          </div>
        </>
      }
    >
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
                        <div style={{ color: "var(--text-dim)", fontSize: 11 }}>
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
    </Modal>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--bg-base)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-default)",
  borderRadius: 6,
  padding: "6px 10px",
  fontFamily: "var(--font-mono-stack)",
  fontSize: 12,
};
