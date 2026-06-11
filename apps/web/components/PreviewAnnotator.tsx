"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { PreviewServer } from "@uniqus/api-types";
import { useStore } from "@/lib/store";
import Modal from "./Modal";

/**
 * Screenshot annotator (Build §3). Captures the live preview (or accepts a
 * pasted/dropped image), lets the user draw boxes, arrows, freehand, and text
 * notes on it, then flattens to a PNG and hands it to the composer via the
 * store's queued-files channel — which rides the existing upload→image path the
 * agent already understands (no new endpoint, no new message type).
 *
 * The preview iframe is cross-origin (served by the orchestrator proxy), so we
 * can't read its pixels from the DOM. `getDisplayMedia` captures at the
 * compositor level — which DOES include cross-origin content — and we best-
 * effort crop that frame to the preview's on-screen box. Paste/drop is the
 * always-available fallback (and works when capture is unsupported/denied).
 */

type Pt = { x: number; y: number };
type Tool = "box" | "arrow" | "pen" | "text";
type Shape =
  | { kind: "box"; color: string; width: number; x: number; y: number; w: number; h: number }
  | { kind: "arrow"; color: string; width: number; x1: number; y1: number; x2: number; y2: number }
  | { kind: "pen"; color: string; width: number; pts: Pt[] }
  | { kind: "text"; color: string; x: number; y: number; text: string; size: number };

const COLORS = ["#ff3b30", "#ffcc00", "#34c759", "#0a84ff", "#b21e7d", "#ffffff", "#111111"];
const WIDTHS = [2, 4, 7];
const MAX_CANVAS_W = 2200; // cap the backing store so huge captures stay sane

const TOOLS: { key: Tool; label: string; hint: string }[] = [
  { key: "box", label: "Box", hint: "Draw a rectangle" },
  { key: "arrow", label: "Arrow", hint: "Point at something" },
  { key: "pen", label: "Pen", hint: "Freehand draw" },
  { key: "text", label: "Text", hint: "Add a note" },
];

function supportsCapture(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getDisplayMedia === "function"
  );
}

