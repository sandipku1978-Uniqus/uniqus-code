"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useStore, flushSave, type SaveStatus, type ThemeChoice } from "@/lib/store";

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

const DARK_THEME = "gate15-dark";
const LIGHT_THEME = "gate15-light";

/**
 * Gate 15's editor themes: one warm signal colour on cold industrial steel.
 *
 * Monaco cannot read CSS custom properties, so the palette has to be restated
 * as literal hex — which means BOTH themes have to exist, or the editor stays a
 * dark plate on a concrete-white page. The two mirror each other token for
 * token and are picked off `<html data-theme>` (see `useDocumentTheme`), so the
 * editor ground always equals `--bg-code` for the active theme.
 *
 * The chrome is deliberately COLD (graphite/concrete surfaces, steel selection)
 * — that's what makes the warm signal read as hi-vis. The brand orange is
 * reserved for the live-state marks the eye tracks: the caret, the matched
 * bracket, the dragged scrollbar. On light it drops from ember (#FF7700, only
 * 2.3:1 on concrete) to the deep oxide --brand-rust (#AE460A), exactly as the
 * spec requires of every orange mark on a light ground.
 *
 * Syntax keeps six well-separated hues, because an editor is a functional
 * surface before it is a brand one. Warm (ember → signal, and rust → ochre on
 * light) marks the structural spine — keywords and literals; cold (olive →
 * teal → cyan → steel blue) marks everything nominal — strings, types, tags,
 * functions. Every token clears 4.5:1 on its own ground; the two closest pairs
 * (keyword/number, type/function) also separate on lightness, not hue alone.
 * Ratios below are against that theme's --bg-code (#08090A / #EDECEA).
 */
