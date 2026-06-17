"use client";

import { useEffect, useState } from "react";

/**
 * Sticky table-of-contents rail for the docs page (a client island so the page
 * itself stays a server component). An IntersectionObserver tracks which section
 * is near the top of the viewport and highlights its entry — the "every state
 * gets craft" finish a long reference page needs. Pure-CSS sticky handles the
 * positioning; this only adds the active-section signal.
 */

export interface DocsTocEntry {
  /** In-page hash, e.g. "#create". */
  href: string;
  label: string;
  /** Mono index shown before the label, e.g. "01" (or "00" for the overview). */
  n: string;
}

export default function DocsToc({ entries }: { entries: DocsTocEntry[] }) {
  const [active, setActive] = useState<string>(entries[0]?.href.slice(1) ?? "");

  useEffect(() => {
    const ids = entries.map((e) => e.href.slice(1));
    const els = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;

    const observer = new IntersectionObserver(
      (records) => {
        // Highlight the topmost section currently crossing the upper band of the
        // viewport (rootMargin pulls the trigger line down from the fixed nav and
        // up from the fold so the active item changes as you read, not at the
        // very edge).
        const visible = records
          .filter((r) => r.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-96px 0px -66% 0px", threshold: 0 },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [entries]);

  return (
    <nav className="mk-docs-toc" aria-label="On this page">
      <span className="label-eyebrow">On this page</span>
      {entries.map((e) => {
        const id = e.href.slice(1);
        return (
          <a
            key={e.href}
            href={e.href}
            className={active === id ? "active" : undefined}
            aria-current={active === id ? "true" : undefined}
          >
            <span className="n" aria-hidden>
              {e.n}
            </span>
            <span>{e.label}</span>
          </a>
        );
      })}
    </nav>
  );
}
