"use client";

import { useEffect, useState } from "react";

/**
 * Sticky date/version rail for the changelog (a client island so the page
 * itself stays a server component) — browse every release, jump straight to
 * what changed on a given date. Mirrors DocsToc's IntersectionObserver
 * active-section pattern.
 */

export interface ChangelogNavEntry {
  /** In-page anchor, e.g. "#v0-17". */
  href: string;
  date: string;
  ver: string;
}

export default function ChangelogNav({
  entries,
}: {
  entries: ChangelogNavEntry[];
}) {
  const [active, setActive] = useState<string>(entries[0]?.href.slice(1) ?? "");

  useEffect(() => {
    const ids = entries.map((e) => e.href.slice(1));
    const els = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;

    const observer = new IntersectionObserver(
      (records) => {
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
    <nav className="changelog-nav" aria-label="Browse releases">
      <span className="label-eyebrow">All releases</span>
      {entries.map((e) => {
        const id = e.href.slice(1);
        return (
          <a
            key={e.href}
            href={e.href}
            className={active === id ? "active" : undefined}
            aria-current={active === id ? "true" : undefined}
          >
            <span className="ver">{e.ver}</span>
            <span className="date">{e.date}</span>
          </a>
        );
      })}
    </nav>
  );
}