export default function PreviewAnnotator({
  server,
  previewUrl,
  onClose,
}: {
  server: PreviewServer;
  previewUrl: string;
  onClose: () => void;
}) {
  const enqueueComposerFiles = useStore((s) => s.enqueueComposerFiles);

  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [tool, setTool] = useState<Tool>("box");
  const [color, setColor] = useState(COLORS[0]);
  const [strokeWidth, setStrokeWidth] = useState(WIDTHS[1]);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Non-blocking hint (capture cancelled, or fell back to a whole-tab grab) —
  // distinct from the louder `error` path (UI/UX audit §C).
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Inline text entry: where the user clicked (canvas coords + on-screen coords).
  const [textEntry, setTextEntry] = useState<{ cx: number; cy: number; dx: number; dy: number; value: string } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef(false);
  const textInputRef = useRef<HTMLInputElement>(null);
  const canCapture = supportsCapture();

  // The capture/load flows setState after async awaits (image decode, screen
  // capture, frame grab) — guard every post-await setState so a close mid-flight
  // doesn't trigger a "setState after unmount" warning / wasted work.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // ── Load a base image from a data URL ──────────────────────────────────────
  const loadImage = useCallback((src: string) => {
    const img = new Image();
    img.onload = () => {
      if (!isMountedRef.current) return;
      setImage(img);
      setShapes([]);
      setDraft(null);
      setError(null);
    };
    img.onerror = () => {
      if (!isMountedRef.current) return;
      setError("Could not load that image.");
    };
    img.src = src;
  }, []);

  // Map the preview iframe's CSS-px box to capture-frame pixels. Only crops
  // when the capture's scale is consistent with this tab's viewport (i.e. the
  // user captured the current tab); otherwise returns the full frame. Declared
  // before its consumers so the deps arrays below reference live bindings.
  const computePreviewCrop = useCallback(
    (
      vw: number,
      vh: number,
    ): { x: number; y: number; w: number; h: number; cropped: boolean } => {
      // `cropped: false` ⇒ we couldn't isolate the preview and fell back to the
      // whole frame; the caller surfaces a hint so the user isn't surprised by a
      // screenshot of their entire tab.
      const full = { x: 0, y: 0, w: vw, h: vh, cropped: false };
      const iframe = document.querySelector<HTMLIFrameElement>(
        `iframe[title="preview ${server.port}"]`,
      );
      if (!iframe || typeof window === "undefined") return full;
      const r = iframe.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return full;
      const sx = vw / window.innerWidth;
      const sy = vh / window.innerHeight;
      // Consistent scale ⇒ a current-tab capture; otherwise bail to full frame.
      if (Math.abs(sx - sy) / Math.max(sx, sy) > 0.08) return full;
      const x = Math.max(0, Math.round(r.left * sx));
      const y = Math.max(0, Math.round(r.top * sy));
      const w = Math.min(vw - x, Math.round(r.width * sx));
      const h = Math.min(vh - y, Math.round(r.height * sy));
      if (w < 8 || h < 8) return full;
      return { x, y, w, h, cropped: true };
    },
    [server.port],
  );

  // Grab a single frame from the capture stream, cropped (best-effort) to the
  // preview iframe's on-screen box, and return a PNG data URL.
  const frameToDataUrl = useCallback(
    (stream: MediaStream): Promise<{ dataUrl: string; cropped: boolean }> =>
      new Promise((resolve, reject) => {
        const video = document.createElement("video");
        video.muted = true;
        video.srcObject = stream;
        const cleanup = () => {
          video.pause();
          video.srcObject = null;
        };
        video.onloadedmetadata = () => {
          video
            .play()
            .then(() => {
              // One rAF so the first frame is actually painted.
              requestAnimationFrame(() => {
                const vw = video.videoWidth;
                const vh = video.videoHeight;
                if (!vw || !vh) {
                  cleanup();
                  reject(new Error("empty capture frame"));
                  return;
                }
                const crop = computePreviewCrop(vw, vh);
                const out = document.createElement("canvas");
                out.width = crop.w;
                out.height = crop.h;
                const ctx = out.getContext("2d");
                if (!ctx) {
                  cleanup();
                  reject(new Error("no 2d context"));
                  return;
                }
                ctx.drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
                cleanup();
                resolve({ dataUrl: out.toDataURL("image/png"), cropped: crop.cropped });
              });
            })
            .catch((e) => {
              cleanup();
              reject(e);
            });
        };
        video.onerror = () => {
          cleanup();
          reject(new Error("capture video error"));
        };
      }),
    [computePreviewCrop],
  );

  // Hide the annotator dialog (card + backdrop) at the paint level while the
  // frame is grabbed. getDisplayMedia captures the compositor output of the
  // whole tab, and this modal sits on top of the preview — without this, the
  // screenshot contains the annotator itself, recursively. visibility (not
  // display) keeps layout and focus stable, and hidden elements are simply not
  // painted, so they can't show up in the captured frame. Same trick native
  // screenshot tools use to keep themselves out of the shot.
  const setSelfHidden = useCallback((hidden: boolean) => {
    const overlay = wrapRef.current?.closest<HTMLElement>(".modal-overlay");
    if (overlay) overlay.style.visibility = hidden ? "hidden" : "";
  }, []);

  // ── Capture the preview via the Screen Capture API ─────────────────────────
  const capture = useCallback(async () => {
    if (!canCapture) return;
    setError(null);
    setNotice(null);
    setCapturing(true);
    setSelfHidden(true);
    let stream: MediaStream | null = null;
    try {
      // Two rAFs so the hide has actually painted before the stream starts
      // producing frames (the permission prompt usually adds time anyway, but
      // preferCurrentTab can start the stream near-instantly in Chromium).
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      stream = await navigator.mediaDevices.getDisplayMedia({
        // `preferCurrentTab` (Chromium) skips the surface picker and grabs this
        // tab — which contains the preview iframe. Non-standard keys are cast.
        video: { displaySurface: "browser" } as MediaTrackConstraints,
        audio: false,
        ...({ preferCurrentTab: true } as Record<string, unknown>),
      });
      const { dataUrl, cropped } = await frameToDataUrl(stream);
      if (!isMountedRef.current) return;
      loadImage(dataUrl);
      // Warn when we couldn't isolate the preview and grabbed the whole tab.
      if (!cropped) {
        setNotice(
          "Couldn't isolate the preview — captured the whole tab. Crop it with the Box tool, recapture, or paste an image instead.",
        );
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      if (/denied|dismiss|abort|cancel/i.test(msg)) {
        // User cancelled the OS picker — give a soft hint, not a loud error, so
        // the empty state doesn't just sit there with no feedback (§C).
        setNotice("Capture cancelled — click Capture again, or paste/drop a screenshot.");
      } else {
        setError(`Capture failed: ${msg}. You can paste a screenshot instead.`);
      }
    } finally {
      // Always release the tracks even if we unmounted; only the setState is guarded.
      stream?.getTracks().forEach((t) => t.stop());
      setSelfHidden(false);
      if (isMountedRef.current) setCapturing(false);
    }
  }, [canCapture, loadImage, frameToDataUrl, setSelfHidden]);

  // ── Paste / drop an image ──────────────────────────────────────────────────
  const ingestFile = useCallback(
    (file: File | null | undefined) => {
      if (!file || !file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") loadImage(reader.result);
      };
      reader.readAsDataURL(file);
    },
    [loadImage],
  );

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          e.preventDefault();
          ingestFile(item.getAsFile());
          return;
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [ingestFile]);

  // Keep the text input focused while entering a note.
  useEffect(() => {
    if (textEntry) textInputRef.current?.focus();
  }, [textEntry]);

  // ── Render the canvas whenever the image / shapes / draft change ───────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const w = Math.min(image.naturalWidth || image.width, MAX_CANVAS_W);
    const ratio = w / (image.naturalWidth || image.width || w);
    const h = Math.round((image.naturalHeight || image.height) * ratio);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(image, 0, 0, w, h);
    for (const s of shapes) drawShape(ctx, s);
    if (draft) drawShape(ctx, draft);
  }, [image, shapes, draft]);

  // Pointer → canvas-pixel coords.
  const toCanvas = (e: ReactPointerEvent): Pt => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (!image) return;
    const p = toCanvas(e);
    if (tool === "text") {
      const rect = wrapRef.current!.getBoundingClientRect();
      setTextEntry({ cx: p.x, cy: p.y, dx: e.clientX - rect.left, dy: e.clientY - rect.top, value: "" });
      return;
    }
    drawingRef.current = true;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (tool === "box") setDraft({ kind: "box", color, width: strokeWidth, x: p.x, y: p.y, w: 0, h: 0 });
    else if (tool === "arrow") setDraft({ kind: "arrow", color, width: strokeWidth, x1: p.x, y1: p.y, x2: p.x, y2: p.y });
    else if (tool === "pen") setDraft({ kind: "pen", color, width: strokeWidth, pts: [p] });
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!drawingRef.current || !draft) return;
    const p = toCanvas(e);
    if (draft.kind === "box") setDraft({ ...draft, w: p.x - draft.x, h: p.y - draft.y });
    else if (draft.kind === "arrow") setDraft({ ...draft, x2: p.x, y2: p.y });
    else if (draft.kind === "pen") setDraft({ ...draft, pts: [...draft.pts, p] });
  };

  const onPointerUp = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    if (draft) {
      // Drop degenerate clicks (no drag) for box/arrow.
      const keep =
        draft.kind === "pen"
          ? draft.pts.length > 1
          : draft.kind === "box"
          ? Math.abs(draft.w) > 3 && Math.abs(draft.h) > 3
          : draft.kind === "arrow"
          ? Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) > 6
          : true;
      if (keep) setShapes((s) => [...s, normalizeShape(draft)]);
    }
    setDraft(null);
  };

  const commitText = () => {
    if (!textEntry) return;
    const value = textEntry.value.trim();
    if (value) {
      setShapes((s) => [...s, { kind: "text", color, x: textEntry.cx, y: textEntry.cy, text: value, size: Math.max(14, strokeWidth * 6) }]);
    }
    setTextEntry(null);
  };

  const undo = () => setShapes((s) => s.slice(0, -1));
  const clearShapes = () => setShapes([]);

  const attach = () => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    setSaving(true);
    canvas.toBlob((blob) => {
      if (!blob) {
        setSaving(false);
        setError("Could not export the image.");
        return;
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const file = new File([blob], `annotated-preview-${stamp}.png`, { type: "image/png" });
      enqueueComposerFiles([file]);
      setSaving(false);
      onClose();
    }, "image/png");
  };

  const hasImage = !!image;

  return (
    <Modal
      title="Annotate a screenshot"
      subtitle="Mark up the preview, then attach it to your next message."
      width={920}
      onClose={onClose}
      bodyStyle={{ padding: 0 }}
      footer={
        <>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {hasImage ? `${shapes.length} mark${shapes.length === 1 ? "" : "s"}` : "No image yet"}
          </span>
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={attach} disabled={!hasImage || saving}>
              {saving ? "Attaching…" : "Attach to chat"}
            </button>
          </div>
        </>
      }
    >
      <div className="annotator">
        {/* Toolbar */}
        <div className="annotator-tools">
          <div className="annotator-tool-group" role="radiogroup" aria-label="Drawing tool">
            {TOOLS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="radio"
                aria-checked={tool === t.key}
                className={`annotator-tool${tool === t.key ? " active" : ""}`}
                onClick={() => setTool(t.key)}
                title={t.hint}
                disabled={!hasImage}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="annotator-tool-group" aria-label="Color">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Color ${c}`}
                aria-pressed={color === c}
                className={`annotator-swatch${color === c ? " active" : ""}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
                disabled={!hasImage}
              />
            ))}
          </div>

          <div className="annotator-tool-group" aria-label="Thickness">
            {WIDTHS.map((wpx) => (
              <button
                key={wpx}
                type="button"
                aria-pressed={strokeWidth === wpx}
                className={`annotator-width${strokeWidth === wpx ? " active" : ""}`}
                onClick={() => setStrokeWidth(wpx)}
                title={`${wpx}px`}
                disabled={!hasImage}
              >
                <span style={{ width: wpx + 6, height: wpx, background: "currentColor", borderRadius: wpx }} />
              </button>
            ))}
          </div>

          <div className="annotator-tool-group" style={{ marginLeft: "auto" }}>
            <button type="button" className="annotator-action" onClick={undo} disabled={shapes.length === 0}>
              Undo
            </button>
            <button type="button" className="annotator-action" onClick={clearShapes} disabled={shapes.length === 0}>
              Clear
            </button>
            {canCapture && (
              <button type="button" className="annotator-action" onClick={() => void capture()} disabled={capturing}>
                {capturing ? "Capturing…" : hasImage ? "Recapture" : "Capture"}
              </button>
            )}
          </div>
        </div>

        {/* Canvas / drop zone */}
        <div
          ref={wrapRef}
          className="annotator-stage"
          onDragOver={(e) => {
            e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            ingestFile(e.dataTransfer.files?.[0]);
          }}
        >
          {hasImage ? (
            <>
              <canvas
                ref={canvasRef}
                className="annotator-canvas"
                style={{ cursor: tool === "text" ? "text" : "crosshair" }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
              />
              {textEntry && (
                <input
                  ref={textInputRef}
                  className="annotator-text-input"
                  style={textInputStyle(textEntry.dx, textEntry.dy, color)}
                  value={textEntry.value}
                  onChange={(e) => setTextEntry({ ...textEntry, value: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitText();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setTextEntry(null);
                    }
                  }}
                  onBlur={commitText}
                  placeholder="Type a note, Enter to place"
                />
              )}
            </>
          ) : (
            <div className="annotator-empty">
              {capturing ? (
                <p>Capturing the preview…</p>
              ) : (
                <>
                  <p style={{ fontWeight: 600, color: "var(--text-primary)" }}>No screenshot yet</p>
                  <p style={{ maxWidth: "42ch" }}>
                    {canCapture
                      ? "Capture the preview, or paste (⌘/Ctrl+V) or drop an image here."
                      : "Paste (⌘/Ctrl+V) or drop a screenshot here to annotate it."}
                  </p>
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    {canCapture && (
                      <button type="button" className="btn-primary" onClick={() => void capture()} disabled={capturing}>
                        Capture preview
                      </button>
                    )}
                  </div>
                  <p style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4, wordBreak: "break-all" }}>{previewUrl}</p>
                </>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="annotator-error" role="alert">
            {error}
          </div>
        )}
        {!error && notice && (
          <div
            className="annotator-error"
            role="status"
            style={{
              background: "rgba(240, 180, 41, 0.12)",
              borderColor: "rgba(240, 180, 41, 0.4)",
              color: "var(--text-primary)",
            }}
          >
            {notice}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Canvas drawing helpers ────────────────────────────────────────────────────

function normalizeShape(s: Shape): Shape {
  // Make box w/h positive so later hit-tests / exports are predictable.
  if (s.kind === "box") {
    return {
      ...s,
      x: s.w < 0 ? s.x + s.w : s.x,
      y: s.h < 0 ? s.y + s.h : s.y,
      w: Math.abs(s.w),
      h: Math.abs(s.h),
    };
  }
  return s;
}

function drawShape(ctx: CanvasRenderingContext2D, s: Shape) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (s.kind === "box") {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.strokeRect(s.x, s.y, s.w, s.h);
  } else if (s.kind === "arrow") {
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = s.width;
    drawArrow(ctx, s.x1, s.y1, s.x2, s.y2, s.width);
  } else if (s.kind === "pen") {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.beginPath();
    s.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
  } else if (s.kind === "text") {
    ctx.font = `600 ${s.size}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textBaseline = "top";
    // Outline for legibility on any background, then fill.
    ctx.lineWidth = Math.max(2, s.size / 8);
    ctx.strokeStyle = pickOutline(s.color);
    ctx.lineJoin = "round";
    ctx.strokeText(s.text, s.x, s.y);
    ctx.fillStyle = s.color;
    ctx.fillText(s.text, s.x, s.y);
  }
  ctx.restore();
}

function drawArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, width: number) {
  const head = Math.max(10, width * 3.2);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

/** White outline for dark ink, dark outline for light ink. */
function pickOutline(hex: string): string {
  const c = hex.replace("#", "");
  if (c.length < 6) return "rgba(0,0,0,0.65)";
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.85)";
}

function textInputStyle(left: number, top: number, color: string): CSSProperties {
  return {
    position: "absolute",
    left,
    top,
    transform: "translateY(-2px)",
    color,
    minWidth: 140,
  };
}
