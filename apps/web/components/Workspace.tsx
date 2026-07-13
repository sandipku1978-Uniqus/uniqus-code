"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from "react-resizable-panels";
import { type PermissionMode, runModeForPermission } from "@uniqus/api-types";
import { connect, disconnect, send } from "@/lib/ws-client";
import { useStore, previewTabId, fileTabId, AGENT_PREVIEW_TAB, ACTIVITY_TAB } from "@/lib/store";
import { useIsMobile } from "@/lib/use-is-mobile";
import { runProjectApi, switchProjectBranchApi } from "@/lib/api";
import { toast } from "@/lib/toast";
import ChatPanel from "./ChatPanel";
import FileExplorer from "./FileExplorer";
import EditorPreviewArea from "./EditorPreviewArea";
import PreviewPanel from "./PreviewPanel";
import AgentPreviewPanel from "./AgentPreviewPanel";
import ActivityMonitor from "./ActivityMonitor";
import TerminalPanel from "./TerminalPanel";
import DeployButton from "./DeployButton";
import BrandLockup from "./BrandLockup";
import GithubRepoButton from "./GithubRepoButton";
import Modal from "./Modal";
import MembersView from "./MembersView";
import CommentsView from "./CommentsView";
import TasksView from "./TasksView";
import GuestBanner from "./GuestBanner";
import SkillsModal from "./SkillsModal";
import SecretsModal from "./SecretsModal";
import CheckpointsModal from "./CheckpointsModal";
import { ErrorBoundary } from "./ErrorBoundary";
import Coachmark from "./Coachmark";
import PlanDocument, { type PlanItem } from "./PlanDocument";

