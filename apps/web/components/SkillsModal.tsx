"use client";

import { useEffect, useState } from "react";
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

  const applyPack = async (id: string, mode: "replace" | "append") => {
    if (packBusy) return;
    setPackBusy(id);
    setError(null);
    try {
      const r = await applySkillPackApi(projectId, id, mode);
      setContent(r.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPackBusy(null);
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
          width: "min(960px, 100%)",
          maxHeight: "85vh",
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
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Project Skills</div>
            <div style={{ color: "var(--text-dim, #999)", fontSize: 11.5 }}>
              Stored at <code>.uniqus/skills.md</code> · prepended to the agent system prompt every turn
            </div>
          </div>
          <button onClick={onClose} className="icon-btn-sm" title="Close">
            ✕
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 280px",
            overflow: "hidden",
            minHeight: 0,
          }}
        >
          <div style={{ padding: 16, overflow: "auto", minHeight: 0 }}>
            {loading ? (
              <div style={{ color: "var(--text-dim, #999)", fontSize: 12.5 }}>Loading…</div>
            ) : (
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={`# Project guidance for the agent\n\n- Always use Python 3.11.\n- Brand voice is dry and concise.\n- Avoid jQuery; prefer fetch + DOM APIs.\n- Bind dev servers to 0.0.0.0.`}
                style={{
                  width: "100%",
                  height: "100%",
                  minHeight: 360,
                  background: "var(--bg-base, #0d0d12)",
                  color: "var(--text-primary, #e6e6ee)",
                  border: "1px solid var(--border-default, #2a2a36)",
                  borderRadius: 6,
                  padding: 10,
                  fontFamily: "var(--mono, ui-monospace), JetBrains Mono, monospace",
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  resize: "none",
                }}
              />
            )}
          </div>
          <div
            style={{
              borderLeft: "1px solid var(--border-default, #2a2a36)",
              padding: 12,
              overflow: "auto",
              minHeight: 0,
              background: "rgba(255,255,255,0.02)",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: "var(--text-primary)" }}>
              Curated design packs
            </div>
            <div style={{ fontSize: 10.5, color: "var(--text-dim)", marginBottom: 10 }}>
              Pre-built skill markdowns. Replace or append to your current Skills.
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {packs.map((p) => (
                <div
                  key={p.id}
                  style={{
                    border: "1px solid var(--border-default, #2a2a36)",
                    borderRadius: 6,
                    padding: 10,
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{p.name}</div>
                  <div style={{ fontSize: 10.5, color: "var(--text-dim)", marginBottom: 6 }}>
                    {p.summary}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={() => applyPack(p.id, "replace")}
                      disabled={!!packBusy}
                      className="icon-btn-sm"
                      style={{ width: "auto", padding: "2px 8px", fontSize: 10.5 }}
                      title={`Replace skills with ${p.name}`}
                    >
                      Replace
                    </button>
                    <button
                      onClick={() => applyPack(p.id, "append")}
                      disabled={!!packBusy}
                      className="icon-btn-sm"
                      style={{ width: "auto", padding: "2px 8px", fontSize: 10.5 }}
                      title={`Append ${p.name} to current skills`}
                    >
                      Append
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
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
          <div style={{ fontSize: 11, color: error ? "var(--conf-low, #c0392b)" : "var(--text-dim)" }}>
            {error ?? `${content.length.toLocaleString()} chars · max 64 KB`}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} className="icon-btn-sm" style={{ width: "auto", padding: "4px 12px" }}>
              Cancel
            </button>
            <button
              onClick={onSave}
              disabled={saving || loading}
              className="send-btn"
              style={{ padding: "4px 14px" }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
