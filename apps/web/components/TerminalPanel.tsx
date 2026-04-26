"use client";

import { useEffect, useRef } from "react";
import { useStore } from "@/lib/store";

export default function TerminalPanel({ onClose }: { onClose: () => void }) {
  const lines = useStore((s) => s.terminalLines);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);

  return (
    <div className="terminal-pane">
      <div className="terminal-tabs">
        <div className="tab active" style={{ cursor: "default" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--conf-high)" }} />
          <span>Terminal</span>
        </div>
        <div className="actions">
          <button
            type="button"
            onClick={onClose}
            className="icon-btn-sm"
            title="Hide terminal"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
      <div ref={scrollRef} className="terminal-body">
        {lines.length === 0 && (
          <div className="term-empty">
            run_command output appears here.
          </div>
        )}
        {lines.map((line, i) => (
          <div key={i} className="term-line">
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}