function defineGate15Themes(monaco: typeof import("monaco-editor")): void {
  monaco.editor.defineTheme(DARK_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: "edebe7" }, // --text-primary
      { token: "comment", foreground: "7c7a76", fontStyle: "italic" }, // --text-dim, 4.6:1
      { token: "keyword", foreground: "ff8c24" }, // ember-hi — the structural spine, 8.5:1
      { token: "number", foreground: "ffcf3d" }, // brand signal — numerals, 13.5:1
      { token: "string", foreground: "a8cf7e" }, // lichen, 11.3:1
      { token: "type", foreground: "5ec9b0" }, // patina, 9.9:1
      { token: "type.identifier", foreground: "5ec9b0" },
      { token: "identifier", foreground: "edebe7" },
      { token: "function", foreground: "79b8ff" }, // steel blue, 9.6:1
      { token: "tag", foreground: "4fb8d8" }, // cold cyan, 8.7:1
      { token: "attribute.name", foreground: "79b8ff" },
      { token: "attribute.value", foreground: "a8cf7e" }, // an attribute value IS a string
      { token: "delimiter", foreground: "8a8880" }, // recedes, still 5.6:1
      { token: "operator", foreground: "9a9793" }, // --text-muted
    ],
    colors: {
      "editor.background": "#08090A", // --bg-code, the deepest surface
      "editor.foreground": "#EDEBE7",
      "editorLineNumber.foreground": "#3C3A37", // --text-xdim (decoration)
      "editorLineNumber.activeForeground": "#9A9793",
      "editor.lineHighlightBackground": "#0F1113", // --bg-pane, one step up
      "editor.lineHighlightBorder": "#0F1113",
      // Selection stays cold steel on purpose: a warm selection block would go
      // muddy under the warm tokens sitting on it (and brown is the one thing
      // this palette must never become).
      "editor.selectionBackground": "#28323A",
      "editor.inactiveSelectionBackground": "#1E2429",
      "editorCursor.foreground": "#FF7700", // ember
      "editorWidget.background": "#16181B", // --bg-surface
      "editorWidget.border": "#2A2E33", // --border-default
      "editorIndentGuide.background": "#1E2125", // --border-light
      "editorIndentGuide.activeBackground": "#3C3A37",
      "editorBracketMatch.background": "#28323A",
      "editorBracketMatch.border": "#FF7700", // ember
      "editorGutter.background": "#08090A",
      "scrollbarSlider.background": "#2A2E3380",
      "scrollbarSlider.hoverBackground": "#3C3A37",
      "scrollbarSlider.activeBackground": "#FF770080", // ember while dragging
      "minimap.background": "#08090A",
    },
  });

  // The same ladder inverted onto concrete. Every hue is the dark theme's hue
  // driven down in lightness until it clears AA on #EDECEA — the warm spine
  // stays warm, the cold nominals stay cold, and the ordering of the three
  // recessive greys (comment < delimiter < operator) is preserved.
  monaco.editor.defineTheme(LIGHT_THEME, {
    base: "vs",
    inherit: true,
    rules: [
      { token: "", foreground: "17181a" }, // --text-primary, 15.0:1
      { token: "comment", foreground: "64676c", fontStyle: "italic" }, // 4.8:1
      { token: "keyword", foreground: "ae460a" }, // --brand-rust — the spine, 4.8:1
      { token: "number", foreground: "6b4600" }, // deep ochre — numerals, 7.1:1
      { token: "string", foreground: "4a6b1e" }, // moss (lichen, darkened), 5.2:1
      { token: "type", foreground: "0f6b5c" }, // patina, 5.4:1
      { token: "type.identifier", foreground: "0f6b5c" },
      { token: "identifier", foreground: "17181a" },
      { token: "function", foreground: "14487f" }, // steel blue, 7.9:1
      { token: "tag", foreground: "0e6a85" }, // cold cyan, 5.2:1
      { token: "attribute.name", foreground: "14487f" },
      { token: "attribute.value", foreground: "4a6b1e" }, // an attribute value IS a string
      { token: "delimiter", foreground: "595c61" }, // recedes, still 5.7:1
      { token: "operator", foreground: "52555a" }, // --text-muted, 6.3:1
    ],
    colors: {
      "editor.background": "#EDECEA", // --bg-code (light)
      "editor.foreground": "#17181A",
      "editorLineNumber.foreground": "#B5B7BA", // --text-xdim (decoration)
      "editorLineNumber.activeForeground": "#52555A",
      "editor.lineHighlightBackground": "#FFFFFF", // --bg-pane, one step up
      "editor.lineHighlightBorder": "#FFFFFF",
      // Cold steel tint, kept light enough that even the lowest-contrast token
      // (keyword/rust) still clears 4.5:1 sitting on a selected run.
      "editor.selectionBackground": "#E1E8ED",
      "editor.inactiveSelectionBackground": "#EAEEF1",
      "editorCursor.foreground": "#AE460A", // rust — ember is only 2.3:1 here
      "editorWidget.background": "#FFFFFF", // --bg-surface
      "editorWidget.border": "#DDDCDA", // --border-default
      "editorIndentGuide.background": "#E8E7E5", // --border-light
      "editorIndentGuide.activeBackground": "#B5B7BA",
      "editorBracketMatch.background": "#E1E8ED",
      "editorBracketMatch.border": "#AE460A", // rust
      "editorGutter.background": "#EDECEA",
      "scrollbarSlider.background": "#DDDCDA80",
      "scrollbarSlider.hoverBackground": "#B5B7BA",
      "scrollbarSlider.activeBackground": "#AE460A80", // rust while dragging
      "minimap.background": "#EDECEA",
    },
  });
}

/**
 * The live theme, read from `<html data-theme>`.
 *
 * NOT from `useStore(s => s.theme)`: that field initializes to "dark" for SSR
 * safety and is only reconciled with localStorage by
 * `hydrateAppearanceFromStorage()`, which today is called from the Appearance
 * settings card alone — so in the workspace it reads "dark" even when the user
 * is actually on light, and the editor would have been the one surface that
 * didn't flip. The `data-theme` attribute is the real source of truth: the
 * layout bootstrap script stamps it before first paint and `setTheme` keeps it
 * in sync, and it is the same signal globals.css keys its token overrides off,
 * so the Monaco ground can never disagree with --bg-code.
 */
