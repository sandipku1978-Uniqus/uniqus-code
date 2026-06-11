"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useStore } from "@/lib/store";

// Only one coachmark may be on screen at a time so a first-time user isn't
// swarmed (the plan's "wizard and coachmarks don't fire simultaneously" rule).
// Module-level claim: the first unseen Coachmark to mount wins the slot; the
// rest wait until it's dismissed and re-evaluate.
let activeCoachmark: string | null = null;
const waiters = new Set<() => void>();
function claimSlot(id: string): boolean {
  if (activeCoachmark === null || activeCoachmark === id) {
    activeCoachmark = id;
    return true;
  }
  return false;
}
function releaseSlot(id: string): void {
  if (activeCoachmark === id) {
    activeCoachmark = null;
    for (const w of waiters) w();
  }
}

/**
 * One-time anchored coachmark (B7): a small dismissible callout next to a
 * control, shown once per user (gated on `seenHints[id]`, persisted to
 * localStorage). Use for the genuinely-non-obvious affordances — the
 * Builder↔Code toggle, Rewind, Secrets, the Plan toggle.
 */
export default function Coachmark({
  id,
  title,
  body,
  placement = "bottom",
  children,
}: {
  id: string;
  title: string;
  body: string;
  placement?: "top" | "bottom" | "left" | "right";
  children: ReactNode;
}) {
  const seen = useStore((s) => s.seenHints[id]);
  const markHintSeen = useStore((s) => s.markHintSeen);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (seen) return;
    let cancelled = false;
    const tryShow = () => {
      if (cancelled || seen) return;
      if (claimSlot(id)) setShow(true);
    };
    // Small delay so the anchor is laid out and quick navigations don't flash it.
    const t = setTimeout(tryShow, 700);
    waiters.add(tryShow);
    return () => {
      cancelled = true;
      clearTimeout(t);
      waiters.delete(tryShow);
      releaseSlot(id);
    };
  }, [id, seen]);

  const dismiss = () => {
    setShow(false);
    releaseSlot(id);
    markHintSeen(id);
  };

  return (
    <span className="cm-wrap">
      {children}
      {show && !seen && (
        <div className={`cm-pop cm-${placement}`} role="dialog" aria-label={title}>
          <div className="cm-title">{title}</div>
          <div className="cm-body">{body}</div>
          <div className="cm-actions">
            <button type="button" className="cm-dismiss" onClick={dismiss}>
              Got it
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
