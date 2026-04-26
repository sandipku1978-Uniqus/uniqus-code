"use client";

import { useState } from "react";
import type { PreviewServer } from "@uniqus/api-types";

const ORCHESTRATOR_URL =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ??
  (typeof window !== "undefined" ? `http://${window.location.hostname}:8787` : "");

export default function PreviewPanel({ server }: { server: PreviewServer }) {
  const [reloadKey, setReloadKey] = useState(0);
  // Route through the orchestrator's preview proxy so the iframe works in
  // production (Vercel + Railway) where the dev server isn't on a public port.
  const url = `${ORCHESTRATOR_URL}/preview/${server.id}/`;

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
        <span className="url">{url}</span>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="icon-btn-sm"
          title="Open in new tab"
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
        src={url}
        className="preview-iframe"
        title={`preview ${server.port}`}
      />
    </div>
  );
}
