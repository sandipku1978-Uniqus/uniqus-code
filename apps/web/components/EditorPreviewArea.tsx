"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  useStore,
  fileTabId,
  previewTabId,
  AGENT_PREVIEW_TAB,
  ACTIVITY_TAB,
  flushSave,
  flushAllPendingEdits,
} from "@/lib/store";
import { requestFile } from "@/lib/ws-client";
import { stopServerApi, getApiBase } from "@/lib/api";
import Modal from "./Modal";
import CodeEditor from "./CodeEditor";
import PreviewPanel from "./PreviewPanel";
import AgentPreviewPanel from "./AgentPreviewPanel";
import ActivityMonitor from "./ActivityMonitor";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico"]);

function editorTabDomId(tabId: string): string {
  return `editor-tab-${encodeURIComponent(tabId)}`;
}

function isImageFile(filePath: string): boolean {
  const ext = filePath.lastIndexOf(".") >= 0 ? filePath.slice(filePath.lastIndexOf(".")).toLowerCase() : "";
  return IMAGE_EXTENSIONS.has(ext);
}

function ImageViewer({ path, projectId }: { path: string; projectId: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  // Bumped by the Retry button so a transient fetch failure isn't a dead end (§C).
  const [reloadKey, setReloadKey] = useState(0);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setUrl(null);
    setError(null);
    if (!projectId) return () => controller.abort();
    fetch(`${getApiBase()}/api/projects/${projectId}/raw/${encodeURIComponent(path)}`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.blob();
      })
      .then((blob) => {
        const nextUrl = URL.createObjectURL(blob);
        if (controller.signal.aborted) {
          URL.revokeObjectURL(nextUrl);
          return;
        }
        setUrl(nextUrl);
        setError(null);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => controller.abort();
  }, [path, projectId, reloadKey]);

  // Reset zoom when switching files
  useEffect(() => {
    setZoom(100);
    setDims(null);
  }, [path]);

  // Cleanup object URL on unmount
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  if (error) {
    return (
      <div className="editor-empty" style={{ gap: 10 }}>
        <p style={{ color: "var(--text-dim)" }}>Could not load image: {error}</p>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setReloadKey((k) => k + 1)}
        >
          Retry
        </button>
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
        <button type="button" onClick={() => setZoom((z) => Math.max(10, z - 25))} aria-label="Zoom out" style={{ background: "none", border: "none", color: "var(--text-primary)", cursor: "pointer", fontSize: 14, padding: "2px 6px" }}>−</button>
        <span style={{ minWidth: 40, textAlign: "center" }}>{zoom}%</span>
        <button type="button" onClick={() => setZoom((z) => Math.min(500, z + 25))} aria-label="Zoom in" style={{ background: "none", border: "none", color: "var(--text-primary)", cursor: "pointer", fontSize: 14, padding: "2px 6px" }}>+</button>
        <button type="button" onClick={() => setZoom(100)} style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: 10, padding: "2px 6px" }}>Fit</button>
        {dims && (
          <span style={{ marginLeft: 8 }}>
            {dims.w}×{dims.h}
          </span>
        )}
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          style={{ marginLeft: "auto", color: "var(--accent)", fontSize: 10 }}
        >
          Open in new tab ↗
        </a>
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
          onLoad={(e) =>
            setDims({
              w: e.currentTarget.naturalWidth,
              h: e.currentTarget.naturalHeight,
            })
          }
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
  const [copied, setCopied] = useState(false);
  return (
    <div
      style={{
        height: "100%",
        overflow: "auto",
        background: "var(--bg-canvas, #0e0e14)",
        color: "var(--text-primary, #e4e2dc)",
        fontSize: 14,
        lineHeight: 1.7,
      }}
    >
      <div
        style={{
          position: "sticky",
          top: 0,
          display: "flex",
          justifyContent: "flex-end",
          padding: "6px 12px",
          background: "var(--bg-canvas, #0e0e14)",
          borderBottom: "1px solid var(--border-default)",
        }}
      >
        <button
          type="button"
          className="btn-secondary"
          style={{ fontSize: 11, padding: "2px 10px" }}
          onClick={() => {
            navigator.clipboard
              ?.writeText(content)
              .then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              })
              .catch(() => {});
          }}
        >
          {copied ? "Copied ✓" : "Copy source"}
        </button>
      </div>
      <div style={{ padding: "24px 32px" }}>
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
    </div>
  );
}

