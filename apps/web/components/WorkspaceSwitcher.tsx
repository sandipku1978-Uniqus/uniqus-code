"use client";

import { useRef, useState } from "react";
import type { Organization } from "@gate15/api-types";
import Popover from "./Popover";

/**
 * Dashboard workspace selector (P3.1) — the Vercel/Linear-style context switcher
 * that sits at the top of the project sidebar. The active workspace is either the
 * user's Personal space (null) or one of their organizations; switching it scopes
 * the whole dashboard (project list, new-project target, the org nav group).
 *
 * House design language: a hairline-bordered trigger with a compact identity tile,
 * a mono micro-label for the workspace kind, and magenta as the only accent (the
 * active row's check + left rail). Organizations use a neutral placeholder until
 * custom logos are supported. Self-contained: it owns only its open state; the
 * selected id and the org list are lifted to the ProjectPicker.
 */

const mono: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "var(--fs-2xs)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--text-dim)",
};

function monogram(label: string): string {
  return (label.trim()[0] ?? "?").toUpperCase();
}

function OrganizationPlaceholder() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 20h14" />
      <path d="M7 20V7l5-3 5 3v13" />
      <path d="M10 9h.01M14 9h.01M10 13h.01M14 13h.01" />
      <path d="M10 20v-3h4v3" />
    </svg>
  );
}

function Tile({ label, personal }: { label: string; personal?: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        width: 26,
        height: 26,
        flex: "0 0 auto",
        borderRadius: "var(--radius-md)",
        display: "grid",
        placeItems: "center",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-sm)",
        color: "var(--text-muted)",
        background: "var(--bg-surface-active)",
        border: personal ? "none" : "1px solid var(--border-default)",
      }}
    >
      {personal ? monogram(label) : <OrganizationPlaceholder />}
    </span>
  );
}

export default function WorkspaceSwitcher({
  orgs,
  activeWorkspaceId,
  personalLabel,
  onSelect,
  onCreate,
}: {
  orgs: Organization[];
  activeWorkspaceId: string | null;
  personalLabel: string;
  onSelect: (id: string | null) => void;
  onCreate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  const activeOrg = activeWorkspaceId ? orgs.find((o) => o.id === activeWorkspaceId) ?? null : null;
  const activeName = activeOrg ? activeOrg.name : personalLabel;
  const activeKind = activeOrg ? "Organization" : "Personal";

  function pick(id: string | null) {
    setOpen(false);
    if (id !== activeWorkspaceId) onSelect(id);
  }

  const rowBase: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    textAlign: "left",
    padding: "9px 12px",
    background: "transparent",
    color: "var(--text-primary)",
    cursor: "pointer",
    font: "inherit",
    border: "none",
    borderLeft: "2px solid transparent",
  };

  function Row({
    id,
    name,
    sub,
    personal,
  }: {
    id: string | null;
    name: string;
    sub: string;
    personal?: boolean;
  }) {
    const active = id === activeWorkspaceId;
    return (
      <button
        type="button"
        role="menuitemradio"
        aria-checked={active}
        onClick={() => pick(id)}
        style={{
          ...rowBase,
          borderLeft: active ? "2px solid var(--brand-ember)" : "2px solid transparent",
          background: active ? "var(--bg-surface-active)" : "transparent",
        }}
      >
        <Tile label={name} personal={personal} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              display: "block",
              fontSize: "var(--fs-md)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {name}
          </span>
          <span style={{ ...mono, display: "block" }}>{sub}</span>
        </span>
        {active && (
          <span aria-hidden style={{ color: "var(--accent-text)", fontSize: "var(--fs-sm)" }}>
            ✓
          </span>
        )}
      </button>
    );
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Switch workspace"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          padding: "8px 10px",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-default)",
          borderRadius: "var(--radius-lg)",
          color: "var(--text-primary)",
          cursor: "pointer",
          font: "inherit",
        }}
      >
        <Tile label={activeName} personal={!activeOrg} />
        <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
          <span
            style={{
              display: "block",
              fontSize: "var(--fs-md)",
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {activeName}
          </span>
          <span style={{ ...mono, display: "block" }}>{activeKind}</span>
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden style={{ color: "var(--text-dim)", flex: "0 0 auto" }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      <Popover
        open={open}
        anchorRef={anchorRef}
        placement="bottom-start"
        gap={6}
        onRequestClose={() => setOpen(false)}
        role="menu"
        ariaLabel="Workspaces"
        style={{
          minWidth: Math.max(anchorRef.current?.offsetWidth ?? 240, 240),
          background: "var(--bg-elev)",
          border: "1px solid var(--border-default)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg, 0 12px 32px rgba(0,0,0,0.35))",
          padding: "6px 0",
          overflow: "hidden",
        }}
      >
        <div style={{ ...mono, padding: "4px 12px 6px" }}>Personal</div>
        <Row id={null} name={personalLabel} sub="Your private projects" personal />

        {orgs.length > 0 && (
          <>
            <div style={{ ...mono, padding: "8px 12px 6px", borderTop: "1px solid var(--border-light)", marginTop: 4 }}>
              Organizations
            </div>
            {orgs.map((o) => (
              <Row
                key={o.id}
                id={o.id}
                name={o.name}
                sub={o.monthly_budget_usd == null ? "Shared workspace" : `Cap $${o.monthly_budget_usd}/mo`}
              />
            ))}
          </>
        )}

        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setOpen(false);
            onCreate();
          }}
          style={{
            ...rowBase,
            borderTop: "1px solid var(--border-light)",
            marginTop: 4,
            color: "var(--accent-text)",
          }}
        >
          <span
            aria-hidden
            style={{
              width: 26,
              height: 26,
              flex: "0 0 auto",
              borderRadius: "var(--radius-md)",
              display: "grid",
              placeItems: "center",
              border: "1px dashed color-mix(in srgb, var(--brand-ember) 45%, transparent)",
              fontSize: "var(--fs-md)",
            }}
          >
            +
          </span>
          <span style={{ fontSize: "var(--fs-md)" }}>Create organization</span>
        </button>
      </Popover>
    </>
  );
}
