"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    addUserMessage(trimmed);
    setBusy(true);
    const ok = send({ type: "user_message", content: trimmed, mode });
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
                handleSubmit(e);
              }
            }}
            disabled={busy || !project || !connected}
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
          <div className="controls">
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
                onClick={handleSubmit}
                disabled={!input.trim()}
                className="send-btn"
              >
                Send
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

function ChatItemView({ item }: { item: ChatItem }) {
  if (item.kind === "user") {
    return (
      <div className="msg">
        <div className="head">
          <span className="av">Y</span>
          <span className="name">You</span>
        </div>
        <div className="msg-body user">{item.content}</div>
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
  if (item.kind === "plan_proposal") {
    return <PlanReview item={item} />;
  }
  if (item.kind === "system") {
    return <div className="msg-system">{item.content}</div>;
  }
  return null;
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
