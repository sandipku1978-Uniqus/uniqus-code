"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";

export default function TerminalPanel({ onClose }: { onClose: () => void }) {
  const lines = useStore((s) => s.terminalLines);
  const dropped = useStore((s) => s.terminalDropped);
  const clearTerminal = useStore((s) => s.clearTerminal);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Only follow new output when the user is already parked at the bottom, so
  // reading older lines isn't yanked away on every new line (UI/UX audit §C).
  const atBottomRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);

  const shown = query
    ? lines.filter((l) => l.text.toLowerCase().includes(query.toLowerCase()))
    : lines;

  useEffect(() => {
    if (atBottomRef.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [lines]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    atBottomRef.current = bottom;
    setAtBottom(bottom);
  };

  const jumpToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight });
    atBottomRef.current = true;
    setAtBottom(true);
  };

  const copyAll = () => {
    const text = lines.map((l) => l.text).join("\n");
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  return (
    <div className="terminal-pane">
      <div className="terminal-tabs">
        <div className="tab active" style={{ cursor: "default" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--conf-high)" }} />
          <span>Logs</span>
        </div>
        <div className="actions" style={{ gap: 6 }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search logs"
            aria-label="Search logs"
            className="term-search"
          />
          <button
            type="button"
            onClick={copyAll}
            disabled={lines.length === 0}
            className="icon-btn-sm"
            title="Copy all log output"
            aria-label="Copy all log output"
            style={{ width: "auto", padding: "2px 8px", fontSize: 11 }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={clearTerminal}
            disabled={lines.length === 0}
            className="icon-btn-sm"
            title="Clear the log"
            aria-label="Clear the log"
            style={{ width: "auto", padding: "2px 8px", fontSize: 11 }}
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onClose}
            className="icon-btn-sm"
            title="Hide logs"
            aria-label="Hide logs"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
      <div ref={scrollRef} className="terminal-body" onScroll={onScroll} style={{ position: "relative" }}>
        {lines.length === 0 ? (
          <div className="term-empty">Commands the agent runs will show up here.</div>
        ) : (
          <>
            {dropped > 0 && !query && (
              <div className="term-trimmed">
                … {dropped.toLocaleString()} earlier line{dropped === 1 ? "" : "s"} trimmed
              </div>
            )}
            {shown.length === 0 ? (
              <div className="term-empty">No lines match “{query}”.</div>
            ) : (
              shown.map((line, i) => (
                <div
                  key={i}
                  className={`term-line${
                    line.stream === "err" ? " term-err" : line.stream === "cmd" ? " term-cmd" : ""
                  }`}
                >
                  {line.text}
                </div>
              ))
            )}
          </>
        )}
      </div>
      {!atBottom && lines.length > 0 && (
        <button type="button" className="term-jump" onClick={jumpToBottom}>
          Jump to bottom ↓
        </button>
      )}
    </div>
  );
}
