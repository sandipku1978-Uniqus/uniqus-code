"use client";

import { useState } from "react";
import Modal from "./Modal";
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
  const [copied, setCopied] = useState(false);

  async function copyCode(): Promise<void> {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure context) — the code box is userSelect:"all".
    }
  }

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
              ? "Guest session tied to this browser. Projects are stored securely; save your recovery code for access elsewhere."
              : "This guest session is tied to this browser. Your projects are stored securely; save your recovery code to access them elsewhere, or sign in to keep access across devices."}
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
              minHeight: compact ? 32 : 36,
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
              minHeight: compact ? 32 : 36,
            }}
          >
            Show recovery code
          </button>
        </span>
      </div>

      {showCode && (
        <Modal
          title="Your recovery code"
          onClose={() => setShowCode(false)}
          width={440}
          footer={
            <>
              <span />
              <div className="modal-actions">
                {code && !loadingCode && (
                  <button type="button" onClick={copyCode} className="btn-secondary" style={{ fontSize: 12 }}>
                    {copied ? "Copied ✓" : "Copy"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowCode(false)}
                  className="btn-primary"
                  style={{ fontSize: 12 }}
                >
                  Done
                </button>
              </div>
            </>
          }
        >
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 14px", lineHeight: 1.6 }}>
            Your projects are stored on Gate 15&apos;s servers, while this guest session is
            tied to your current browser. Save this code somewhere safe to restore access
            on another device or after browser data is cleared.
          </p>
          {loadingCode ? (
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>loading…</div>
          ) : codeError ? (
            <div style={{ fontSize: 13, color: "var(--conf-low)" }} role="alert">
              {codeError}
            </div>
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
        </Modal>
      )}
    </>
  );
}
