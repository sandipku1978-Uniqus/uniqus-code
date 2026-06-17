"use client";

import { useCallback, useEffect, useState } from "react";
import type { Comment, CommentTargetKind } from "@uniqus/api-types";
import { fetchCommentsApi, addCommentApi, resolveCommentApi } from "@/lib/api";
import { toast } from "@/lib/toast";

/**
 * Project comments / review threads (P3.4). Leave a comment scoped to an
 * element, file, checkpoint, PR, or the project in general; resolve and re-open
 * threads. The server stamps the author. House design language: hairline-
 * divided editorial rows, mono micro-labels, magenta the only accent, status
 * carried by a labelled pill, loading + empty states like MembersView.
 */

const TARGET_KINDS: CommentTargetKind[] = ["element", "file", "checkpoint", "pr", "general"];

/** Which kinds take a freeform reference (selector / file path). */
const KINDS_WITH_REF: ReadonlySet<CommentTargetKind> = new Set<CommentTargetKind>(["element", "file"]);

const refPlaceholder: Partial<Record<CommentTargetKind, string>> = {
  element: "CSS selector, e.g. .hero > h1",
  file: "path, e.g. apps/web/app/page.tsx",
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function CommentsView({ projectId }: { projectId: string }) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [targetKind, setTargetKind] = useState<CommentTargetKind>("general");
  const [targetRef, setTargetRef] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { comments } = await fetchCommentsApi(projectId);
      setComments(comments);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load comments");
      setComments([]);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
    const text = body.trim();
    if (!text || busy) return;
    const showRef = KINDS_WITH_REF.has(targetKind);
    const ref = showRef ? targetRef.trim() : "";
    setBusy(true);
    try {
      await addCommentApi(projectId, {
        target_kind: targetKind,
        target_ref: ref ? ref : null,
        body: text,
      });
      setBody("");
      setTargetRef("");
      toast.success("Comment added");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add comment");
    } finally {
      setBusy(false);
    }
  }

  async function setResolved(c: Comment, resolved: boolean) {
    // Optimistic; revert on failure.
    setComments((prev) => prev?.map((x) => (x.id === c.id ? { ...x, resolved } : x)) ?? null);
    try {
      await resolveCommentApi(projectId, c.id, resolved);
    } catch (e) {
      setComments((prev) => prev?.map((x) => (x.id === c.id ? { ...x, resolved: c.resolved } : x)) ?? null);
      toast.error(e instanceof Error ? e.message : "Couldn't update comment");
    }
  }

  const eyebrow: React.CSSProperties = {
    fontFamily: "var(--font-mono)",
    fontSize: "var(--fs-2xs)",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "var(--text-dim)",
  };

  const sorted =
    comments === null
      ? null
      : [...comments].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const showRef = KINDS_WITH_REF.has(targetKind);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 640 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={eyebrow}>● Comments</span>
        {sorted && (
          <span style={{ ...eyebrow, fontVariantNumeric: "tabular-nums" }}>
            {sorted.length} {sorted.length === 1 ? "comment" : "comments"}
          </span>
        )}
      </div>

      {/* Add-comment form */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          border: "1px solid var(--border-default)",
          borderRadius: "var(--radius-lg)",
          background: "var(--bg-surface)",
          padding: 14,
        }}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            className="ui-select"
            value={targetKind}
            onChange={(e) => setTargetKind(e.target.value as CommentTargetKind)}
            aria-label="Comment target kind"
          >
            {TARGET_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          {showRef && (
            <input
              type="text"
              className="ui-input"
              placeholder={refPlaceholder[targetKind] ?? "reference"}
              value={targetRef}
              onChange={(e) => setTargetRef(e.target.value)}
              aria-label="Comment target reference"
              style={{
                flex: 1,
                minWidth: 0,
                background: "var(--bg-elev)",
                border: "1px solid var(--border-default)",
                borderRadius: "var(--radius-md)",
                color: "var(--text-primary)",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-sm)",
                padding: "8px 10px",
              }}
            />
          )}
        </div>
        <textarea
          className="ui-input"
          placeholder="Leave a comment…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
          }}
          rows={3}
          aria-label="Comment body"
          style={{
            resize: "vertical",
            background: "var(--bg-elev)",
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-md)",
            color: "var(--text-primary)",
            fontSize: "var(--fs-md)",
            padding: "8px 10px",
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void submit()}
            disabled={busy || !body.trim()}
          >
            {busy ? "Posting…" : "Submit"}
          </button>
        </div>
      </div>

      {/* Comment list — hairline-divided editorial rows, newest first */}
      {sorted === null ? (
        <div style={{ ...eyebrow }}>Loading…</div>
      ) : sorted.length === 0 ? (
        <div
          style={{
            border: "1px dashed var(--border-default)",
            borderRadius: "var(--radius-lg)",
            padding: 24,
            textAlign: "center",
            color: "var(--text-dim)",
            fontSize: "var(--fs-sm)",
          }}
        >
          No comments yet. Start a thread above.
        </div>
      ) : (
        <div
          style={{
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-lg)",
            overflow: "hidden",
            background: "var(--bg-surface)",
          }}
        >
          {sorted.map((c, i) => {
            const author = c.author_name || c.author_email || "Unknown";
            return (
              <div
                key={c.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  padding: "12px 14px",
                  borderTop: i === 0 ? "none" : "1px solid var(--border-light)",
                  opacity: c.resolved ? 0.55 : 1,
                }}
              >
                {/* Header: author · target pill · target_ref · time */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span
                    style={{
                      color: "var(--text-primary)",
                      fontSize: "var(--fs-sm)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: 220,
                    }}
                  >
                    {author}
                  </span>
                  <span
                    title={`scope: ${c.target_kind}`}
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--fs-2xs)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      color: "var(--text-muted)",
                      background: "var(--bg-elev)",
                      border: "1px solid var(--border-default)",
                      borderRadius: "var(--radius-full)",
                      padding: "2px 9px",
                    }}
                  >
                    {c.target_kind}
                  </span>
                  {c.target_ref && (
                    <span
                      title={c.target_ref}
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "var(--fs-xs)",
                        color: "var(--text-dim)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: 240,
                      }}
                    >
                      {c.target_ref}
                    </span>
                  )}
                  {c.resolved && (
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "var(--fs-2xs)",
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        color: "var(--brand-magenta)",
                        background: "color-mix(in srgb, var(--brand-magenta) 12%, transparent)",
                        border: "1px solid color-mix(in srgb, var(--brand-magenta) 30%, transparent)",
                        borderRadius: "var(--radius-full)",
                        padding: "2px 9px",
                      }}
                    >
                      resolved
                    </span>
                  )}
                  <span
                    style={{
                      marginLeft: "auto",
                      ...eyebrow,
                      fontVariantNumeric: "tabular-nums",
                    }}
                    title={new Date(c.created_at).toLocaleString()}
                  >
                    {relativeTime(c.created_at)}
                  </span>
                </div>

                {/* Body */}
                <div
                  style={{
                    color: "var(--text-primary)",
                    fontSize: "var(--fs-md)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {c.body}
                </div>

                {/* Resolve / re-open toggle */}
                <div>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => void setResolved(c, !c.resolved)}
                    style={{ color: "var(--text-dim)", padding: "4px 8px", fontSize: "var(--fs-xs)" }}
                  >
                    {c.resolved ? "Re-open" : "Mark resolved"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
