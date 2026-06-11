"use client";

import { useEffect, useMemo, useState } from "react";
import Modal from "./Modal";
import { toast } from "@/lib/toast";
import {
  fetchCheckpointsApi,
  fetchCheckpointDiffApi,
  restoreCheckpointApi,
  type CheckpointMeta,
  type CheckpointFileDelta,
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
  const [query, setQuery] = useState("");
  // Modal-based confirm (replaces the native window.confirm — UI/UX audit §D).
  const [pendingRestore, setPendingRestore] = useState<CheckpointMeta | null>(null);
  // Diff viewer (C6-Tier2): the change a checkpoint introduced.
  const [diffFor, setDiffFor] = useState<CheckpointMeta | null>(null);
  const [diff, setDiff] = useState<{ diff: string; truncated: boolean; files: CheckpointFileDelta[] } | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  const openDiff = async (c: CheckpointMeta) => {
    setDiffFor(c);
    setDiff(null);
    setDiffLoading(true);
    try {
      const r = await fetchCheckpointDiffApi(projectId, c.sha);
      setDiff({ diff: r.diff, truncated: r.truncated, files: r.files });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't load diff");
      setDiffFor(null);
    } finally {
      setDiffLoading(false);
    }
  };

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

  const doRestore = async (sha: string) => {
    if (busy) return;
    setPendingRestore(null);
    setBusy(sha);
    setError(null);
    try {
      await restoreCheckpointApi(projectId, sha);
      toast.success(`Rewound to ${sha.slice(0, 8)}`);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error(`Rewind failed: ${msg}`);
    } finally {
      setBusy(null);
    }
  };

  // Filter (client-side) then group by calendar day so a long list is navigable.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? items.filter(
          (c) =>
            c.message.toLowerCase().includes(q) || c.short_sha.toLowerCase().includes(q),
        )
      : items;
    const out: { label: string; items: CheckpointMeta[] }[] = [];
    for (const c of filtered) {
      const label = dayLabel(new Date(c.created_at));
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(c);
      else out.push({ label, items: [c] });
    }
    return out;
  }, [items, query]);

  return (
    <>
      <Modal
        title="Checkpoints"
        subtitle="Auto-committed after every agent file edit or command. Click to rewind — your current state is saved first."
        onClose={onClose}
        width={640}
        bodyStyle={{ padding: 12 }}
        footer={
          <>
            <div
              className={`modal-status${error ? " error" : ""}`}
              role="status"
              aria-live="polite"
            >
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
          <>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search checkpoints…"
              aria-label="Search checkpoints"
              className="ckpt-search"
            />
            {groups.length === 0 ? (
              <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                No checkpoints match “{query}”.
              </div>
            ) : (
              groups.map((g) => (
                <div key={g.label}>
                  <div className="ckpt-day">{g.label}</div>
                  <div style={{ display: "grid", gap: 4, marginBottom: 8 }}>
                    {g.items.map((c) => (
                      <div
                        key={c.sha}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "70px 1fr auto auto",
                          alignItems: "center",
                          gap: 10,
                          padding: "6px 10px",
                          border: "1px solid var(--border-default)",
                          background:
                            busy === c.sha ? "var(--bg-surface-hover)" : "transparent",
                          borderRadius: 6,
                          fontSize: 12,
                        }}
                      >
                        <code style={{ fontSize: 11, color: "var(--accent)" }}>
                          {c.short_sha}
                        </code>
                        <button
                          type="button"
                          onClick={() => openDiff(c)}
                          title="See what this checkpoint changed"
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            textAlign: "left",
                            background: "transparent",
                            border: "none",
                            color: "var(--text-primary)",
                            cursor: "pointer",
                            padding: 0,
                          }}
                        >
                          {c.message}
                        </button>
                        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          {relTime(new Date(c.created_at))}
                        </span>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => setPendingRestore(c)}
                          disabled={busy === c.sha}
                          title="Rewind the sandbox to this checkpoint"
                          style={{ fontSize: 11, padding: "3px 9px" }}
                        >
                          Rewind
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </Modal>

      {pendingRestore && (
        <Modal
          title="Rewind to this checkpoint?"
          width={460}
          onClose={() => setPendingRestore(null)}
          footer={
            <>
              <span className="modal-status">
                Your current state is checkpointed first, so this is reversible.
              </span>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setPendingRestore(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => doRestore(pendingRestore.sha)}
                >
                  Rewind
                </button>
              </div>
            </>
          }
        >
          <div style={{ fontSize: 13, color: "var(--text-primary)", display: "grid", gap: 6 }}>
            <div>
              <code style={{ color: "var(--accent)" }}>{pendingRestore.short_sha}</code> ·{" "}
              {new Date(pendingRestore.created_at).toLocaleString()}
            </div>
            <div style={{ color: "var(--text-dim)" }}>{pendingRestore.message}</div>
            <div style={{ color: "var(--text-dim)", marginTop: 4 }}>
              The sandbox files will be rewound to this point. Your current state is
              checkpointed first so you can undo the rewind.
            </div>
          </div>
        </Modal>
      )}

      {diffFor && (
        <Modal
          title="What changed"
          subtitle={diffFor.message}
          width={760}
          onClose={() => setDiffFor(null)}
          bodyStyle={{ padding: 12 }}
          footer={
            <>
              <span className="modal-status">
                {diff
                  ? `${diff.files.length} file${diff.files.length === 1 ? "" : "s"} changed${diff.truncated ? " (diff truncated)" : ""}`
                  : ""}
              </span>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setDiffFor(null)}>
                  Close
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    const c = diffFor;
                    setDiffFor(null);
                    setPendingRestore(c);
                  }}
                >
                  Rewind to here
                </button>
              </div>
            </>
          }
        >
          {diffLoading ? (
            <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Loading diff…</div>
          ) : !diff ? (
            <div style={{ color: "var(--text-muted)", fontSize: 12 }}>No diff available.</div>
          ) : diff.files.length === 0 ? (
            <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
              This checkpoint didn’t change any files.
            </div>
          ) : (
            <>
              <div className="changed-list" style={{ marginBottom: 10, paddingLeft: 0 }}>
                {diff.files.map((f) => (
                  <div
                    key={f.path}
                    style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}
                  >
                    <code className="changed-path">{f.path}</code>
                    <span className="changed-diff">
                      <span className="add">+{f.added}</span>{" "}
                      <span className="rem">−{f.removed}</span>
                    </span>
                  </div>
                ))}
              </div>
              <DiffView text={diff.diff} />
            </>
          )}
        </Modal>
      )}
    </>
  );
}

