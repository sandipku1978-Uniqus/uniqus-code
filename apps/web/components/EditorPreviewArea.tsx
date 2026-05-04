"use client";

import { useEffect } from "react";
import { useStore, fileTabId, previewTabId, flushSave } from "@/lib/store";
import { send } from "@/lib/ws-client";
import { stopServerApi } from "@/lib/api";
import CodeEditor from "./CodeEditor";
import PreviewPanel from "./PreviewPanel";

export default function EditorPreviewArea() {
  const previews = useStore((s) => s.previews);
  const openFiles = useStore((s) => s.openFiles);
  const editorTab = useStore((s) => s.editorTab);
  const setEditorTab = useStore((s) => s.setEditorTab);
  const closeOpenFile = useStore((s) => s.closeOpenFile);
  const removePreview = useStore((s) => s.removePreview);
  const saveStatus = useStore((s) => s.saveStatus);
  const selectedFile = useStore((s) => s.selectedFile);
  const projectId = useStore((s) => s.project?.id ?? null);

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
        </div>
      )}

      <div className="editor-content">
        {activePreview && <PreviewPanel server={activePreview} />}
        {activeFilePath && <CodeEditor />}
        {!hasAnyTabs && (
          <div className="editor-empty">
            <h3>Nothing here yet.</h3>
            <p>
              Open a file from the file explorer, or have Codex start a dev server — it&apos;ll
              appear as a preview tab here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
