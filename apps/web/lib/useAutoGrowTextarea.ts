import { useCallback, useEffect, type RefObject } from "react";

/**
 * Grow a textarea with its content up to ~`maxLines`, then scroll. The cap also
 * tracks the viewport so a long draft never swallows a short (mobile) screen —
 * phones get a tighter fraction. Shared by every composer (landing hero,
 * dashboard, workspace) so they all expand identically. Line height is read
 * from the element, so each box's own font sizing is respected.
 */
export function useAutoGrowTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  maxLines = 10,
): void {
  const resize = useCallback(() => {
    const ta = ref.current;
    if (!ta || typeof window === "undefined") return;
    ta.style.height = "auto";
    const cs = window.getComputedStyle(ta);
    const fontSize = parseFloat(cs.fontSize) || 14;
    // getComputedStyle usually resolves line-height to px, but fall back for
    // "normal" or a bare unitless multiplier.
    const lhRaw = cs.lineHeight;
    let lineHeight: number;
    if (lhRaw === "normal") {
      lineHeight = fontSize * 1.2;
    } else {
      const n = parseFloat(lhRaw);
      lineHeight = !n ? fontSize * 1.2 : n > 4 ? n : n * fontSize;
    }
    const padding =
      (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const vh = window.innerHeight || 800;
    const isNarrow = window.innerWidth <= 760;
    const lineCap = lineHeight * maxLines + padding;
    const viewportCap = Math.round(vh * (isNarrow ? 0.3 : 0.45));
    const maxHeight = Math.min(lineCap, viewportCap);
    ta.style.height = `${Math.min(ta.scrollHeight, maxHeight)}px`;
    ta.style.overflowY = ta.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [ref, maxLines]);

  // Recompute on every content change.
  useEffect(() => {
    resize();
  }, [value, resize]);

  // Recompute on viewport changes (rotation, on-screen keyboard) so the cap
  // tracks the live screen height.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [resize]);

  // Recompute when the textarea's own width changes (pane switches, the first
  // mobile layout pass). scrollHeight depends on width — a measure taken while
  // the box was momentarily narrow (placeholder wrapped into many lines) would
  // otherwise stick as a huge inline height.
  useEffect(() => {
    const ta = ref.current;
    if (!ta || typeof ResizeObserver === "undefined") return;
    let lastWidth = ta.clientWidth;
    const ro = new ResizeObserver(() => {
      if (ta.clientWidth !== lastWidth) {
        lastWidth = ta.clientWidth;
        resize();
      }
    });
    ro.observe(ta);
    return () => ro.disconnect();
  }, [resize, ref]);
}
