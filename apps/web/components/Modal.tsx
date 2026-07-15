"use client";

import { useEffect, useId, useRef, type ReactNode, type CSSProperties } from "react";

/**
 * Shared modal primitive. Every overlay in the app used to hand-roll its own
 * backdrop, card, header, close button, and (inconsistently) escape handling —
 * they disagreed on backdrop opacity, radius, shadow, and close affordance.
 *
 * This centralises the chrome AND the behaviour that was missing almost
 * everywhere: Escape-to-close, backdrop-click-to-close, body scroll-lock,
 * `role="dialog"` + `aria-modal`, initial focus, a Tab focus-trap, and focus
 * restoration to the trigger on close.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Module-level stack of mounted-modal ids. Only the topmost id reacts to Escape
// and Tab, so a stacked confirm dialog owns the keyboard without its parent's
// listener also firing (which double-closed the parent on Escape and fought the
// focus-trap on Tab). The body scroll-lock is released only once the last modal
// unmounts.
let modalStack: number[] = [];
let nextModalId = 1;

export default function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 640,
  maxHeight = "85vh",
  bodyStyle,
  labelId,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  maxHeight?: string;
  bodyStyle?: CSSProperties;
  labelId?: string;
}) {
  // Per-instance default so stacked dialogs don't all share id="modal-title"
  // (which made aria-labelledby on a confirm dialog resolve to the PARENT's
  // title — the confirm was announced with the wrong name to screen readers).
  const autoId = useId();
  const resolvedLabelId = labelId ?? autoId;
  const cardRef = useRef<HTMLDivElement>(null);
  // Latest onClose, read by the keydown handler. Lets the mount effect run with
  // an empty dep array so this modal's position in the stack is stable — pushed
  // once on mount, not re-pushed (to the top) whenever onClose identity changes.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Track where the mouse went DOWN so a drag that starts inside the card (e.g.
  // selecting text in an input) and releases over the dim backdrop doesn't close
  // the dialog and discard the in-progress edit. We only close when BOTH the
  // press and the release happen on the overlay itself.
  const pressedOnOverlay = useRef(false);

  useEffect(() => {
    const prevActive = document.activeElement as HTMLElement | null;

    const id = nextModalId++;
    modalStack.push(id);
    document.body.style.overflow = "hidden";

    const card = cardRef.current;
    // Focus the first focusable control, falling back to the card itself.
    const initial = card?.querySelector<HTMLElement>(FOCUSABLE);
    (initial ?? card)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      // Only the topmost modal in the stack handles keys — otherwise every
      // mounted modal's document-level listener would fire on one keypress
      // (double-close on Escape, duelling focus-traps on Tab).
      if (modalStack[modalStack.length - 1] !== id) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !card) return;
      const nodes = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (nodes.length === 0) {
        // Nothing focusable inside — keep focus on the card so Tab can't escape.
        e.preventDefault();
        card.focus();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;
      // If focus has somehow left the dialog (on the body, the card itself, or a
      // node filtered out as hidden), pull it back in rather than letting Tab
      // walk out into the browser chrome.
      if (!active || !card.contains(active) || !nodes.includes(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      const i = modalStack.indexOf(id);
      if (i !== -1) modalStack.splice(i, 1);
      if (modalStack.length === 0) document.body.style.overflow = "";
      prevActive?.focus?.();
    };
    // Mount/unmount only — onClose is read through onCloseRef so changing it
    // doesn't reshuffle the modal stack.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        pressedOnOverlay.current = e.target === e.currentTarget;
      }}
      onMouseUp={(e) => {
        if (e.target === e.currentTarget && pressedOnOverlay.current) onClose();
        pressedOnOverlay.current = false;
      }}
    >
      <div
        ref={cardRef}
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={resolvedLabelId}
        tabIndex={-1}
        style={
          {
            "--modal-w": `${width}px`,
            "--modal-h": maxHeight,
          } as CSSProperties
        }
      >
        <div className="modal-head">
          <div>
            <div className="modal-title" id={resolvedLabelId}>
              {title}
            </div>
            {subtitle && <div className="modal-sub">{subtitle}</div>}
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
            title="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="modal-body" style={bodyStyle}>
          {children}
        </div>

        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
