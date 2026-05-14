"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createGuestApi, restoreGuestApi } from "@/lib/api";

/**
 * Guest entry points on the login page: start a free guest account (no Google,
 * no email) or restore one with a recovery code. WorkOS sign-in stays the
 * primary CTA above this; these are the fallback for students whose districts
 * lock down Google sign-in.
 *
 * When the visitor is already a guest, the create/restore UI is replaced with
 * a simple "open your dashboard" — they reached /login to upgrade (via the
 * "Continue securely" button above), not to make a second guest account.
 */
export default function GuestLoginActions({
  isExistingGuest = false,
}: {
  isExistingGuest?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreCode, setRestoreCode] = useState("");

  async function startGuest(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await createGuestApi();
      setNewCode(r.recovery_code);
      setBusy(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  async function restoreGuest(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (busy) return;
    const code = restoreCode.trim();
    if (!code) return;
    setBusy(true);
    setError(null);
    try {
      await restoreGuestApi(code);
      router.push("/projects");
    } catch {
      setError("That recovery code wasn't recognised.");
      setBusy(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    flex: 1,
    background: "var(--bg-elev)",
    border: "1px solid var(--border-default)",
    borderRadius: 6,
    padding: "8px 10px",
    color: "var(--text-primary)",
    fontSize: 12,
    fontFamily: "var(--font-mono, monospace)",
  };

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          margin: "18px 0",
          color: "var(--text-muted)",
          fontSize: 11,
        }}
      >
        <span style={{ flex: 1, height: 1, background: "var(--border-default)" }} />
        or
        <span style={{ flex: 1, height: 1, background: "var(--border-default)" }} />
      </div>

      {isExistingGuest ? (
        <>
          <p
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
              textAlign: "center",
              margin: "0 0 10px",
            }}
          >
            You&apos;re already signed in as a guest.
          </p>
          <button
            type="button"
            onClick={() => router.push("/projects")}
            className="btn-ghost"
            style={{ width: "100%", padding: "10px 12px", fontSize: 13 }}
          >
            Open your dashboard
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={startGuest}
            disabled={busy}
            className="btn-ghost"
            style={{ width: "100%", padding: "10px 12px", fontSize: 13 }}
          >
            {busy && !restoreOpen
              ? "Creating guest account…"
              : "Continue as a guest"}
          </button>
          <p
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              margin: "8px 0 0",
              textAlign: "center",
            }}
          >
            No Google account or email needed — best for students whose school
            locks down sign-in. GitHub and deploys stay disabled until you sign
            in.
          </p>

          <div style={{ marginTop: 12, textAlign: "center" }}>
            <button
              type="button"
              onClick={() => setRestoreOpen((v) => !v)}
              className="btn-ghost"
              style={{ fontSize: 11, padding: "2px 6px" }}
            >
              {restoreOpen ? "Hide" : "Have a recovery code?"}
            </button>
          </div>

          {restoreOpen && (
            <form
              onSubmit={restoreGuest}
              style={{ display: "flex", gap: 6, marginTop: 8 }}
            >
              <input
                value={restoreCode}
                onChange={(e) => setRestoreCode(e.target.value)}
                placeholder="UNIQUS-GUEST-XXXX-XXXX-XXXX-XXXX"
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
                style={inputStyle}
              />
              <button
                type="submit"
                className="btn-primary"
                disabled={busy || !restoreCode.trim()}
                style={{ fontSize: 12 }}
              >
                Restore
              </button>
            </form>
          )}

          {error && (
            <div
              style={{
                color: "var(--conf-low)",
                fontSize: 12,
                marginTop: 10,
                textAlign: "center",
              }}
            >
              {error}
            </div>
          )}
        </>
      )}

      {newCode && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            zIndex: 200,
            display: "grid",
            placeItems: "center",
          }}
        >
          <div
            style={{
              width: "min(460px, 92vw)",
              background: "var(--bg-base, #0c0c10)",
              border: "1px solid var(--border-default)",
              borderRadius: 10,
              padding: 22,
              color: "var(--text-primary)",
              boxShadow: "0 24px 48px rgba(0,0,0,0.6)",
            }}
          >
            <h2 style={{ fontSize: 16, margin: "0 0 6px" }}>
              Save your recovery code
            </h2>
            <p
              style={{
                fontSize: 12.5,
                color: "var(--text-muted)",
                margin: "0 0 14px",
              }}
            >
              This is the only way back into your guest account on another
              device or if your browser data is cleared. Write it down or have
              your teacher record it — we can&apos;t recover it for you.
            </p>
            <div
              style={{
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 16,
                letterSpacing: 1,
                padding: "14px 16px",
                background: "var(--bg-elev)",
                border: "1px solid rgba(240, 180, 41, 0.4)",
                borderRadius: 6,
                userSelect: "all",
                wordBreak: "break-all",
                textAlign: "center",
              }}
            >
              {newCode}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginTop: 18,
              }}
            >
              <button
                type="button"
                onClick={() => router.push("/projects")}
                className="btn-primary"
                style={{ fontSize: 13 }}
              >
                I&apos;ve saved it — continue
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
