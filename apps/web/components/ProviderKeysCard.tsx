"use client";

import { useCallback, useEffect, useState } from "react";
import type { BillingStatus } from "@gate15/api-types";
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
  { id: "zai", label: "Z.ai (GLM)", hint: "Z.ai API key" },
];

/**
 * Bring-your-own-key card (F7): add per-account provider API keys. When set,
 * the agent's calls (including planning + compaction) bill YOUR provider
 * account. Plus/Max may fall back to their Gate 15 wallet; BYOK never does.
 * Keys are write-only — never displayed or logged, and never sent to the
 * sandbox/agent.
 */
export default function ProviderKeysCard({
  billing,
  billingState,
}: {
  billing: BillingStatus | null;
  billingState: "loading" | "ready" | "error";
}) {
  const [configured, setConfigured] = useState<Set<ByokProvider>>(new Set());
  const [drafts, setDrafts] = useState<Record<ByokProvider, string>>({
    anthropic: "",
    openai: "",
    google: "",
    zai: "",
  });
  const [busy, setBusy] = useState<ByokProvider | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [statusError, setStatusError] = useState<string | null>(null);

  const load = useCallback(() => {
    setStatus("loading");
    setStatusError(null);
    fetchAccountProviderKeysApi()
      .then((r) => {
        setConfigured(new Set(r.providers));
        setStatus("ready");
      })
      .catch((error) => {
        setStatusError(error instanceof Error ? error.message : "Couldn't check provider keys");
        setStatus("error");
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
      if (billingState !== "ready" || !billing) {
        toast.success("Key removed");
      } else if (billing.requires_byok) {
        toast.info(
          provider === "anthropic"
            ? "Anthropic key removed — BYOK runs are unavailable until you add one"
            : `${PROVIDERS.find((item) => item.id === provider)?.label ?? provider} key removed`,
        );
      } else {
        toast.success(
          "Key removed — Gate 15 fallback is available while eligible credits remain",
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't remove key");
    } finally {
      setBusy(null);
    }
  };

  const billingReady = billingState === "ready" && billing !== null;
  const canConfigure = billingReady && billing.byok_enabled;
  const requiresOwnKeys = billingReady && billing.requires_byok;

  return (
    <div className="settings-card">
      <h2>Model provider keys (bring your own)</h2>
      <p className="settings-card-sub">
        {!billingReady && billingState === "loading" ? (
          <>
            Checking plan access. You can still review and remove stored keys while this
            finishes; adding or replacing a key waits for verification.
          </>
        ) : !billingReady ? (
          <>
            Billing status is unavailable. You can still review and remove stored keys;
            adding or replacing a key waits until plan access is verified.
          </>
        ) : !canConfigure ? (
          <>
            Free accounts can review and remove previously stored keys. Upgrade to BYOK,
            Plus, or Max to add or replace a key.
          </>
        ) : requiresOwnKeys ? (
          <>
            BYOK never falls back to Gate 15&apos;s model wallet. Anthropic is required for
            every session because it powers internal planning, compaction, and Auto. Add
            OpenAI, Google, or Z.ai keys for any manual models you want to use. Calls bill
            your provider accounts directly.
          </>
        ) : (
          <>
            Add your own Anthropic, OpenAI, Google, or Z.ai key to bill that provider
            directly. A provider left blank uses Gate 15 model credits while eligible
            credits remain.
          </>
        )}{" "}
        Keys are write-only, encrypted at rest, and never reach the sandbox or agent.
      </p>
      {billingReady && !canConfigure && (
        <a href="#billing-settings" className="btn-secondary">
          Compare paid plans
        </a>
      )}
      {requiresOwnKeys && status === "ready" && !configured.has("anthropic") && (
        <div className="billing-notice warn" role="status">
          Anthropic is required on BYOK, including manual-model turns. Add that key before
          starting another session.
        </div>
      )}
      {status === "error" ? (
        <div className="async-error" role="alert">
          <p>
            Provider-key status is unavailable, so we cannot identify a stored key
            safely. Retry before changing one.
          </p>
          <code>{statusError}</code>
          <button type="button" className="btn-secondary" onClick={load}>
            Retry
          </button>
        </div>
      ) : status === "loading" ? (
        <div className="settings-row">
          <span className="k">Status</span>
          <span className="v">Checking provider keys…</span>
        </div>
      ) : (
      <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
        {PROVIDERS.map((p) => {
          const isSet = configured.has(p.id);
          return (
            <div key={p.id} className="settings-row provider-key-row" style={{ alignItems: "center", gap: 10 }}>
              <span className="k" style={{ minWidth: 150 }}>
                {p.label}
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: 11,
                    color: isSet ? "var(--conf-high, #3ea76a)" : "var(--text-dim)",
                  }}
                >
                  {isSet
                    ? "● your key"
                    : requiresOwnKeys
                      ? p.id === "anthropic"
                        ? "required for every run"
                        : "not configured"
                      : canConfigure
                        ? "Gate 15 credits when available"
                        : "not configured"}
                </span>
              </span>
              <div className="provider-key-controls" style={{ display: "flex", gap: 6, flex: 1, justifyContent: "flex-end" }}>
                {canConfigure && (
                  <>
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
                      aria-label={`Save ${p.label} API key`}
                      disabled={busy === p.id || !drafts[p.id].trim()}
                      onClick={() => void save(p.id)}
                    >
                      {busy === p.id ? "…" : "Save"}
                    </button>
                  </>
                )}
                {isSet && (
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ fontSize: 12, padding: "6px 10px" }}
                    aria-label={`Remove ${p.label} API key`}
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
      )}
    </div>
  );
}