export default function EditorPreviewArea() {
  const previews = useStore((s) => s.previews);
  const openFiles = useStore((s) => s.openFiles);
  const editorTab = useStore((s) => s.editorTab);
  const setEditorTab = useStore((s) => s.setEditorTab);
  // Narrow selectors (not the whole agentPreview object) so streaming frames
  // don't re-render the editor area every frame — only the booleans that gate
  // the tab's existence + indicators change at run start/end.
  const agentHasFrames = useStore((s) => s.agentPreview.frames.length > 0);
  const agentActive = useStore((s) => s.agentPreview.active);
  const agentUnseen = useStore((s) => s.agentPreview.unseen);
  const closeOpenFile = useStore((s) => s.closeOpenFile);
  const removePreview = useStore((s) => s.removePreview);
  const saveStatus = useStore((s) => s.saveStatus);
  const selectedFile = useStore((s) => s.selectedFile);
  const fileContentPath = useStore((s) => s.fileContentPath);
  const fileRequest = useStore((s) => s.fileRequest);
  const fileContent = useStore((s) => s.fileContent);
  const projectId = useStore((s) => s.project?.id ?? null);
  const [mdPreview, setMdPreview] = useState(false);
  // Preview-tab close confirm — closing stops the dev server, so warn first (§C).
  const [confirmStop, setConfirmStop] = useState<{ id: string; port: number } | null>(null);

  // The single live "Preview (Agent)" tab appears once the agent has produced
  // any interaction frames (or a run is mid-flight).
  const showAgentTab = agentHasFrames || agentActive;
  // The Activity tab is permanent, so the strip is worth showing whenever it's
  // the active view too (e.g. a mobile "Activity" tap on a project with no files
  // open) — otherwise the tab strip vanishes and there's no way back.
  const hasAnyTabs =
    openFiles.length > 0 || previews.length > 0 || showAgentTab || editorTab === ACTIVITY_TAB;
  // How many open files have unsaved edits, for the Save-all affordance.
  const dirtyCount = openFiles.filter(
    (p) => saveStatus[p]?.kind === "dirty" || saveStatus[p]?.kind === "saving",
  ).length;

  // Pick what to render based on editorTab; fall back to first available tab.
  let activeTab = editorTab;
  if (!activeTab && showAgentTab) activeTab = AGENT_PREVIEW_TAB;
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
    if (
      selectedFile === activeFilePath &&
      (fileContentPath === activeFilePath || fileRequest?.path === activeFilePath)
    ) {
      return;
    }
    requestFile(activeFilePath);
  }, [activeFilePath, selectedFile, fileContentPath, fileRequest]);

  const tabIds = [
    ...openFiles.map(fileTabId),
    ...previews.map((preview) => previewTabId(preview.id)),
    ...(showAgentTab ? [AGENT_PREVIEW_TAB] : []),
    ACTIVITY_TAB,
  ];
  const activateTab = (tabId: string): void => {
    setEditorTab(tabId);
    if (tabId.startsWith("file:")) requestFile(tabId.slice(5));
  };
  const onTabKeyDown = (currentTab: string, event: KeyboardEvent<HTMLButtonElement>): void => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = Math.max(0, tabIds.indexOf(currentTab));
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabIds.length - 1
          : event.key === "ArrowRight"
            ? (currentIndex + 1) % tabIds.length
            : (currentIndex - 1 + tabIds.length) % tabIds.length;
    const nextTab = tabIds[nextIndex];
    if (!nextTab) return;
    activateTab(nextTab);
    requestAnimationFrame(() => document.getElementById(editorTabDomId(nextTab))?.focus());
  };

  return (
    <div className="editor-area">
      {hasAnyTabs && (
        <div className="tab-strip">
          <div className="editor-tab-list" role="tablist" aria-label="Open editor views">
          {openFiles.map((path) => {
            const tabId = fileTabId(path);
            const status = saveStatus[path]?.kind;
            const isDirty = status === "dirty" || status === "saving";
            const fileName = path.split("/").pop() ?? path;
            return (
              <div className="editor-tab-item" key={tabId} role="presentation">
                <button
                  id={editorTabDomId(tabId)}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tabId}
                  aria-controls="editor-active-panel"
                  tabIndex={activeTab === tabId ? 0 : -1}
                  onClick={() => activateTab(tabId)}
                  onKeyDown={(event) => onTabKeyDown(tabId, event)}
                  className={`tab ${activeTab === tabId ? "active" : ""}`}
                >
                  <span style={{ fontFamily: "var(--font-mono-stack)" }}>{fileName}</span>
                  {isDirty && <span className="sr-only">, unsaved changes</span>}
                </button>
                {isDirty ? (
                  <button
                    type="button"
                    className="tab-action"
                    onClick={() => flushSave(path).catch(() => {})}
                    disabled={status === "saving"}
                    aria-label={status === "saving" ? `${fileName} is saving` : `Save ${fileName}`}
                    title={status === "saving" ? "Saving" : "Save now"}
                  >
                    <span aria-hidden="true">•</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="tab-action"
                    onClick={() => closeOpenFile(path)}
                    aria-label={`Close ${fileName}`}
                    title={`Close ${fileName}`}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                )}
              </div>
            );
          })}
          {previews.map((p) => {
            const tabId = previewTabId(p.id);
            return (
              <div className="editor-tab-item" key={tabId} role="presentation">
                <button
                  id={editorTabDomId(tabId)}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tabId}
                  aria-controls="editor-active-panel"
                  tabIndex={activeTab === tabId ? 0 : -1}
                  onClick={() => activateTab(tabId)}
                  onKeyDown={(event) => onTabKeyDown(tabId, event)}
                  className={`tab ${activeTab === tabId ? "active" : ""}`}
                  title={`Live dev server on port ${p.port}`}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                  <span>Live preview</span>
                </button>
                <button
                  type="button"
                  className="tab-action"
                  onClick={() => setConfirmStop({ id: p.id, port: p.port })}
                  aria-label={`Close live preview on port ${p.port} and stop its server`}
                  title="Close tab and stop the dev server"
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>
            );
          })}
          {showAgentTab && (
            <button
              id={editorTabDomId(AGENT_PREVIEW_TAB)}
              type="button"
              role="tab"
              aria-selected={activeTab === AGENT_PREVIEW_TAB}
              aria-controls="editor-active-panel"
              tabIndex={activeTab === AGENT_PREVIEW_TAB ? 0 : -1}
              onClick={() => activateTab(AGENT_PREVIEW_TAB)}
              onKeyDown={(event) => onTabKeyDown(AGENT_PREVIEW_TAB, event)}
              className={`tab ${activeTab === AGENT_PREVIEW_TAB ? "active" : ""}`}
              title="Watch the agent interact with your app, and replay saved flows"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M3 3l7 17 2-7 7-2z" />
              </svg>
              <span>Agent preview</span>
              {agentActive && <span className="sr-only">, live</span>}
              {!agentActive && agentUnseen && <span className="sr-only">, new activity</span>}
              {agentActive ? (
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: "var(--danger, #d9534f)",
                    animation: "pulse-dot 1.4s ease-in-out infinite",
                  }}
                  aria-hidden="true"
                />
              ) : (
                agentUnseen && (
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: "var(--accent-primary, #7c5cff)",
                    }}
                    aria-hidden="true"
                  />
                )
              )}
            </button>
          )}
          {/* Activity Monitor tab (item 2) — a real editor tab so the live build
              dashboard is reachable in Code view without the ⋯ menu. */}
          <button
            id={editorTabDomId(ACTIVITY_TAB)}
            type="button"
            role="tab"
            aria-selected={activeTab === ACTIVITY_TAB}
            aria-controls="editor-active-panel"
            tabIndex={activeTab === ACTIVITY_TAB ? 0 : -1}
            onClick={() => activateTab(ACTIVITY_TAB)}
            onKeyDown={(event) => onTabKeyDown(ACTIVITY_TAB, event)}
            className={`tab ${activeTab === ACTIVITY_TAB ? "active" : ""}`}
            title="Live tokens, cost, tasks, sub-agents, and file diffs"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M3 12h4l2 6 4-16 2 8h6" />
            </svg>
            <span>Activity</span>
          </button>
          </div>
          <div className="editor-tab-actions">
            {dirtyCount > 1 && (
              <button
                type="button"
                onClick={() => {
                  flushAllPendingEdits().catch(() => {});
                }}
                className="tab"
                style={{ fontSize: 10, gap: 4, opacity: 0.85 }}
                title="Save all unsaved files"
              >
                Save all ({dirtyCount})
              </button>
            )}
            {activeFilePath && isMarkdownFile(activeFilePath) && (
              <button
                type="button"
                onClick={() => setMdPreview((v) => !v)}
                className={`tab ${mdPreview ? "active" : ""}`}
                style={{ fontSize: 10, gap: 4, opacity: 0.85 }}
                title={mdPreview ? "Show source" : "Preview markdown"}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M2 3h12v10H2V3zm1 1v8h10V4H3zm1 1h3v2H6v2H5V5h-.5L4 5zm4.5 0H10l1.5 3-1.5 3H8.5l1.5-3-1.5-3z"/>
                </svg>
                {mdPreview ? "Source" : "Preview"}
              </button>
            )}
          </div>
        </div>
      )}

      <div
        id="editor-active-panel"
        className="editor-content"
        role="tabpanel"
        aria-labelledby={activeTab ? editorTabDomId(activeTab) : undefined}
        tabIndex={0}
      >
        {activeTab === ACTIVITY_TAB && <ActivityMonitor />}
        {activeTab === AGENT_PREVIEW_TAB && <AgentPreviewPanel />}
        {activePreview && (
          <PreviewPanel
            key={`${projectId ?? "none"}:${activePreview.id}`}
            server={activePreview}
          />
        )}
        {activeFilePath && isImageFile(activeFilePath) ? (
          <ImageViewer
            key={`${projectId ?? "none"}:${activeFilePath}`}
            path={activeFilePath}
            projectId={projectId}
          />
        ) : activeFilePath &&
          isMarkdownFile(activeFilePath) &&
          mdPreview &&
          fileContentPath === activeFilePath ? (
          <MarkdownPreview content={fileContent} />
        ) : activeFilePath ? (
          <CodeEditor path={activeFilePath} />
        ) : null}
        {!hasAnyTabs && activeTab !== ACTIVITY_TAB && (
          <div className="editor-empty">
            <h3>Your preview will show up here.</h3>
            <p>
              Click Run in the top toolbar to start the dev server and see a live preview here. You
              can also open a file from the explorer to view its code.
            </p>
          </div>
        )}
      </div>

      {confirmStop && (
        <Modal
          title="Stop the dev server?"
          width={440}
          onClose={() => setConfirmStop(null)}
          footer={
            <>
              <span />
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setConfirmStop(null)}
                >
                  Keep running
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => {
                    const { id } = confirmStop;
                    setConfirmStop(null);
                    removePreview(id);
                    if (projectId) stopServerApi(projectId, id).catch(() => {});
                  }}
                >
                  Close &amp; stop
                </button>
              </div>
            </>
          }
        >
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-dim)", lineHeight: 1.6 }}>
            Closing the preview on port {confirmStop.port} stops its dev server. You can start it
            again from the Run button.
          </p>
        </Modal>
      )}
    </div>
  );
}
