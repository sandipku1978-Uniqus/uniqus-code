"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { PreviewServer } from "@uniqus/api-types";
import { useIsMobile } from "@/lib/use-is-mobile";
import { useStore, type SelectedElement } from "@/lib/store";
import { toast } from "@/lib/toast";
import PreviewAnnotator from "./PreviewAnnotator";

// Match the page's TLS state for the dev fallback so the iframe doesn't get
// mixed-content blocked when the app is loaded over HTTPS. Production should
// always set NEXT_PUBLIC_ORCHESTRATOR_URL explicitly.
const ORCHESTRATOR_URL =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ??
  (typeof window !== "undefined"
    ? window.location.protocol === "https:"
      ? `https://${window.location.hostname}`
      : `http://${window.location.hostname}:8787`
    : "");

interface PreviewNavMessage {
  type: "uniqus:preview-nav";
  server_id: string;
  path: string;
}

function isPreviewNavMessage(data: unknown): data is PreviewNavMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "uniqus:preview-nav" &&
    typeof (data as { server_id?: unknown }).server_id === "string" &&
    typeof (data as { path?: unknown }).path === "string"
  );
}

/**
 * Shared element-picker contract (C) — mirrored by the proxy-injected script.
 *
 *   parent → iframe : { type: "uniqus:picker", active: boolean }
 *       We post this into the preview's window to turn pick-mode on/off. The
 *       injected script arms hover/click tracking while active and suppresses
 *       the page's own click handling so picking never navigates the app.
 *
 *   iframe → parent : { type: "uniqus:element", selector, tag, classes, id,
 *                       rect, text }
 *       Posted when the user clicks an element in pick-mode. `rect` is the
 *       element's getBoundingClientRect() in the iframe's own CSS pixels.
 *
 * The control message direction isn't pinned by the prose contract (which only
 * documents the `uniqus:element` payload), so it's defined here and kept
 * deliberately symmetric/namespaced so the script half can match it 1:1.
 */
const PICKER_CONTROL_TYPE = "uniqus:picker";
const ELEMENT_MESSAGE_TYPE = "uniqus:element";

/** Coerce a (possibly slightly off-shape) inbound message into a SelectedElement. */
function parseElementMessage(data: unknown): SelectedElement | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.type !== ELEMENT_MESSAGE_TYPE) return null;
  const selector = typeof d.selector === "string" ? d.selector.trim() : "";
  if (!selector) return null;
  const tag = typeof d.tag === "string" ? d.tag.toLowerCase() : "";
  const classes = Array.isArray(d.classes)
    ? d.classes.filter((c): c is string => typeof c === "string")
    : [];
  const id = typeof d.id === "string" && d.id.length > 0 ? d.id : null;
  const r = (d.rect && typeof d.rect === "object" ? d.rect : {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const rect = { x: num(r.x), y: num(r.y), width: num(r.width), height: num(r.height) };
  const text = typeof d.text === "string" ? d.text.trim().slice(0, 280) : "";
  return { selector, tag, classes, id, rect, text };
}

/** A short, human label for an element ("button.cta#submit"). */
function describeElement(el: SelectedElement): string {
  const id = el.id ? `#${el.id}` : "";
  const cls = el.classes.length > 0 ? `.${el.classes.slice(0, 2).join(".")}` : "";
  return `${el.tag || "element"}${id}${cls}` || el.selector;
}

/**
 * A runtime error reported by the proxy-injected error reporter (window.onerror,
 * unhandledrejection, or console.error from inside the preview app). These never
 * reach the dev-server logs — they happen in the user's browser — so the agent
 * is blind to them unless we capture them here and hand them over. `count` folds
 * repeats of the same error (a render loop) into one row.
 */
interface RuntimeError {
  kind: string; // "error" | "unhandledrejection" | "console" | "resource"
  message: string;
  stack: string;
  source: string;
  line: number | null;
  col: number | null;
  path: string;
  count: number;
}

/**
 * Validate + clamp an inbound `uniqus:runtime-error` message, rejecting anything
 * not addressed to `serverId`. Returns null if off-shape or for another server.
 */
function parseRuntimeError(data: unknown, serverId: string): Omit<RuntimeError, "count"> | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.type !== "uniqus:runtime-error") return null;
  if (d.server_id !== serverId) return null;
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
  const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const message = str(d.message, 1000).trim();
  if (!message) return null;
  return {
    kind: typeof d.kind === "string" ? d.kind : "error",
    message,
    stack: str(d.stack, 4000),
    source: str(d.source, 300),
    line: numOrNull(d.line),
    col: numOrNull(d.col),
    path: str(d.path, 300) || "/",
  };
}

