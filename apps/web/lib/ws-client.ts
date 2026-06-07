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

function handleEvent(event: ServerEvent): void {
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
      s.appendText(event.content);
      break;
    case "replay_user_message":
      // Persisted user prompt being replayed on load — render it as the user's
      // own bubble (live turns add this client-side; replay can't, so the
      // server re-sends it).
      s.addUserMessage(event.content);
      break;
    case "thinking":
      s.appendThinking(event.content);
      break;
    case "system":
      // Non-agent infra messages — VM lifecycle, storage notices, etc. Render
      // muted so the user doesn't read them as agent output.
      s.addSystem(event.content);
      break;
    case "tool_call":
      s.addToolCall(event.call_id, event.name, event.input);
      break;
    case "tool_result":
      s.setToolResult(event.call_id, event.result, event.is_error, {
        lines_added: event.lines_added,
        lines_removed: event.lines_removed,
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
      );
      s.setBusy(false);
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
      s.setSaveStatus(
        event.path,
        event.ok
          ? { kind: "saved", at: Date.now() }
          : { kind: "error", message: event.error ?? "save failed" },
      );
      break;
    case "error":
      s.addSystem(`error: ${event.message}`);
      s.setBusy(false);
      break;
  }
}
