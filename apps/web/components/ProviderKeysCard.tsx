"use client";

import { useEffect, useState } from "react";
import { toast } from "@/lib/toast";
import {
  fetchAccountProviderKeysApi,
  setAccountProviderKeyApi,
  deleteAccountProviderKeyApi,
  type ByokProvider,
} from "@/lib/api";

const PROVIDERS: { id: ByokProvider; label: string; hint: string }[] = [
  { id: "anthropic", label: "Anthropic (Claude)", hint: "sk-ant-…" },
  { id: "openai", label: "OpenAI (ChatGPT)", hint: "sk-…" },
  { id: "google", label: "Google (Gemini)", hint: "AIza… / API key" },
];

/**
 * Bring-your-own-key card (F7): add per-account provider API keys. When set,
 * the agent's calls (including planning + compaction) bill YOUR provider
 * account; otherwise Uniqus's platform key is used. Keys are write-only — never
 * displayed or logged, and never sent to the sandbox/agent.
 */
export default function ProviderKeysCard() {
  const [configured, setConfigured] = useState<Set<ByokProvider>>(new Set());
  const [drafts, setDrafts] = useState<Record<ByokProvider, string>>({
    anthropic: "",
    openai: "",
    google: "",
  });
  const [busy, setBusy] = useState<ByokProvider | null>(null);

  useEffect(() => {
    fetchAccountProviderKeysApi()
      .then((r) => setConfigured(new Set(r.providers)))
      .catch(() => setConfigured(new Set()));
  }, []);

  const save = async (provider: ByokProvider) => {
    const key = drafts[provider].trim();
    if (!key) return;
    setBusy(provider);
    try {
      const r = await setAccountProviderKeyApi(provider, key);
      setConfigured(new Set(r.providers));
      setDrafts((d) => ({ ...d, [provider]: "" }));
      toast.success("Key saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save key");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (provider: ByokProvider) => {
    setBusy(provider);
    try {
      const r = await deleteAccountProviderKeyApi(provider);
      setConfigured(new Set(r.providers));
      toast.success("Key removed — using the platform key");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't remove key");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="settings-card">
      <h2>Model provider keys (bring your own)</h2>
      <p className="settings-card-sub">
        Add your own Anthropic / OpenAI / Google API key and the agent&apos;s model
        calls — including planning and history compaction — bill <strong>your</strong>{" "}
        provider account, governed by your own DPA. Leave a provider blank to use
        Uniqus&apos;s platform key. We never display or log your key, and it never
        reaches the sandbox or the agent.
      </p>
      <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
        {PROVIDERS.map((p) => {
          const isSet = configured.has(p.id);
          return (
            <div key={p.id} className="settings-row" style={{ alignItems: "center", gap: 10 }}>
              <span className="k" style={{ minWidth: 150 }}>
                {p.label}
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: 11,
                    color: isSet ? "var(--conf-high, #3ea76a)" : "var(--text-dim)",
                  }}
                >
                  {isSet ? "● your key" : "platform key"}
                </span>
              </span>
              <div style={{ display: "flex", gap: 6, flex: 1, justifyContent: "flex-end" }}>
                <input
                  type="password"
                  value={drafts[p.id]}
                  onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                  placeholder={isSet ? "Replace key…" : p.hint}
                  aria-label={`${p.label} API key`}
                  autoComplete="off"
                  style={{ fontSize: 12, padding: "6px 8px", flex: "1 1 220px", maxWidth: 280 }}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ fontSize: 12, padding: "6px 10px" }}
                  disabled={busy === p.id || !drafts[p.id].trim()}
                  onClick={() => void save(p.id)}
                >
                  {busy === p.id ? "…" : "Save"}
                </button>
                {isSet && (
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ fontSize: 12, padding: "6px 10px" }}
                    disabled={busy === p.id}
                    onClick={() => void remove(p.id)}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
