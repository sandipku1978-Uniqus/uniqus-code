"use client";

import type { CSSProperties } from "react";

/**
 * Shimmering placeholder block used while data loads. Renders a single inline
 * element with the `.skeleton` class (subtle elevated background + pulse
 * keyframe, both defined in globals.css). Pass explicit `width`/`height` to
 * size it; numbers are treated as pixels. Compose several of these to mock
 * the shape of the content that's about to appear (a card, a row, a chip).
 */
export function Skeleton({
  width,
  height,
  radius,
  className,
}: {
  width?: string | number;
  height?: string | number;
  radius?: number;
  className?: string;
}) {
  const style: CSSProperties = {
    width,
    height,
    ...(radius !== undefined ? { borderRadius: radius } : null),
  };
  return (
    <span
      className={`skeleton ${className ?? ""}`}
      style={style}
      aria-hidden="true"
    />
  );
}
