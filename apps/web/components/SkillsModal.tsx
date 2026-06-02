"use client";

import { useEffect, useRef, useState } from "react";
import Modal from "./Modal";
import { toast } from "@/lib/toast";
import {
  applySkillPackApi,
  fetchSkillPacksApi,
  fetchSkillsApi,
  writeSkillsApi,
  type SkillPackSummary,
} from "@/lib/api";

/**
 * Per-project Skills editor (Plan §3.8). The .uniqus/skills.md file in the
 * sandbox is the source of truth — this is a convenience surface so users
 * don't have to dig through the file tree to manage their project's
 * agent-steering rules.
 */
export default function SkillsModal({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [packs, setPacks] = useState<SkillPackSummary[]>([]);
  const [packBusy, setPackBusy] = useState<string | null>(null);
  // The content as loaded/last-saved, to detect unsaved edits (§D).
  const pristineRef = useRef<string>("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Pack pending confirmation before it overwrites the editor.
  const [confirmPack, setConfirmPack] = useState<string | null>(null);
  // Buffer of the editor content before a pack replaced it, for one-step undo.
  const [undoBuffer, setUndoBuffer] = useState<string | null>(null);

  const dirty = content !== pristineRef.current;

  useEffect(() => {
    let abort = false;
    (async () => {
      try {
        const [s, p] = await Promise.all([
          fetchSkillsApi(projectId),
          fetchSkillPacksApi(),
        ]);
        if (abort) return;
        setContent(s.content);
        pristineRef.current = s.content;
        setPacks(p.packs);
      } catch (err) {
        if (abort) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!abort) setLoading(false);
      }
    })();
    return () => {
      abort = true;
    };
  }, [projectId]);

  const onSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await writeSkillsApi(projectId, content);
      pristineRef.current = content;
      toast.success("Skills saved");
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error(`Couldn't save Skills: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  // Guard every close path (Cancel, Escape, backdrop) against losing edits.
  const requestClose = () => {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };

  // One design pack active at a time — the API supports append, but stacking
  // packs ("retro pixel" + "liquid glass") produces contradictory guidance
  // and was confusing in the UI. The skills file is still freeform; you can
  // hand-edit it to mix concepts.
  const applyPack = (id: string) => {
    if (packBusy) return;
    // Confirm before clobbering a non-empty editor buffer (§D).
    if (content.trim().length > 0) {
      setConfirmPack(id);
      return;
    }
    void applyPackNow(id);
  };

  const applyPackNow = async (id: string) => {
    setConfirmPack(null);
    setPackBusy(id);
    setError(null);
    try {
      const previous = content;
      const r = await applySkillPackApi(projectId, id, "replace");
      setUndoBuffer(previous);
      setContent(r.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPackBusy(null);
    }
  };

  const undoPack = () => {
    if (undoBuffer === null) return;
    setContent(undoBuffer);
    setUndoBuffer(null);
  };

  // A pack is "active" when its body header (`# Design: <Name>`) is present in
  // the current skills.md. Cheap, robust, doesn't require backend changes.
  const activePackId = (() => {
    if (!content) return null;
    for (const p of packs) {
      const header = `# Design: ${p.name}`;
      if (content.includes(header)) return p.id;
    }
    return null;
  })();

  return (
    <>
    <Modal
      title="Project Skills"
      subtitle={
        <>
          Stored at <code>.uniqus/skills.md</code> · prepended to the agent system prompt every turn
        </>
      }
      onClose={requestClose}
      width={960}
      bodyStyle={{ padding: 0, display: "grid", gridTemplateColumns: "1fr 280px" }}
      footer={
        <>
          <div
            className={`modal-status${error ? " error" : ""}`}
            role="status"
            aria-live="polite"
          >
            {error ? (
              error
            ) : undoBuffer !== null ? (
              <>
                Pack applied ·{" "}
                <button
                  type="button"
                  onClick={undoPack}
                  style={{
                    background: "none",
                    border: 0,
                    padding: 0,
                    color: "var(--accent)",
                    cursor: "pointer",
                    font: "inherit",
                    textDecoration: "underline",
                  }}
                >
                  Undo
                </button>
              </>
            ) : (
              `${content.length.toLocaleString()} chars · max 64 KB${dirty ? " · unsaved" : ""}`
            )}
          </div>
          <div className="modal-actions">
            <button onClick={requestClose} className="btn-secondary">
              Cancel
            </button>
            <button onClick={onSave} disabled={saving || loading} className="btn-primary">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </>
      }
    >
      <div style={{ padding: 16, overflow: "auto", minHeight: 0 }}>
        {loading ? (
          <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Loading…</div>
        ) : (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            aria-label="Project guidance for the agent"
            placeholder={`# Project guidance for the agent\n\n- Always use Python 3.11.\n- Brand voice is dry and concise.\n- Avoid jQuery; prefer fetch + DOM APIs.\n- Bind dev servers to 0.0.0.0.`}
            style={{
              width: "100%",
              height: "100%",
              minHeight: 360,
              background: "var(--bg-base)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-default)",
              borderRadius: 6,
              padding: 10,
              fontFamily: "var(--font-mono-stack)",
              fontSize: 12,
              lineHeight: 1.5,
              resize: "none",
            }}
          />
        )}
      </div>
      <div
        style={{
          borderLeft: "1px solid var(--border-default)",
          padding: 12,
          overflow: "auto",
          minHeight: 0,
          background: "rgba(255,255,255,0.02)",
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: "var(--text-primary)" }}>
          Curated design packs
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10 }}>
          Pick one. Applying replaces the current Skills file with that
          pack&apos;s body — you can hand-edit afterwards.
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {packs.map((p) => {
            const isActive = activePackId === p.id;
            return (
              <div
                key={p.id}
                style={{
                  border: isActive
                    ? "1px solid var(--accent)"
                    : "1px solid var(--border-default)",
                  borderRadius: 6,
                  padding: 10,
                  background: isActive ? "rgba(178,30,125,0.08)" : undefined,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {p.name}
                  {isActive && (
                    <span
                      style={{
                        fontSize: 10,
                        color: "var(--accent)",
                        border: "1px solid var(--accent)",
                        borderRadius: 3,
                        padding: "0 4px",
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                      }}
                    >
                      Active
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
                  {p.summary}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => applyPack(p.id)}
                    disabled={!!packBusy || isActive}
                    className="btn-secondary"
                    style={{ padding: "3px 10px", fontSize: 11 }}
                    title={
                      isActive
                        ? `${p.name} is already active`
                        : `Apply ${p.name} (replaces current Skills)`
                    }
                  >
                    {isActive ? "Active" : packBusy === p.id ? "Applying…" : "Apply"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>

    {confirmDiscard && (
      <Modal
        title="Discard unsaved changes?"
        width={420}
        onClose={() => setConfirmDiscard(false)}
        footer={
          <>
            <span />
            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setConfirmDiscard(false)}
              >
                Keep editing
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={() => {
                  setConfirmDiscard(false);
                  onClose();
                }}
              >
                Discard
              </button>
            </div>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-dim)" }}>
          You have unsaved edits to your Skills. Closing now will lose them.
        </p>
      </Modal>
    )}

    {confirmPack && (
      <Modal
        title="Replace your Skills?"
        width={460}
        onClose={() => setConfirmPack(null)}
        footer={
          <>
            <span />
            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setConfirmPack(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => applyPackNow(confirmPack)}
              >
                Replace
              </button>
            </div>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-dim)" }}>
          Applying the{" "}
          <strong>{packs.find((p) => p.id === confirmPack)?.name ?? "selected"}</strong> pack
          overwrites everything currently in the editor. You can undo it right after, and
          nothing is saved until you click Save.
        </p>
      </Modal>
    )}
    </>
  );
}
