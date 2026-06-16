"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  fetchChatSessionsApi,
  createChatSessionApi,
  deleteChatSessionApi,
  renameChatSessionApi,
  type ChatSessionSummary,
} from "@/lib/api";
import Modal from "./Modal";
import Popover from "./Popover";

/**
 * Topbar dropdown for switching between chat sessions in the same project.
 * Each session is a separate conversation history; the VM, sandbox files,
 * skills, and secrets are project-wide and shared across sessions. Switching
 * navigates to ?session=<id>, which triggers a WS reconnect.
 */
export default function ChatSessionDropdown({ projectId }: { projectId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeId = searchParams?.get("session") ?? null;

  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<ChatSessionSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Session targeted by the rename / delete confirmation modals (null = closed).
  const [renaming, setRenaming] = useState<ChatSessionSummary | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState<ChatSessionSummary | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Server-side, no ?session= binds to ensureDefaultSession(), which chooses
  // the oldest-created session. The list API returns newest-updated first, so
  // compute the default explicitly instead of assuming sessions[0].
  const defaultSession = sessions ? oldestSession(sessions) : null;
  const active =
    (activeId ? sessions?.find((s) => s.id === activeId) : defaultSession) ??
    defaultSession ??
    null;

  const refresh = async (): Promise<void> => {
    try {
      const r = await fetchChatSessionsApi(projectId);
      setSessions(r.sessions);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const switchTo = (sessionId: string): void => {
    if (sessionId === active?.id) {
      setOpen(false);
      return;
    }
    router.push(`/projects/${projectId}?session=${encodeURIComponent(sessionId)}`);
    setOpen(false);
  };

  const onNewChat = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Numbered title: "Chat 3" picks N+1 from current count. Cheap, sane;
      // user can rename via the … menu next to each row if they want.
      const next = (sessions?.length ?? 0) + 1;
      const r = await createChatSessionApi(projectId, `Chat ${next}`);
      await refresh();
      switchTo(r.session.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onRename = (s: ChatSessionSummary): void => {
    setRenameValue(s.title ?? "");
    setRenaming(s);
  };

  const commitRename = async (): Promise<void> => {
    const s = renaming;
    if (!s) return;
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === s.title) {
      setRenaming(null);
      return;
    }
    setRenaming(null);
    try {
      await renameChatSessionApi(projectId, s.id, trimmed);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onDelete = (s: ChatSessionSummary): void => {
    setDeleting(s);
  };

  const commitDelete = async (): Promise<void> => {
    const s = deleting;
    if (!s) return;
    setDeleting(null);
    try {
      await deleteChatSessionApi(projectId, s.id);
      const r = await fetchChatSessionsApi(projectId);
      setSessions(r.sessions);
      // If we're deleting the active session, navigate to an existing session
      // so the WS reconnects away from the deleted history row.
      if (s.id === active?.id) {
        const fallback = oldestSession(r.sessions);
        router.push(
          fallback
            ? `/projects/${projectId}?session=${encodeURIComponent(fallback.id)}`
            : `/projects/${projectId}`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const buttonLabel = active?.title ?? (sessions ? "Default" : "…");

  return (
    <div style={{ display: "inline-flex" }}>
      <button
        ref={triggerRef}
        type="button"
        className="toggle-btn"
        onClick={() => setOpen((v) => !v)}
        title="Switch chat thread"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {buttonLabel}
        </span>
        <span style={{ fontSize: 9, opacity: 0.6 }}>▾</span>
      </button>
      <Popover
        open={open}
        anchorRef={triggerRef}
        placement="bottom-end"
        onRequestClose={() => setOpen(false)}
        style={{
          minWidth: 260,
          background: "var(--bg-surface, #16161e)",
          border: "1px solid var(--border-default, #2a2a36)",
          borderRadius: 6,
          padding: 4,
          zIndex: 50,
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        }}
      >
          <button
            type="button"
            onClick={() => void onNewChat()}
            disabled={busy}
            style={{
              display: "block",
              width: "100%",
              padding: "8px 10px",
              background: "transparent",
              border: "none",
              borderBottom: "1px solid var(--border-default, #2a2a36)",
              color: "var(--text-primary)",
              cursor: "pointer",
              fontSize: 12,
              textAlign: "left",
            }}
          >
            + New chat
          </button>
          <div style={{ maxHeight: 320, overflow: "auto", marginTop: 4 }}>
            {sessions === null && (
              <div style={{ padding: 8, fontSize: 11, color: "var(--text-muted)" }}>loading…</div>
            )}
            {sessions !== null && sessions.length === 0 && (
              <div style={{ padding: 8, fontSize: 11, color: "var(--text-muted)" }}>
                No chats yet. Click + New chat above.
              </div>
            )}
            {sessions?.map((s) => {
              const isActive = (active?.id ?? null) === s.id;
              return (
                <div
                  key={s.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto auto",
                    gap: 4,
                    alignItems: "center",
                    padding: "4px 6px",
                    background: isActive ? "rgba(99,102,241,0.10)" : "transparent",
                    borderRadius: 4,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => switchTo(s.id)}
                    style={{
                      display: "block",
                      background: "transparent",
                      border: "none",
                      color: "var(--text-primary)",
                      textAlign: "left",
                      cursor: "pointer",
                      fontSize: 12,
                      padding: "4px 6px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={s.title ?? "Untitled"}
                  >
                    {s.title ?? "Untitled"}
                    <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                      {relTime(s.updated_at)}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRename(s)}
                    title="Rename"
                    className="icon-btn-xs"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(s)}
                    title="Delete"
                    className="icon-btn-xs danger"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
          {error && (
            <div style={{ padding: 8, fontSize: 11, color: "var(--conf-low, #c0392b)" }}>
              {error}
            </div>
          )}
      </Popover>

      {renaming && (
        <Modal
          title="Rename chat"
          onClose={() => setRenaming(null)}
          width={420}
          footer={
            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={() => setRenaming(null)}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={() => void commitRename()}>
                Save
              </button>
            </div>
          }
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void commitRename();
            }}
          >
            <input
              type="text"
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder="Chat title"
              style={renameInputStyle}
            />
          </form>
        </Modal>
      )}

      {deleting && (
        <Modal
          title="Delete this chat?"
          subtitle={deleting.title ?? "Chat"}
          onClose={() => setDeleting(null)}
          width={460}
          footer={
            <>
              <span className="modal-status">This can’t be undone.</span>
              <div className="modal-actions">
                <button type="button" className="btn-ghost" onClick={() => setDeleting(null)}>
                  Cancel
                </button>
                <button type="button" className="btn-primary" onClick={() => void commitDelete()}>
                  Delete
                </button>
              </div>
            </>
          }
        >
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--text-muted)" }}>
            Deleting <strong>“{deleting.title ?? "Chat"}”</strong> permanently removes the
            conversation and all of its messages. The project’s VM, files, skills, and secrets are
            shared across chats and are not affected.
          </p>
        </Modal>
      )}
    </div>
  );
}

const renameInputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--bg-base)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-default)",
  borderRadius: 6,
  padding: "8px 10px",
  fontSize: 13,
};

function oldestSession(sessions: ChatSessionSummary[]): ChatSessionSummary | null {
  return sessions.reduce<ChatSessionSummary | null>((oldest, s) => {
    if (!oldest) return s;
    return new Date(s.created_at).getTime() < new Date(oldest.created_at).getTime()
      ? s
      : oldest;
  }, null);
}

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}
