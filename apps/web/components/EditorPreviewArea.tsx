"use client";

import { useStore, fileTabId, previewTabId } from "@/lib/store";
import CodeEditor from "./CodeEditor";
import PreviewPanel from "./PreviewPanel";

export default function EditorPreviewArea() {
  const previews = useStore((s) => s.previews);
  const openFiles = useStore((s) => s.openFiles);
  const editorTab = useStore((s) => s.editorTab);
  const setEditorTab = useStore((s) => s.setEditorTab);
  const closeOpenFile = useStore((s) => s.closeOpenFile);

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
