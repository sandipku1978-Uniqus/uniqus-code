"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from "react-resizable-panels";
import { connect, disconnect } from "@/lib/ws-client";
import { useStore } from "@/lib/store";
import { runProjectApi } from "@/lib/api";
import ChatPanel from "./ChatPanel";
import FileExplorer from "./FileExplorer";
import EditorPreviewArea from "./EditorPreviewArea";
import TerminalPanel from "./TerminalPanel";

export default function Workspace({
  projectId,
  signOutUrl,
}: {
  projectId: string;
  signOutUrl: string;
}) {
  const connected = useStore((s) => s.connected);
  const panels = useStore((s) => s.panels);
  const togglePanel = useStore((s) => s.togglePanel);
  const project = useStore((s) => s.project);
  const reset = useStore((s) => s.reset);
  const lastSyncedAt = useStore((s) => s.lastSyncedAt);

  // Tick so the "synced 12s ago" label increments without waiting for the
  // next sync event. 10s cadence is plenty — the label rounds to seconds/min.
  const [, setNow] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNow((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    reset();
    connect(projectId);
    return () => {
      disconnect();
    };
  }, [projectId, reset]);

  return (
    <div className="ide-shell">
      {/* Topbar */}
      <div className="ide-topbar">
        <div className="crumbs">
          <Link href="/" className="lockup" style={{ fontSize: 14 }}>
            <span className="mark" style={{ width: 18, height: 18, fontSize: 11 }}>
              u
            </span>
            <span>uniqus</span>
            <span className="slash">/</span>
            <span className="code">code</span>
          </Link>
          <span className="sep">/</span>
          <Link href="/projects" className="proj" style={{ color: "var(--text-primary)" }}>
            {project?.name ?? "loading…"}
          </Link>
          <span className="branch">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
            main
          </span>
        </div>

        <div className="actions">
          <RunButton projectId={projectId} />
          <ToggleButton
            on={panels.files}
            onClick={() => togglePanel("files")}
            label="Files"
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            }
          />
          <ToggleButton
            on={panels.terminal}
            onClick={() => togglePanel("terminal")}
            label="Terminal"
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
            }
          />
          <span style={{ width: 1, height: 18, background: "var(--border-default)" }} />
          <a
            href={signOutUrl}
            className="icon-btn"
            title="Sign out"
            style={{ textDecoration: "none" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </a>
        </div>
      </div>

      {/* Main grid */}
      <div className="ide-grid">
        <PanelGroup direction="horizontal" autoSaveId={`uniqus-h-${panels.files ? "f" : "nf"}`}>
          <Panel id="chat" defaultSize={panels.files ? 35 : 45} minSize={25} order={1}>
            <ChatPanel />
          </Panel>

          {panels.files && (
            <>
              <PanelResizeHandle className="resize-handle-h" />
              <Panel id="files" defaultSize={20} minSize={12} maxSize={35} order={2}>
                <FileExplorer onClose={() => togglePanel("files")} />
              </Panel>
            </>
          )}

          <PanelResizeHandle className="resize-handle-h" />

          <Panel id="main" defaultSize={panels.files ? 45 : 55} minSize={30} order={3}>
            <PanelGroup
              direction="vertical"
              autoSaveId={`uniqus-v-${panels.terminal ? "t" : "nt"}`}
            >
              <Panel id="editor" defaultSize={panels.terminal ? 65 : 100} minSize={20} order={1}>
                <EditorPreviewArea />
              </Panel>
              {panels.terminal && (
                <>
                  <PanelResizeHandle className="resize-handle-v" />
                  <Panel id="terminal" defaultSize={35} minSize={15} order={2}>
                    <TerminalPanel onClose={() => togglePanel("terminal")} />
                  </Panel>
                </>
              )}
            </PanelGroup>
          </Panel>
        </PanelGroup>
      </div>

      {/* Status bar */}
      <div className="status-bar">
        <span className="seg">
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: connected ? "#fff" : "rgba(255,255,255,0.4)",
            }}
          />
          {connected ? "online" : "connecting…"}
        </span>
        <span className="seg">{project?.name ?? "—"}</span>
        <span className="seg" title="Files synced to Supabase Storage">
          {lastSyncedAt ? `synced ${relativeAge(lastSyncedAt)}` : "not synced yet"}
        </span>
        <div className="right">
          <span className="seg">main</span>
          <span className="seg">utf-8</span>
        </div>
      </div>
    </div>
  );
}

function relativeAge(epochMs: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - epochMs) / 1000));
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

function RunButton({ projectId }: { projectId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addSystem = useStore((s) => s.addSystem);

  // Auto-clear the error toast after a few seconds so a stale message
  // doesn't sit above the topbar forever.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(t);
  }, [error]);

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await runProjectApi(projectId);
      addSystem(`server up · ${r.command} :${r.port} (config: ${r.config_source})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="toggle-btn"
        title="Stop any running server, then start (or restart) the project's dev server"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
        <span>{busy ? "Starting…" : "Run"}</span>
      </button>
      {error && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 50,
            background: "var(--bg-elev, #16161e)",
            border: "1px solid var(--conf-low, #c0392b)",
            borderRadius: 6,
            padding: "8px 10px",
            fontSize: 11,
            color: "var(--text-primary)",
            maxWidth: 360,
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

function ToggleButton({
  on,
  onClick,
  label,
  icon,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="toggle-btn"
      data-on={on}
      title={`${on ? "Hide" : "Show"} ${label.toLowerCase()}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
