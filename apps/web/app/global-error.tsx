"use client";

import { useEffect } from "react";

/**
 * Last-resort error boundary (Next.js App Router). Only trips when an error
 * escapes every nested boundary — including a failure in the root layout —
 * so it must render its own <html>/<body>. Kept dependency-free and
 * inline-styled because the normal app shell (and globals.css class names)
 * may not be available at this point.
 */
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
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0c0c11",
          color: "#e4e2dc",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 460, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 10px" }}>
            Something went wrong
          </h1>
          <p style={{ color: "#8a8880", fontSize: 14, lineHeight: 1.6, margin: "0 0 22px" }}>
            The app hit an unexpected error and couldn’t recover automatically.
            Reloading usually fixes it — your work on the server is safe.
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                background: "linear-gradient(135deg, #482879, #B21E7D)",
                color: "#fff",
                border: 0,
                padding: "10px 18px",
                borderRadius: 8,
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
                color: "#e4e2dc",
                border: "1px solid #2a2a35",
                padding: "10px 18px",
                borderRadius: 8,
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
