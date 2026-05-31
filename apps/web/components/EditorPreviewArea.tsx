"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useStore, fileTabId, previewTabId, flushSave } from "@/lib/store";
import { send } from "@/lib/ws-client";
import { stopServerApi, getApiBase } from "@/lib/api";
import CodeEditor from "./CodeEditor";
import PreviewPanel from "./PreviewPanel";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico"]);

function isImageFile(filePath: string): boolean {
  const ext = filePath.lastIndexOf(".") >= 0 ? filePath.slice(filePath.lastIndexOf(".")).toLowerCase() : "";
  return IMAGE_EXTENSIONS.has(ext);
}

function ImageViewer({ path, projectId }: { path: string; projectId: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetch(`${getApiBase()}/api/projects/${projectId}/raw/${encodeURIComponent(path)}`, { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        setUrl(URL.createObjectURL(blob));
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [path, projectId]);

  // Reset zoom when switching files
  useEffect(() => {
    setZoom(100);
  }, [path]);

  // Cleanup object URL on unmount
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  if (error) {
    return (
      <div className="editor-empty" style={{ gap: 8 }}>
        <p style={{ color: "var(--text-dim)" }}>Could not load image: {error}</p>
      </div>
    );
  }
  if (!url) {
    return (
      <div className="editor-empty">
        <p style={{ color: "var(--text-dim)" }}>Loading image…</p>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%" }}>
      {/* Zoom toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          borderBottom: "1px solid var(--border-default, #2a2a36)",
          background: "var(--bg-surface, #16161e)",
          fontSize: 11,
          color: "var(--text-dim)",
          flexShrink: 0,
        }}
      >
        <button type="button" onClick={() => setZoom((z) => Math.max(10, z - 25))} style={{ background: "none", border: "none", color: "var(--text-primary)", cursor: "pointer", fontSize: 14, padding: "2px 6px" }}>−</button>
        <span style={{ minWidth: 40, textAlign: "center" }}>{zoom}%</span>
        <button type="button" onClick={() => setZoom((z) => Math.min(500, z + 25))} style={{ background: "none", border: "none", color: "var(--text-primary)", cursor: "pointer", fontSize: 14, padding: "2px 6px" }}>+</button>
        <button type="button" onClick={() => setZoom(100)} style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: 10, padding: "2px 6px" }}>Reset</button>
      </div>
      {/* Image area */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          display: "flex",
          alignItems: zoom <= 100 ? "center" : "flex-start",
          justifyContent: zoom <= 100 ? "center" : "flex-start",
          background: "repeating-conic-gradient(#1a1a22 0% 25%, #121218 0% 50%) 50% / 20px 20px",
          padding: 24,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={path.split("/").pop() ?? "image"}
          style={{
            width: `${zoom}%`,
            maxWidth: zoom <= 100 ? "100%" : "none",
            objectFit: "contain",
            borderRadius: 4,
            imageRendering: zoom >= 200 ? "pixelated" : "auto",
          }}
        />
      </div>
    </div>
  );
}

function isMarkdownFile(filePath: string): boolean {
  const ext = filePath.lastIndexOf(".") >= 0 ? filePath.slice(filePath.lastIndexOf(".")).toLowerCase() : "";
  return ext === ".md" || ext === ".mdx";
}

function MarkdownPreview({ content }: { content: string }) {
  return (
    <div
      style={{
        height: "100%",
        overflow: "auto",
        padding: "24px 32px",
        background: "var(--bg-canvas, #0e0e14)",
        color: "var(--text-primary, #e4e2dc)",
        fontSize: 14,
        lineHeight: 1.7,
      }}
    >
      <div className="md" style={{ maxWidth: 760 }}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}

export default function EditorPreviewArea() {
  const previews = useStore((s) => s.previews);
  const openFiles = useStore((s) => s.openFiles);
  const editorTab = useStore((s) => s.editorTab);
  const setEditorTab = useStore((s) => s.setEditorTab);
  const closeOpenFile = useStore((s) => s.closeOpenFile);
  const removePreview = useStore((s) => s.removePreview);
  const saveStatus = useStore((s) => s.saveStatus);
  const selectedFile = useStore((s) => s.selectedFile);
  const fileContent = useStore((s) => s.fileContent);
  const projectId = useStore((s) => s.project?.id ?? null);
  const [mdPreview, setMdPreview] = useState(false);

  const hasAnyTabs = openFiles.length > 0 || previews.length > 0;

  // Pick what to render based on editorTab; fall back to first available tab.
  let activeTab = editorTab;
  if (!activeTab && previews[0]) activeTab = previewTabId(previews[0].id);
  if (!activeTab && openFiles[0]) activeTab = fileTabId(openFiles[0]);

  const activePreview =
    activeTab.startsWith("preview:") &&
    previews.find((p) => previewTabId(p.id) === activeTab);
  const activeFilePath = activeTab.startsWith("file:") ? activeTab.slice(5) : null;

  // Drive the editor's loaded file from the active tab. Without this, clicking
  // an already-open tab updated `editorTab` (and the active styling) but did
  // not re-issue request_file, so the editor kept showing whichever file was
  // most recently loaded rather than the one the tab points at.
  useEffect(() => {
    if (!activeFilePath) return;
    if (selectedFile === activeFilePath) return;
    send({ type: "request_file", path: activeFilePath });
  }, [activeFilePath, selectedFile]);

  return (
    <div className="editor-area">
      {hasAnyTabs && (
        <div className="tab-strip">
          {openFiles.map((path) => {
            const tabId = fileTabId(path);
            const status = saveStatus[path]?.kind;
            const isDirty = status === "dirty" || status === "saving";
            return (
              <button
                key={tabId}
                type="button"
                onClick={() => setEditorTab(tabId)}
                className={`tab ${activeTab === tabId ? "active" : ""}`}
              >
                <span style={{ fontFamily: "var(--font-mono-stack)" }}>
                  {path.split("/").pop() ?? path}
                </span>
                {isDirty ? (
                  <span
                    className="x"
                    onClick={(e) => {
                      e.stopPropagation();
                      // Fire-and-forget; flushSave handles dedup + agent-busy backoff.
                      flushSave(path).catch(() => {});
                    }}
                    title={status === "saving" ? "saving…" : "Save now (⌘S)"}
                    style={{
                      color:
                        status === "saving"
                          ? "var(--text-muted)"
                          : "var(--accent-primary, #fbbf24)",
                      fontSize: 14,
                      lineHeight: 1,
                    }}
                  >
                    •
                  </span>
                ) : (
                  <span
                    className="x"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeOpenFile(path);
                    }}
                    title="Close"
                  >
                    ×
                  </span>
                )}
              </button>
            );
          })}
          {previews.map((p) => {
            const tabId = previewTabId(p.id);
            return (
              <button
                key={tabId}
                type="button"
                onClick={() => setEditorTab(tabId)}
                className={`tab ${activeTab === tabId ? "active" : ""}`}
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
                <span>preview :{p.port}</span>
                <span
                  className="x"
                  onClick={(e) => {
                    e.stopPropagation();
                    // Closing the tab also stops the dev server. Otherwise
                    // dev servers leak across runs and tie up ports until the
                    // orchestrator restarts. The DELETE call is best-effort —
                    // we remove the tab locally regardless so the UI stays
                    // responsive even if the API is briefly down. The
                    // `server_stopped` broadcast that follows the kill is a
                    // no-op for this client (preview already removed).
                    removePreview(p.id);
                    if (projectId) {
                      stopServerApi(projectId, p.id).catch(() => {});
                    }
                  }}
                  title="Close tab and stop the dev server"
                >
                  ×
                </span>
              </button>
            );
          })}
          {activeFilePath && isMarkdownFile(activeFilePath) && (
            <button
              type="button"
              onClick={() => setMdPreview((v) => !v)}
              className={`tab ${mdPreview ? "active" : ""}`}
              style={{ marginLeft: "auto", fontSize: 10, gap: 4, opacity: 0.85 }}
              title={mdPreview ? "Show source" : "Preview markdown"}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M2 3h12v10H2V3zm1 1v8h10V4H3zm1 1h3v2H6v2H5V5h-.5L4 5zm4.5 0H10l1.5 3-1.5 3H8.5l1.5-3-1.5-3z"/>
              </svg>
              {mdPreview ? "Source" : "Preview"}
            </button>
          )}
        </div>
      )}

      <div className="editor-content">
        {activePreview && <PreviewPanel server={activePreview} />}
        {activeFilePath && isImageFile(activeFilePath) ? (
          <ImageViewer path={activeFilePath} projectId={projectId} />
        ) : activeFilePath && isMarkdownFile(activeFilePath) && mdPreview ? (
          <MarkdownPreview content={fileContent} />
        ) : activeFilePath ? (
          <CodeEditor />
        ) : null}
        {!hasAnyTabs && (
          <div className="editor-empty">
            <h3>Your preview will show up here.</h3>
            <p>
              Click Run in the top toolbar to start the dev server and see a live preview here. You
              can also open a file from the explorer to view its code.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
