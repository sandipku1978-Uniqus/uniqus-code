"use client";

import { useEffect, useState } from "react";
import Modal from "./Modal";
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
    <Modal
      title="Checkpoints"
      subtitle="Auto-committed after every agent file edit or command. Click to rewind — your current state is saved first."
      onClose={onClose}
      width={640}
      bodyStyle={{ padding: 12 }}
      footer={
        <>
          <div className={`modal-status${error ? " error" : ""}`}>
            {error ?? `${items.length} checkpoints`}
          </div>
          <div className="modal-actions">
            <button onClick={onClose} className="btn-secondary">
              Close
            </button>
          </div>
        </>
      }
    >
      {loading ? (
        <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Loading…</div>
      ) : items.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
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
                border: "1px solid var(--border-default)",
                background: busy === c.sha ? "var(--bg-surface-hover)" : "transparent",
                color: "var(--text-primary)",
                borderRadius: 6,
                textAlign: "left",
                cursor: busy ? "default" : "pointer",
                fontSize: 12,
              }}
            >
              <code style={{ fontSize: 11, color: "var(--accent)" }}>{c.short_sha}</code>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.message}
              </span>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {new Date(c.created_at).toLocaleString()}
              </span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
