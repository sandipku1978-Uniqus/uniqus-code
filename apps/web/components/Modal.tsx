"use client";

import { useEffect, useRef, type ReactNode, type CSSProperties } from "react";

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

// Module-level counter so nested/stacked modals don't prematurely release the
// body scroll-lock when the inner one closes.
let openModalCount = 0;

export default function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 640,
  maxHeight = "85vh",
  bodyStyle,
  labelId = "modal-title",
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
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prevActive = document.activeElement as HTMLElement | null;

    openModalCount += 1;
    document.body.style.overflow = "hidden";

    const card = cardRef.current;
    // Focus the first focusable control, falling back to the card itself.
    const initial = card?.querySelector<HTMLElement>(FOCUSABLE);
    (initial ?? card)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !card) return;
      const nodes = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
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
      openModalCount = Math.max(0, openModalCount - 1);
      if (openModalCount === 0) document.body.style.overflow = "";
      prevActive?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={cardRef}
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={
          {
            "--modal-w": `${width}px`,
            "--modal-h": maxHeight,
          } as CSSProperties
        }
      >
        <div className="modal-head">
          <div>
            <div className="modal-title" id={labelId}>
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
            ✕
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
