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
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Close on outside click — small dropdown, not worth a portal.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent): void => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [open]);

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

  const onRename = async (s: ChatSessionSummary): Promise<void> => {
    const next = window.prompt("Rename chat", s.title ?? "");
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === s.title) return;
    try {
      await renameChatSessionApi(projectId, s.id, trimmed);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onDelete = async (s: ChatSessionSummary): Promise<void> => {
    if (!window.confirm(`Delete "${s.title ?? "Chat"}" and all its messages?`)) return;
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
    <div
      ref={containerRef}
      style={{ position: "relative", display: "inline-flex" }}
    >
      <button
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
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
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
                    onClick={() => void onRename(s)}
                    title="Rename"
                    className="icon-btn-xs"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDelete(s)}
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
        </div>
      )}
    </div>
  );
}

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