function useDocumentTheme(): ThemeChoice {
  const [theme, setTheme] = useState<ThemeChoice>("dark");

  useEffect(() => {
    const root = document.documentElement;
    const read = () => setTheme(root.dataset.theme === "light" ? "light" : "dark");
    read();
    const obs = new MutationObserver(read);
    obs.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  return theme;
}

export default function CodeEditor() {
  const path = useStore((s) => s.selectedFile);
  const content = useStore((s) => s.fileContent);
  const busy = useStore((s) => s.busy);
  const rawSaveStatus = useStore((s) => (path ? s.saveStatus[path] : undefined));
  const saveStatus: SaveStatus = rawSaveStatus ?? IDLE_STATUS;
  const setSaveStatus = useStore((s) => s.setSaveStatus);
  const setPendingEdit = useStore((s) => s.setPendingEdit);
  const theme = useDocumentTheme();

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Flush any in-flight save when the open file changes — the user almost
  // always wants their last typed bytes to land before they navigate away.
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      if (path) {
        // Fire and forget; flushSave is a no-op if nothing's pending.
        flushSave(path).catch(() => {});
      }
    };
  }, [path]);

  // Cmd/Ctrl-S → flush save now. Browsers default this to "Save Page As…",
  // which is never what a developer wants in a code editor. We capture at
  // window scope so it works even when Monaco doesn't have keyboard focus.
  useEffect(() => {
    if (!path) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (saveTimer.current) {
          clearTimeout(saveTimer.current);
          saveTimer.current = null;
        }
        flushSave(path).catch(() => {});
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
    setPendingEdit(path, value);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      flushSave(path).catch(() => {});
    }, SAVE_DEBOUNCE_MS);
  };

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-code)",
      }}
    >
      <Monaco
        theme={theme === "light" ? LIGHT_THEME : DARK_THEME}
        language={languageFor(path)}
        value={content}
        beforeMount={(monaco) => defineGate15Themes(monaco)}
        onMount={(editor, monaco) => {
          // Lock down VSCode-flavored features that aren't appropriate inside
          // an embedded sandbox editor — the Quick Command palette would
          // expose actions the user can't actually use here, and Goto Symbol /
          // Peek work against a phantom workspace that doesn't match what's
          // really on disk. Override the keybindings to no-ops; combined with
          // `contextmenu: false` below this removes all the obvious entry
          // points. We keep Find (Ctrl/Cmd-F) — it's useful and harmless.
          const NOOP = (): void => {};
          // F1 — Quick Command
          editor.addCommand(monaco.KeyCode.F1, NOOP);
          // Cmd/Ctrl + Shift + P — Quick Command
          editor.addCommand(
            monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyP,
            NOOP,
          );
          // Cmd/Ctrl + P — Go to file (no file picker here)
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP, NOOP);
          // Cmd/Ctrl + Shift + O — Go to symbol
          editor.addCommand(
            monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyO,
            NOOP,
          );
        }}
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
          // Lockdown: no right-click menu, no peek/goto symbol UIs, no
          // command palette button in the bottom-right.
          contextmenu: false,
          links: false,
          quickSuggestions: false,
          parameterHints: { enabled: false },
          codeLens: false,
          lightbulb: { enabled: false as unknown as never },
        }}
      />
      <div
        style={{
          padding: "4px 12px",
          fontSize: 11,
          color: "var(--text-muted)",
          borderTop: "1px solid var(--border-default)",
          // Must be the token, not a literal: --text-muted above flips with the
          // theme, so a pinned #08090A ground drops the path text to 2.7:1 on
          // light. Tracking --bg-code keeps it ≥6:1 in both themes and keeps the
          // strip flush with the editor ground it sits under.
          background: "var(--bg-code)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {path}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {saveStatus.kind === "dirty" && (
            <span
              aria-hidden="true"
              title={busy ? "Saves when the agent finishes" : "Unsaved changes"}
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                // Deferred-save is a STATUS, so it takes semantic amber — not
                // brand signal yellow, which must never sit beside ember (it
                // does here: the plain-dirty dot next door is --accent).
                background: busy ? "var(--conf-medium)" : "var(--accent)",
              }}
            />
          )}
          <span role="status" aria-live="polite">
            {describeSave(saveStatus, busy)}
          </span>
          {(saveStatus.kind === "dirty" || saveStatus.kind === "error") && (
            <button
              type="button"
              onClick={() => {
                if (saveTimer.current) {
                  clearTimeout(saveTimer.current);
                  saveTimer.current = null;
                }
                flushSave(path).catch(() => {});
              }}
              disabled={busy && saveStatus.kind === "dirty"}
              className="btn-secondary"
              style={{ fontSize: 11, padding: "2px 10px" }}
              title={
                busy
                  ? "Saves automatically when the agent finishes"
                  : "Save now (⌘S)"
              }
            >
              {busy && saveStatus.kind === "dirty" ? "Queued" : "Save"}
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

function describeSave(status: SaveStatus, agentBusy: boolean): string {
  switch (status.kind) {
    case "saving":
      return "saving…";
    case "dirty":
      return agentBusy ? "saves when agent finishes" : "unsaved";
    case "saved":
      return "saved";
    case "error":
      return `save failed: ${status.message}`;
    default:
      return "";
  }
}