/** Dedup key — same kind + message + top stack frame counts as one error. */
function errSig(e: { kind: string; message: string; stack: string }): string {
  return `${e.kind}|${e.message}|${e.stack.split("\n")[0] ?? ""}`;
}

// ── Device-breakpoint presets ───────────────────────────────────────────────
// "Responsive" fills the pane exactly like the plain preview. Fixed presets
// render the app at a real device width (height drives the frame's aspect) and
// scale-to-fit when the pane is smaller — so the picker doubles as a quick
// responsive-design check, generalizing the old single phone toggle.
interface DevicePreset {
  label: string;
  width: number | null;
  height: number | null;
}
const DEVICE_PRESETS: Record<string, DevicePreset> = {
  responsive: { label: "Responsive", width: null, height: null },
  mobile: { label: "Mobile", width: 375, height: 667 },
  mobileL: { label: "Mobile L", width: 414, height: 896 },
  tablet: { label: "Tablet", width: 768, height: 1024 },
  laptop: { label: "Laptop", width: 1280, height: 800 },
  desktop: { label: "Desktop", width: 1440, height: 900 },
};
const DEVICE_ORDER = ["responsive", "mobile", "mobileL", "tablet", "laptop", "desktop"] as const;
type DeviceKey = (typeof DEVICE_ORDER)[number];

// Loading/error overlays. We can't reach the proxied (cross-origin) iframe's
// CSS, so the overlays carry their own styling off the shared design tokens to
// stay on-brand. The overlay covers the iframe in both fill and framed modes.
const overlayStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  padding: 28,
  textAlign: "center",
  background: "var(--bg-surface)",
  borderRadius: "inherit",
  zIndex: 3,
};
// Pulsing dot — reuses the global `pulse-dim` keyframe (see globals.css) so we
// don't need a spinner animation of our own.
const dotStyle: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: "50%",
  background: "var(--brand-magenta)",
  animation: "pulse-dim 1.5s ease-in-out infinite",
};
const reloadBtnStyle: CSSProperties = {
  marginTop: 4,
  background: "transparent",
  border: "1px solid var(--border-default)",
  color: "var(--text-primary)",
  borderRadius: "var(--radius-sm)",
  padding: "4px 12px",
  fontSize: 12,
  fontFamily: "inherit",
  cursor: "pointer",
};
// Floating panel listing captured runtime errors. Anchored to .preview-wrap
// (position:relative), just under the 32px toolbar. Inline-styled off the design
// tokens like the overlays above, since the panel can't reach the cross-origin
// iframe's CSS.
const errPanelStyle: CSSProperties = {
  position: "absolute",
  top: 36,
  right: 8,
  zIndex: 7,
  width: 380,
  maxWidth: "calc(100% - 16px)",
  maxHeight: "60%",
  display: "flex",
  flexDirection: "column",
  background: "var(--bg-surface)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-md)",
  boxShadow: "0 8px 28px rgba(0,0,0,0.35)",
  overflow: "hidden",
};
const errStackStyle: CSSProperties = {
  margin: "4px 0 0",
  padding: "6px 8px",
  background: "var(--bg-dark)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-sm)",
  font: "11px/1.5 ui-monospace,Menlo,Consolas,monospace",
  color: "var(--text-muted)",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  maxHeight: 96,
  overflow: "auto",
};

