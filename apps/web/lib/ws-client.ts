"use client";

import type { ClientEvent, ServerEvent } from "@uniqus/api-types";
import { useStore, flushAllPendingEdits } from "./store";

function defaultWsUrl(projectId: string, sessionId: string | null): string {
  const explicit = process.env.NEXT_PUBLIC_WS_URL;
  const session = sessionId ? `&session=${encodeURIComponent(sessionId)}` : "";
  if (explicit) {
    return `${explicit}?project=${encodeURIComponent(projectId)}${session}`;
  }
  // Match the page's TLS state so the browser doesn't refuse a `ws://`
  // upgrade from an `https://` origin (mixed content). Falls back to
  // `ws://localhost:8787` only when there's no window (SSR build) or when
  // the page is itself plain http.
  if (typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const host = window.location.hostname;
    const port = window.location.protocol === "https:" ? "" : ":8787";
    return `${proto}://${host}${port}?project=${encodeURIComponent(projectId)}${session}`;
  }
  return `ws://localhost:8787?project=${encodeURIComponent(projectId)}${session}`;
}

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let activeProjectId: string | null = null;
let activeSessionId: string | null = null;

// Reconnect backoff. A fixed 1.5s delay made every connected browser hammer
// the orchestrator after a deploy/OOM/network blip, which can stall recovery
// under thundering-herd. Cap at 30s, jitter to spread the herd.
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_CAP_MS = 30_000;
// Give up auto-reconnecting after this many failed attempts (~minutes of
// retries with the capped backoff). Past the cap we stop scheduling and flag
// `connectionFailed` so the UI can offer a manual Retry instead of silently
// hammering a server that isn't coming back.
const MAX_RECONNECT_ATTEMPTS = 12;
let reconnectAttempts = 0;

function nextReconnectDelay(): number {
  const exp = Math.min(RECONNECT_CAP_MS, RECONNECT_BASE_MS * 2 ** reconnectAttempts);
  // Full jitter — uniform across [0, exp]. Better at de-correlating clients
  // than equal/decorrelated jitter for the small fleet sizes we have here.
  return Math.floor(Math.random() * exp);
}

export function connect(projectId: string, sessionId: string | null = null): void {
  // A fresh connect — i.e. an explicit call rather than the reconnect timer —
  // clears the backoff budget and the "connection lost" flag so a manual Retry
  // (or switching project/session) returns the UI to a connecting state.
  reconnectAttempts = 0;
  useStore.getState().setConnectionFailed(false);
  // Cancel any reconnect the previous close scheduled — otherwise a stale timer
  // fires after this fresh connect and opens a stray duplicate socket.
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  openSocket(projectId, sessionId);
}

/**
 * Open (or re-open) the socket. Public `connect()` resets the reconnect budget
 * first; the reconnect timer calls this directly so the exponential backoff
 * keeps growing across consecutive failed attempts.
 */
function openSocket(projectId: string, sessionId: string | null): void {
  // If asked to connect to a different project OR a different session within
  // the same project, close the old socket first — server-side history is
  // bound at upgrade time, so we have to reconnect to switch sessions.
  if (socket && (activeProjectId !== projectId || activeSessionId !== sessionId)) {
    // Detach the old socket's handlers before closing it. Otherwise its async
    // `onclose` fires after we've assigned the freshly-opened socket below and
    // clobbers it (nulls the shared `socket`, bumps the reconnect counter,
    // schedules a reconnect) — orphaning the new socket and opening a duplicate.
    try {
      socket.onclose = null;
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.close();
    } catch {}
    socket = null;
  }
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }
  activeProjectId = projectId;
  activeSessionId = sessionId;

  const ws = new WebSocket(defaultWsUrl(projectId, sessionId));
  socket = ws;

  ws.onopen = () => {
    useStore.getState().setConnected(true);
    useStore.getState().setConnectionFailed(false);
    reconnectAttempts = 0;
    // A successful open cancels any reconnect the previous close scheduled, so a
    // stale timer can't tear this live socket down with a duplicate reconnect.
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    send({ type: "request_tree" });
    // Replay any edits the user made while the socket was down. Without this
    // a flaky network leaves dirty buffers stranded only in client state.
    flushAllPendingEdits().catch(() => {});
  };

  ws.onclose = () => {
    // Ignore the close of a socket we've already replaced (project/session
    // switch). Without this, this stale handler nulls the freshly-opened
    // `socket` and schedules a reconnect → orphaned socket + duplicate connection.
    if (socket !== ws) return;
    // Any half-buffered streaming text belongs to a turn whose socket just
    // dropped — discard it; session_started replays authoritative history.
    discardStreamBuffers();
    useStore.getState().setConnected(false);
    socket = null;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectAttempts += 1;
    if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      // Out of budget — stop hammering and let the UI offer a manual Retry,
      // which calls connect() and resets the counter + this flag.
      useStore.getState().setConnectionFailed(true);
      return;
    }
    const delay = nextReconnectDelay();
    reconnectTimer = setTimeout(() => {
      if (activeProjectId) openSocket(activeProjectId, activeSessionId);
    }, delay);
  };

  ws.onerror = () => {
    // close handler will reconnect
  };

  ws.onmessage = (msg) => {
    try {
      const event = JSON.parse(msg.data) as ServerEvent;
      handleEvent(event);
    } catch (err) {
      console.error("bad message", err);
    }
  };
}

