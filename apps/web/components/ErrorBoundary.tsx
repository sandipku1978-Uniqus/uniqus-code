"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Short name of the boundaried region (e.g. "chat", "editor") — shown in
   *  the fallback and the console log so a crash is easy to place. */
  label?: string;
  /** Render-prop fallback; receives the caught error and a reset callback.
   *  When omitted, a built-in fallback card is shown. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** When any entry changes, the boundary clears its error and re-renders the
   *  children. Use it so a recovered context (switched file/session) doesn't
   *  stay stuck on the error screen. */
  resetKeys?: ReadonlyArray<unknown>;
  /** "pane" fills its container (for a whole panel); "inline" is compact (for a
   *  single chat message / small widget). */
  variant?: "pane" | "inline";
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  error: Error | null;
}

function keysChanged(
  a: ReadonlyArray<unknown> | undefined,
  b: ReadonlyArray<unknown> | undefined,
): boolean {
  if (a === b) return false;
  if (!a || !b || a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return true;
  return false;
}

/**
 * Catches render/lifecycle exceptions in its subtree and shows a recoverable
 * fallback instead of letting the error bubble to Next.js's full-page
 * "client-side exception" screen (which unmounts everything — including the
 * in-memory store that holds chat history). Localizing a crash here keeps the
 * rest of the workspace, the WebSocket, and the store alive, so the user
 * doesn't lose unrelated work.
 *
 * Error boundaries only catch errors thrown during React rendering — not in
 * event handlers, timeouts, or async code (those already use try/catch where
 * they matter, e.g. ws-client's onmessage and the chat send path).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const tag = this.props.label ? `ErrorBoundary:${this.props.label}` : "ErrorBoundary";
    // eslint-disable-next-line no-console
    console.error(`[${tag}]`, error, info.componentStack);
    this.props.onError?.(error, info);
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && keysChanged(prev.resetKeys, this.props.resetKeys)) {
      this.reset();
    }
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return (
      <DefaultFallback
        error={error}
        reset={this.reset}
        label={this.props.label}
        variant={this.props.variant ?? "pane"}
      />
    );
  }
}

function DefaultFallback({
  error,
  reset,
  label,
  variant,
}: {
  error: Error;
  reset: () => void;
  label?: string;
  variant: "pane" | "inline";
}) {
  const what = label ? `the ${label}` : "this view";
  if (variant === "inline") {
    return (
      <div className="error-fallback error-fallback-inline" role="alert">
        <span>Couldn’t render {what}.</span>
        <button type="button" className="error-fallback-retry" onClick={reset}>
          Retry
        </button>
      </div>
    );
  }
  return (
    <div className="error-fallback" role="alert">
      <svg
        width="22"
        height="22"
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
      <h3>Something went wrong in {what}.</h3>
      <p>
        The rest of your session is intact — your chat and files are safe. You
        can retry just this part.
      </p>
      {error.message && <pre className="error-fallback-msg">{error.message}</pre>}
      <button type="button" className="btn-secondary" onClick={reset}>
        Retry
      </button>
    </div>
  );
}
