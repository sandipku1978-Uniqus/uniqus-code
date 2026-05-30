"use client";

import { useEffect } from "react";

/**
 * Route-level error boundary for the workspace (Next.js App Router convention).
 * Catches any render error that escapes the in-component <ErrorBoundary>
 * wrappers in Workspace, so the user gets a friendly recovery screen instead of
 * the default "Application error: a client-side exception has occurred."
 *
 * `reset()` re-renders the segment. The Zustand store is a module-level
 * singleton, so it is NOT torn down by this boundary — recovering here keeps
 * whatever chat/session state was already loaded.
 */
export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[workspace route error]", error);
  }, [error]);

  return (
    <div className="route-error">
      <div className="route-error-card" role="alert">
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <h1>The workspace hit a snag</h1>
        <p>
          Something threw an unexpected error. Your project files are saved on
          the server — nothing here is lost. Try again, and if it keeps
          happening, reload the page.
        </p>
        {error?.message && <pre className="route-error-msg">{error.message}</pre>}
        <div className="route-error-actions">
          <button type="button" className="btn-primary" onClick={() => reset()}>
            Try again
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              if (typeof window !== "undefined") window.location.reload();
            }}
          >
            Reload page
          </button>
        </div>
      </div>
    </div>
  );
}