export function disconnect(): void {
  activeProjectId = null;
  reconnectAttempts = 0;
  discardStreamBuffers();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket) {
    try {
      socket.close();
    } catch {}
    socket = null;
  }
}

/**
 * Send a client event. Returns true if it actually went out, false if the
 * socket isn't open. Callers that need user-visible failure handling (chat,
 * file save) should branch on the return value rather than fire-and-forget.
 */
export function send(event: ClientEvent): boolean {
  if (socket && socket.readyState === WebSocket.OPEN) {
    try {
      socket.send(JSON.stringify(event));
      return true;
    } catch (err) {
      // socket.send can still throw (e.g. the socket flipped to CLOSING between
      // the readyState check and here). Treat it as "not sent" so callers'
      // `if (!ok)` recovery branches engage instead of an uncaught exception
      // escaping into a click handler (which no error boundary would catch).
      console.error("ws send failed", err);
      return false;
    }
  }
  return false;
}

// ── Coalesced streaming (A3) ────────────────────────────────────────────────
// The hot path that froze the tab was one Zustand `set()` (→ full ChatPanel
// re-render) per streamed token. We accumulate `text`/`thinking` deltas in
// module-level buffers and flush them to the store once per animation frame —
// one re-render per paint instead of per token. Any NON-streaming event flushes
// the buffer first (see handleEvent) so chat ORDER stays exact: a tool_call that
// arrives between two text deltas must land between them, not after a late blob.
let pendingText = "";
let pendingThinking = "";
let flushRaf: number | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flushStreamBuffers(): void {
  if (flushRaf !== null) {
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(flushRaf);
    flushRaf = null;
  }
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (pendingText) {
    const t = pendingText;
    pendingText = "";
    useStore.getState().appendText(t);
  }
  if (pendingThinking) {
    const t = pendingThinking;
    pendingThinking = "";
    useStore.getState().appendThinking(t);
  }
}

function scheduleStreamFlush(): void {
  if (flushRaf !== null || flushTimer !== null) return;
  // rAF aligns the flush with paint while the tab is foregrounded. A
  // backgrounded tab parks rAF, but the periodic `usage` event (and every tool
  // event) flushes the buffer via handleEvent's top guard, so text never sits
  // long. The setTimeout fallback covers SSR/test/no-rAF environments.
  if (typeof requestAnimationFrame === "function") {
    flushRaf = requestAnimationFrame(() => {
      flushRaf = null;
      flushStreamBuffers();
    });
  } else {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushStreamBuffers();
    }, 50);
  }
}

