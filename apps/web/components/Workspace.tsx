"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from "react-resizable-panels";
import { connect, disconnect, send } from "@/lib/ws-client";
import { useStore, previewTabId, fileTabId } from "@/lib/store";
import { useIsMobile } from "@/lib/use-is-mobile";
import { runProjectApi } from "@/lib/api";
import ChatPanel from "./ChatPanel";
import FileExplorer from "./FileExplorer";
import EditorPreviewArea from "./EditorPreviewArea";
import TerminalPanel from "./TerminalPanel";
import DeployButton from "./DeployButton";
import BrandLockup from "./BrandLockup";
import GithubRepoButton from "./GithubRepoButton";
import GuestBanner from "./GuestBanner";
import SkillsModal from "./SkillsModal";
import SecretsModal from "./SecretsModal";
import CheckpointsModal from "./CheckpointsModal";
import { ErrorBoundary } from "./ErrorBoundary";

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
  // Real conversation history — anything that isn't a `system` item. The
  // `session_started` handler always adds a "session ready" system message,
  // so `chat.length` is never 0 once the WS is up; gating the first-turn
  // fire on it would suppress the brief on every brand-new project.
  const hasHistory = useStore((s) => s.chat.some((i) => i.kind !== "system"));
  const mode = useStore((s) => s.mode);
  const modeTouched = useStore((s) => s.modeTouched);
  const setMode = useStore((s) => s.setMode);
  const addUserMessage = useStore((s) => s.addUserMessage);
  const setBusy = useStore((s) => s.setBusy);
  // account_type arrives on the WS session_started event. Guests get full
  // parity except GitHub + deploys, so we drop those two topbar buttons.
  const isGuest = useStore((s) => s.user?.account_type) === "guest";

  const router = useRouter();
  const searchParams = useSearchParams();
  const briefParam = searchParams?.get("brief") ?? null;
  // Phase-2.x multi-session support: ?session=<uuid> binds the WS to a
  // specific chat thread. Default (no param) resolves server-side to the
  // project's default session.
  const sessionParam = searchParams?.get("session") ?? null;
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [secretsOpen, setSecretsOpen] = useState(false);
  const [checkpointsOpen, setCheckpointsOpen] = useState(false);

  // ── Mobile (≤760px) layout ──────────────────────────────────────────────
  // On a phone the horizontal Chat | Files | Editor split is unusable, so we
  // render one full-screen pane at a time and switch between them with a
  // bottom tab bar. `useIsMobile` is SSR-safe (desktop is the server default,
  // mobile swaps in after mount) so there's no hydration mismatch.
  const isMobile = useIsMobile();
  const [mobileView, setMobileView] = useState<
    "chat" | "editor" | "files" | "logs"
  >("chat");
  const [overflowOpen, setOverflowOpen] = useState(false);
  // Selectors that drive the bottom-nav Code/Preview state. The editor surface
  // is shared between "Code" and "Preview"; which one is highlighted depends on
  // whether the active editor tab is a preview. Mirrors the fallback order in
  // EditorPreviewArea so the highlight matches what's actually shown.
  const previews = useStore((s) => s.previews);
  const openFiles = useStore((s) => s.openFiles);
  const editorTab = useStore((s) => s.editorTab);
  const setEditorTab = useStore((s) => s.setEditorTab);

  const hasPreview = previews.length > 0;
  const effectiveTab =
    editorTab ||
    (previews[0]
      ? previewTabId(previews[0].id)
      : openFiles[0]
      ? fileTabId(openFiles[0])
      : "");
  const activeTabIsPreview = effectiveTab.startsWith("preview:");
  // Highlight intent. With no running preview the editor can only show code /
  // its empty state, so "Code" is the active editor view regardless. The
  // Preview tab is disabled when nothing is running, so previewActive only
  // holds once a server exists AND the editor is actually showing it.
  const codeActive = mobileView === "editor" && (!hasPreview || !activeTabIsPreview);
  const previewActive = mobileView === "editor" && hasPreview && activeTabIsPreview;

  // Topbar overflow (⋯) menu plumbing. Refs drive focus management (move focus
  // into the menu on open, restore to the trigger on close).
  const overflowTriggerRef = useRef<HTMLButtonElement>(null);
  const overflowMenuRef = useRef<HTMLDivElement>(null);
  const closeOverflow = () => {
    setOverflowOpen(false);
    overflowTriggerRef.current?.focus();
  };
  // Close the menu when leaving mobile so it can't linger as a stray popover
  // after a resize back to desktop.
  useEffect(() => {
    if (!isMobile) setOverflowOpen(false);
  }, [isMobile]);
  // Move focus to the first item when the menu opens (a11y).
  useEffect(() => {
    if (!overflowOpen) return;
    const first = overflowMenuRef.current?.querySelector<HTMLElement>(
      'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    );
    first?.focus();
  }, [overflowOpen]);

  const goCode = () => {
    setMobileView("editor");
    // If we're sitting on a preview tab but have a file open, surface the file.
    if (activeTabIsPreview && openFiles[0]) {
      setEditorTab(fileTabId(openFiles[0]));
    }
  };
  const goPreview = () => {
    setMobileView("editor");
    if (previews[0]) setEditorTab(previewTabId(previews[0].id));
  };

  // Tick so the "synced 12s ago" label increments without waiting for the
  // next sync event. 10s cadence is plenty — the label rounds to seconds/min.
  const [, setNow] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNow((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, []);

  // First-turn plan-mode default (#2a). A brand-new project (no real history)
  // opens with plan mode ON for its first turn; once that turn's message is
  // sent it falls back to execute-only. A manual toggle (modeTouched) opts out
  // of both behaviors. Refs are reset per project below.
  const firstTurnDecidedRef = useRef(false);
  const sentFirstTurnRef = useRef(false);
  const [firstTurnModeReady, setFirstTurnModeReady] = useState(false);

  useEffect(() => {
    reset();
    firstTurnDecidedRef.current = false;
    sentFirstTurnRef.current = false;
    setFirstTurnModeReady(false);
    connect(projectId, sessionParam);
    return () => {
      disconnect();
    };
  }, [projectId, sessionParam, reset]);

  // Decide the first-turn mode once the session is ready. Runs before the brief
  // auto-fire below (which waits on firstTurnModeReady) so the brief is sent
  // with the resolved mode, not the stale default.
  useEffect(() => {
    if (!connected || !project) return;
    if (firstTurnDecidedRef.current) return;
    firstTurnDecidedRef.current = true;
    if (!hasHistory && !modeTouched) {
      setMode("plan-then-execute");
    }
    setFirstTurnModeReady(true);
  }, [connected, project, hasHistory, modeTouched, setMode]);

  // After the first real message exists, default subsequent turns back to
  // execute-only (unless the user explicitly chose a mode).
  useEffect(() => {
    if (!hasHistory || sentFirstTurnRef.current) return;
    sentFirstTurnRef.current = true;
    if (!modeTouched) setMode("execute-only");
  }, [hasHistory, modeTouched, setMode]);

  // One-sentence project creation: the picker passes the brief through
  // ?brief=…; once the WS is up, the project loaded, and the chat is
  // still empty (i.e. no replayed history), fire it as the first turn.
  // Tracked in a ref so a chat update mid-fire doesn't double-send.
  const briefFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!briefParam) return;
    if (!connected || !project) return;
    // Wait until the first-turn mode is resolved so the brief fires with the
    // intended mode (plan-then-execute on a new project) rather than the stale
    // default.
    if (!firstTurnModeReady) return;
    if (hasHistory) {
      // History exists — strip the param without firing. Avoids
      // surprise-re-running an old brief on re-open.
      router.replace(`/projects/${projectId}`);
      return;
    }
    if (briefFiredRef.current === briefParam) return;
    briefFiredRef.current = briefParam;
    addUserMessage(briefParam);
    setBusy(true);
    const ok = send({ type: "user_message", content: briefParam, mode });
    if (!ok) {
      setBusy(false);
      // Leave the param in place so a reconnect retries the fire.
      briefFiredRef.current = null;
      return;
    }
    router.replace(`/projects/${projectId}`);
  }, [
    briefParam,
    connected,
    project,
    hasHistory,
    firstTurnModeReady,
    mode,
    addUserMessage,
    setBusy,
    projectId,
    router,
  ]);

  // Secondary topbar actions, shared between the desktop topbar (inline) and
  // the mobile overflow (⋯) menu so there's a single source for each button.
  const secondaryActions = (
    <>
      {!isGuest && <DeployButton projectId={projectId} />}
      {!isGuest && <GithubRepoButton projectId={projectId} />}
      <button
        onClick={() => {
          setSkillsOpen(true);
          setOverflowOpen(false);
        }}
        className="toggle-btn"
        title="Edit project Skills (instructions prepended to the agent's system prompt)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="9" y1="13" x2="15" y2="13" />
          <line x1="9" y1="17" x2="15" y2="17" />
        </svg>
        <span>Skills</span>
      </button>
      <button
        onClick={() => {
          setSecretsOpen(true);
          setOverflowOpen(false);
        }}
        className="toggle-btn"
        title="Manage project secrets (encrypted at rest; the agent gets values via get_secret only)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <span>Secrets</span>
      </button>
      <button
        onClick={() => {
          setCheckpointsOpen(true);
          setOverflowOpen(false);
        }}
        className="toggle-btn"
        title="Browse + restore agent-made checkpoints"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="1 4 1 10 7 10" />
          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
        </svg>
        <span>Rewind</span>
      </button>
    </>
  );

  return (
    <div className="ide-shell" data-mobile={isMobile}>
      {/* Topbar */}
      <div className="ide-topbar">
        <div className="crumbs">
          <Link href="/" style={{ textDecoration: "none" }}>
            <BrandLockup style={{ fontSize: 14 }} />
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

          {isMobile ? (
            /* Phone: keep Run inline; fold the rest into a ⋯ overflow menu.
               The Files/Logs toggles are dropped here — the bottom tab bar
               navigates to those panes instead. */
            <div
              className="topbar-overflow-wrap"
              onKeyDown={(e) => {
                if (e.key === "Escape" && overflowOpen) {
                  e.stopPropagation();
                  closeOverflow();
                }
              }}
            >
              <button
                ref={overflowTriggerRef}
                type="button"
                onClick={() => setOverflowOpen((v) => !v)}
                className="icon-btn"
                title="More"
                aria-label="More actions"
                aria-haspopup="true"
                aria-expanded={overflowOpen}
                data-on={overflowOpen}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="5" cy="12" r="2" />
                  <circle cx="12" cy="12" r="2" />
                  <circle cx="19" cy="12" r="2" />
                </svg>
              </button>
              {overflowOpen && (
                <>
                  <button
                    type="button"
                    className="topbar-overflow-backdrop"
                    aria-label="Close menu"
                    tabIndex={-1}
                    onClick={closeOverflow}
                  />
                  {/* Not a true role="menu" — it hosts components (Deploy /
                      GitHub) that render their own dialogs, so we keep native
                      tab order rather than the menu/menuitem keyboard model.
                      Deploy & GitHub intentionally DON'T close the menu on click:
                      their modals render inside this subtree, so unmounting the
                      menu would unmount the dialog. Their full-screen overlay
                      covers the menu instead. */}
                  <div ref={overflowMenuRef} className="topbar-overflow">
                    {secondaryActions}
                    <span className="topbar-overflow-sep" />
                    <a
                      href={signOutUrl}
                      className="toggle-btn"
                      style={{ textDecoration: "none" }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <polyline points="16 17 21 12 16 7" />
                        <line x1="21" y1="12" x2="9" y2="12" />
                      </svg>
                      <span>Sign out</span>
                    </a>
                  </div>
                </>
              )}
            </div>
          ) : (
            <>
              {secondaryActions}
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
                label="Logs"
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
            </>
          )}
        </div>
      </div>

      {isGuest && <GuestBanner variant="compact" />}

      {/* Main grid */}
      <div className="ide-grid">
        {isMobile ? (
          /* Phone: every pane is mounted at once and shown/hidden via CSS
             `display` (not conditional render) so each keeps its state across
             tab switches — the Monaco cursor, chat scroll, and crucially the
             running preview iframe all survive. The bottom tab bar picks which
             one is visible. */
          <div className="ide-mobile">
            <div className="ide-mobile-pane" data-active={mobileView === "chat"}>
              <ErrorBoundary label="chat">
                <ChatPanel />
              </ErrorBoundary>
            </div>
            <div className="ide-mobile-pane" data-active={mobileView === "editor"}>
              <ErrorBoundary label="editor">
                <EditorPreviewArea />
              </ErrorBoundary>
            </div>
            <div className="ide-mobile-pane" data-active={mobileView === "files"}>
              <ErrorBoundary label="files">
                <FileExplorer
                  onClose={() => setMobileView("chat")}
                  onFileOpened={() => setMobileView("editor")}
                />
              </ErrorBoundary>
            </div>
            <div className="ide-mobile-pane" data-active={mobileView === "logs"}>
              <ErrorBoundary label="logs">
                <TerminalPanel onClose={() => setMobileView("chat")} />
              </ErrorBoundary>
            </div>
          </div>
        ) : (
          <PanelGroup direction="horizontal" autoSaveId={`uniqus-h-${panels.files ? "f" : "nf"}`}>
            <Panel id="chat" defaultSize={panels.files ? 35 : 45} minSize={25} order={1}>
              <ErrorBoundary label="chat">
                <ChatPanel />
              </ErrorBoundary>
            </Panel>

            {panels.files && (
              <>
                <PanelResizeHandle className="resize-handle-h" />
                <Panel id="files" defaultSize={20} minSize={12} maxSize={35} order={2}>
                  <ErrorBoundary label="files">
                    <FileExplorer onClose={() => togglePanel("files")} />
                  </ErrorBoundary>
                </Panel>
              </>
            )}

            <PanelResizeHandle className="resize-handle-h" />

            <Panel id="main" defaultSize={panels.files ? 45 : 55} minSize={30} order={3}>
              <PanelGroup
                direction="vertical"
                autoSaveId={`uniqus-v-${panels.terminal ? "t" : "nt"}`}
              >
                <Panel id="editor" defaultSize={panels.terminal ? 60 : 100} minSize={20} order={1}>
                  <ErrorBoundary label="editor">
                    <EditorPreviewArea />
                  </ErrorBoundary>
                </Panel>
                {panels.terminal && (
                  <>
                    <PanelResizeHandle className="resize-handle-v" />
                    <Panel id="terminal" defaultSize={30} minSize={15} order={3}>
                      <ErrorBoundary label="logs">
                        <TerminalPanel onClose={() => togglePanel("terminal")} />
                      </ErrorBoundary>
                    </Panel>
                  </>
                )}
              </PanelGroup>
            </Panel>
          </PanelGroup>
        )}
      </div>

      {/* Mobile bottom tab bar — full-screen pane switcher. */}
      {isMobile && (
        <nav className="mobile-tabbar" aria-label="Workspace panes">
          <MobileTab
            active={mobileView === "chat"}
            onClick={() => setMobileView("chat")}
            label="Chat"
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            }
          />
          <MobileTab
            active={codeActive}
            onClick={goCode}
            label="Code"
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
            }
          />
          <MobileTab
            active={previewActive}
            onClick={goPreview}
            label="Preview"
            badge={hasPreview}
            disabled={!hasPreview}
            disabledTitle="Run the project to get a live preview"
            accessibleLabel={hasPreview ? "Preview (running)" : undefined}
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            }
          />
          <MobileTab
            active={mobileView === "files"}
            onClick={() => setMobileView("files")}
            label="Files"
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            }
          />
          <MobileTab
            active={mobileView === "logs"}
            onClick={() => setMobileView("logs")}
            label="Logs"
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
            }
          />
        </nav>
      )}

      {skillsOpen && (
        <SkillsModal projectId={projectId} onClose={() => setSkillsOpen(false)} />
      )}
      {secretsOpen && (
        <SecretsModal projectId={projectId} onClose={() => setSecretsOpen(false)} />
      )}
      {checkpointsOpen && (
        <CheckpointsModal projectId={projectId} onClose={() => setCheckpointsOpen(false)} />
      )}

      {/* Status bar — hidden on mobile, where the bottom tab bar owns the
          bottom edge and vertical space is at a premium. */}
      {!isMobile && (
      <div className="status-bar">
        <span className="seg">
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: connected ? "var(--conf-high)" : "var(--text-dim)",
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
      )}
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

function MobileTab({
  active,
  onClick,
  label,
  icon,
  badge,
  disabled,
  disabledTitle,
  accessibleLabel,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  /** Small dot indicating activity (e.g. a running preview server). */
  badge?: boolean;
  /** Dim + block the tab (e.g. Preview before any server is running). */
  disabled?: boolean;
  /** Tooltip explaining why the tab is disabled. */
  disabledTitle?: string;
  /** Overrides the announced name (e.g. "Preview (running)") so state that's
   *  only shown as a colored dot is still perceivable to screen readers. */
  accessibleLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      className="mobile-tab"
      data-active={active}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      title={disabled ? disabledTitle : undefined}
      aria-label={accessibleLabel}
      aria-current={active ? "page" : undefined}
    >
      <span className="mobile-tab-icon">
        {icon}
        {badge && <span className="mobile-tab-badge" aria-hidden="true" />}
      </span>
      <span className="mobile-tab-label">{label}</span>
    </button>
  );
}
