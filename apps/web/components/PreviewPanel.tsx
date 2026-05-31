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

  // Screenshot annotator modal.
  const [annotateOpen, setAnnotateOpen] = useState(false);

  // In-app path the iframe is currently showing — updated via postMessage from
  // the navigation reporter the proxy injects into every HTML response.
  const [iframePath, setIframePath] = useState<string>("/");
  // Load state for the proxied iframe (inferred from load events + a timeout).
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const deviceMenuRef = useRef<HTMLDivElement>(null);

  // Route through the orchestrator's preview proxy so the iframe works in
  // production (Vercel + Hetzner) where the dev server isn't on a public port.
  const baseUrl = `${ORCHESTRATOR_URL}/preview/${server.id}/`;
  const displayedUrl = `${baseUrl.replace(/\/$/, "")}${iframePath.startsWith("/") ? iframePath : `/${iframePath}`}`;
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
    // Reset path when the underlying server changes — and when the user hits
    // Reload, since the inner app starts at "/" again.
    setIframePath("/");
  }, [server.id, reloadKey]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!isPreviewNavMessage(e.data)) return;
      if (e.data.server_id !== server.id) return;
      setIframePath(e.data.path || "/");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [server.id]);

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

  useEffect(() => {
    // Re-arm the load state whenever the iframe re-points (server change or
    // Reload). If `onLoad` never fires within a few seconds the dev server is
    // almost certainly down/starting — treat that as an error.
    setStatus("loading");
    const timeout = window.setTimeout(() => {
      setStatus((s) => (s === "loading" ? "error" : s));
    }, 8000);
    return () => window.clearTimeout(timeout);
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

  return (
    <div className="preview-wrap">
      <div className="preview-toolbar">
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          className="icon-btn-sm"
          title="Reload"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
        <span className="url" title={displayedUrl}>
          {displayedUrl}
        </span>

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
