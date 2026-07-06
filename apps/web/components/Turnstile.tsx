"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const SCRIPT_ID = "cf-turnstile-script";
const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
// Stop waiting for the API after ~15s (script blocked/offline) so a dead widget
// doesn't poll forever. With no token, a configured guest flow stays disabled —
// which is the correct fail-closed posture (the server rejects a missing token).
const MAX_READY_ATTEMPTS = 100;

/**
 * True only when a Turnstile site key is configured. The guest flow gates its
 * submit buttons on a solved token ONLY when this is true; with no key the whole
 * feature is dark (matching the orchestrator, which skips verification when its
 * secret is unset). Keep both env vars in lockstep — a site key with no server
 * secret (or vice-versa) breaks signup.
 */
export const turnstileEnabled = !!SITE_KEY;

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export interface TurnstileHandle {
  /** Mint a fresh token (call after each submit — tokens are single-use). */
  reset: () => void;
}

/**
 * Cloudflare Turnstile widget (explicit render). Renders nothing and never
 * blocks when NEXT_PUBLIC_TURNSTILE_SITE_KEY is unset. When configured it mints
 * a token via the managed widget and reports it through `onToken` — passing
 * null on expiry/error/timeout so the parent re-disables its submit button.
 */
const Turnstile = forwardRef<
  TurnstileHandle,
  { onToken: (token: string | null) => void; action?: string }
>(function Turnstile({ onToken, action }, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  // Keep the latest onToken without re-running the render effect on every parent
  // re-render (which would tear down and rebuild the widget).
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useImperativeHandle(
    ref,
    () => ({
      reset: () => {
        if (window.turnstile && widgetIdRef.current) {
          window.turnstile.reset(widgetIdRef.current);
          onTokenRef.current(null);
        }
      },
    }),
    [],
  );

  useEffect(() => {
    if (!SITE_KEY) return;
    let cancelled = false;
    let attempts = 0;

    if (!document.getElementById(SCRIPT_ID)) {
      const s = document.createElement("script");
      s.id = SCRIPT_ID;
      s.src = SCRIPT_SRC;
      s.async = true;
      s.defer = true;
      document.head.appendChild(s);
    }

    // Render as soon as the API script has initialised. Poll rather than rely on
    // an onload global so multiple widgets on a page can't clobber each other.
    const timer = window.setInterval(() => {
      attempts += 1;
      if (cancelled || attempts > MAX_READY_ATTEMPTS) {
        window.clearInterval(timer);
        return;
      }
      if (!window.turnstile || !containerRef.current || widgetIdRef.current) return;
      window.clearInterval(timer);
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: SITE_KEY,
        ...(action ? { action } : {}),
        callback: (token: string) => onTokenRef.current(token),
        "expired-callback": () => onTokenRef.current(null),
        "error-callback": () => onTokenRef.current(null),
        "timeout-callback": () => onTokenRef.current(null),
      });
    }, 150);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (window.turnstile && widgetIdRef.current) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // Widget already gone (e.g. script reloaded) — nothing to clean up.
        }
        widgetIdRef.current = null;
      }
    };
  }, [action]);

  if (!SITE_KEY) return null;
  return (
    <div
      ref={containerRef}
      style={{ display: "flex", justifyContent: "center", margin: "12px 0 4px" }}
    />
  );
});

export default Turnstile;
