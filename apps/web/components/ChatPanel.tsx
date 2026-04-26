"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useStore } from "@/lib/store";
import { send } from "@/lib/ws-client";
import PlanReview from "./PlanReview";

export default function ChatPanel() {
  const chat = useStore((s) => s.chat);
  const busy = useStore((s) => s.busy);
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const addUserMessage = useStore((s) => s.addUserMessage);
  const setBusy = useStore((s) => s.setBusy);
  const project = useStore((s) => s.project);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [chat]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    addUserMessage(trimmed);
    setBusy(true);
    send({ type: "user_message", content: trimmed, mode });
    setInput("");
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
            Brief Codex on what to build. {mode === "plan-then-execute" ? "It will propose a plan first." : "It will start working immediately."}
          </div>
        )}
        {chat.map((item) => {
          if (item.kind === "user") {
            return (
              <div key={item.id} className="msg">
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
              <div key={item.id} className="msg">
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
            return <ToolCard key={item.id} item={item} />;
          }
          if (item.kind === "plan_proposal") {
            return <PlanReview key={item.id} item={item} />;
          }
          if (item.kind === "system") {
            return (
              <div key={item.id} className="msg-system">
                {item.content}
              </div>
            );
          }
          return null;
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
            disabled={busy || !project}
            placeholder={
              busy
                ? "Codex is running…"
                : project
                ? "Brief Codex — describe what to build…"
                : "Connecting…"
            }
            rows={2}
          />
          <div className="controls">
            <button
              type="button"
              onClick={() => setMode(mode === "plan-then-execute" ? "execute-only" : "plan-then-execute")}
              className={`plan-toggle ${mode === "plan-then-execute" ? "on" : ""}`}
              title="Plan mode — Codex proposes a plan you can edit before it executes"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Plan
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={busy || !input.trim()}
              className="send-btn"
            >
              Send
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolCard({
  item,
}: {
  item: Extract<ReturnType<typeof useStore.getState>["chat"][number], { kind: "tool" }>;
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
      return `${a.path} (${(a.content as string | undefined)?.length ?? 0}b)`;
    case "edit_file":
      return String(a.path ?? "");
    case "run_command":
      return `\`${a.command}\``;
    case "grep":
      return `/${a.pattern}/${a.path ? ` in ${a.path}` : ""}`;
    case "wait_for_port":
      return `port ${a.port}`;
    case "start_server":
      return `${a.command} :${a.port}`;
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
