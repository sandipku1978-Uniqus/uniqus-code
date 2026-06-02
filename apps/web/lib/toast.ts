"use client";

import { create } from "zustand";

/**
 * Global toast/notification system (UI/UX audit §E).
 *
 * Before this, success/failure feedback was scattered — some surfaces dropped a
 * transient chat `system` line, some set an inline error string, many did
 * nothing — and none of it was announced to screen readers. This is the single
 * app-wide channel: `toast.success/error/info(...)` from anywhere, rendered by
 * <Toaster/> (mounted once in the root layout) inside an `aria-live` region.
 *
 * Kept as its own tiny store rather than folded into the big workspace store so
 * non-workspace surfaces (landing, login, dashboard) can use it without pulling
 * in project/chat state, and so a toast can outlive a project `reset()`.
 */
export type ToastKind = "success" | "error" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  /** Auto-dismiss after this many ms. 0 = sticky (must be dismissed/actioned). */
  duration: number;
  action?: ToastAction;
}

interface ToastState {
  toasts: ToastItem[];
  push: (toast: Omit<ToastItem, "id">) => number;
  dismiss: (id: number) => void;
  clear: () => void;
}

// Module-level monotonic id — avoids Date.now()/Math.random() and is stable
// across renders so React keys don't churn.
let nextToastId = 1;

const DEFAULT_DURATION = 4500;
const ERROR_DURATION = 7000;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) => {
    const id = nextToastId++;
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

function show(
  kind: ToastKind,
  message: string,
  opts?: { duration?: number; action?: ToastAction },
): number {
  return useToastStore.getState().push({
    kind,
    message,
    duration: opts?.duration ?? (kind === "error" ? ERROR_DURATION : DEFAULT_DURATION),
    action: opts?.action,
  });
}

/**
 * Fire a toast from anywhere (event handlers, async catches, ws-client). Errors
 * stick around a little longer; pass `{ duration: 0 }` for a sticky toast that
 * only clears on dismiss or its action.
 */
export const toast = {
  success: (message: string, opts?: { duration?: number; action?: ToastAction }) =>
    show("success", message, opts),
  error: (message: string, opts?: { duration?: number; action?: ToastAction }) =>
    show("error", message, opts),
  info: (message: string, opts?: { duration?: number; action?: ToastAction }) =>
    show("info", message, opts),
  dismiss: (id: number) => useToastStore.getState().dismiss(id),
};
