"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * Accessible hover/focus tooltip (B7). Unlike the native `title` attribute it
 * shows on keyboard focus (and could be made tap-friendly), and it's a real
 * `role="tooltip"` wired via `aria-describedby`. Wrap any focusable control:
 *   <Tooltip label="Roll back to an earlier checkpoint"><button …/></Tooltip>
 */
export default function Tooltip({
  label,
  placement = "bottom",
  children,
}: {
  label: string;
  placement?: "top" | "bottom" | "left" | "right";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span
      className="tt-wrap"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={() => setOpen(false)}
    >
      <span aria-describedby={open ? id : undefined} style={{ display: "contents" }}>
        {children}
      </span>
      {open && (
        <span role="tooltip" id={id} className={`tt-pop tt-${placement}`}>
          {label}
        </span>
      )}
    </span>
  );
}
