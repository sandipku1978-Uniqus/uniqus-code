import Link from "next/link";

/**
 * 404 boundary (Next.js App Router convention) for any unmatched route under
 * the root layout. Reuses the same `.route-error` card styling as the error
 * boundaries so missing pages feel on-brand rather than like a raw 404.
 */
export default function NotFound() {
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
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <h1>Page not found</h1>
        <p>
          We couldn’t find the page you were looking for. It may have moved, or
          the link might be out of date.
        </p>
        <div className="route-error-actions">
          <Link className="btn-primary" href="/projects">
            Back to projects
          </Link>
          <Link className="btn-secondary" href="/">
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}
