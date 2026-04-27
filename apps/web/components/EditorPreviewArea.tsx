"use client";

import { useStore, fileTabId, previewTabId, flushSave } from "@/lib/store";
import { stopServerApi } from "@/lib/api";
import CodeEditor from "./CodeEditor";
import PreviewPanel from "./PreviewPanel";

export default function EditorPreviewArea() {
  const previews = useStore((s) => s.previews);
  const openFiles = useStore((s) => s.openFiles);
  const editorTab = useStore((s) => s.editorTab);
  const setEditorTab = useStore((s) => s.setEditorTab);
  const closeOpenFile = useStore((s) => s.closeOpenFile);
  const saveStatus = useStore((s) => s.saveStatus);
  const project = useStore((s) => s.project);

  const hasAnyTabs = openFiles.length > 0 || previews.length > 0;

  // Pick what to render based on editorTab; fall back to first available tab.
  let activeTab = editorTab;
  if (!activeTab && previews[0]) activeTab = previewTabId(previews[0].id);
  if (!activeTab && openFiles[0]) activeTab = fileTabId(openFiles[0]);

  const activePreview =
    activeTab.startsWith("preview:") &&
    previews.find((p) => previewTabId(p.id) === activeTab);
  const activeFilePath = activeTab.startsWith("file:") ? activeTab.slice(5) : null;

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
                    if (!project) return;
                    // Closing the tab kills the underlying dev server.
                    // Without this, the server keeps running on the
                    // orchestrator host and the user can't get rid of it
                    // without restarting Railway. The store will drop the
                    // tab when the orchestrator broadcasts server_stopped.
                    stopServerApi(project.id, p.id).catch((err) => {
                      console.error("stopServer failed:", err);
                    });
                  }}
                  title="Stop server and close tab"
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
