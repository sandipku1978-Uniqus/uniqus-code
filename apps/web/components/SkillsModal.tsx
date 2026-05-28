"use client";

import { useEffect, useState } from "react";
import Modal from "./Modal";
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
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  // One design pack active at a time — the API supports append, but stacking
  // packs ("retro pixel" + "liquid glass") produces contradictory guidance
  // and was confusing in the UI. The skills file is still freeform; you can
  // hand-edit it to mix concepts.
  const applyPack = async (id: string) => {
    if (packBusy) return;
    setPackBusy(id);
    setError(null);
    try {
      const r = await applySkillPackApi(projectId, id, "replace");
      setContent(r.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPackBusy(null);
    }
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
    <Modal
      title="Project Skills"
      subtitle={
        <>
          Stored at <code>.uniqus/skills.md</code> · prepended to the agent system prompt every turn
        </>
      }
      onClose={onClose}
      width={960}
      bodyStyle={{ padding: 0, display: "grid", gridTemplateColumns: "1fr 280px" }}
      footer={
        <>
          <div className={`modal-status${error ? " error" : ""}`}>
            {error ?? `${content.length.toLocaleString()} chars · max 64 KB`}
          </div>
          <div className="modal-actions">
            <button onClick={onClose} className="btn-secondary">
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
  );
}
