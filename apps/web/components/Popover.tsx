"use client";

import {
  useEffect,
  useId,
  useRef,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useAnchoredPosition, type Placement } from "@/lib/useAnchoredPosition";

/**
 * A floating element (menu / dropdown / popover / tooltip) anchored to a trigger
 * and rendered in a portal at <body> with `position: fixed`. Portaling + fixed
 * is what stops it being clipped by an ancestor's `overflow: hidden` or
 * re-anchored by an ancestor `transform` — the bug every hand-rolled
 * absolutely-positioned dropdown in this app shared. Use this instead of an
 * `position: absolute` child inside a `position: relative` wrapper.
 *
 * Positioning (flip + viewport clamp) comes from useAnchoredPosition. When
 * `onRequestClose` is supplied, the popover also closes itself on Escape and on
 * a pointer-down outside both the anchor and any open popover — clicks inside a
 * nested popover (e.g. a sub-flyout) are ignored via the shared `data-popover`
 * marker, so picking an option in a child menu doesn't tear down its parent.
 */
export default function Popover({
  open,
  anchorRef,
  placement = "bottom-start",
  gap,
  onRequestClose,
  className,
  role,
  ariaLabel,
  id,
  floatingRef,
  style,
  onClick,
  onKeyDown,
  focusOnOpen,
  children,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  placement?: Placement;
  gap?: number;
  /** When set, the popover self-dismisses on outside pointer-down + Escape. */
  onRequestClose?: () => void;
  className?: string;
  role?: string;
  ariaLabel?: string;
  id?: string;
  /** Expose the floating element (focus management, measuring) to the caller. */
  floatingRef?: RefObject<HTMLDivElement | null>;
  style?: CSSProperties;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  /** Move focus into the first/selected control. Menu/listbox roles opt in automatically. */
  focusOnOpen?: boolean;
  children: ReactNode;
}) {
  const innerRef = useRef<HTMLDivElement>(null);
  const ref = floatingRef ?? innerRef;
  const generatedId = useId();
  const popoverId = id ?? `popover-${generatedId.replace(/:/g, "")}`;
  const typeaheadRef = useRef("");
  const typeaheadTimerRef = useRef<number | null>(null);
  const pos = useAnchoredPosition(anchorRef, ref, { open, placement, gap });
  const managesFocus = focusOnOpen ?? (role === "menu" || role === "listbox");

  const focusableItems = (): HTMLElement[] => {
    const root = ref.current;
    if (!root) return [];
    const selector =
      role === "listbox"
        ? '[role="option"]:not([aria-disabled="true"])'
        : role === "menu"
          ? '[role^="menuitem"]:not([aria-disabled="true"]), button:not(:disabled), a[href]'
          : 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
    return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
      (item, index, all) => all.indexOf(item) === index && !item.hidden,
    );
  };

  useEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    anchor?.setAttribute("aria-controls", popoverId);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    let frame = 0;
    if (managesFocus) {
      frame = window.requestAnimationFrame(() => {
        const items = focusableItems();
        if (role === "menu" || role === "listbox") {
          for (const item of items) item.tabIndex = -1;
        }
        const selected = items.find(
          (item) =>
            item.getAttribute("aria-selected") === "true" ||
            item.getAttribute("aria-checked") === "true" ||
            item.dataset.active === "true",
        );
        const target = selected ?? items[0];
        if (target) {
          if (role === "menu" || role === "listbox") target.tabIndex = 0;
          target.focus();
        }
      });
    }
    return () => {
      window.cancelAnimationFrame(frame);
      if (anchor?.getAttribute("aria-controls") === popoverId) {
        anchor.removeAttribute("aria-controls");
      }
      if (typeaheadTimerRef.current !== null) {
        window.clearTimeout(typeaheadTimerRef.current);
        typeaheadTimerRef.current = null;
      }
      const active = document.activeElement;
      if (
        managesFocus &&
        anchor?.isConnected &&
        (active === document.body || ref.current?.contains(active))
      ) {
        anchor.focus();
      } else if (managesFocus && previouslyFocused === anchor && anchor?.isConnected) {
        // Escape/outside close while focus never moved still leaves the trigger stable.
        anchor.focus();
      }
    };
  }, [anchorRef, managesFocus, open, popoverId, ref, role]);

  useEffect(() => {
    if (!open || !onRequestClose) return;
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Element | null;
      if (anchorRef.current?.contains(t as Node)) return;
      // A click inside any popover (this one or a nested/sibling flyout) must not
      // dismiss — the option's own handler manages closing.
      if (t?.closest?.("[data-popover]")) return;
      onRequestClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onRequestClose();
        anchorRef.current?.focus();
      }
    };
    // Capture so we settle the open/close before the target's own click runs.
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onRequestClose, anchorRef, ref]);

  if (!open || typeof document === "undefined") return null;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    onKeyDown?.(event);
    if (event.defaultPrevented || (role !== "menu" && role !== "listbox")) return;
    const items = focusableItems();
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      next = current < 0 ? 0 : (current + 1) % items.length;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      next = current <= 0 ? items.length - 1 : current - 1;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = items.length - 1;
    } else if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      typeaheadRef.current += event.key.toLocaleLowerCase();
      if (typeaheadTimerRef.current !== null) {
        window.clearTimeout(typeaheadTimerRef.current);
      }
      typeaheadTimerRef.current = window.setTimeout(() => {
        typeaheadRef.current = "";
        typeaheadTimerRef.current = null;
      }, 700);
      const query = typeaheadRef.current;
      const ordered = [...items.slice(current + 1), ...items.slice(0, current + 1)];
      const match = ordered.find((item) =>
        (item.textContent ?? "").trim().toLocaleLowerCase().startsWith(query),
      );
      next = match ? items.indexOf(match) : -1;
    }
    if (next < 0) return;
    event.preventDefault();
    for (const item of items) item.tabIndex = -1;
    items[next].tabIndex = 0;
    items[next].focus();
  };

  return createPortal(
    <div
      ref={ref}
      data-popover=""
      className={className}
      role={role}
      aria-label={ariaLabel}
      id={popoverId}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      style={{
        position: "fixed",
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        right: "auto",
        bottom: "auto",
        margin: 0,
        maxHeight: pos?.maxHeight,
        overflowY: "auto",
        // Hidden until measured so it never flashes at 0,0.
        visibility: pos ? "visible" : "hidden",
        ...style,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
