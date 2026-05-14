"use client";

import { useState } from "react";
import { fetchGuestRecoveryCodeApi } from "@/lib/api";

/**
 * Yellow "you're on a guest account" bar. Shown on the homepage, the project
 * dashboard, and (compact) in the workspace topbar. Nudges the student to sign
 * in with Google to make the account permanent and unlock GitHub + deploys,
 * and lets them re-view their recovery code at any time.
 */
export default function GuestBanner({
  variant = "full",
}: {
  variant?: "full" | "compact";
}) {
  const [code, setCode] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [loadingCode, setLoadingCode] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  async function revealCode(): Promise<void> {
    setShowCode(true);
    if (code || loadingCode) return;
    setLoadingCode(true);
    setCodeError(null);
    try {
      const r = await fetchGuestRecoveryCodeApi();
      if (r.recovery_code) setCode(r.recovery_code);
      else setCodeError("Recovery code unavailable.");
    } catch {
      setCodeError("Couldn't load your recovery code — try again.");
    } finally {
      setLoadingCode(false);
    }
  }

  const compact = variant === "compact";

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          padding: compact ? "4px 12px" : "8px 16px",
          fontSize: compact ? 11 : 12.5,
          background: "rgba(240, 180, 41, 0.12)",
          borderBottom: "1px solid rgba(240, 180, 41, 0.4)",
          color: "var(--text-primary)",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          <svg
            width={compact ? 13 : 15}
            height={compact ? 13 : 15}
            viewBox="0 0 24 24"
            fill="none"
            stroke="#f0b429"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span>
            {compact
              ? "Guest account — work is saved, but GitHub + deploys need a Google sign-in."
              : "You're on a free guest account. Your work is saved, but sign in with Google to keep it permanently and to use GitHub or deploys."}
          </span>
        </span>
        <span style={{ display: "inline-flex", gap: 8, marginLeft: "auto" }}>
          <a
            href="/login"
            className="btn-primary"
            style={{
              fontSize: compact ? 11 : 12,
              padding: compact ? "3px 9px" : "5px 11px",
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            Sign in with Google
          </a>
          <button
            type="button"
            onClick={revealCode}
            className="btn-ghost"
            style={{
              fontSize: compact ? 11 : 12,
              padding: compact ? "3px 9px" : "5px 11px",
              whiteSpace: "nowrap",
            }}
          >
            Show recovery code
          </button>
        </span>
      </div>

      {showCode && (
        <div
          onClick={() => setShowCode(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            zIndex: 200,
            display: "grid",
            placeItems: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(440px, 92vw)",
              background: "var(--bg-base, #0c0c10)",
              border: "1px solid var(--border-default)",
              borderRadius: 10,
              padding: 20,
              color: "var(--text-primary)",
              boxShadow: "0 24px 48px rgba(0,0,0,0.6)",
            }}
          >
            <h2 style={{ fontSize: 15, margin: "0 0 6px" }}>Your recovery code</h2>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 14px" }}>
              Save this somewhere safe — it&apos;s the only way back into this
              guest account on another device or after browser data is cleared.
            </p>
            {loadingCode ? (
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>loading…</div>
            ) : codeError ? (
              <div style={{ fontSize: 13, color: "var(--conf-low)" }}>{codeError}</div>
            ) : (
              <div
                style={{
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: 15,
                  letterSpacing: 1,
                  padding: "12px 14px",
                  background: "var(--bg-elev)",
                  border: "1px solid var(--border-default)",
                  borderRadius: 6,
                  userSelect: "all",
                  wordBreak: "break-all",
                }}
              >
                {code}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button
                type="button"
                onClick={() => setShowCode(false)}
                className="btn-primary"
                style={{ fontSize: 12 }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
