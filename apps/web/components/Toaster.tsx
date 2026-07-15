"use client";

import { useEffect } from "react";
import { useToastStore, type ToastItem } from "@/lib/toast";

/**
 * Renders the global toast stack inside a polite `aria-live` region so every
 * toast is announced to screen readers (UI/UX audit §E — feedback was
 * previously invisible to assistive tech). Mounted once in the root layout.
 */
export default function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div className="toast-region" role="region" aria-label="Notifications">
      <div aria-live="polite" aria-atomic="false" className="toast-stack">
        {toasts.map((t) => (
          <ToastRow key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </div>
  );
}

function ToastRow({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  useEffect(() => {
    if (toast.duration <= 0) return;
    const handle = window.setTimeout(onDismiss, toast.duration);
    return () => window.clearTimeout(handle);
    // onDismiss is a fresh closure each render but stable in behaviour; the
    // timer is keyed to this toast's lifetime, which is what we want.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.id, toast.duration]);

  // Errors get role="alert" (assertive) so they interrupt; success/info ride
  // the polite live region from the parent.
  return (
    <div
      className={`toast toast-${toast.kind}`}
      role={toast.kind === "error" ? "alert" : "status"}
    >
      <span className="toast-icon" aria-hidden="true">
        {toast.kind === "success" ? "✓" : toast.kind === "error" ? "!" : "i"}
      </span>
      <span className="toast-msg">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            toast.action?.onClick();
            onDismiss();
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        className="toast-close"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        title="Dismiss"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
