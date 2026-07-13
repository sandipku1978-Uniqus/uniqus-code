"use client";

import { useEffect } from "react";

/**
 * Last-resort error boundary (Next.js App Router). Only trips when an error
 * escapes every nested boundary — including a failure in the root layout —
 * so it must render its own <html>/<body>. Kept dependency-free and
 * inline-styled because the normal app shell (and globals.css class names)
 * may not be available at this point.
 *
 * It is theme-aware: a tiny inline script applies the persisted `gate15.theme`
 * to <html> before paint, and an inline <style> defines the handful of colour
 * tokens for both themes, so a light-theme user doesn't get a jarring dark
 * recovery screen (UI/UX audit §E).
 */
const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem("gate15.theme");document.documentElement.dataset.theme=t==="light"?"light":"dark";}catch(e){document.documentElement.dataset.theme="dark";}})();`;

const THEME_TOKENS = `
:root{--ge-bg:#0A0B0C;--ge-text:#EDEBE7;--ge-muted:#9A9793;--ge-border:#2A2E33;}
:root[data-theme="light"]{--ge-bg:#EFEEEC;--ge-text:#17181A;--ge-muted:#52555A;--ge-border:#DDDCDA;}
body{margin:0;}
`;

/** Ember → signal. Ink on ember is near-black, never white (hazard signage). */
const EMBER_GRADIENT = "linear-gradient(135deg, #FF651F, #FFCF3D)";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[global error]", error);
  }, [error]);

  return (
    <html lang="en" data-theme="dark">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
        <style dangerouslySetInnerHTML={{ __html: THEME_TOKENS }} />
      </head>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "var(--ge-bg)",
          color: "var(--ge-text)",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 460, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 10px" }}>
            Something went wrong
          </h1>
          <p style={{ color: "var(--ge-muted)", fontSize: 14, lineHeight: 1.6, margin: "0 0 22px" }}>
            The app hit an unexpected error and couldn’t recover automatically.
            Reloading usually fixes it — your work on the server is safe.
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                background: EMBER_GRADIENT,
                color: "#140D07",
                border: 0,
                padding: "10px 18px",
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => {
                if (typeof window !== "undefined") window.location.reload();
              }}
              style={{
                background: "transparent",
                color: "var(--ge-text)",
                border: "1px solid var(--ge-border)",
                padding: "10px 18px",
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Reload
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
