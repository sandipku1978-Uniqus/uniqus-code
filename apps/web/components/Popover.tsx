"use client";

import {
  useEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useAnchoredPosition, type Placement } from "@/lib/useAnchoredPosition";

/**
 * A floating element (menu / dropdown / popover / tooltip) anchored to a trigger
 * and rendered in a portal at <body> with `position: fixed`. Portaling + fixed
 * is what stops it being clipped by an ancestor's `overflow: hidden` or
 * re-anchored by an ancestor `transform` — the bug every hand-rolled
 * absolutely-positioned dropdown in this app shared. Use this instead of an
 * `position: absolute` child inside a `position: relative` wrapper.
 *
 * Positioning (flip + viewport clamp) comes from useAnchoredPosition. When
 * `onRequestClose` is supplied, the popover also closes itself on Escape and on
 * a pointer-down outside both the anchor and any open popover — clicks inside a
 * nested popover (e.g. a sub-flyout) are ignored via the shared `data-popover`
 * marker, so picking an option in a child menu doesn't tear down its parent.
 */
export default function Popover({
  open,
  anchorRef,
  placement = "bottom-start",
  gap,
  onRequestClose,
  className,
  role,
  ariaLabel,
  id,
  floatingRef,
  style,
  onClick,
  onKeyDown,
  children,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  placement?: Placement;
  gap?: number;
  /** When set, the popover self-dismisses on outside pointer-down + Escape. */
  onRequestClose?: () => void;
  className?: string;
  role?: string;
  ariaLabel?: string;
  id?: string;
  /** Expose the floating element (focus management, measuring) to the caller. */
  floatingRef?: RefObject<HTMLDivElement | null>;
  style?: CSSProperties;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  const innerRef = useRef<HTMLDivElement>(null);
  const ref = floatingRef ?? innerRef;
  const pos = useAnchoredPosition(anchorRef, ref, { open, placement, gap });

  useEffect(() => {
    if (!open || !onRequestClose) return;
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Element | null;
      if (anchorRef.current?.contains(t as Node)) return;
      // A click inside any popover (this one or a nested/sibling flyout) must not
      // dismiss — the option's own handler manages closing.
      if (t?.closest?.("[data-popover]")) return;
      onRequestClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onRequestClose();
    };
    // Capture so we settle the open/close before the target's own click runs.
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onRequestClose, anchorRef, ref]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={ref}
      data-popover=""
      className={className}
      role={role}
      aria-label={ariaLabel}
      id={id}
      onClick={onClick}
      onKeyDown={onKeyDown}
      style={{
        position: "fixed",
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        right: "auto",
        bottom: "auto",
        margin: 0,
        maxHeight: pos?.maxHeight,
        overflowY: "auto",
        // Hidden until measured so it never flashes at 0,0.
        visibility: pos ? "visible" : "hidden",
        ...style,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
