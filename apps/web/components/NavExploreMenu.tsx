"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import Popover from "@/components/Popover";
import { FOOTER_COLUMNS } from "@/components/SiteFooter";

/**
 * "Explore" nav dropdown — surfaces every marketing page one click from the
 * top of the site instead of only from the footer at the very bottom.
 * Reuses FOOTER_COLUMNS as the single source of truth so the two link lists
 * can't drift; `excludeHrefs` drops whatever a given nav already links to
 * directly, so the dropdown only ever adds pages, never repeats one.
 */
export default function NavExploreMenu({
  excludeHrefs = [],
}: {
  excludeHrefs?: string[];
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const columns = FOOTER_COLUMNS.filter((c) => c.title !== "Legal")
    .map((c) => ({
      ...c,
      links: c.links.filter((l) => !excludeHrefs.includes(l.href)),
    }))
    .filter((c) => c.links.length > 0);

  if (columns.length === 0) return null;

  return (
    <div className="nav-explore">
      <button
        ref={triggerRef}
        type="button"
        className={`nav-explore-trigger${open ? " open" : ""}`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Explore
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden focusable="false">
          <path
            d="M2 3.5 5 6.5 8 3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <Popover
        open={open}
        anchorRef={triggerRef}
        placement="bottom-start"
        gap={10}
        onRequestClose={() => setOpen(false)}
        className="nav-explore-panel"
        role="menu"
        ariaLabel="Explore Uniqus Code"
      >
        {columns.map((column) => (
          <div className="nav-explore-col" key={column.title}>
            <span className="nav-explore-heading">{column.title}</span>
            {column.links.map((link) => (
              <Link
                href={link.href}
                key={link.href}
                role="menuitem"
                onClick={() => setOpen(false)}
              >
                {link.label}
              </Link>
            ))}
          </div>
        ))}
      </Popover>
    </div>
  );
}
