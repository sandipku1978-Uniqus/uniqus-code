"use client";

import { useEffect, useState } from "react";
import {
  fetchCheckpointsApi,
  restoreCheckpointApi,
  type CheckpointMeta,
} from "@/lib/api";

/**
 * Checkpoints / rewind modal (Plan §3.5).
 *
 * Every successful write_file / edit_file / run_command auto-commits the
 * sandbox tree into a shadow git repo. This modal lets the user pick any
 * past commit and rewind to it. A "pre-restore" checkpoint is captured
 * automatically before the rewind, so the rewind is itself reversible.
 */
export default function CheckpointsModal({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<CheckpointMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let abort = false;
    (async () => {
      try {
        const r = await fetchCheckpointsApi(projectId);
        if (!abort) setItems(r.checkpoints);
      } catch (err) {
        if (!abort) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!abort) setLoading(false);
      }
    })();
    return () => {
      abort = true;
    };
  }, [projectId]);

  const onRestore = async (sha: string) => {
    if (busy) return;
    if (
      !confirm(
        `Rewind to ${sha.slice(0, 8)}? The current state will be checkpointed first so you can undo the rewind.`,
      )
    ) {
      return;
    }
    setBusy(sha);
    setError(null);
    try {
      await restoreCheckpointApi(projectId, sha);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(640px, 100%)",
          maxHeight: "80vh",
          background: "var(--bg-surface, #16161e)",
          border: "1px solid var(--border-default, #2a2a36)",
          borderRadius: 8,
          display: "grid",
          gridTemplateRows: "auto 1fr auto",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--border-default, #2a2a36)",
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 14 }}>Checkpoints</div>
          <div style={{ color: "var(--text-dim, #999)", fontSize: 11.5 }}>
            Auto-committed after every agent file edit or command. Click to rewind — your current state is saved first.
          </div>
        </div>

        <div style={{ overflow: "auto", padding: 12 }}>
          {loading ? (
            <div style={{ color: "var(--text-dim)", fontSize: 12 }}>Loading…</div>
          ) : items.length === 0 ? (
            <div style={{ color: "var(--text-dim)", fontSize: 12 }}>
              No checkpoints yet. They’ll appear here after the agent makes its first change.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 4 }}>
              {items.map((c) => (
                <button
                  key={c.sha}
                  onClick={() => onRestore(c.sha)}
                  disabled={busy === c.sha}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "70px 1fr auto",
                    gap: 10,
                    padding: "6px 10px",
                    border: "1px solid var(--border-default, #2a2a36)",
                    background: busy === c.sha ? "rgba(255,255,255,0.06)" : "transparent",
                    color: "var(--text-primary)",
                    borderRadius: 6,
                    textAlign: "left",
                    cursor: busy ? "default" : "pointer",
                    fontSize: 12,
                  }}
                >
                  <code style={{ fontSize: 11, color: "var(--accent, #a78bfa)" }}>{c.short_sha}</code>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.message}
                  </span>
                  <span style={{ fontSize: 10.5, color: "var(--text-dim)" }}>
                    {new Date(c.created_at).toLocaleString()}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div
          style={{
            padding: "10px 16px",
            borderTop: "1px solid var(--border-default, #2a2a36)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: error ? "var(--conf-low, #c0392b)" : "var(--text-dim)",
            }}
          >
            {error ?? `${items.length} checkpoints`}
          </div>
          <button
            onClick={onClose}
            className="icon-btn-sm"
            style={{ width: "auto", padding: "4px 12px" }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
