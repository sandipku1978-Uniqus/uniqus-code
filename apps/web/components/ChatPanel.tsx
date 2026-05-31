"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ClientEvent, UploadedFileSummary } from "@uniqus/api-types";
import {
  fetchSlashCommandsApi,
  uploadProjectFilesApi,
  type SlashCommandSummary,
} from "@/lib/api";
import { useStore, type ChatItem, type SelectedElement } from "@/lib/store";
import { connect, send } from "@/lib/ws-client";
import PlanReview from "./PlanReview";
import ChatSessionDropdown from "./ChatSessionDropdown";
import ModelPicker from "./ModelPicker";
import Modal from "./Modal";
import { ErrorBoundary } from "./ErrorBoundary";

/**
 * A few short, realistic starter prompts shown on the empty-chat onboarding so
 * a first-time user isn't staring at a blank composer. Clicking one drops the
 * text into the composer (it doesn't auto-send) so they can tweak before
 * running. Kept local to this file — the picker has its own copy.
 */
const EXAMPLE_PROMPTS = [
  "Build a landing page for a coffee subscription with a hero, pricing, and signup form.",
  "Make a Markdown note-taking app with a sidebar list and live preview.",
  "Create a REST API for a todo list with SQLite and a few example endpoints.",
];

export default function ChatPanel() {
  const chat = useStore((s) => s.chat);
  const busy = useStore((s) => s.busy);
  const mode = useStore((s) => s.mode);
  const setModeManual = useStore((s) => s.setModeManual);
  const model = useStore((s) => s.model);
  const thinking = useStore((s) => s.thinking);
  const addUserMessage = useStore((s) => s.addUserMessage);
  const addSystem = useStore((s) => s.addSystem);
  const setBusy = useStore((s) => s.setBusy);
  const project = useStore((s) => s.project);
  const connected = useStore((s) => s.connected);
  const connectionFailed = useStore((s) => s.connectionFailed);
  const expandedTurns = useStore((s) => s.expandedTurns);
  const toggleTurn = useStore((s) => s.toggleTurn);
  const todos = useStore((s) => s.todos);
  const liveUsage = useStore((s) => s.liveUsage);
  // Element the user picked from the preview (PreviewPanel sets this); attached
  // to the next turn as `selected_element` and cleared on a successful send.
  const pendingSelectedElement = useStore((s) => s.pendingSelectedElement);
  const setPendingSelectedElement = useStore((s) => s.setPendingSelectedElement);
  // Files handed over from the preview pane (e.g. an annotated screenshot) —
  // drained into pendingFiles below so the normal upload path handles them.
  const queuedComposerFiles = useStore((s) => s.queuedComposerFiles);
  const clearQueuedComposerFiles = useStore((s) => s.clearQueuedComposerFiles);
  // Mirror Workspace's session-param read so a manual Retry reconnects to the
  // SAME chat session (a bare connect() would default the session to null and
  // silently drop the user back to the project's default thread).
  const searchParams = useSearchParams();
  const sessionParam = searchParams?.get("session") ?? null;
  const [tasksExpanded, setTasksExpanded] = useState(false);
  const [input, setInput] = useState("");
  // Persist the composer draft per-project so a reload or a client-side crash
  // doesn't lose typed-but-unsent text. Cleared on successful send.
  const draftKey = project ? `uniqus.draft.${project.id}` : null;
  // The key the current `input` value belongs to. Set synchronously when we
  // (re)hydrate for a new key so the persist effect can never write one
  // project's text under another project's key during a switch.
  const draftKeyRef = useRef<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [slashCommands, setSlashCommands] = useState<SlashCommandSummary[]>([]);
  const [slashIndex, setSlashIndex] = useState(0);
  // True from the moment the user clicks Stop until the server's `complete`
  // event lands. Without this, a click that the server is slow to act on
  // looks like a no-op — the button just keeps saying "Stop" until something
  // happens. Reset whenever `busy` flips (i.e. a turn ends or a new one starts).
  const [stopping, setStopping] = useState(false);
  // Drives the Modal-based "Clear chat history?" confirmation (replaces the
  // native window.confirm so it matches the app's other destructive dialogs).
  const [confirmReset, setConfirmReset] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setStopping(false);
  }, [busy]);

  // Drain files queued from the preview pane (annotated screenshots) into the
  // composer's pending attachments, deduping the same way addFiles does, then
  // empty the hand-off queue so they aren't re-added on the next render.
  useEffect(() => {
    if (queuedComposerFiles.length === 0) return;
    setPendingFiles((current) => {
      const next = [...current];
      for (const file of queuedComposerFiles) {
        const duplicate = next.some(
          (existing) =>
            existing.name === file.name &&
            existing.size === file.size &&
            existing.lastModified === file.lastModified,
        );
        if (!duplicate) next.push(file);
      }
      return next;
    });
    clearQueuedComposerFiles();
  }, [queuedComposerFiles, clearQueuedComposerFiles]);

  // Lazy-load slash commands once per project. The list is small and stable
  // — built-ins never change at runtime, project commands change rarely.
  useEffect(() => {
    if (!project) return;
    let abort = false;
    fetchSlashCommandsApi(project.id)
      .then((r) => {
        if (!abort) setSlashCommands(r.commands);
      })
      .catch(() => {});
    return () => {
      abort = true;
    };
  }, [project]);

  // Auto-resize textarea: grow up to ~15 lines, then scroll
  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const lineHeight = 20; // approx line-height in px
    const maxHeight = lineHeight * 15;
    ta.style.height = `${Math.min(ta.scrollHeight, maxHeight)}px`;
    ta.style.overflowY = ta.scrollHeight > maxHeight ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    autoResize();
  }, [input, autoResize]);

  // Hydrate whenever the key changes (first load OR a project switch). Always
  // replaces `input` with the new key's saved value (or "") so stale text from
  // the previous project can't linger — and marks which key `input` now holds.
  useEffect(() => {
    if (!draftKey) return;
    let saved = "";
    try {
      saved = localStorage.getItem(draftKey) ?? "";
    } catch {
      // localStorage can throw in private mode / when disabled — drafts are a
      // nicety, never block the composer over it.
    }
    draftKeyRef.current = draftKey;
    setInput(saved);
  }, [draftKey]);

  // Persist on input change only — NOT on draftKey change. This runs after the
  // hydrate effect above has settled `input` for the current key, so it always
  // writes under the key `input` actually belongs to (draftKeyRef), never the
  // previous project's leftover text under the new key.
  useEffect(() => {
    const key = draftKeyRef.current;
    if (!key) return;
    try {
      if (input) localStorage.setItem(key, input);
      else localStorage.removeItem(key);
    } catch {
      /* ignore — see note above */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  // Drag-and-drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  }, []);
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Clipboard paste for images/files
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        const dt = new DataTransfer();
        for (const f of files) dt.items.add(f);
        addFiles(dt.files);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Show palette when input begins with "/" and is one token wide
  // ("/review" matches; "/review now" doesn't).
  const slashFilter = useMemo(() => {
    const m = input.match(/^\/([a-zA-Z0-9_-]*)$/);
    return m ? m[1].toLowerCase() : null;
  }, [input]);
  const slashMatches = useMemo(() => {
    if (slashFilter === null) return [];
    return slashCommands.filter((c) => c.name.startsWith(slashFilter)).slice(0, 6);
  }, [slashFilter, slashCommands]);
  useEffect(() => {
    setSlashIndex(0);
  }, [slashFilter]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [chat]);

  const turns = useMemo(() => buildTurns(chat), [chat]);
  const tree = useStore((s) => s.tree);
  const validFilePaths = useMemo(() => {
    const set = new Set<string>();
    for (const entry of tree) {
      if (!entry.is_dir) set.add(entry.path);
    }
    return set;
  }, [tree]);

  // @file autocomplete — detect "@<partial>" at current cursor position.
  const [atIndex, setAtIndex] = useState(0);
  const atFilter = useMemo(() => {
    const m = input.match(/(?:^|\s)@([\w./-]*)$/);
    return m ? m[1].toLowerCase() : null;
  }, [input]);
  const atMatches = useMemo(() => {
    if (atFilter === null) return [];
    const all = Array.from(validFilePaths);
    return all
      .filter((p) => p.toLowerCase().includes(atFilter))
      .sort((a, b) => {
        const aStarts = a.toLowerCase().startsWith(atFilter) ? 0 : 1;
        const bStarts = b.toLowerCase().startsWith(atFilter) ? 0 : 1;
        return aStarts - bStarts || a.localeCompare(b);
      })
      .slice(0, 8);
  }, [atFilter, validFilePaths]);
  useEffect(() => {
    setAtIndex(0);
  }, [atFilter]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = input.trim();
    // Snapshot the picked element now — it's valid context even with no text.
    const selectedElement = pendingSelectedElement;
    if (
      (!trimmed && pendingFiles.length === 0 && !selectedElement) ||
      busy ||
      uploading ||
      !project ||
      !connected
    ) {
      return;
    }

    setUploading(true);
    let attachments: UploadedFileSummary[] = [];
    try {
      if (pendingFiles.length > 0) {
        const result = await uploadProjectFilesApi({
          projectId: project.id,
          files: pendingFiles,
        });
        attachments = result.files;
      }
    } catch (err) {
      addSystem(`upload failed: ${err instanceof Error ? err.message : String(err)}`);
      setUploading(false);
      return;
    }

    const content =
      trimmed ||
      (pendingFiles.length > 0 ? "Use the attached file(s)." : "Use the selected element.");
    const fileRefs = extractFileRefs(content, validFilePaths);
    // The `selected_element` block rides on the user_message. The shared
    // contract (C) puts it there; the orchestrator's ClientEvent type gains the
    // field in the paired Backend track, so until that lands we widen the
    // payload locally rather than editing the shared package from this track.
    const payload: ClientEvent & { selected_element?: SelectedElement } = {
      type: "user_message",
      content,
      mode,
      model: model !== "auto" ? model : undefined,
      thinking: thinking !== "medium" ? thinking : undefined,
      attachments,
      file_refs: fileRefs.length > 0 ? fileRefs : undefined,
    };
    if (selectedElement) payload.selected_element = selectedElement;
    // Send is synchronous, so check the result BEFORE echoing/clearing. On a
    // closed socket we keep the composer text (and its saved draft) and don't
    // echo a bubble — otherwise the user would lose the exact text the draft
    // feature exists to protect, with a misleading "sent" bubble left behind.
    const ok = send(payload);
    if (!ok) {
      addSystem(
        "disconnected — message not sent. We'll reconnect automatically; try again in a moment.",
      );
      setUploading(false);
      return;
    }
    // Sent — echo the message, mark the turn busy, and clear the composer +
    // its persisted draft (and the one-shot selected element).
    addUserMessage(content, attachments, fileRefs, selectedElement ?? undefined);
    setBusy(true);
    setInput("");
    setPendingFiles([]);
    if (selectedElement) setPendingSelectedElement(null);
    setUploading(false);
  };

  const handleStop = () => {
    if (!busy) return;
    setStopping(true);
    const ok = send({ type: "abort" });
    if (!ok) {
      // Socket dropped right when the user clicked Stop. Bail out locally so
      // the UI doesn't sit on "Stopping…" forever — when we reconnect, the
      // session will be in a fresh state anyway.
      setBusy(false);
      setStopping(false);
      addSystem("disconnected — stop request not sent.");
    }
  };

  const resetChat = () => {
    if (busy || chat.length === 0) return;
    setConfirmReset(true);
  };

  const confirmResetChat = () => {
    setConfirmReset(false);
    send({ type: "reset_session" });
  };

  const addFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setPendingFiles((current) => {
      const next = [...current];
      for (const file of Array.from(files)) {
        const duplicate = next.some(
          (existing) =>
            existing.name === file.name &&
            existing.size === file.size &&
            existing.lastModified === file.lastModified,
        );
        if (!duplicate) next.push(file);
      }
      return next;
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removePendingFile = (index: number) => {
    setPendingFiles((current) => current.filter((_, i) => i !== index));
  };

  return (
    <div className="pane">
      <div className="pane-header">
        <span className="label-micro">Chat</span>
        <div className="actions">
          {project && <ChatSessionDropdown projectId={project.id} />}
          <button
            onClick={resetChat}
            disabled={busy || chat.length === 0}
            className="icon-btn-sm"
            title="Clear chat history (sandbox files kept)"
            style={{ width: "auto", padding: "2px 8px", fontSize: 11 }}
          >
            clear
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="chat-scroll">
        {chat.length === 0 && (
          <div style={{ color: "var(--text-dim)", fontSize: 12 }}>
            <div style={{ fontStyle: "italic" }}>
              Describe what you want to build.{" "}
              {mode === "plan-then-execute"
                ? "Uniqus will propose a plan first."
                : "Uniqus will start working immediately."}
            </div>
            <div style={{ marginTop: 6, fontStyle: "normal" }}>
              New here?{" "}
              <a
                href="/guide"
                target="_blank"
                rel="noreferrer"
                style={{ color: "var(--accent, #a78bfa)", textDecoration: "none" }}
              >
                Read the guide
              </a>
              .
            </div>
            <div
              style={{
                marginTop: 10,
                display: "flex",
                flexDirection: "column",
                gap: 6,
                fontStyle: "normal",
              }}
            >
              {EXAMPLE_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => {
                    setInput(prompt);
                    textareaRef.current?.focus();
                  }}
                  style={{
                    textAlign: "left",
                    padding: "6px 10px",
                    fontSize: 12,
                    color: "var(--text-primary)",
                    background: "transparent",
                    border: "1px dashed var(--border-default, #2a2a36)",
                    borderRadius: 6,
                    cursor: "pointer",
                  }}
                  title="Use this prompt"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((turn, idx) => {
          const isLast = idx === turns.length - 1;
          // Past turns (those ending in a `complete` marker) collapse by default;
          // the current in-flight turn (no complete yet) always stays expanded.
          const completeId = turn.complete?.id;
          const expanded = completeId ? !!expandedTurns[completeId] : true;
          return (
            // Per-turn boundary: a single malformed message (bad markdown,
            // unexpected tool payload) renders a small inline fallback instead
            // of throwing and blanking the entire conversation.
            <ErrorBoundary
              key={turn.key}
              variant="inline"
              label="message"
              // Include content-identity signals (not just the positional key)
              // so a boundary that caught a transient mid-stream error clears
              // itself once the turn advances or completes — rather than staying
              // stuck until the manual Retry.
              resetKeys={[turn.key, turn.body.length, turn.complete?.id ?? null]}
            >
              <Turn
                turn={turn}
                expanded={expanded || isLast && !turn.complete}
                onToggle={completeId ? () => toggleTurn(completeId) : undefined}
              />
            </ErrorBoundary>
          );
        })}
        {busy && (() => {
          // Show a thinking indicator when the agent is working but no tool
          // calls or text have streamed yet (e.g. planning, booting VM).
          const lastTurn = turns[turns.length - 1];
          const inFlight = lastTurn && !lastTurn.complete ? lastTurn : null;
          // Real streamed output (assistant text, tool cards) renders its own
          // rows, so the pill is redundant once any non-system item lands. A
          // `system` progress note (rendered muted in-line) does NOT count as
          // visible activity — it instead becomes the pill's label below.
          const hasVisibleActivity =
            !!inFlight && inFlight.body.some((i) => i.kind !== "system");
          if (hasVisibleActivity) return null;
          // Surface server progress (e.g. "Starting sandbox…", "Installing
          // dependencies…"): the most recent `system` item of the in-flight
          // turn, if any, takes precedence over the generic "Thinking…".
          const lastSystem = inFlight
            ? [...inFlight.body].reverse().find((i) => i.kind === "system")
            : undefined;
          const progress =
            lastSystem && lastSystem.kind === "system" ? lastSystem.content : null;
          const label =
            progress ??
            (mode === "plan-then-execute" ? "Thinking about a plan…" : "Thinking…");
          return (
            <div className="msg">
              <div className="head">
                <span className="av agent">U</span>
                <span className="name">Uniqus</span>
                <span className="frame thinking-indicator">{label}</span>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Inline tasks bar — collapsible, above the composer */}
      {todos.length > 0 && (
        <div className="tasks-inline">
          <button
            type="button"
            className="tasks-inline-toggle"
            onClick={() => setTasksExpanded((v) => !v)}
          >
            <span className="tasks-inline-summary">
              {(() => {
                const done = todos.filter((t) => t.status === "completed").length;
                const inFlight = todos.find((t) => t.status === "in_progress");
                return (
                  <>
                    <span style={{ opacity: 0.6 }}>Tasks {done}/{todos.length}</span>
                    {inFlight && (
                      <span className="tasks-inline-active">
                        <span title="In progress" role="img" aria-label="In progress">
                          ▶
                        </span>{" "}
                        {inFlight.activeForm}
                      </span>
                    )}
                  </>
                );
              })()}
            </span>
            <span style={{ fontSize: 10, opacity: 0.5 }}>{tasksExpanded ? "▾" : "▸"}</span>
          </button>
          {tasksExpanded && (
            <div className="tasks-inline-list">
              {todos.map((t, i) => {
                const icon = t.status === "completed" ? "✓" : t.status === "in_progress" ? "▶" : "·";
                const stateLabel =
                  t.status === "completed"
                    ? "Completed"
                    : t.status === "in_progress"
                    ? "In progress"
                    : "Pending";
                const color = t.status === "completed" ? "var(--text-dim)" : t.status === "in_progress" ? "var(--accent, #a78bfa)" : "var(--text-primary)";
                const label = t.status === "in_progress" ? t.activeForm : t.content;
                return (
                  <div key={i} className="tasks-inline-item" style={{ color }}>
                    <span
                      title={stateLabel}
                      role="img"
                      aria-label={stateLabel}
                      style={{ fontFamily: "var(--font-mono-stack)", fontSize: 11 }}
                    >
                      {icon}
                    </span>
                    <span style={{ textDecoration: t.status === "completed" ? "line-through" : "none" }}>{label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {busy && liveUsage && (liveUsage.input > 0 || liveUsage.output > 0) && (
        <div className="live-usage" title="Live token usage for this response">
          <span className="live-usage-dot" />
          <span>
            <strong>{formatTokens(liveUsage.input)}</strong> tokens in ·{" "}
            <strong>{formatTokens(liveUsage.output)}</strong> tokens out
          </span>
        </div>
      )}

      {connectionFailed && (
        <div
          className="ws-failed-banner"
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            margin: "0 0 6px",
            padding: "6px 10px",
            fontSize: 12,
            color: "var(--text-primary)",
            background: "color-mix(in srgb, var(--conf-low, #c0392b) 14%, transparent)",
            border: "1px solid var(--conf-low, #c0392b)",
            borderRadius: 6,
          }}
        >
          <span style={{ flex: 1 }}>Connection lost.</span>
          <button
            type="button"
            onClick={() => {
              if (project) connect(project.id, sessionParam);
            }}
            disabled={!project}
            className="icon-btn-sm"
            style={{ width: "auto", padding: "2px 10px", fontSize: 11 }}
            title="Reconnect to the workspace"
          >
            Retry
          </button>
        </div>
      )}

      <div
        className={`composer${dragging ? " dragging" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="field">
          {slashMatches.length > 0 && (
            <div
              role="menu"
              aria-label="Slash commands"
              style={{
                marginBottom: 6,
                border: "1px solid var(--border-default, #2a2a36)",
                borderRadius: 6,
                background: "var(--bg-elev, #1a1a22)",
                overflow: "hidden",
              }}
            >
              {slashMatches.map((c, i) => (
                <button
                  key={c.name}
                  type="button"
                  role="menuitem"
                  aria-selected={i === slashIndex}
                  onClick={() => {
                    setInput(`/${c.name} `);
                  }}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr auto",
                    gap: 8,
                    width: "100%",
                    textAlign: "left",
                    padding: "6px 10px",
                    fontSize: 12,
                    background: i === slashIndex ? "rgba(255,255,255,0.05)" : "transparent",
                    border: 0,
                    color: "var(--text-primary)",
                    cursor: "pointer",
                  }}
                >
                  <code style={{ color: "var(--accent, #a78bfa)" }}>/{c.name}</code>
                  <span style={{ color: "var(--text-dim)", fontSize: 11 }}>{c.summary}</span>
                  <span style={{ fontSize: 10, color: "var(--text-dim)" }}>
                    {c.source === "project" ? "project" : "built-in"}
                  </span>
                </button>
              ))}
            </div>
          )}
          {atMatches.length > 0 && (
            <div
              role="menu"
              aria-label="File references"
              style={{
                marginBottom: 6,
                border: "1px solid var(--border-default, #2a2a36)",
                borderRadius: 6,
                background: "var(--bg-elev, #1a1a22)",
                overflow: "hidden",
                maxHeight: 200,
                overflowY: "auto",
              }}
            >
              {atMatches.map((p, i) => (
                <button
                  key={p}
                  type="button"
                  role="menuitem"
                  aria-selected={i === atIndex}
                  onClick={() => {
                    setInput((prev) => prev.replace(/@[\w./-]*$/, `@${p} `));
                  }}
                  style={{
                    display: "flex",
                    gap: 8,
                    width: "100%",
                    textAlign: "left",
                    padding: "5px 10px",
                    fontSize: 12,
                    background: i === atIndex ? "rgba(255,255,255,0.05)" : "transparent",
                    border: 0,
                    color: "var(--text-primary)",
                    cursor: "pointer",
                  }}
                >
                  <code style={{ color: "var(--accent, #a78bfa)", fontSize: 11 }}>@{p}</code>
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              // @file autocomplete navigation
              if (atMatches.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setAtIndex((i) => (i + 1) % atMatches.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setAtIndex((i) => (i - 1 + atMatches.length) % atMatches.length);
                  return;
                }
                if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                  e.preventDefault();
                  const pick = atMatches[atIndex] ?? atMatches[0];
                  if (pick) setInput((prev) => prev.replace(/@[\w./-]*$/, `@${pick} `));
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  // clear the @-token to dismiss the palette
                  return;
                }
              }
              if (slashMatches.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSlashIndex((i) => (i + 1) % slashMatches.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSlashIndex((i) => (i - 1 + slashMatches.length) % slashMatches.length);
                  return;
                }
                if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                  e.preventDefault();
                  const pick = slashMatches[slashIndex] ?? slashMatches[0];
                  if (pick) setInput(`/${pick.name} `);
                  return;
                }
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSubmit();
              }
            }}
            disabled={busy || uploading || !project || !connected}
            placeholder={
              busy
                ? "Uniqus is running…"
                : !connected
                ? "Reconnecting…"
                : project
                ? "Describe what you want Uniqus to build…"
                : "Connecting…"
            }
            rows={2}
            style={{ resize: "none", overflowY: "hidden" }}
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => addFiles(e.target.files)}
          />
          {pendingSelectedElement && (
            <div className="composer-attachments">
              <span className="selected-el-chip" title={pendingSelectedElement.selector}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <line x1="12" y1="2" x2="12" y2="6" />
                  <line x1="12" y1="18" x2="12" y2="22" />
                  <line x1="2" y1="12" x2="6" y2="12" />
                  <line x1="18" y1="12" x2="22" y2="12" />
                  <circle cx="12" cy="12" r="4" />
                </svg>
                <span className="selected-el-chip-label">
                  {describeSelectedElement(pendingSelectedElement)}
                </span>
                <button
                  type="button"
                  onClick={() => setPendingSelectedElement(null)}
                  title="Remove selected element"
                  aria-label="Remove selected element"
                >
                  ×
                </button>
              </span>
            </div>
          )}
          {pendingFiles.length > 0 && (
            <div className="composer-attachments">
              {pendingFiles.map((file, index) => (
                <span
                  key={`${file.name}-${file.size}-${file.lastModified}`}
                  className="attachment-chip"
                >
                  <span className="attachment-name" title={file.name}>
                    {file.name}
                  </span>
                  <span className="attachment-size">{formatFileSize(file.size)}</span>
                  <button
                    type="button"
                    onClick={() => removePendingFile(index)}
                    disabled={uploading}
                    title={`Remove ${file.name}`}
                  >
                    x
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="controls">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy || uploading || !project}
              className="attach-btn"
              title="Attach files to this agent turn"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21.4 11.6 12 21a6 6 0 0 1-8.5-8.5l9.9-9.9a4 4 0 0 1 5.7 5.7l-9.9 9.9a2 2 0 0 1-2.8-2.8l9.4-9.4" />
              </svg>
              Files
            </button>
            <button
              type="button"
              onClick={() =>
                setModeManual(mode === "plan-then-execute" ? "execute-only" : "plan-then-execute")
              }
              className={`plan-toggle ${mode === "plan-then-execute" ? "on" : ""}`}
              title="Plan mode — Uniqus proposes a plan you can edit before it executes. On by default for a brand-new project's first turn."
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Plan
            </button>
            <ModelPicker variant="compact" />
            {busy ? (
              <button
                type="button"
                onClick={handleStop}
                disabled={stopping}
                className="send-btn"
                style={{
                  background: "var(--conf-low, #c0392b)",
                  borderColor: "var(--conf-low, #c0392b)",
                  opacity: stopping ? 0.7 : 1,
                  cursor: stopping ? "default" : "pointer",
                }}
                title={
                  stopping
                    ? "Stopping… (waiting for the agent to finish its current step)"
                    : "Stop the agent (cancels current turn)"
                }
              >
                {stopping ? "Stopping…" : "Stop"}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="1" />
                </svg>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={
                  uploading ||
                  (!input.trim() && pendingFiles.length === 0 && !pendingSelectedElement) ||
                  !project ||
                  !connected
                }
                className="send-btn"
              >
                {uploading ? "Uploading..." : "Send"}
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {confirmReset && (
        <Modal
          title="Clear chat history?"
          subtitle="This clears the conversation only — your sandbox files are kept."
          width={420}
          onClose={() => setConfirmReset(false)}
          footer={
            <>
              <span />
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setConfirmReset(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={confirmResetChat}
                >
                  Clear history
                </button>
              </div>
            </>
          }
        >
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-dim)" }}>
            The agent will start fresh with no memory of this conversation.
          </p>
        </Modal>
      )}
    </div>
  );
}

interface Turn {
  key: string;
  /** Items that always render at the top of the turn (user message). */
  head: ChatItem[];
  /** Items that fold away when the turn is collapsed. */
  body: ChatItem[];
  /** The completion marker, if this turn has finished. */
  complete: Extract<ChatItem, { kind: "complete" }> | null;
}

/**
 * Slice the flat chat array into turn groups so each "user → agent → done"
 * cycle can collapse independently.
 *
 * - `user` opens a turn.
 * - `complete` closes a turn and is the toggle anchor.
 * - Anything before the first user (system messages, plan replays) becomes a
 *   prelude turn that's never collapsible.
 */
function buildTurns(chat: ChatItem[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | null = null;
  let n = 0;

  const open = (head: ChatItem[]): Turn => ({
    key: `t${n++}`,
    head,
    body: [],
    complete: null,
  });

  for (const item of chat) {
    if (item.kind === "user") {
      if (current) turns.push(current);
      current = open([item]);
      continue;
    }
    if (!current) current = open([]);
    if (item.kind === "complete") {
      current.complete = item;
      turns.push(current);
      current = null;
      continue;
    }
    current.body.push(item);
  }
  if (current) turns.push(current);
  return turns;
}

function Turn({
  turn,
  expanded,
  onToggle,
}: {
  turn: Turn;
  expanded: boolean;
  onToggle?: () => void;
}) {
  const renderItems = (items: ChatItem[]) =>
    items.map((item) => <ChatItemView key={item.id} item={item} />);
  const stepCount = turn.body.filter((i) => i.kind === "tool").length;
  const finalText = [...turn.body].reverse().find((i) => i.kind === "assistant_text") as
    | Extract<ChatItem, { kind: "assistant_text" }>
    | undefined;

  return (
    <>
      {renderItems(turn.head)}
      {expanded ? (
        renderItems(turn.body)
      ) : (
        // Collapsed view: show only the assistant's final text + a "N steps"
        // disclosure that expands the full body when clicked.
        <>
          {finalText && <ChatItemView item={finalText} />}
          {stepCount > 0 && (
            <button
              type="button"
              onClick={onToggle}
              className="msg-system"
              style={{
                cursor: "pointer",
                width: "100%",
                textAlign: "left",
                background: "transparent",
                border: "1px dashed var(--border-default)",
                borderRadius: 6,
                padding: "6px 10px",
              }}
              title="Show all steps"
            >
              ▸ {stepCount} step{stepCount === 1 ? "" : "s"} hidden — click to expand
            </button>
          )}
        </>
      )}
      {turn.complete && (
        <CompleteRow item={turn.complete} expanded={expanded} onToggle={onToggle} />
      )}
    </>
  );
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Compact label for a picked element: "button#submit.cta". */
function describeSelectedElement(el: SelectedElement): string {
  const id = el.id ? `#${el.id}` : "";
  const cls = el.classes.length > 0 ? `.${el.classes.slice(0, 2).join(".")}` : "";
  return `${el.tag || "element"}${id}${cls}` || el.selector;
}

/** Compact token count: 980 → "980", 10800 → "10.8k", 1_250_000 → "1.25M". */
function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}k`;
  }
  return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
}

const FILE_REF_PATTERN = /(?:^|\s)@([\w./-][\w./-]*)/g;

/**
 * Extract `@path/to/file.ts` references from composer text and resolve
 * them against the current file tree. Returns sandbox-relative paths only
 * for tokens that match an existing file — unknown @-tokens are silently
 * dropped so a stray @username doesn't fire spurious file reads.
 */
function extractFileRefs(content: string, validPaths: Set<string>): string[] {
  if (!content || validPaths.size === 0) return [];
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  FILE_REF_PATTERN.lastIndex = 0;
  while ((match = FILE_REF_PATTERN.exec(content)) !== null) {
    const candidate = match[1];
    if (!candidate) continue;
    if (validPaths.has(candidate)) {
      found.add(candidate);
    }
  }
  return Array.from(found);
}

function ChatItemView({ item }: { item: ChatItem }) {
  if (item.kind === "user") {
    return (
      <div className="msg">
        <div className="head">
          <span className="av">Y</span>
          <span className="name">You</span>
        </div>
        <div className="msg-body user">
          {item.content}
          {item.attachments && item.attachments.length > 0 && (
            <div className="message-attachments">
              {item.attachments.map((file) => (
                <span key={file.path} className="message-attachment">
                  <span className="attachment-name" title={file.path}>
                    {file.name}
                  </span>
                  <code>{file.path}</code>
                  <span>{formatFileSize(file.size)}</span>
                </span>
              ))}
            </div>
          )}
          {item.fileRefs && item.fileRefs.length > 0 && (
            <div className="message-file-refs">
              <span className="message-file-refs-label">included:</span>
              {item.fileRefs.map((ref) => (
                <code key={ref} className="message-file-ref" title={ref}>
                  @{ref}
                </code>
              ))}
            </div>
          )}
          {item.selectedElement && (
            <div className="message-file-refs">
              <span className="message-file-refs-label">element:</span>
              <code className="message-file-ref" title={item.selectedElement.selector}>
                {describeSelectedElement(item.selectedElement)}
              </code>
            </div>
          )}
        </div>
      </div>
    );
  }
  if (item.kind === "assistant_text") {
    return (
      <div className="msg">
        <div className="head">
          <span className="av agent">U</span>
          <span className="name">Uniqus</span>
          <span className="frame">Engineering agent</span>
        </div>
        <div className="msg-body" style={{ paddingLeft: 30 }}>
          <div className="md">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
              }}
            >
              {item.content}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    );
  }
  if (item.kind === "reasoning") {
    return <ReasoningCard item={item} />;
  }
  if (item.kind === "tool") {
    return <ToolCard item={item} />;
  }
  if (item.kind === "user_question") {
    return <UserQuestionCard item={item} />;
  }
  if (item.kind === "plan_proposal") {
    return <PlanReview item={item} />;
  }
  if (item.kind === "system") {
    return <div className="msg-system">{item.content}</div>;
  }
  return null;
}

function UserQuestionCard({
  item,
}: {
  item: Extract<ChatItem, { kind: "user_question" }>;
}) {
  const resolveUserQuestion = useStore((s) => s.resolveUserQuestion);
  const [freeText, setFreeText] = useState("");
  // Surfaced when send() fails (socket down). Without it the click was a silent
  // no-op — the answer buttons stayed live but nothing happened. Cleared on a
  // successful send (or a fresh attempt).
  const [sendError, setSendError] = useState<string | null>(null);
  const answered = item.answer !== undefined;

  const submit = (answer: string) => {
    const trimmed = answer.trim();
    if (!trimmed || answered) return;
    const ok = send({
      type: "user_question_answered",
      call_id: item.call_id,
      answer: trimmed,
    });
    if (ok) {
      setSendError(null);
      resolveUserQuestion(item.call_id, trimmed);
    } else {
      // Keep the answer controls enabled so the user can retry once the socket
      // reconnects, rather than losing their selection to a dropped frame.
      setSendError("Couldn't send — reconnecting. Try again.");
    }
  };

  return (
    <div className="msg">
      <div className="head">
        <span className="av agent">?</span>
        <span className="name">Uniqus is asking</span>
        <span className="frame">needs your input</span>
      </div>
      <div className="msg-body" style={{ paddingLeft: 30 }}>
        <div className="ask-user-card">
          <div className="ask-user-question">{item.question}</div>
          {answered ? (
            <div className="ask-user-answer">
              <span className="ask-user-answer-label">You answered:</span>{" "}
              <span className="ask-user-answer-text">{item.answer}</span>
            </div>
          ) : (
            <>
              {item.options && item.options.length > 0 && (
                <div className="ask-user-options">
                  {item.options.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => submit(opt)}
                      className="ask-user-option"
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}
              {item.allow_free_text && (
                <form
                  className="ask-user-free"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submit(freeText);
                  }}
                >
                  <input
                    type="text"
                    value={freeText}
                    onChange={(e) => setFreeText(e.target.value)}
                    placeholder={
                      item.options && item.options.length > 0
                        ? "Or type your own answer…"
                        : "Type your answer…"
                    }
                    autoFocus
                  />
                  <button type="submit" disabled={!freeText.trim()}>
                    Answer
                  </button>
                </form>
              )}
              {sendError && (
                <div
                  role="alert"
                  style={{
                    marginTop: 8,
                    fontSize: 12,
                    color: "var(--conf-low, #c0392b)",
                  }}
                >
                  {sendError}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CompleteRow({
  item,
  expanded,
  onToggle,
}: {
  item: Extract<ChatItem, { kind: "complete" }>;
  expanded: boolean;
  onToggle?: () => void;
}) {
  const parts = [
    item.aborted ? "aborted" : "done",
    `${item.tool_calls} tool calls`,
  ];
  // elapsed_ms is 0 on replayed turns (we don't persist per-turn wall-clock) —
  // skip it rather than show a misleading "0.0s".
  if (item.elapsed_ms > 0) parts.push(`${(item.elapsed_ms / 1000).toFixed(1)}s`);
  if (item.input_tokens !== undefined || item.output_tokens !== undefined) {
    parts.push(
      `${formatTokens(item.input_tokens ?? 0)} in · ${formatTokens(item.output_tokens ?? 0)} out`,
    );
  }
  const summary = parts.join(" · ");
  return (
    <button
      type="button"
      onClick={onToggle}
      className="msg-system"
      style={{
        cursor: onToggle ? "pointer" : "default",
        width: "100%",
        textAlign: "left",
        background: "transparent",
        border: "none",
        padding: "4px 0",
        opacity: 0.75,
      }}
      title={onToggle ? (expanded ? "Collapse this turn" : "Expand this turn") : undefined}
    >
      {onToggle ? (expanded ? "▾ " : "▸ ") : ""}
      {summary}
    </button>
  );
}

function ReasoningCard({
  item,
}: {
  item: Extract<ChatItem, { kind: "reasoning" }>;
}) {
  // Default open so the live trace is visible as it streams; collapsible since
  // past steps' reasoning is mostly noise once the answer has landed.
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="reasoning-card">
      <button
        type="button"
        className="reasoning-toggle"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded ? "true" : "false"}
      >
        <span>💭 Thinking</span>
        <span className="reasoning-chevron">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && <div className="reasoning-body">{item.content}</div>}
    </div>
  );
}

function ToolCard({
  item,
}: {
  item: Extract<ChatItem, { kind: "tool" }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const summary = summarizeInput(item.name, item.input);
  const hasResult = item.result !== undefined;
  const isError = item.is_error === true;

  return (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      className="tool-card"
    >
      <div className="row">
        <span className={`name ${isError ? "error" : ""}`}>{item.name}</span>
        <span className="summary">{summary}</span>
        <span
          className={`status ${
            !hasResult ? "run" : isError ? "err" : "ok"
          }`}
        >
          {!hasResult ? "running…" : isError ? "error" : "✓"}
        </span>
      </div>
      {expanded && hasResult && (
        <pre className={isError ? "err" : ""}>{item.result}</pre>
      )}
    </button>
  );
}

function summarizeInput(name: string, input: unknown): string {
  const a = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case "read_file":
    case "list_dir":
      return String(a.path ?? "");
    case "write_file":
      return `${a.path ?? ""}${a.content ? ` (${(a.content as string).length}b)` : ""}`;
    case "edit_file":
      return String(a.path ?? "");
    case "run_command":
      return a.command ? `\`${a.command}\`` : "";
    case "grep":
      return `/${a.pattern ?? ""}/${a.path ? ` in ${a.path}` : ""}`;
    case "wait_for_port":
      return a.port ? `port ${a.port}` : "";
    case "start_server":
      return `${a.command ?? ""}${a.port ? ` :${a.port}` : ""}`;
    case "stop_server":
      return String(a.server_id ?? "");
    case "list_servers":
      return "";
    case "read_server_log":
      return String(a.server_id ?? "");
    case "web_search":
      return String(a.query ?? "");
    default:
      return "";
  }
}
