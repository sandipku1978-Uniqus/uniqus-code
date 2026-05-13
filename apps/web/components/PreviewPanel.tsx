"use client";

import { useEffect, useState } from "react";
import type { PreviewServer } from "@uniqus/api-types";

// Match the page's TLS state for the dev fallback so the iframe doesn't get
// mixed-content blocked when the app is loaded over HTTPS. Production should
// always set NEXT_PUBLIC_ORCHESTRATOR_URL explicitly.
const ORCHESTRATOR_URL =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ??
  (typeof window !== "undefined"
    ? window.location.protocol === "https:"
      ? `https://${window.location.hostname}`
      : `http://${window.location.hostname}:8787`
    : "");

interface PreviewNavMessage {
  type: "uniqus:preview-nav";
  server_id: string;
  path: string;
}

function isPreviewNavMessage(data: unknown): data is PreviewNavMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "uniqus:preview-nav" &&
    typeof (data as { server_id?: unknown }).server_id === "string" &&
    typeof (data as { path?: unknown }).path === "string"
  );
}

export default function PreviewPanel({ server }: { server: PreviewServer }) {
  const [reloadKey, setReloadKey] = useState(0);
  // In-app path the iframe is currently showing — updated via postMessage
  // from the navigation reporter the proxy injects into every HTML response.
  // Starts at "/" because that's what we load. Cross-origin is fine: the
  // iframe posts outward, we never need to read its location directly.
  const [iframePath, setIframePath] = useState<string>("/");
  // Route through the orchestrator's preview proxy so the iframe works in
  // production (Vercel + Railway) where the dev server isn't on a public port.
  const baseUrl = `${ORCHESTRATOR_URL}/preview/${server.id}/`;
  // What we display in the URL bar: the orchestrator URL with the iframe's
  // in-app path appended. So a SPA pushState to /about shows up correctly.
  const displayedUrl = `${baseUrl.replace(/\/$/, "")}${iframePath.startsWith("/") ? iframePath : `/${iframePath}`}`;

  useEffect(() => {
    // Reset path when the underlying server changes — and when the user hits
    // Reload, since the inner app starts at "/" again.
    setIframePath("/");
  }, [server.id, reloadKey]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!isPreviewNavMessage(e.data)) return;
      if (e.data.server_id !== server.id) return;
      setIframePath(e.data.path || "/");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [server.id]);

  return (
    <div className="preview-wrap">
      <div className="preview-toolbar">
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          className="icon-btn-sm"
          title="Reload"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
        <span className="url" title={displayedUrl}>
          {displayedUrl}
        </span>
        <a
          href={displayedUrl}
          target="_blank"
          rel="noreferrer"
          className="icon-btn-sm"
          title="Open current page in new tab"
          style={{ textDecoration: "none" }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
      </div>
      <iframe
        key={reloadKey}
        src={baseUrl}
        className="preview-iframe"
        title={`preview ${server.port}`}
      />
    </div>
  );
}
