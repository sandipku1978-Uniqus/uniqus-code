import type { ReactNode } from "react";

type StatusTone = "live" | "warn" | "danger" | "dim";

export function OrgPageHeader({
  index,
  title,
  accent,
  lede,
  status,
  statusTone = "live",
  context,
}: {
  index: string;
  title: string;
  accent: string;
  lede: ReactNode;
  status: string;
  statusTone?: StatusTone;
  context: string;
}) {
  return (
    <header className="org-hero">
      <div className="org-hero-copy">
        <span className="page-eyebrow">Organization workspace</span>
        <h1>
          {title} <span className="grad">{accent}</span>
        </h1>
        <p className="lede">{lede}</p>
      </div>
      <div className="org-hero-meta" aria-label={`${context}: ${status}`}>
        <span className="org-hero-index" aria-hidden="true">
          {index}
        </span>
        <div>
          <span className="org-hero-context">{context}</span>
          <strong className="org-status">
            <span className={`org-status-dot ${statusTone}`} aria-hidden="true" />
            {status}
          </strong>
        </div>
      </div>
    </header>
  );
}

export function OrgMetricRail({ children }: { children: ReactNode }) {
  return <div className="metric-strip org-metric-strip">{children}</div>;
}

export function OrgMetric({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="metric-cell">
      <span className="metric-value">{value}</span>
      <span className="metric-label">{label}</span>
    </div>
  );
}

export function OrgStatePanel({
  state,
  title,
  body,
  onRetry,
}: {
  state: "loading" | "error" | "empty";
  title: string;
  body: string;
  onRetry?: () => void;
}) {
  const label = state === "loading" ? "Loading" : state === "error" ? "Needs attention" : "Ready";
  const tone: StatusTone = state === "error" ? "danger" : state === "loading" ? "warn" : "dim";

  return (
    <section className={`org-state-panel ${state}`} aria-live="polite">
      <span className="org-status">
        <span className={`org-status-dot ${tone}`} aria-hidden="true" />
        {label}
      </span>
      <h2>{title}</h2>
      <p>{body}</p>
      {state === "loading" && (
        <div className="org-state-lines" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      )}
      {onRetry && (
        <button type="button" className="btn-secondary" onClick={onRetry}>
          Try again
        </button>
      )}
    </section>
  );
}
