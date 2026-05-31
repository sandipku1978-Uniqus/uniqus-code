"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * App-segment error boundary (Next.js App Router convention). Catches render
 * errors that escape the route segments under the root layout. Unlike
 * `global-error.tsx`, the root <html>/<body> shell persists here, so this only
 * renders the recovery card — reusing the same `.route-error` styling as the
 * workspace boundary for a consistent look.
 *
 * `reset()` re-renders the segment; the Zustand store is a module-level
 * singleton, so it survives the reset and keeps whatever state was loaded.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[route error]", error);
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
        <h1>Something went wrong</h1>
        <p>
          The app hit an unexpected error and couldn’t recover automatically.
          Trying again usually fixes it — your work on the server is safe.
        </p>
        {error?.message && <pre className="route-error-msg">{error.message}</pre>}
        <div className="route-error-actions">
          <button type="button" className="btn-primary" onClick={() => reset()}>
            Try again
          </button>
          <Link className="btn-secondary" href="/projects">
            Back to projects
          </Link>
        </div>
      </div>
    </div>
  );
}