/** Minimal colorized unified-diff renderer (no dependency). */
function DiffView({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <pre
      style={{
        margin: 0,
        padding: 10,
        background: "var(--bg-code)",
        borderRadius: 6,
        fontSize: 11.5,
        lineHeight: 1.5,
        maxHeight: 420,
        overflow: "auto",
        whiteSpace: "pre",
      }}
    >
      {lines.map((ln, i) => {
        const color = ln.startsWith("+") && !ln.startsWith("+++")
          ? "var(--conf-high, #3ea76a)"
          : ln.startsWith("-") && !ln.startsWith("---")
            ? "var(--conf-low, #d9534f)"
            : ln.startsWith("@@")
              ? "var(--accent, #a78bfa)"
              : ln.startsWith("diff ") || ln.startsWith("index ") || ln.startsWith("+++") || ln.startsWith("---")
                ? "var(--text-dim)"
                : "var(--text-muted)";
        return (
          <div key={i} style={{ color }}>
            {ln || " "}
          </div>
        );
      })}
    </pre>
  );
}

/** "Today" / "Yesterday" / a locale date for grouping checkpoints by day. */
function dayLabel(d: Date): string {
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Compact relative time: "just now", "5m ago", "3h ago", else a short date. */
function relTime(d: Date): string {
  const secs = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
