"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "./Modal";
import Turnstile, { turnstileEnabled, type TurnstileHandle } from "./Turnstile";
import { createGuestApi, restoreGuestApi, RestoreError } from "@/lib/api";

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
  const [copied, setCopied] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreCode, setRestoreCode] = useState("");
  // Cloudflare Turnstile token, shared by the create + restore flows (a user
  // does one at a time; we reset the widget after each attempt to re-mint).
  // Stays null — and the flows stay gated — until the widget solves. When
  // Turnstile isn't configured (`turnstileEnabled` false), the token is ignored.
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captchaRef = useRef<TurnstileHandle>(null);
  const captchaReady = !turnstileEnabled || !!captchaToken;

  async function copyCode(): Promise<void> {
    if (!newCode) return;
    try {
      await navigator.clipboard.writeText(newCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (insecure context / permissions) — fall back
      // to selecting the text so the user can copy manually. The code box has
      // userSelect:"all", so this is a no-op safety net.
    }
  }

  function downloadCode(): void {
    if (!newCode) return;
    const blob = new Blob(
      [
        `Gate 15 — guest recovery code\n\n${newCode}\n\n` +
          `Keep this safe: it is the only way back into your guest account on ` +
          `another device or after clearing browser data. We cannot recover it for you.\n`,
      ],
      { type: "text/plain" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gate15-recovery-code.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function startGuest(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await createGuestApi(captchaToken);
      setNewCode(r.recovery_code);
      setBusy(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
      // The token is single-use — mint a fresh one so a retry isn't rejected.
      captchaRef.current?.reset();
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
      await restoreGuestApi(code, captchaToken);
      router.push("/projects");
    } catch (err) {
      // Distinguish a genuinely unknown code from a transient failure so a
      // network blip doesn't read as "your valid code is wrong" (§A).
      const status = err instanceof RestoreError ? err.status : -1;
      if (status === 401 || status === 404) {
        // Deliberately says nothing about the code's SHAPE. Codes issued before
        // the rebrand carry a different prefix and still restore fine (the
        // orchestrator hashes a normalized form and never parses the prefix —
        // auth/guest.ts), so naming one expected prefix here would tell a
        // returning guest holding a valid older code that it's malformed, and
        // they may conclude the account is dead. Keep this shape-neutral.
        setError(
          "That recovery code isn't recognised. Check for typos, and make sure you entered the whole code.",
        );
      } else if (status === 403) {
        setError("Couldn't verify you're human. Please try again.");
      } else {
        setError("We couldn't reach the server. Check your connection and try again.");
      }
      setBusy(false);
      // The token is single-use — mint a fresh one so a retry isn't rejected.
      captchaRef.current?.reset();
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
            disabled={busy || !captchaReady}
            className="btn-ghost"
            style={{ width: "100%", padding: "10px 12px", fontSize: 13 }}
          >
            {busy && !restoreOpen
              ? "Creating guest account…"
              : !captchaReady
                ? "Verifying you're human…"
                : "Continue as a guest"}
          </button>
          <Turnstile ref={captchaRef} onToken={setCaptchaToken} action="guest" />
          <p
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              margin: "8px 0 0",
              textAlign: "center",
            }}
          >
            No Google account or email needed — best for students whose school
            locks down sign-in. GitHub and publishing unlock when you sign in.
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
                placeholder="GATE15-XXXX-XXXX-XXXX-XXXX"
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
                style={inputStyle}
              />
              <button
                type="submit"
                className="btn-primary"
                disabled={busy || !restoreCode.trim() || !captchaReady}
                style={{ fontSize: 12 }}
              >
                Restore
              </button>
            </form>
          )}

          {restoreOpen && (
            <p
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                margin: "8px 0 0",
                textAlign: "center",
                lineHeight: 1.5,
              }}
            >
              Lost your code? A guest account can only be reopened with its recovery
              code — we can&apos;t recover it for you. You can still start a fresh guest
              account above.
            </p>
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
        <Modal
          title="Save your recovery code"
          // The account already exists — every dismissal path (Escape, backdrop,
          // both buttons) continues into the dashboard rather than orphaning the
          // user. The code stays viewable later from the guest banner (§A).
          onClose={() => router.push("/projects")}
          width={460}
          footer={
            <>
              <span className="modal-status">
                You can view this again anytime from the guest banner.
              </span>
              <div className="modal-actions">
                <button
                  type="button"
                  onClick={() => router.push("/projects")}
                  className="btn-secondary"
                >
                  Skip for now
                </button>
                <button
                  type="button"
                  onClick={() => router.push("/projects")}
                  className="btn-primary"
                >
                  I&apos;ve saved it — continue
                </button>
              </div>
            </>
          }
        >
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 14px", lineHeight: 1.6 }}>
            This is the only way back into your guest account on another device or if
            your browser data is cleared. Write it down or have your teacher record it —
            we can&apos;t recover it for you.
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
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button type="button" onClick={copyCode} className="btn-secondary" style={{ fontSize: 12, flex: 1 }}>
              {copied ? "Copied ✓" : "Copy code"}
            </button>
            <button type="button" onClick={downloadCode} className="btn-secondary" style={{ fontSize: 12, flex: 1 }}>
              Download
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
