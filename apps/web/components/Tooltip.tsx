"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Popover from "./Popover";
import type { Placement } from "@/lib/useAnchoredPosition";

const TT_PLACEMENT: Record<"top" | "bottom" | "left" | "right", Placement> = {
  top: "top-center",
  bottom: "bottom-center",
  left: "left-center",
  right: "right-center",
};

/**
 * Accessible hover/focus tooltip (B7). Unlike the native `title` attribute it
 * shows on keyboard focus (and could be made tap-friendly), and it's a real
 * `role="tooltip"` wired via `aria-describedby`. Wrap any focusable control:
 *   <Tooltip label="Roll back to an earlier checkpoint"><button …/></Tooltip>
 *
 * The bubble is portaled (via Popover) so it's never clipped by a toolbar's
 * `overflow` — it positions against the wrapper and flips to stay on screen.
 */
export default function Tooltip({
  label,
  placement = "bottom",
  children,
}: {
  label: ReactNode;
  placement?: "top" | "bottom" | "left" | "right";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const describedRef = useRef<HTMLElement | null>(null);

  useEffect(
    () => () => describedRef.current?.removeAttribute("aria-describedby"),
    [],
  );
  return (
    <span
      ref={wrapRef}
      className="tt-wrap"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!wrapRef.current?.contains(document.activeElement)) setOpen(false);
      }}
      onFocusCapture={(event) => {
        const target = event.target as HTMLElement;
        describedRef.current?.removeAttribute("aria-describedby");
        describedRef.current = target;
        target.setAttribute("aria-describedby", id);
        setOpen(true);
      }}
      onBlurCapture={(event) => {
        if (wrapRef.current?.contains(event.relatedTarget as Node | null)) return;
        describedRef.current?.removeAttribute("aria-describedby");
        describedRef.current = null;
        setOpen(false);
      }}
    >
      <span style={{ display: "contents" }}>{children}</span>
      <Popover
        open={open}
        anchorRef={wrapRef}
        placement={TT_PLACEMENT[placement]}
        role="tooltip"
        id={id}
        className="tt-pop"
      >
        {label}
      </Popover>
    </span>
  );
}
