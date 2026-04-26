"use client";

import dynamic from "next/dynamic";
import { useStore } from "@/lib/store";

const Monaco = dynamic(() => import("@monaco-editor/react"), { ssr: false });

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

  if (!path) {
    return (
      <div className="editor-empty">
        <h3>No file open.</h3>
        <p>Open a file from the explorer to view it here.</p>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "#0c0c11" }}>
      <Monaco
        theme="uniqus-dark"
        language={languageFor(path)}
        value={content}
        beforeMount={(monaco) => defineUniqusTheme(monaco)}
        options={{
          readOnly: true,
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
    </div>
  );
}
