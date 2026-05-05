"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { UploadedFileSummary } from "@uniqus/api-types";
import { uploadProjectFilesApi } from "@/lib/api";
import { useStore, type ChatItem } from "@/lib/store";
import { send } from "@/lib/ws-client";
import PlanReview from "./PlanReview";

export default function ChatPanel() {
  const chat = useStore((s) => s.chat);
  const busy = useStore((s) => s.busy);
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const addUserMessage = useStore((s) => s.addUserMessage);
  const addSystem = useStore((s) => s.addSystem);
  const setBusy = useStore((s) => s.setBusy);
  const project = useStore((s) => s.project);
  const connected = useStore((s) => s.connected);
  const expandedTurns = useStore((s) => s.expandedTurns);
  const toggleTurn = useStore((s) => s.toggleTurn);
  const [input, setInput] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // True from the moment the user clicks Stop until the server's `complete`
  // event lands. Without this, a click that the server is slow to act on
  // looks like a no-op — the button just keeps saying "Stop" until something
  // happens. Reset whenever `busy` flips (i.e. a turn ends or a new one starts).
  const [stopping, setStopping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setStopping(false);
  }, [busy]);

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

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = input.trim();
    if (
      (!trimmed && pendingFiles.length === 0) ||
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

    const content = trimmed || "Use the attached file(s).";
    const fileRefs = extractFileRefs(content, validFilePaths);
    addUserMessage(content, attachments, fileRefs);
    setBusy(true);
    const ok = send({
      type: "user_message",
      content,
      mode,
      attachments,
      file_refs: fileRefs.length > 0 ? fileRefs : undefined,
    });
    if (!ok) {
      // Socket is closed — the message never left the browser. Surface that
      // instead of leaving the UI stuck on "Codex is running…" forever, and
      // unblock the composer so the user can retry once we reconnect.
      setBusy(false);
      addSystem(
        "disconnected — message not sent. We'll reconnect automatically; try again in a moment.",
      );
    }
    setInput("");
    setPendingFiles([]);
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
    if (confirm("Clear chat history? Sandbox files are kept.")) {
      send({ type: "reset_session" });
    }
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
          <div style={{ color: "var(--text-dim)", fontSize: 12.5, fontStyle: "italic" }}>
            Brief Codex on what to build.{" "}
            {mode === "plan-then-execute"
              ? "It will propose a plan first."
              : "It will start working immediately."}
          </div>
        )}
        {turns.map((turn, idx) => {
          const isLast = idx === turns.length - 1;
          // Past turns (those ending in a `complete` marker) collapse by default;
          // the current in-flight turn (no complete yet) always stays expanded.
          const completeId = turn.complete?.id;
          const expanded = completeId ? !!expandedTurns[completeId] : true;
          return (
            <Turn
              key={turn.key}
              turn={turn}
              expanded={expanded || isLast && !turn.complete}
              onToggle={completeId ? () => toggleTurn(completeId) : undefined}
            />
          );
        })}
      </div>

      <div className="composer">
        <div className="field">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSubmit();
              }
            }}
            disabled={busy || uploading || !project || !connected}
            placeholder={
              busy
                ? "Codex is running…"
                : !connected
                ? "Reconnecting…"
                : project
                ? "Brief Codex — describe what to build…"
                : "Connecting…"
            }
            rows={2}
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => addFiles(e.target.files)}
          />
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
                setMode(mode === "plan-then-execute" ? "execute-only" : "plan-then-execute")
              }
              className={`plan-toggle ${mode === "plan-then-execute" ? "on" : ""}`}
              title="Plan mode — Codex proposes a plan you can edit before it executes"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Plan
            </button>
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
                  (!input.trim() && pendingFiles.length === 0) ||
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
        </div>
      </div>
    );
  }
  if (item.kind === "assistant_text") {
    return (
      <div className="msg">
        <div className="head">
          <span className="av agent">C</span>
          <span className="name">Codex</span>
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
  const answered = item.answer !== undefined;

  const submit = (answer: string) => {
    const trimmed = answer.trim();
    if (!trimmed || answered) return;
    const ok = send({
      type: "user_question_answered",
      call_id: item.call_id,
      answer: trimmed,
    });
    if (ok) resolveUserQuestion(item.call_id, trimmed);
  };

  return (
    <div className="msg">
      <div className="head">
        <span className="av agent">?</span>
        <span className="name">Codex is asking</span>
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
  const summary = item.aborted
    ? `aborted · ${item.tool_calls} tool calls · ${(item.elapsed_ms / 1000).toFixed(1)}s`
    : `done · ${item.tool_calls} tool calls · ${(item.elapsed_ms / 1000).toFixed(1)}s`;
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
