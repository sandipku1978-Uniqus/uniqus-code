"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  type RefObject,
} from "react";

// useLayoutEffect warns when run during SSR; this hook backs widely server-
// rendered components (e.g. Tooltip). Fall back to useEffect on the server.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export type Side = "top" | "bottom" | "left" | "right";
export type Align = "start" | "center" | "end";
/** e.g. "bottom-start", "top-center", "right-start". */
export type Placement = `${Side}-${Align}`;

export interface AnchoredPosition {
  top: number;
  left: number;
  /** Viewport-bounded height cap so a tall menu scrolls instead of overflowing. */
  maxHeight: number;
}

export interface AnchoredOptions {
  open: boolean;
  placement?: Placement;
  /** Distance between the anchor and the floating element, in px. */
  gap?: number;
  /** Minimum distance kept from the viewport edges, in px. */
  margin?: number;
}

/**
 * Compute `position: fixed` coordinates for a floating element (menu, popover,
 * tooltip) anchored to a trigger, so it can be portaled to <body> and never be
 * clipped by an ancestor's `overflow: hidden` — nor mis-placed by an ancestor
 * `transform` (which silently turns `fixed` into `absolute`). This is the shared
 * fix for every dropdown in the app.
 *
 * The element flips to the opposite side when it would overflow, aligns on the
 * cross axis (start / center / end), and is clamped within the viewport. Pass
 * the floating element's own ref so its measured size feeds the math; render it
 * hidden until the returned position is non-null to avoid a flash at 0,0.
 *
 * Recomputes on open and on any scroll/resize while open.
 */
export function useAnchoredPosition(
  anchorRef: RefObject<HTMLElement | null>,
  floatingRef: RefObject<HTMLElement | null>,
  { open, placement = "bottom-start", gap = 6, margin = 8 }: AnchoredOptions,
): AnchoredPosition | null {
  const [pos, setPos] = useState<AnchoredPosition | null>(null);

  const place = useCallback((): void => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const a = anchor.getBoundingClientRect();
    const floating = floatingRef.current;
    const fw = floating?.offsetWidth ?? 0;
    const fh = floating?.offsetHeight ?? 0;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const [side, align] = placement.split("-") as [Side, Align];

    let top = 0;
    let left = 0;

    if (side === "bottom" || side === "top") {
      // Primary axis (vertical) with flip.
      const below = a.bottom + gap;
      const above = a.top - gap - fh;
      if (side === "bottom") {
        top = below + fh > vh - margin && above >= margin ? above : below;
      } else {
        top = above < margin && below + fh <= vh - margin ? below : above;
      }
      // Cross axis (horizontal) alignment.
      if (align === "end") left = a.right - fw;
      else if (align === "center") left = a.left + a.width / 2 - fw / 2;
      else left = a.left;
    } else {
      // Primary axis (horizontal) with flip.
      const after = a.right + gap;
      const before = a.left - gap - fw;
      if (side === "right") {
        left = after + fw > vw - margin && before >= margin ? before : after;
      } else {
        left = before < margin && after + fw <= vw - margin ? after : before;
      }
      // Cross axis (vertical) alignment.
      if (align === "end") top = a.bottom - fh;
      else if (align === "center") top = a.top + a.height / 2 - fh / 2;
      else top = a.top;
    }

    // Final clamp so the element always stays fully on screen.
    left = Math.max(margin, Math.min(left, vw - fw - margin));
    top = Math.max(margin, Math.min(top, vh - fh - margin));

    setPos({ top, left, maxHeight: vh - margin * 2 });
  }, [anchorRef, floatingRef, placement, gap, margin]);

  useIsomorphicLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
    // `true` (capture) catches scrolls in any scroll container, not just window,
    // so the menu tracks its anchor inside scrollable panes.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  return pos;
}
