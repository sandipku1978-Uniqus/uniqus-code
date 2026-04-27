"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import { useStore, type SaveStatus } from "@/lib/store";
import { send } from "@/lib/ws-client";

const Monaco = dynamic(() => import("@monaco-editor/react"), { ssr: false });

const SAVE_DEBOUNCE_MS = 600;
// Module-scoped sentinel so the "no status" case returns a stable reference
// across renders. A fresh object literal inside a Zustand selector causes an
// infinite render loop (React #185) — Object.is sees a new ref every tick.
const IDLE_STATUS: SaveStatus = { kind: "idle" };

function languageFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return (
    {
      ts: "typescript",
      tsx: "typescript",
      js: "javascript",
      jsx: "javascript",
      mjs: "javascript",
      cjs: "javascript",
      py: "python",
      go: "go",
      rs: "rust",
      json: "json",
      md: "markdown",
      html: "html",
      css: "css",
      scss: "scss",
      yml: "yaml",
      yaml: "yaml",
      sh: "shell",
      txt: "plaintext",
    }[ext] ?? "plaintext"
  );
}

function defineUniqusTheme(monaco: typeof import("monaco-editor")): void {
  monaco.editor.defineTheme("uniqus-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: "e4e2dc" },
      { token: "comment", foreground: "5a5850", fontStyle: "italic" },
      { token: "keyword", foreground: "c084fc" },
      { token: "string", foreground: "fbbf24" },
      { token: "number", foreground: "34d399" },
      { token: "type", foreground: "5eead4" },
      { token: "type.identifier", foreground: "5eead4" },
      { token: "identifier", foreground: "e4e2dc" },
      { token: "function", foreground: "60a5fa" },
      { token: "tag", foreground: "f472b6" },
      { token: "attribute.name", foreground: "60a5fa" },
      { token: "attribute.value", foreground: "fbbf24" },
      { token: "delimiter", foreground: "8a8880" },
      { token: "operator", foreground: "8a8880" },
    ],
    colors: {
      "editor.background": "#0c0c11",
      "editor.foreground": "#e4e2dc",
      "editorLineNumber.foreground": "#3a3830",
      "editorLineNumber.activeForeground": "#8a8880",
      "editor.lineHighlightBackground": "#16161e",
      "editor.lineHighlightBorder": "#16161e",
      "editor.selectionBackground": "#3a2055",
      "editor.inactiveSelectionBackground": "#252530",
      "editorCursor.foreground": "#B21E7D",
      "editorWidget.background": "#16161e",
      "editorWidget.border": "#2a2a35",
      "editorIndentGuide.background": "#1e1e28",
      "editorIndentGuide.activeBackground": "#3a3830",
      "editorBracketMatch.background": "#3a2055",
      "editorBracketMatch.border": "#B21E7D",
      "editorGutter.background": "#0c0c11",
      "scrollbarSlider.background": "#2a2a3580",
      "scrollbarSlider.hoverBackground": "#3a3830",
      "scrollbarSlider.activeBackground": "#48287980",
      "minimap.background": "#0c0c11",
    },
  });
}

export default function CodeEditor() {
  const path = useStore((s) => s.selectedFile);
  const content = useStore((s) => s.fileContent);
  const busy = useStore((s) => s.busy);
  // Read just the per-path entry (returns the same reference until that
  // entry is set/replaced); fall back to a stable sentinel afterwards so the
  // selector never returns a new object literal.
  const rawSaveStatus = useStore((s) => (path ? s.saveStatus[path] : undefined));
  const saveStatus: SaveStatus = rawSaveStatus ?? IDLE_STATUS;
  const setSaveStatus = useStore((s) => s.setSaveStatus);

  // Save debounce. We keep a single timer per editor instance — if the user
  // switches files mid-edit, we flush the pending save first.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPathRef = useRef<string | null>(null);
  const pendingContentRef = useRef<string>("");

  // Flush any in-flight save when the open file changes — the user almost
  // always wants their last typed bytes to land before they navigate away.
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        if (pendingPathRef.current) {
          send({
            type: "client_write_file",
            path: pendingPathRef.current,
            content: pendingContentRef.current,
          });
        }
      }
    };
  }, [path]);

  if (!path) {
    return (
      <div className="editor-empty">
        <h3>No file open.</h3>
        <p>Open a file from the explorer to view it here.</p>
      </div>
    );
  }

  const onChange = (value: string | undefined) => {
    if (value === undefined || value === content) return;
    setSaveStatus(path, { kind: "dirty" });
    pendingPathRef.current = path;
    pendingContentRef.current = value;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      // Don't fight the agent: if it's mid-turn, hold the save until it
      // finishes. The pending content stays buffered and re-arms when the
      // user types again or when busy clears (we re-check on the next tick).
      if (useStore.getState().busy) {
        setSaveStatus(path, { kind: "dirty" });
        // Re-schedule a short retry so the save lands shortly after the
        // agent goes idle.
        saveTimer.current = setTimeout(() => {
          saveTimer.current = null;
          if (useStore.getState().busy) return; // try again on next change
          setSaveStatus(path, { kind: "saving" });
          send({
            type: "client_write_file",
            path,
            content: pendingContentRef.current,
          });
        }, 800);
        return;
      }
      setSaveStatus(path, { kind: "saving" });
      send({
        type: "client_write_file",
        path,
        content: pendingContentRef.current,
      });
    }, SAVE_DEBOUNCE_MS);
  };

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: "#0c0c11",
      }}
    >
      <Monaco
        theme="uniqus-dark"
        language={languageFor(path)}
        value={content}
        beforeMount={(monaco) => defineUniqusTheme(monaco)}
        onChange={onChange}
        options={{
          readOnly: false,
          minimap: { enabled: false },
          fontSize: 12,
          fontFamily: "JetBrains Mono, ui-monospace, monospace",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          padding: { top: 8 },
          renderLineHighlight: "line",
          smoothScrolling: true,
        }}
      />
      <div
        style={{
          padding: "4px 12px",
          fontSize: 11,
          color: "var(--text-muted)",
          borderTop: "1px solid var(--border-default)",
          background: "#0c0c11",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>{path}</span>
        <span>{describeSave(saveStatus, busy)}</span>
      </div>
    </div>
  );
}

function describeSave(
  status: { kind: string; at?: number; message?: string },
  agentBusy: boolean,
): string {
  switch (status.kind) {
    case "saving":
      return "saving…";
    case "dirty":
      return agentBusy ? "edits queued (agent running)" : "unsaved";
    case "saved":
      return "saved";
    case "error":
      return `save failed: ${status.message ?? ""}`;
    default:
      return "";
  }
}