/** Drop any buffered streaming text without applying it (session switch / close). */
function discardStreamBuffers(): void {
  pendingText = "";
  pendingThinking = "";
  if (flushRaf !== null) {
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(flushRaf);
    flushRaf = null;
  }
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

function handleEvent(event: ServerEvent): void {
  // Keep chat order exact: flush any buffered streaming text before applying a
  // non-streaming event (tool_call, complete, error, …).
  if (event.type !== "text" && event.type !== "thinking") {
    flushStreamBuffers();
  }
  const s = useStore.getState();
  switch (event.type) {
    case "session_started":
      // The server unconditionally replays the full history right after this
      // event (see startSession in server.ts). Treat session_started as the
      // contract that authoritative history is incoming and wipe whatever
      // we accumulated locally first; otherwise a WS flap mid-session
      // doubles up the assistant text (or a session switch leaves the
      // previous thread's messages stuck on screen).
      //
      // The only thing we lose is an in-flight assistant text that hadn't
      // been persisted yet — but that text was already orphaned on the
      // server when the socket dropped, so the user has to re-prompt
      // either way. Better a clean replay than a dirty merge.
      s.resetChat();
      // A fresh session view — clear transient run state; a following run_active
      // re-raises busy + the reattach banner if a run is still live (C-28/C-30).
      // Clearing busy here un-wedges the composer when switching to an empty
      // session/project mid-run (which replays no `complete` to clear it).
      s.setBusy(false);
      s.setRunReattaching(false);
      s.setInstallInProgress(null);
      s.setUser(event.user);
      s.setProject(event.project);
      s.addSystem(
        `session ready · ${event.project.name} · ${event.platform} (${event.shell})`,
      );
      // Tree was already requested in onopen. Only re-request if we don't
      // have any tree data yet (first connect). Skipping the duplicate
      // request prevents a visible flash when switching chat sessions
      // within the same project (the tree is project-wide, not per-session).
      if (s.tree.length === 0) {
        send({ type: "request_tree" });
      }
      // Re-fetch the open file for the NEW session. `resetChat` keeps
      // `selectedFile`, so the editor's request_file effect (which skips when
      // selectedFile already equals the open path) would otherwise leave the
      // previous session's stale content on screen. Skip a dirty/saving buffer
      // so we don't request content we'd discard anyway (the file_content
      // handler guards on the same).
      if (s.selectedFile) {
        const status = s.saveStatus[s.selectedFile]?.kind;
        if (status !== "dirty" && status !== "saving") {
          send({ type: "request_file", path: s.selectedFile });
        }
      }
      break;
    case "iteration":
      break;
    case "text":
      // Buffer + flush once per frame (A3); see scheduleStreamFlush.
      pendingText += event.content;
      scheduleStreamFlush();
      break;
    case "replay_user_message":
      // Persisted user prompt being replayed on load — render it as the user's
      // own bubble (live turns add this client-side; replay can't, so the
      // server re-sends it).
      s.addUserMessage(event.content);
      break;
    case "thinking":
      // Buffer + flush once per frame (A3); see scheduleStreamFlush.
      pendingThinking += event.content;
      scheduleStreamFlush();
      break;
    case "system":
      // Non-agent infra messages — VM lifecycle, storage notices, etc. Render
      // muted so the user doesn't read them as agent output.
      s.addSystem(event.content);
      break;
    case "install_state":
      // A4: the agent started/finished a dependency install → raise/clear the
      // "Installing — don't refresh" banner.
      s.setInstallInProgress(
        event.phase === "start" ? { command: event.command ?? "dependencies" } : null,
      );
      break;
    case "run_active":
      // A1/A2: reconnected to a build that kept running while the socket was
      // gone. session_started already reset the chat + replayed prior turns;
      // re-add the in-flight prompt as the user bubble, mark busy, and show the
      // "kept running" banner. The server flushes this turn's buffered events
      // right after, reconstructing the rest of the turn.
      if (event.prompt) s.addUserMessage(event.prompt);
      s.setBusy(true);
      s.setRunReattaching(true);
      break;
    case "tool_call":
      s.addToolCall(event.call_id, event.name, event.input);
      break;
    case "tool_result":
      s.setToolResult(
        event.call_id,
        event.result,
        event.is_error,
        { lines_added: event.lines_added, lines_removed: event.lines_removed },
        event.image_paths,
      );
      break;
    case "agent_preview_frame":
      // P2 live "Preview (Agent)" view — one screenshot frame per interaction
      // step. The store opens the tab on the first frame of a run.
      s.addAgentPreviewFrame({
        call_id: event.call_id,
        seq: event.seq,
        label: event.label,
        ok: event.ok,
        detail: event.detail,
        url: event.url,
        image: event.image,
        mime: event.mime,
        title: event.title,
        done: event.done,
        flow_name: event.flow_name,
      });
      break;
    case "plan_proposed":
      s.addPlanProposal(event.plan);
      break;
    case "plan_running":
      s.addSystem("plan approved — executing");
      break;
    case "tree_listing":
      s.setTree(event.entries);
      break;
    case "file_content":
      if (event.content !== null) {
        // Don't clobber an in-flight local edit. Re-requesting an already-dirty
        // file (re-click the open tab, or switch-away-and-back while the agent
        // is busy) would otherwise discard recent keystrokes and reset to "idle".
        // Mirror the file_changed guard and skip the whole apply in that case.
        const status = s.saveStatus[event.path]?.kind;
        if (status !== "dirty" && status !== "saving") {
          s.setFile(event.path, event.content);
          // Server is the source of truth post-load — clear any stale dirty
          // marker so the status footer doesn't lie. Also drop any pending
          // edit since it's been overwritten by the server's content.
          s.setSaveStatus(event.path, { kind: "idle" });
          s.clearPendingEdit(event.path);
        }
      }
      break;
    case "file_changed":
      send({ type: "request_tree" });
      // Project files moved on from the live deploy — nudge a redeploy (no-op
      // unless there's already a READY deploy that's now stale).
      s.markProjectFilesChanged();
      // Don't clobber local edits the user has in flight — if the editor is
      // dirty/saving on this same path, leave the buffer alone. The user's
      // save will land shortly and become the new authoritative version.
      if (s.selectedFile === event.path) {
        const status = s.saveStatus[event.path]?.kind;
        if (status !== "dirty" && status !== "saving") {
          send({ type: "request_file", path: event.path });
        }
      }
      break;
    case "server_started":
      s.addPreview({ id: event.id, command: event.command, port: event.port });
      s.addSystem(`server up on port ${event.port} → preview tab opened`);
      break;
    case "server_stopped":
      s.removePreview(event.id);
      s.addSystem(`server stopped`);
      break;
    case "usage":
      s.setLiveUsage({ input: event.input_tokens, output: event.output_tokens });
      break;
    case "complete":
      s.addCompleteMarker(
        event.tool_calls,
        event.elapsed_ms,
        event.aborted === true,
        event.input_tokens,
        event.output_tokens,
        {
          cache_read_tokens: event.cache_read_tokens,
          cache_creation_tokens: event.cache_creation_tokens,
          model: event.model,
          cost_usd: event.cost_usd,
          changed_files: event.changed_files,
          suggestions: event.suggestions,
        },
      );
      s.setBusy(false);
      // Defensive: a turn can't still be installing or reattaching once done.
      s.setInstallInProgress(null);
      s.setRunReattaching(false);
      // If the run was aborted while a plan was still awaiting approval, resolve
      // that stale plan card so its live Approve button can't later hijack a new
      // run's plan wait (C-27). No-op when no plan is pending.
      if (event.aborted === true) s.cancelPendingPlan();
      send({ type: "request_tree" });
      // Agent just went idle — drain any user edits that were deferred while
      // it was running. Without this, edits made during the agent's turn
      // sit in pendingEdits forever (or until the user types again).
      flushAllPendingEdits().catch(() => {});
      break;
    case "session_reset":
      s.resetChat();
      s.setTodos([]);
      send({ type: "request_tree" });
      if (s.selectedFile) {
        send({ type: "request_file", path: s.selectedFile });
      }
      break;
    case "storage_synced":
      s.setLastSyncedAt(event.at);
      break;
    case "deploy_state_changed":
      s.setDeployment({
        id: event.deployment_id,
        state: event.state,
        vercel_url: event.vercel_url,
        error_message: event.error_message,
      });
      break;
    case "user_question_asked":
      s.addUserQuestion(
        event.call_id,
        event.question,
        event.options,
        event.allow_free_text,
      );
      break;
    case "tool_approval_requested":
      s.addToolApproval({
        callId: event.call_id,
        tool: event.tool,
        category: event.category,
        summary: event.summary,
        reason: event.reason,
        input: event.input,
      });
      break;
    case "permission_mode_changed":
      // Server-driven mode change (another tab switched it, or the run dropped
      // out of plan into acceptEdits after approval). Sync without marking it a
      // manual choice so the per-project first-turn defaults still apply.
      s.setPermissionMode(event.mode);
      break;
    case "checkpoint_created":
      // Quietly track — surface only when the user opens the Rewind modal,
      // which fetches the full list. Suppress chat noise.
      break;
    case "todos_updated":
      // Rendered as the inline collapsible Tasks bar in the chat composer
      // (ChatPanel) — the single live tasks surface.
      s.setTodos(event.todos);
      break;
    case "history_compacted":
      s.addSystem(
        `compacted ${event.removed_messages} earlier turns (~${Math.round(
          (event.before_tokens - event.after_tokens) / 1000,
        )}k tokens reclaimed) to keep the session alive`,
      );
      break;
    case "client_write_ack":
      if (event.ok) {
        // Only clear the buffered edit + mark "saved" if no NEWER keystroke has
        // re-dirtied the path since we sent (C-29/C-83). flushSave no longer
        // clears pendingEdits on send, so:
        //  - status still "saving" → this ack matches the latest send: clear + saved.
        //  - status back to "dirty" → newer edit buffered: leave it for the next
        //    flush so the dirty indicator stays honest and the edit isn't lost.
        if (s.saveStatus[event.path]?.kind === "saving") {
          s.clearPendingEdit(event.path);
          s.setSaveStatus(event.path, { kind: "saved", at: Date.now() });
        }
      } else {
        // Write failed — keep the pending edit so the Save retry button can
        // resend it (previously flushSave had already cleared it, making retry
        // a no-op and losing the edit on the next request_file).
        s.setSaveStatus(event.path, { kind: "error", message: event.error ?? "save failed" });
      }
      break;
    case "error":
      // Friendly error card (C7) instead of a bare muted `error: <raw>` line.
      s.addErrorItem(event.message, event.code, event.retryable);
      s.setBusy(false);
      s.setInstallInProgress(null);
      s.setRunReattaching(false);
      break;
  }
}