export default function Workspace({
  projectId,
  signOutUrl,
}: {
  projectId: string;
  signOutUrl: string;
}) {
  const connected = useStore((s) => s.connected);
  const connectionFailed = useStore((s) => s.connectionFailed);
  const panels = useStore((s) => s.panels);
  const togglePanel = useStore((s) => s.togglePanel);
  const resetPanels = useStore((s) => s.resetPanels);
  // Workspace surface: "builder" (Chat + big live Preview, beginner default)
  // or "code" (the full IDE). Persisted account-wide in the store.
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const project = useStore((s) => s.project);
  const setProject = useStore((s) => s.setProject);
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
  const permissionMode = useStore((s) => s.permissionMode);
  const permissionModeTouched = useStore((s) => s.permissionModeTouched);
  // Model + thinking ride the auto-fired brief so a choice made in the
  // landing-page composer (persisted in the same store) applies to the very
  // first turn, not just to follow-ups typed in the workspace.
  const model = useStore((s) => s.model);
  const thinking = useStore((s) => s.thinking);
  const addUserMessage = useStore((s) => s.addUserMessage);
  const setBusy = useStore((s) => s.setBusy);
  // account_type arrives on the WS session_started event. Guests get full
  // parity except GitHub + deploys, so we drop those two topbar buttons.
  const isGuest = useStore((s) => s.user?.account_type) === "guest";

  const router = useRouter();
  const searchParams = useSearchParams();
  const briefParam = searchParams?.get("brief") ?? null;
  // Plan-mode preference carried from the landing-page composer ("1"/"0"). Only
  // honored for a brand-new project's first turn (see the first-turn effect).
  const planParam = searchParams?.get("plan") ?? null;
  // Phase-2.x multi-session support: ?session=<uuid> binds the WS to a
  // specific chat thread. Default (no param) resolves server-side to the
  // project's default session.
  const sessionParam = searchParams?.get("session") ?? null;
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [secretsOpen, setSecretsOpen] = useState(false);
  const [checkpointsOpen, setCheckpointsOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  // Bumped to force a clean PanelGroup remount after "Reset layout" clears the
  // saved drag sizes (UI/UX audit §B).
  const [layoutKey, setLayoutKey] = useState(0);

  const resetLayout = () => {
    try {
      for (const k of Object.keys(window.localStorage)) {
        if (k.includes("uniqus-h-") || k.includes("uniqus-v-")) {
          window.localStorage.removeItem(k);
        }
      }
    } catch {
      /* private mode — non-fatal */
    }
    resetPanels();
    setLayoutKey((n) => n + 1);
    toast.success("Layout reset");
  };

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
  // Close the menu whenever we're in a context with NO ⋯ trigger (desktop Code
  // view), so it can't linger as a stray popover after a resize or a view
  // switch. The ⋯ exists on mobile (any view) and on desktop Builder view.
  useEffect(() => {
    if (!isMobile && view === "code") setOverflowOpen(false);
  }, [isMobile, view]);
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
    else {
      // No server yet — instead of a dead, inert tab (whose tooltip a phone
      // can't show), surface the editor and explain how to start one (§E).
      toast.info("Tap Run to start a live preview.");
    }
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
      // Default is plan-first; the landing composer can opt out via ?plan=0.
      setMode(planParam === "0" ? "execute-only" : "plan-then-execute");
    }
    setFirstTurnModeReady(true);
  }, [connected, project, hasHistory, modeTouched, setMode, planParam]);

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
    // Derive the first-turn mode SYNCHRONOUSLY from the URL's ?plan= flag
    // instead of reading the store's `mode` (B1 race fix). The decision effect
    // above writes `mode` asynchronously; gating the fire on a *separate*
    // `firstTurnModeReady` boolean while reading `mode` from a different state
    // source opened a window where the brief could fire with the stale
    // execute-only default before the plan-then-execute write propagated — the
    // intermittent "a new project sometimes skips plan mode" bug. The ?plan=
    // flag already encodes the user's landing-page choice (default plan), so we
    // never need the round-tripped store value here. An explicit in-workspace
    // toggle (modeTouched) still wins.
    // Mirror the mode decision in permission-mode terms (derived synchronously
    // from the URL flag, same race-avoidance reasoning as below): a brand-new
    // project briefs in Plan unless ?plan=0 opted out (→ the acceptEdits default).
    const firstTurnPermissionMode: PermissionMode = permissionModeTouched
      ? permissionMode
      : planParam === "0"
        ? "acceptEdits"
        : "plan";
    const firstTurnMode = runModeForPermission(firstTurnPermissionMode);
    // Send first, echo only on success (mirrors ChatPanel.handleSubmit). A
    // failed send used to leave the echoed user bubble behind, which flipped
    // hasHistory true and made the retry path strip ?brief= — so the new
    // project's opening prompt was shown but never delivered.
    const ok = send({
      type: "user_message",
      content: briefParam,
      mode: firstTurnMode,
      permission_mode: firstTurnPermissionMode,
      model: model !== "auto" ? model : undefined,
      thinking: thinking !== "medium" ? thinking : undefined,
    });
    if (!ok) {
      // Leave the param in place so a reconnect retries the fire.
      briefFiredRef.current = null;
      return;
    }
    addUserMessage(briefParam);
    setBusy(true);
    router.replace(`/projects/${projectId}`);
  }, [
    briefParam,
    connected,
    project,
    hasHistory,
    firstTurnModeReady,
    mode,
    modeTouched,
    permissionMode,
    permissionModeTouched,
    planParam,
    model,
    thinking,
    addUserMessage,
    setBusy,
    projectId,
    router,
  ]);

  // Secondary topbar actions, split so each context can place them right:
  //   • deployAction        — the Publish/Deploy button. Inline in Builder &
  //     in the desktop Code cluster; in the mobile ⋯ menu.
  //   • secondaryActionsRest — GitHub + Skills + Secrets + Rewind. Inline in
  //     Code; folded into the ⋯ menu in Builder and on mobile so the
  //     beginner topbar stays uncluttered.
  // The resting Deploy button reads "Publish" in Builder (plain language).
  const deployAction = !isGuest ? (
    <DeployButton
      projectId={projectId}
      label={view === "builder" ? "Publish" : "Deploy"}
    />
  ) : null;
  const secondaryActionsRest = (
    <>
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
        title="Manage project secrets (encrypted; available only to trusted connectors and deployments)"
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
      {!isGuest && (
        <button
          onClick={() => {
            setMembersOpen(true);
            setOverflowOpen(false);
          }}
          className="toggle-btn"
          title="Invite teammates and manage their roles on this project"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          <span>Members</span>
        </button>
      )}
      {!isGuest && (
        <button
          onClick={() => {
            setCommentsOpen(true);
            setOverflowOpen(false);
          }}
          className="toggle-btn"
          title="Read and leave review comments on this project"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span>Comments</span>
        </button>
      )}
      {!isGuest && (
        <button
          onClick={() => {
            setTasksOpen(true);
            setOverflowOpen(false);
          }}
          className="toggle-btn"
          title="Queue and track durable agent tasks for this project"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
          <span>Tasks</span>
        </button>
      )}
    </>
  );

  // The ⋯ overflow menu, shared by mobile (any view) and desktop Builder view.
  // `leading` is the context-specific action rows (mobile includes Deploy;
  // Builder doesn't, since Publish sits inline); Reset layout + Sign out always
  // close the menu. Only one trigger is ever mounted at a time, so reusing the
  // open-state + refs is safe.
  const renderOverflow = (leading: React.ReactNode) => (
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
          {/* Not a true role="menu" — it hosts components (Deploy / GitHub) that
              render their own dialogs, so we keep native tab order rather than
              the menu/menuitem keyboard model. Deploy & GitHub intentionally
              DON'T close the menu on click: their modals render inside this
              subtree, so unmounting the menu would unmount the dialog. Their
              full-screen overlay covers the menu instead. */}
          <div ref={overflowMenuRef} className="topbar-overflow">
            {leading}
            <button
              type="button"
              className="toggle-btn"
              onClick={() => {
                resetLayout();
                closeOverflow();
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
              <span>Reset layout</span>
            </button>
            <span className="topbar-overflow-sep" />
            <a href={signOutUrl} className="toggle-btn" style={{ textDecoration: "none" }}>
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
          {/* Git branch is developer jargon — only shown in Code view. */}
          {view === "code" && (
            <BranchChip
              projectId={projectId}
              branch={project?.linked_branch ?? "main"}
              onSwitched={(linked_branch) => {
                if (project) setProject({ ...project, linked_branch });
              }}
            />
          )}
        </div>

        <div className="actions">
          {/* Builder ⇄ Code switch (desktop only; mobile uses the bottom tab
              bar to move between Chat / Preview / Code). */}
          {!isMobile && (
            <Coachmark
              id="builder-code-toggle"
              title="Two ways to see your app"
              body="Preview shows your app running live. Switch to Code anytime to open the files, editor, and logs."
              placement="bottom"
            >
            <div className="view-toggle" role="group" aria-label="Workspace view">
              <button
                type="button"
                className="view-seg"
                data-on={view === "builder"}
                aria-pressed={view === "builder"}
                onClick={() => setView("builder")}
                title="Chat with a live preview of your app"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
                <span>Preview</span>
              </button>
              <button
                type="button"
                className="view-seg"
                data-on={view === "code"}
                aria-pressed={view === "code"}
                onClick={() => setView("code")}
                title="Open the full code editor, files, and logs"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="16 18 22 12 16 6" />
                  <polyline points="8 6 2 12 8 18" />
                </svg>
                <span>Code</span>
              </button>
            </div>
            </Coachmark>
          )}

          <RunButton projectId={projectId} />

          {isMobile ? (
            /* Phone: Run inline; everything else folds into the ⋯ menu. The
               Files/Logs toggles are dropped — the bottom tab bar navigates
               to those panes instead. */
            renderOverflow(
              <>
                {deployAction}
                {secondaryActionsRest}
              </>,
            )
          ) : view === "builder" ? (
            /* Desktop Builder: Publish inline; the developer tools tuck under
               the ⋯ menu so the beginner topbar stays clean. No Files/Logs
               toggles — the Code switch is the path to them. */
            <>
              {deployAction}
              {renderOverflow(secondaryActionsRest)}
            </>
          ) : (
            /* Desktop Code: keep inline only the controls a developer flips
               constantly — Deploy plus the Files & Logs panel toggles. The
               project tools (GitHub/Skills/Secrets/Rewind/Members), Reset
               layout, and Sign out fold into the same ⋯ menu the Builder view
               uses, so the developer topbar stays uncluttered and the two
               views stay consistent. (renderOverflow appends Reset layout +
               Sign out itself.) */
            <>
              {deployAction}
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
              {renderOverflow(secondaryActionsRest)}
            </>
          )}
        </div>
      </div>

      {isGuest && <GuestBanner variant="compact" />}

      {isMobile && !connected && (
        <div className="mobile-conn-bar" role="status">
          <span className="chat-offline-dot" aria-hidden="true" />
          <span style={{ flex: 1 }}>
            {connectionFailed ? "Connection failed" : "Connecting…"}
          </span>
          {connectionFailed && (
            <button
              type="button"
              className="status-retry-btn"
              onClick={() => connect(projectId, sessionParam)}
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* Main grid */}
      <div className="ide-grid" style={{ position: "relative" }}>
        {/* Connect skeleton (desktop) — placeholder panes while the WS comes up
            so the workspace doesn't look broken/blank on first open (§B). */}
        {!isMobile && !connected && !connectionFailed && <WorkspaceSkeleton />}
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
        ) : view === "code" ? (
          <PanelGroup
            key={`code-${layoutKey}`}
            direction="horizontal"
            autoSaveId={`uniqus-h-${panels.files ? "f" : "nf"}`}
          >
            <Panel id="chat" defaultSize={panels.files ? 35 : 45} minSize={25} order={1}>
              <ErrorBoundary label="chat">
                <ChatPanel />
              </ErrorBoundary>
            </Panel>

            {panels.files && (
              <>
                <PanelResizeHandle
                  className="resize-handle-h"
                  aria-label="Resize the files panel"
                  title="Drag to resize · arrow keys when focused"
                />
                <Panel id="files" defaultSize={20} minSize={12} maxSize={35} order={2}>
                  <ErrorBoundary label="files">
                    <FileExplorer onClose={() => togglePanel("files")} />
                  </ErrorBoundary>
                </Panel>
              </>
            )}

            <PanelResizeHandle
              className="resize-handle-h"
              aria-label="Resize the editor panel"
              title="Drag to resize · arrow keys when focused"
            />

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
                    <PanelResizeHandle
                      className="resize-handle-v"
                      aria-label="Resize the logs panel"
                      title="Drag to resize · arrow keys when focused"
                    />
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
        ) : (
          /* Builder view (default): Chat + a big live Preview. Its own
             autoSaveId keeps the split from colliding with the IDE's saved
             sizes, while still being swept by reset-layout's "uniqus-h-"
             filter. */
          <PanelGroup
            key={`builder-${layoutKey}`}
            direction="horizontal"
            autoSaveId="uniqus-h-builder"
          >
            <Panel id="chat" defaultSize={42} minSize={28} order={1}>
              <ErrorBoundary label="chat">
                <ChatPanel />
              </ErrorBoundary>
            </Panel>
            <PanelResizeHandle
              className="resize-handle-h"
              aria-label="Resize the preview"
              title="Drag to resize · arrow keys when focused"
            />
            <Panel id="builder-stage" defaultSize={58} minSize={35} order={2}>
              <BuilderStage projectId={projectId} />
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
            // Not disabled: a tap when nothing is running shows a hint (toast)
            // rather than a dead tab a phone can't explain (§E).
            dimmed={!hasPreview}
            accessibleLabel={
              hasPreview ? "Preview (running)" : "Preview — run the project first"
            }
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            }
          />
          <MobileTab
            active={mobileView === "editor" && editorTab === ACTIVITY_TAB}
            onClick={() => {
              setMobileView("editor");
              setEditorTab(ACTIVITY_TAB);
            }}
            label="Activity"
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 12h4l2 6 4-16 2 8h6" />
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
      {membersOpen && (
        <Modal
          title="Collaborators"
          subtitle="Invite teammates by email and set their role on this project."
          onClose={() => setMembersOpen(false)}
        >
          <MembersView projectId={projectId} />
        </Modal>
      )}
      {commentsOpen && (
        <Modal
          title="Comments"
          subtitle="Leave review comments scoped to an element, file, checkpoint, PR, or the whole project."
          onClose={() => setCommentsOpen(false)}
        >
          <CommentsView projectId={projectId} />
        </Modal>
      )}
      {tasksOpen && (
        <Modal
          title="Agent tasks"
          subtitle="Queue durable tasks for the agent and track their status."
          onClose={() => setTasksOpen(false)}
        >
          <TasksView projectId={projectId} />
        </Modal>
      )}

      {/* Status bar — Code view only. It's developer plumbing (connection,
          sync state, branch), so Builder hides it; mobile hides it too (the
          bottom tab bar owns the bottom edge). */}
      {!isMobile && view === "code" && (
      <div className="status-bar">
        {/* The always-"online" connection pill was noise (the socket auto-
            reconnects with backoff). Only surface the connection state when it
            has actually FAILED — i.e. auto-reconnect gave up — so the manual
            Retry recovery path is preserved without the steady-state clutter. */}
        {connectionFailed && (
          <span className="seg">
            <span
              style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--conf-low)" }}
            />
            connection lost
            <button
              type="button"
              onClick={() => connect(projectId, sessionParam)}
              className="status-retry-btn"
              title="Reconnect to the workspace"
              aria-label="Reconnect to the workspace"
            >
              Retry
            </button>
          </span>
        )}
        <span className="seg">{project?.name ?? "—"}</span>
        <span className="seg" title="Files synced to Supabase Storage">
          {lastSyncedAt ? `synced ${relativeAge(lastSyncedAt)}` : "not synced yet"}
        </span>
        <div className="right">
          <span className="seg">{project?.linked_branch ?? "main"}</span>
        </div>
      </div>
      )}
    </div>
  );
}

/** Placeholder panes shown over the IDE grid while the WebSocket connects. */
function WorkspaceSkeleton() {
  return (
    <div className="ide-skeleton" aria-hidden="true">
      <div className="ide-skeleton-bar" style={{ width: "40%" }} />
      <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
        {[90, 70, 80, 60, 75, 55, 85, 65].map((w, i) => (
          <div key={i} className="ide-skeleton-row" style={{ width: `${w}%` }} />
        ))}
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

/**
 * Shared dev-server start/restart logic: stop any running server, then start
 * (or restart) the project's dev server, surfacing progress via the global
 * toast + a system chat line. Consumed by the topbar Run button AND the Builder
 * empty-state "Start preview" button so both behave identically.
 */
function useRunProject(projectId: string) {
  const [busy, setBusy] = useState(false);
  const addSystem = useStore((s) => s.addSystem);

  const run = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await runProjectApi(projectId);
      addSystem(`server up · ${r.command} :${r.port} (config: ${r.config_source})`);
      toast.success(`Server running on port ${r.port}`);
    } catch (err) {
      // Surface via the global toast system (aria-live) instead of a stray
      // absolute-positioned popover above the topbar (§E).
      toast.error(
        `Couldn't start the server: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusy(false);
    }
  }, [busy, projectId, addSystem]);

  return { run, busy };
}

/**
 * Interactive linked-branch chip (P1.2). The chip in the Code-view topbar used
 * to be a read-only display of the tracked branch; now it's a button that opens
 * a small inline popover with a free-text branch input + Save. Save calls
 * switchProjectBranchApi and, on success, updates the store's
 * project.linked_branch (via onSwitched) and toasts. A "pick from repo branches"
 * list is intentionally out of scope (no list endpoint yet) — free-text is the
 * shippable version.
 */
function BranchChip({
  projectId,
  branch,
  onSwitched,
}: {
  projectId: string;
  branch: string;
  onSwitched: (linkedBranch: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(branch);
  const [busy, setBusy] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-seed the field with the current branch each time the popover opens, and
  // move focus into it.
  useEffect(() => {
    if (open) {
      setValue(branch);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open, branch]);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  async function save() {
    const next = value.trim();
    if (!next || busy) return;
    if (next === branch) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      const { linked_branch } = await switchProjectBranchApi(projectId, next);
      onSwitched(linked_branch);
      toast.success(`Switched to ${linked_branch}`);
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't switch branch");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span
      style={{ position: "relative", display: "inline-flex" }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="branch"
        onClick={() => setOpen((v) => !v)}
        title="Change the git branch this project tracks"
        aria-haspopup="dialog"
        aria-expanded={open}
        style={{
          border: "1px solid var(--border-default)",
          cursor: "pointer",
        }}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="6" y1="3" x2="6" y2="15" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
        {branch}
      </button>

      {open && (
        <>
          {/* Click-away backdrop. */}
          <button
            type="button"
            aria-label="Close branch editor"
            tabIndex={-1}
            onClick={close}
            style={{
              position: "fixed",
              inset: 0,
              background: "transparent",
              border: "none",
              cursor: "default",
              zIndex: 40,
            }}
          />
          <div
            role="dialog"
            aria-label="Switch branch"
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: 0,
              zIndex: 41,
              minWidth: 248,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: 12,
              background: "var(--bg-elev)",
              border: "1px solid var(--border-default)",
              borderRadius: "var(--radius-md)",
              boxShadow: "0 8px 24px rgba(0, 0, 0, 0.35)",
            }}
          >
            <label
              htmlFor="branch-switch-input"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-2xs)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--text-dim)",
              }}
            >
              Linked branch
            </label>
            <input
              id="branch-switch-input"
              ref={inputRef}
              type="text"
              className="ui-input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void save();
                }
              }}
              placeholder="main"
              aria-label="Branch name"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              style={{
                width: "100%",
                background: "var(--bg-surface)",
                border: "1px solid var(--border-default)",
                borderRadius: "var(--radius-md)",
                color: "var(--text-primary)",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-sm)",
                padding: "7px 9px",
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="btn-ghost" onClick={close} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void save()}
                disabled={busy || !value.trim() || value.trim() === branch}
              >
                {busy ? "Switching…" : "Save"}
              </button>
            </div>
          </div>
        </>
      )}
    </span>
  );
}

function RunButton({ projectId }: { projectId: string }) {
  const { run, busy } = useRunProject(projectId);

  return (
    <button
      type="button"
      onClick={run}
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
  );
}

/**
 * Builder view's right-hand surface: the running app, big. Reuses PreviewPanel
 * for the active/first running preview server. When nothing is running yet it
 * shows a friendly empty state with a prominent "Start preview" button (and a
 * note that the preview also appears on its own once the app runs). When more
 * than one server is up, a small pill row switches between them.
 */
function BuilderStage({ projectId }: { projectId: string }) {
  const previews = useStore((s) => s.previews);
  const editorTab = useStore((s) => s.editorTab);
  const setEditorTab = useStore((s) => s.setEditorTab);
  // The current PENDING plan takes over the whole stage as a full document —
  // it's the highest-stakes decision moment and (on the first turn especially)
  // the stage is otherwise idle. Chat shows only a compact stub meanwhile (see
  // PlanReview). The selector returns the same item reference across unrelated
  // chat updates, so this doesn't re-render the stage on every message.
  const pendingPlan = useStore((s): PlanItem | null => {
    if (!s.pendingPlanItemId) return null;
    const it = s.chat.find(
      (i) => i.kind === "plan_proposal" && i.id === s.pendingPlanItemId,
    );
    return it && it.kind === "plan_proposal" ? it : null;
  });
  // Narrow selectors so streamed frames don't re-render the big stage when it's
  // showing the App (only AgentPreviewPanel, mounted below, needs each frame).
  const agentHasFrames = useStore((s) => s.agentPreview.frames.length > 0);
  const agentActive = useStore((s) => s.agentPreview.active);
  const { run, busy } = useRunProject(projectId);

  // Prefer the preview the shared editorTab points at — addPreview sets it to
  // the newest server, so an agent- or user-started preview "just appears" —
  // else the first running server, else nothing (empty state).
  const active =
    (editorTab.startsWith("preview:") &&
      previews.find((p) => previewTabId(p.id) === editorTab)) ||
    previews[0] ||
    null;

  // The live "Preview (Agent)" surface is available once the agent has produced
  // any interaction frames (or a run is mid-flight). When a run starts the store
  // flips editorTab to it, so the builder stage takes over like a screen-share.
  const showAgent = agentHasFrames || agentActive;
  const onAgent = editorTab === AGENT_PREVIEW_TAB && showAgent;
  // The Activity Monitor is now a first-class tab (item 2), not just the idle
  // fallback — the user can flip back to it while a preview is running.
  const onActivity = editorTab === ACTIVITY_TAB;

  // Pending plan → the stage becomes the plan document until it's decided.
  // On approve/reject pendingPlanItemId clears and the stage falls through to
  // the Activity Monitor (watch it build) and then the live preview — the
  // plan → build → app arc in one pane.
  if (pendingPlan) {
    return (
      <div className="builder-stage">
        <ErrorBoundary label="plan">
          {/* Keyed by item id: a NEW pending plan must remount the document so
              its internal draft state re-seeds (useState initializers don't
              re-run on prop change). */}
          <PlanDocument key={pendingPlan.id} item={pendingPlan} variant="stage" />
        </ErrorBoundary>
      </div>
    );
  }

  // No live preview / agent surface to show yet, and not explicitly on Activity.
  // Instead of a dead "Start preview" splash, fill the stage with the Activity
  // Monitor — a live build dashboard (tokens/cost, tasks, sub-agents, edited-file
  // diffs). It falls back to the "Start preview" CTA when there's no activity
  // yet, and is swapped out for the real preview the moment one exists.
  if (!active && !onAgent && !onActivity) {
    return (
      <div className="builder-stage">
        <ActivityMonitor onStartPreview={run} startingPreview={busy} />
      </div>
    );
  }

  return (
    <div className="builder-stage">
      {(previews.length > 0 || showAgent) && (
        <div
          className="builder-preview-bar"
          role="tablist"
          aria-label="Preview surfaces"
        >
          {previews.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={!onAgent && !onActivity && p.id === active?.id}
              className="toggle-btn"
              data-on={!onAgent && !onActivity && p.id === active?.id}
              onClick={() => setEditorTab(previewTabId(p.id))}
              title={`Show the app running on port ${p.port}`}
            >
              {/* "Live preview" instead of a bare port number — a non-technical
                  user shouldn't have to know what ":3000" means (item 1). The
                  port is only appended to disambiguate multiple servers. */}
              Live preview{previews.length > 1 ? ` :${p.port}` : ""}
            </button>
          ))}
          {showAgent && (
            <button
              type="button"
              role="tab"
              aria-selected={onAgent}
              className="toggle-btn"
              data-on={onAgent}
              onClick={() => setEditorTab(AGENT_PREVIEW_TAB)}
              title="Watch the agent interact with your app, and replay saved flows"
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              Agent preview
              {agentActive && (
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: "var(--danger, #d9534f)",
                    animation: "pulse-dot 1.4s ease-in-out infinite",
                  }}
                />
              )}
            </button>
          )}
          <button
            type="button"
            role="tab"
            aria-selected={onActivity}
            className="toggle-btn"
            data-on={onActivity}
            onClick={() => setEditorTab(ACTIVITY_TAB)}
            title="Live tokens, cost, tasks, sub-agents, and file diffs"
          >
            Activity
          </button>
        </div>
      )}
      <ErrorBoundary label="preview">
        {onActivity ? (
          <ActivityMonitor onStartPreview={run} startingPreview={busy} />
        ) : onAgent ? (
          <AgentPreviewPanel />
        ) : active ? (
          <PreviewPanel server={active} />
        ) : null}
      </ErrorBoundary>
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
  dimmed,
  accessibleLabel,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  /** Small dot indicating activity (e.g. a running preview server). */
  badge?: boolean;
  /** Visually de-emphasize without blocking the tap (the tap shows a hint). */
  dimmed?: boolean;
  /** Overrides the announced name (e.g. "Preview (running)") so state that's
   *  only shown as a colored dot is still perceivable to screen readers. */
  accessibleLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mobile-tab"
      data-active={active}
      style={dimmed ? { opacity: 0.5 } : undefined}
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