export default function PreviewPanel({ server }: { server: PreviewServer }) {
  const [reloadKey, setReloadKey] = useState(0);
  // Device-breakpoint selection (generalizes the old phone toggle). On a phone
  // the pane is already device-width, so a fixed frame is pointless — force
  // "responsive" and hide the picker there (mirrors the old `isMobile` gate).
  const [device, setDevice] = useState<DeviceKey>("responsive");
  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false);
  const isMobile = useIsMobile();
  const preset = DEVICE_PRESETS[device];
  const framed = !isMobile && preset.width != null && preset.height != null;

  // Element picker. `picking` = pick-mode armed (we've told the iframe to
  // track); `candidate` = an element the iframe reported, awaiting the user's
  // confirm. We assume `uniqus:element` represents a deliberate click (the
  // standard picker gesture), so one message pauses pick-mode into a confirm.
  const [picking, setPicking] = useState(false);
  const [candidate, setCandidate] = useState<SelectedElement | null>(null);
  const [justAttached, setJustAttached] = useState(false);
  const setPendingSelectedElement = useStore((s) => s.setPendingSelectedElement);
  const setPendingComposerText = useStore((s) => s.setPendingComposerText);

  // Runtime errors captured from inside the preview iframe (see RuntimeError).
  // The ref mirrors state so the toast action — invoked long after it's created
  // — always hands over the latest set, not a stale snapshot.
  const [runtimeErrors, setRuntimeErrors] = useState<RuntimeError[]>([]);
  const [errPanelOpen, setErrPanelOpen] = useState(false);
  const runtimeErrorsRef = useRef<RuntimeError[]>([]);
  const errorToastedRef = useRef(false);

  const sendErrorsToAgent = useCallback(() => {
    const errs = runtimeErrorsRef.current;
    if (errs.length === 0) return;
    const SEND_LIMIT = 20;
    const blocks = errs
      .slice(0, SEND_LIMIT)
      .map((e) => {
        const loc = e.source ? ` (${e.source}${e.line != null ? `:${e.line}` : ""})` : "";
        const times = e.count > 1 ? ` ×${e.count}` : "";
        const head = `[${e.kind}] ${e.message}${loc}${times}`;
        const stack = e.stack ? `\n${e.stack.split("\n").slice(0, 6).join("\n")}` : "";
        return head + stack;
      })
      .join("\n\n");
    // Don't silently drop the tail — tell the agent the list was truncated so it
    // knows there's more to find than what it can see.
    const extra = errs.length - SEND_LIMIT;
    const more = extra > 0 ? `\n\n…and ${extra} more error${extra === 1 ? "" : "s"} in the preview (not shown above).` : "";
    const page = errs[0]?.path || "/";
    const msg =
      `The live preview is throwing runtime errors I can see in the browser but you can't ` +
      `(they're client-side, so they never hit the dev-server log). Please diagnose and fix ` +
      `the root cause.\n\nPage: ${page}\n\n\`\`\`\n${blocks}\n\`\`\`${more}`;
    setPendingComposerText(msg);
    setRuntimeErrors([]);
    setErrPanelOpen(false);
    toast.success("Preview errors added to chat — review and send.");
  }, [setPendingComposerText]);

  // Screenshot annotator modal.
  const [annotateOpen, setAnnotateOpen] = useState(false);

  // In-app path the iframe is currently showing — updated via postMessage from
  // the navigation reporter the proxy injects into every HTML response.
  const [iframePath, setIframePath] = useState<string>("/");
  // Editable address-bar draft, synced from iframePath (UI/UX audit §B — the
  // URL bar used to be a read-only span).
  const [urlDraft, setUrlDraft] = useState<string>("/");
  // Parent-side nav history of reported paths. The preview is cross-origin, so
  // we can't touch its History API directly; instead we track the paths it
  // reports and re-point the iframe's src to navigate Back/Forward.
  const navHistoryRef = useRef<string[]>(["/"]);
  const navIdxRef = useRef(0);
  // True while we navigate programmatically (Back/Forward) so the resulting
  // path report isn't pushed as a new history entry.
  const programmaticNavRef = useRef(false);
  // True while the user is editing the address bar — guards against an incoming
  // iframe nav report (e.g. an async client-side redirect in the previewed app)
  // overwriting the path the user is mid-typing.
  const urlFocusedRef = useRef(false);
  const [navState, setNavState] = useState({ canBack: false, canForward: false });
  // Load state for the proxied iframe (inferred from load events + a timeout).
  // "slow" = the iframe hasn't loaded yet but nothing has actually failed (a
  // first `npm install` + compile routinely runs tens of seconds); "error" is
  // reserved for a real iframe load failure. The old code flipped to a hard
  // "Preview unavailable" after a fixed 8 s, false-failing healthy boots.
  const [status, setStatus] = useState<"loading" | "ready" | "slow" | "error">("loading");

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const deviceMenuRef = useRef<HTMLDivElement>(null);

  // Route through the orchestrator's preview proxy so the iframe works in
  // production (Vercel + Hetzner) where the dev server isn't on a public port.
  const baseUrl = `${ORCHESTRATOR_URL}/preview/${server.id}/`;
  const displayedUrl = `${baseUrl.replace(/\/$/, "")}${iframePath.startsWith("/") ? iframePath : `/${iframePath}`}`;

  // Re-point the iframe to an in-app path. Setting the src of a frame you own is
  // allowed even cross-origin (unlike touching its History API).
  const navigateTo = useCallback(
    (path: string) => {
      const p = (path || "/").trim();
      const norm = p.startsWith("/") ? p : `/${p}`;
      if (iframeRef.current) {
        iframeRef.current.src = `${baseUrl.replace(/\/$/, "")}${norm}`;
      }
    },
    [baseUrl],
  );

  const goBack = useCallback(() => {
    if (navIdxRef.current <= 0) return;
    navIdxRef.current -= 1;
    programmaticNavRef.current = true;
    const path = navHistoryRef.current[navIdxRef.current];
    setUrlDraft(path);
    setNavState({
      canBack: navIdxRef.current > 0,
      canForward: navIdxRef.current < navHistoryRef.current.length - 1,
    });
    navigateTo(path);
  }, [navigateTo]);

  const goForward = useCallback(() => {
    if (navIdxRef.current >= navHistoryRef.current.length - 1) return;
    navIdxRef.current += 1;
    programmaticNavRef.current = true;
    const path = navHistoryRef.current[navIdxRef.current];
    setUrlDraft(path);
    setNavState({
      canBack: navIdxRef.current > 0,
      canForward: navIdxRef.current < navHistoryRef.current.length - 1,
    });
    navigateTo(path);
  }, [navigateTo]);
  // Origin we accept picker messages from / post control messages to. Scoping
  // these keeps a stray frame from spoofing element selections. "*" only in the
  // (dev) case where we couldn't resolve an absolute orchestrator URL.
  const previewOrigin = useMemo(() => {
    try {
      return new URL(baseUrl).origin;
    } catch {
      return "*";
    }
  }, [baseUrl]);

  // Tell the iframe to arm/disarm pick-mode.
  const postPickerControl = useCallback(
    (active: boolean) => {
      const win = iframeRef.current?.contentWindow;
      if (!win) return;
      try {
        win.postMessage({ type: PICKER_CONTROL_TYPE, active }, previewOrigin);
      } catch {
        // Cross-origin frame not ready yet — re-armed on the next onLoad.
      }
    },
    [previewOrigin],
  );

  const stopPicking = useCallback(() => {
    setPicking(false);
    postPickerControl(false);
  }, [postPickerControl]);

  const startPicking = useCallback(() => {
    setCandidate(null);
    setJustAttached(false);
    setPicking(true);
    postPickerControl(true);
  }, [postPickerControl]);

  const togglePicking = useCallback(() => {
    if (picking) stopPicking();
    else startPicking();
  }, [picking, startPicking, stopPicking]);

  // Measure the stage so fixed-device frames can scale-to-fit. contentRect is
  // already the padding-excluded box, so it IS the space available to the frame.
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr) setStageSize({ w: cr.width, h: cr.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const dw = preset.width ?? 0;
  const dh = preset.height ?? 0;
  const scale =
    framed && stageSize.w > 0 && stageSize.h > 0 && dw > 0 && dh > 0
      ? Math.min(1, stageSize.w / dw, stageSize.h / dh)
      : 1;

  useEffect(() => {
    // Reset path + nav history when the underlying server changes — and when the
    // user hits Reload, since the inner app starts at "/" again.
    setIframePath("/");
    setUrlDraft("/");
    navHistoryRef.current = ["/"];
    navIdxRef.current = 0;
    programmaticNavRef.current = false;
    setNavState({ canBack: false, canForward: false });
  }, [server.id, reloadKey]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // Only trust nav messages from the preview's own (orchestrator) origin —
      // mirror the element-picker listener's guard below. Without this a
      // malicious preview app (or any cross-origin frame) can spoof the URL bar
      // (L-10).
      if (previewOrigin !== "*" && e.origin !== previewOrigin) return;
      if (!isPreviewNavMessage(e.data)) return;
      if (e.data.server_id !== server.id) return;
      const path = e.data.path || "/";
      setIframePath(path);
      // Keep iframePath (used for the displayed URL + open-in-new-tab) in sync,
      // but don't clobber the address bar while the user is typing in it.
      if (!urlFocusedRef.current) setUrlDraft(path);
      // Record into the parent-side history unless this report came from a
      // Back/Forward we triggered (which shouldn't create a new entry).
      if (programmaticNavRef.current) {
        programmaticNavRef.current = false;
      } else if (navHistoryRef.current[navIdxRef.current] !== path) {
        navHistoryRef.current = [
          ...navHistoryRef.current.slice(0, navIdxRef.current + 1),
          path,
        ];
        navIdxRef.current = navHistoryRef.current.length - 1;
      }
      setNavState({
        canBack: navIdxRef.current > 0,
        canForward: navIdxRef.current < navHistoryRef.current.length - 1,
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [server.id, previewOrigin]);

  // Element-picker message listener. Only while picking, and only from the
  // preview's own origin. A valid message becomes the candidate and pauses
  // pick-mode into the confirm step.
  useEffect(() => {
    if (!picking) return;
    const onMessage = (e: MessageEvent) => {
      if (previewOrigin !== "*" && e.origin !== previewOrigin) return;
      const el = parseElementMessage(e.data);
      if (!el) return;
      setCandidate(el);
      setPicking(false);
      postPickerControl(false);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [picking, previewOrigin, postPickerControl]);

  // Esc cancels an active pick / dismisses an unattached candidate.
  useEffect(() => {
    if (!picking && !candidate) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      stopPicking();
      setCandidate(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picking, candidate, stopPicking]);

  // Picking is meaningless once the iframe re-points; cancel it on reload /
  // server change so a stale candidate box can't linger over fresh content.
  useEffect(() => {
    setPicking(false);
    setCandidate(null);
  }, [server.id, reloadKey]);

  // Keep the ref in sync so deferred callers (the toast action) read fresh data.
  useEffect(() => {
    runtimeErrorsRef.current = runtimeErrors;
  }, [runtimeErrors]);

  // Listen for runtime errors the proxy-injected reporter posts out of the
  // preview. Origin- and server-id-guarded like the picker listener so a stray
  // frame can't inject fake errors. Repeats fold into a count; the list is
  // capped so a render loop can't grow it unbounded.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (previewOrigin !== "*" && e.origin !== previewOrigin) return;
      const err = parseRuntimeError(e.data, server.id);
      if (!err) return;
      setRuntimeErrors((prev) => {
        const sig = errSig(err);
        const idx = prev.findIndex((x) => errSig(x) === sig);
        if (idx >= 0) {
          const next = prev.slice();
          next[idx] = { ...next[idx], count: next[idx].count + 1 };
          return next;
        }
        if (prev.length >= 50) return prev;
        return [...prev, { ...err, count: 1 }];
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [server.id, previewOrigin]);

  // A fresh load (server change / Reload) clears the slate — errors from a
  // previous build are no longer relevant and would mislead the agent.
  useEffect(() => {
    setRuntimeErrors([]);
    setErrPanelOpen(false);
    errorToastedRef.current = false;
  }, [server.id, reloadKey]);

  // Surface the first error of a batch as a toast with a one-click hand-off, so
  // the user notices even without opening the panel. Fires once per batch
  // (re-arms after a clear) to avoid toast spam on a chatty app.
  useEffect(() => {
    if (runtimeErrors.length === 0) {
      errorToastedRef.current = false;
      return;
    }
    if (errorToastedRef.current) return;
    errorToastedRef.current = true;
    const n = runtimeErrors.length;
    toast.error(n === 1 ? "The preview hit a runtime error." : `The preview hit ${n} runtime errors.`, {
      action: { label: "Send to agent", onClick: sendErrorsToAgent },
    });
  }, [runtimeErrors.length, sendErrorsToAgent]);

  useEffect(() => {
    // Re-arm the load state whenever the iframe re-points (server change or
    // Reload). The iframe stays mounted the whole time, so a late `onLoad`
    // still resolves to "ready". After a generous grace we only down-shift to a
    // reassuring "still starting" state (NOT a scary error) — the dev server's
    // port was already confirmed open before this server appeared, so a slow
    // first paint is almost always install/compile, not a failure.
    setStatus("loading");
    const slowAt = window.setTimeout(() => {
      setStatus((s) => (s === "loading" ? "slow" : s));
    }, 45000);
    return () => window.clearTimeout(slowAt);
  }, [baseUrl, server.id, reloadKey]);

  // Close the device menu on an outside click.
  useEffect(() => {
    if (!deviceMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!deviceMenuRef.current?.contains(e.target as Node)) setDeviceMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [deviceMenuOpen]);

  const attachCandidate = () => {
    if (!candidate) return;
    setPendingSelectedElement(candidate);
    setCandidate(null);
    setJustAttached(true);
    window.setTimeout(() => setJustAttached(false), 2200);
  };

  const highlightRect = candidate?.rect ?? null;
  const totalErrorCount = runtimeErrors.reduce((n, e) => n + e.count, 0);

  return (
    <div className="preview-wrap">
      <div className="preview-toolbar">
        <button
          type="button"
          onClick={goBack}
          disabled={!navState.canBack}
          className="icon-btn-sm"
          title="Back"
          aria-label="Back"
          style={{ opacity: navState.canBack ? 1 : 0.4 }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <button
          type="button"
          onClick={goForward}
          disabled={!navState.canForward}
          className="icon-btn-sm"
          title="Forward"
          aria-label="Forward"
          style={{ opacity: navState.canForward ? 1 : 0.4 }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => navigateTo("/")}
          className="icon-btn-sm"
          title="Home (/)"
          aria-label="Go to home"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          className="icon-btn-sm"
          title="Reload"
          aria-label="Reload"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
        <form
          className="preview-url-form"
          onSubmit={(e) => {
            e.preventDefault();
            navigateTo(urlDraft);
          }}
        >
          <input
            className="url"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            onFocus={() => {
              urlFocusedRef.current = true;
            }}
            onBlur={() => {
              // Re-sync to the actual current path so a typed-but-not-submitted
              // draft doesn't linger (mirrors a browser address bar reverting on
              // blur).
              urlFocusedRef.current = false;
              setUrlDraft(iframePath);
            }}
            spellCheck={false}
            aria-label="Preview address"
            title={displayedUrl}
            placeholder="/"
          />
        </form>

        {/* Element picker toggle */}
        <button
          type="button"
          onClick={togglePicking}
          className="icon-btn-sm"
          data-on={picking}
          title={picking ? "Cancel element select" : "Select an element to point the agent at"}
          aria-pressed={picking}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="2" x2="12" y2="6" />
            <line x1="12" y1="18" x2="12" y2="22" />
            <line x1="2" y1="12" x2="6" y2="12" />
            <line x1="18" y1="12" x2="22" y2="12" />
            <circle cx="12" cy="12" r="4" />
          </svg>
        </button>

        {/* Screenshot annotator */}
        <button
          type="button"
          onClick={() => setAnnotateOpen(true)}
          className="icon-btn-sm"
          title="Annotate a screenshot and attach it to chat"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 19l7-7 3 3-7 7-3-3z" />
            <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
            <line x1="2" y1="2" x2="9.586" y2="9.586" />
            <circle cx="11" cy="11" r="2" />
          </svg>
        </button>

        {/* Device-breakpoint picker (generalizes the old phone toggle). */}
        {!isMobile && (
          <div className="device-picker" ref={deviceMenuRef}>
            <button
              type="button"
              onClick={() => setDeviceMenuOpen((v) => !v)}
              className="icon-btn-sm"
              data-on={framed}
              title="Preview device width"
              aria-haspopup="menu"
              aria-expanded={deviceMenuOpen}
              style={{ width: "auto", gap: 5, padding: "0 7px", fontSize: 11 }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
              <span>{framed ? `${preset.width}` : "Responsive"}</span>
            </button>
            {deviceMenuOpen && (
              <div role="menu" aria-label="Preview device width" className="device-menu">
                {DEVICE_ORDER.map((key) => {
                  const p = DEVICE_PRESETS[key];
                  const active = key === device;
                  return (
                    <button
                      key={key}
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      className={`device-menu-item${active ? " active" : ""}`}
                      onClick={() => {
                        setDevice(key);
                        setDeviceMenuOpen(false);
                      }}
                    >
                      <span>{p.label}</span>
                      <span className="device-menu-dim">
                        {p.width ? `${p.width}×${p.height}` : "fill"}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Runtime-error badge — only shows when the preview has thrown. */}
        {totalErrorCount > 0 && (
          <button
            type="button"
            onClick={() => setErrPanelOpen((v) => !v)}
            className="icon-btn-sm"
            data-on={errPanelOpen}
            title={`${totalErrorCount} runtime error${totalErrorCount === 1 ? "" : "s"} in the preview — click to view`}
            aria-expanded={errPanelOpen}
            aria-label={`${totalErrorCount} runtime errors in the preview`}
            style={{ width: "auto", gap: 5, padding: "0 7px", fontSize: 11, color: "var(--conf-medium)" }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>{totalErrorCount}</span>
          </button>
        )}

        <a
          href={displayedUrl}
          target="_blank"
          rel="noreferrer"
          className="icon-btn-sm"
          title="Open current page in new tab"
          style={{ textDecoration: "none" }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
      </div>

      {/* Runtime-error panel — lists what the preview threw, with a one-click
          hand-off that stages a fix prompt into the composer. */}
      {errPanelOpen && totalErrorCount > 0 && (
        <div style={errPanelStyle} role="dialog" aria-label="Preview runtime errors">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 10px",
              borderBottom: "1px solid var(--border-default)",
            }}
          >
            <strong style={{ fontSize: 12.5, color: "var(--text-primary)" }}>
              Runtime error{totalErrorCount === 1 ? "" : "s"} · {totalErrorCount}
            </strong>
            <button
              type="button"
              onClick={() => setErrPanelOpen(false)}
              className="icon-btn-sm"
              aria-label="Close errors panel"
              title="Close"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div style={{ overflow: "auto", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 10 }}>
            {runtimeErrors.map((e, i) => (
              <div key={i} style={{ fontSize: 12 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                  <span
                    style={{
                      fontSize: 10,
                      textTransform: "uppercase",
                      letterSpacing: 0.3,
                      color: "var(--conf-medium)",
                      fontWeight: 600,
                    }}
                  >
                    {e.kind}
                  </span>
                  {e.count > 1 && <span style={{ fontSize: 10, color: "var(--text-muted)" }}>×{e.count}</span>}
                </div>
                <div style={{ color: "var(--text-primary)", wordBreak: "break-word", marginTop: 2 }}>{e.message}</div>
                {(e.source || e.line != null) && (
                  <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 1, wordBreak: "break-all" }}>
                    {e.source}
                    {e.line != null ? `:${e.line}` : ""}
                  </div>
                )}
                {e.stack && <pre style={errStackStyle}>{e.stack.split("\n").slice(0, 6).join("\n")}</pre>}
              </div>
            ))}
            {runtimeErrors.length >= 50 && (
              <div style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>
                Showing 50 distinct errors — newer ones are hidden until you clear.
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, padding: "8px 10px", borderTop: "1px solid var(--border-default)" }}>
            <button
              type="button"
              onClick={sendErrorsToAgent}
              style={{
                flex: 1,
                padding: "6px 12px",
                fontSize: 12.5,
                fontFamily: "inherit",
                cursor: "pointer",
                border: "none",
                borderRadius: "var(--radius-sm)",
                background: "var(--brand-gradient, var(--brand-magenta))",
                color: "#fff",
                fontWeight: 600,
              }}
            >
              Send to agent
            </button>
            <button
              type="button"
              onClick={() => {
                setRuntimeErrors([]);
                setErrPanelOpen(false);
              }}
              style={{
                padding: "6px 12px",
                fontSize: 12.5,
                fontFamily: "inherit",
                cursor: "pointer",
                border: "1px solid var(--border-default)",
                borderRadius: "var(--radius-sm)",
                background: "transparent",
                color: "var(--text-primary)",
              }}
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Pick-mode hint + confirm card float over the preview area (not the
          scrollable stage) so they stay put regardless of frame scroll. */}
      {picking && !candidate && (
        <div className="picker-hint" role="status">
          <span className="picker-hint-dot" aria-hidden />
          Click an element in the preview to point the agent at it.
          <span className="picker-hint-esc">Esc to cancel</span>
        </div>
      )}
      {candidate && (
        <div className="picker-confirm" role="dialog" aria-label="Confirm selected element">
          <div className="picker-confirm-info">
            <code className="picker-confirm-sel">{describeElement(candidate)}</code>
            {candidate.text && <span className="picker-confirm-text">“{candidate.text.slice(0, 60)}”</span>}
          </div>
          <div className="picker-confirm-actions">
            <button type="button" className="picker-btn primary" onClick={attachCandidate}>
              Attach to chat
            </button>
            <button
              type="button"
              className="picker-btn"
              onClick={() => {
                setCandidate(null);
                startPicking();
              }}
            >
              Re-pick
            </button>
            <button type="button" className="picker-btn ghost" onClick={() => setCandidate(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {justAttached && (
        <div className="picker-toast" role="status">
          ✓ Element attached — describe the change in chat
        </div>
      )}

      <div className="preview-stage" data-framed={framed} ref={stageRef}>
        {/* device-frame is the (optionally scaled) bezel; preview-viewport is
            the iframe's coordinate space — the picker highlight lives inside it
            so it shares the iframe's CSS pixels AND any scale transform. */}
        <div
          className="device-frame"
          data-framed={framed}
          style={framed ? { position: "relative", width: Math.round(dw * scale), height: Math.round(dh * scale) } : { position: "relative" }}
        >
          <div
            className="preview-viewport"
            data-framed={framed}
            style={
              framed
                ? {
                    width: dw,
                    height: dh,
                    transform: scale !== 1 ? `scale(${scale})` : undefined,
                    transformOrigin: "top left",
                  }
                : undefined
            }
          >
            <iframe
              key={reloadKey}
              ref={iframeRef}
              src={baseUrl}
              className="preview-iframe"
              title={`preview ${server.port}`}
              onLoad={() => {
                setStatus("ready");
                // Re-arm pick-mode if the iframe reloaded mid-pick.
                if (picking) postPickerControl(true);
              }}
              onError={() => setStatus("error")}
            />
            {highlightRect && (
              <div
                className="picker-highlight"
                style={{
                  left: highlightRect.x,
                  top: highlightRect.y,
                  width: highlightRect.width,
                  height: highlightRect.height,
                }}
                aria-hidden
              >
                <span className="picker-highlight-label">{describeElement(candidate!)}</span>
              </div>
            )}
          </div>
          {status === "loading" && (
            <div style={overlayStyle} aria-live="polite">
              <span style={dotStyle} aria-hidden />
              <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-muted)" }}>Loading preview…</p>
            </div>
          )}
          {status === "slow" && (
            <div style={overlayStyle} aria-live="polite">
              <span style={dotStyle} aria-hidden />
              <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, maxWidth: "34ch", color: "var(--text-muted)" }}>
                Still starting — the first build can take a little while. It'll appear as soon as it's ready.
              </p>
              <button type="button" onClick={() => setReloadKey((k) => k + 1)} style={reloadBtnStyle}>
                Reload
              </button>
            </div>
          )}
          {status === "error" && (
            <div style={overlayStyle} role="alert">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--conf-medium)" }}>
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Preview unavailable</h3>
              <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, maxWidth: "34ch", color: "var(--text-muted)" }}>
                The dev server may be starting or stopped. Click Run to start it.
              </p>
              <button type="button" onClick={() => setReloadKey((k) => k + 1)} style={reloadBtnStyle}>
                Reload
              </button>
            </div>
          )}
        </div>
      </div>

      {annotateOpen && (
        <PreviewAnnotator
          server={server}
          previewUrl={displayedUrl}
          onClose={() => setAnnotateOpen(false)}
        />
      )}
    </div>
  );
}
