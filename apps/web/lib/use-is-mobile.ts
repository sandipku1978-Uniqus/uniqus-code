"use client";

import { useEffect, useState } from "react";

/**
 * Track whether the viewport matches a (phone-sized) media query. SSR-safe:
 * starts `false` on the server and on first client render, then syncs to the
 * real match in an effect — so it never causes a hydration mismatch (the
 * desktop layout is the SSR default; mobile swaps in after mount).
 *
 * Shared breakpoint with the workspace mobile CSS in globals.css (760px).
 */
export function useIsMobile(query = "(max-width: 760px)"): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const sync = () => setIsMobile(mql.matches);
    sync();
    // addEventListener("change") is the modern API; older Safari only has
    // addListener. Prefer the former, fall back for ancient WebKit.
    if (mql.addEventListener) {
      mql.addEventListener("change", sync);
      return () => mql.removeEventListener("change", sync);
    }
    mql.addListener(sync);
    return () => mql.removeListener(sync);
  }, [query]);

  return isMobile;
}
