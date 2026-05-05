"use client";

import type { ClientEvent, ServerEvent } from "@uniqus/api-types";
import { useStore, flushAllPendingEdits } from "./store";

function defaultWsUrl(projectId: string): string {
  const explicit = process.env.NEXT_PUBLIC_WS_URL;
  if (explicit) {
    return `${explicit}?project=${encodeURIComponent(projectId)}`;
  }
  // Match the page's TLS state so the browser doesn't refuse a `ws://`
  // upgrade from an `https://` origin (mixed content). Falls back to
  // `ws://localhost:8787` only when there's no window (SSR build) or when
  // the page is itself plain http.
  if (typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const host = window.location.hostname;
    const port = window.location.protocol === "https:" ? "" : ":8787";
    return `${proto}://${host}${port}?project=${encodeURIComponent(projectId)}`;
  }
  return `ws://localhost:8787?project=${encodeURIComponent(projectId)}`;
}

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let activeProjectId: string | null = null;

export function connect(projectId: string): void {
  // If asked to connect to a different project, close the old one first.
  if (socket && activeProjectId !== projectId) {
    try {
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

  const ws = new WebSocket(defaultWsUrl(projectId));
  socket = ws;

  ws.onopen = () => {
    useStore.getState().setConnected(true);
    send({ type: "request_tree" });
    // Replay any edits the user made while the socket was down. Without this
    // a flaky network leaves dirty buffers stranded only in client state.
    flushAllPendingEdits().catch(() => {});
  };

  ws.onclose = () => {
    useStore.getState().setConnected(false);
    socket = null;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      if (activeProjectId) connect(activeProjectId);
    }, 1500);
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
    socket.send(JSON.stringify(event));
    return true;
  }
  return false;
}

function handleEvent(event: ServerEvent): void {
  const s = useStore.getState();
  switch (event.type) {
    case "session_started":
      s.setUser(event.user);
      s.setProject(event.project);
      s.addSystem(
        `session ready · ${event.project.name} · ${event.platform} (${event.shell})`,
      );
      // Re-request tree: hydration from Storage may have just written new files
      // that weren't in the tree we got at WS open.
      send({ type: "request_tree" });
      break;
    case "iteration":
      break;
    case "text":
      s.appendText(event.content);
      break;
    case "tool_call":
      s.addToolCall(event.call_id, event.name, event.input);
      break;
    case "tool_result":
      s.setToolResult(event.call_id, event.result, event.is_error);
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
        s.setFile(event.path, event.content);
        // Server is the source of truth post-load — clear any stale dirty
        // marker so the status footer doesn't lie. Also drop any pending
        // edit since it's been overwritten by the server's content.
        s.setSaveStatus(event.path, { kind: "idle" });
        s.clearPendingEdit(event.path);
      }
      break;
    case "file_changed":
      send({ type: "request_tree" });
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
    case "complete":
      s.addCompleteMarker(event.tool_calls, event.elapsed_ms, event.aborted === true);
      s.setBusy(false);
      send({ type: "request_tree" });
      // Agent just went idle — drain any user edits that were deferred while
      // it was running. Without this, edits made during the agent's turn
      // sit in pendingEdits forever (or until the user types again).
      flushAllPendingEdits().catch(() => {});
      break;
    case "session_reset":
      s.resetChat();
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
