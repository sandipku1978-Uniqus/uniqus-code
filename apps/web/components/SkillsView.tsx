"use client";

import { useEffect, useMemo, useState } from "react";
import Modal from "./Modal";
import { toast } from "@/lib/toast";
import {
  listSkillLibrariesApi,
  createSkillLibraryApi,
  updateSkillLibraryApi,
  deleteSkillLibraryApi,
  generateSkillLibraryApi,
  fetchSkillPacksApi,
  fetchSkillPackBodyApi,
  type SkillLibrary,
  type SkillPackSummary,
} from "@/lib/api";

/**
 * Skills tab on the projects homepage. An account-level LIBRARY of reusable,
 * markdown rule-sets the user authors once and attaches to any project (via the
 * project's Skills modal). Attached skills are injected into the agent system
 * prompt ahead of the project's own .uniqus/skills.md (the override layer).
 *
 * Three ways in: write one by hand, AI-generate one from a brief (unsaved
 * draft → review in the editor → save), or add a curated starter pack from the
 * shared SKILL_PACKS catalog. Tiles mirror the projects dashboard (cover band +
 * avatar + meta) so the tab reads as part of the same surface.
 */
const MAX_BODY = 64 * 1024;

/** Deterministic hue from an id — same trick as the project tiles. */
function skillHue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

function avatarColor(id: string): string {
  return `hsl(${skillHue(id)} 55% 28%)`;
}

/** Duotone cover band, mirroring coverBackground() in ProjectPicker. */
function coverBackground(id: string): string {
  const h = skillHue(id);
  const h2 = (h + 42) % 360;
  return [
    `radial-gradient(130% 160% at 88% -30%, hsl(${h2} 72% 48% / 0.8), transparent 58%)`,
    `linear-gradient(118deg, hsl(${h} 58% 31%), hsl(${(h + 24) % 360} 54% 19%))`,
  ].join(", ");
}

function relativeTime(iso: string): string {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 604800) return `${Math.floor(sec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Editor buffer: null = closed; id null = creating a new skill. */
interface EditorState {
  id: string | null;
  name: string;
  description: string;
  body: string;
  /** Set when the buffer came from the AI generator, for the footer note. */
  fromAI?: boolean;
}

export default function SkillsView({ isGuest }: { isGuest: boolean }) {
  const [skills, setSkills] = useState<SkillLibrary[] | null>(null);
  const [packs, setPacks] = useState<SkillPackSummary[]>([]);
  const [busy, setBusy] = useState(false);

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [pristine, setPristine] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Generate-with-AI modal state.
  const [genOpen, setGenOpen] = useState(false);
  const [genBrief, setGenBrief] = useState("");
  const [genBusy, setGenBusy] = useState(false);

  // Starter-pack preview modal + per-pack busy marker for "Add to library".
  const [previewPack, setPreviewPack] = useState<{ id: string; name: string; body: string } | null>(null);
  const [packBusy, setPackBusy] = useState<string | null>(null);

  const dirty = editor !== null && `${editor.name} ${editor.description} ${editor.body}` !== pristine;

  async function load() {
    try {
      const { skills: list } = await listSkillLibrariesApi();
      setSkills(list);
    } catch (e) {
      toast.error(`Couldn't load skills: ${e instanceof Error ? e.message : String(e)}`);
      setSkills([]);
    }
  }

  useEffect(() => {
    if (isGuest) return;
    void load();
    fetchSkillPacksApi()
      .then((r) => setPacks(r.packs))
      .catch(() => setPacks([])); // packs are an enhancement — the library still works without them
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest]);

  // Pack ⇒ "already in your library" when a skill with the same name exists, so
  // the card can show Added instead of offering a duplicate copy.
  const libraryNames = useMemo(
    () => new Set((skills ?? []).map((s) => s.name.trim().toLowerCase())),
    [skills],
  );

  function openEditor(state: EditorState) {
    setEditor(state);
    setPristine(`${state.name} ${state.description} ${state.body}`);
    setConfirmDelete(false);
  }

  function requestCloseEditor() {
    if (dirty) setConfirmDiscard(true);
    else setEditor(null);
  }

  async function save() {
    if (!editor || busy) return;
    const name = editor.name.trim();
    if (!name) return toast.error("Give the skill a name first.");
    if (editor.body.length > MAX_BODY) return toast.error("Skill body exceeds the 64 KB limit.");
    setBusy(true);
    try {
      if (editor.id === null) {
        await createSkillLibraryApi({ name, description: editor.description.trim() || null, body: editor.body });
        toast.success("Skill created");
      } else {
        await updateSkillLibraryApi(editor.id, {
          name,
          description: editor.description.trim() || null,
          body: editor.body,
        });
        toast.success("Skill saved");
      }
      setEditor(null);
      await load();
    } catch (e) {
      toast.error(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function removeCurrent() {
    if (!editor?.id || busy) return;
    setBusy(true);
    try {
      await deleteSkillLibraryApi(editor.id);
      toast.success("Skill deleted");
      setConfirmDelete(false);
      setEditor(null);
      await load();
    } catch (e) {
      toast.error(`Couldn't delete: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    const brief = genBrief.trim();
    if (!brief || genBusy) return;
    setGenBusy(true);
    try {
      const { draft } = await generateSkillLibraryApi(brief);
      setGenOpen(false);
      setGenBrief("");
      // Open as an UNSAVED new-skill buffer so the user reviews before saving.
      openEditor({ id: null, name: draft.name, description: draft.description, body: draft.body, fromAI: true });
    } catch (e) {
      toast.error(`Couldn't generate: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGenBusy(false);
    }
  }

  async function addPack(pack: { id: string; name: string; summary?: string; body?: string }) {
    if (packBusy) return;
    setPackBusy(pack.id);
    try {
      const body = pack.body ?? (await fetchSkillPackBodyApi(pack.id)).body;
      const summary = pack.summary ?? packs.find((p) => p.id === pack.id)?.summary ?? null;
      await createSkillLibraryApi({ name: pack.name, description: summary, body });
      toast.success(`"${pack.name}" added to your library`);
      setPreviewPack(null);
      await load();
    } catch (e) {
      toast.error(`Couldn't add pack: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPackBusy(null);
    }
  }

  async function openPackPreview(pack: SkillPackSummary) {
    if (packBusy) return;
    setPackBusy(pack.id);
    try {
      const { body } = await fetchSkillPackBodyApi(pack.id);
      setPreviewPack({ id: pack.id, name: pack.name, body });
    } catch (e) {
      toast.error(`Couldn't load pack: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPackBusy(null);
    }
  }

  if (isGuest) {
    return (
      <div className="dash-page" style={{ maxWidth: 880 }}>
        <span className="page-eyebrow">Agent</span>
        <h1>Skills</h1>
        <div className="dash-card">
          <p className="card-sub" style={{ marginBottom: 0 }}>
            Sign in with an account to create reusable skills you can attach to any project.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="dash-page ds-page">
      <span className="page-eyebrow">Agent</span>
      <h1>Skills</h1>
      <p className="lede">
        Reusable instruction sets — coding conventions, review checklists, brand voice — you write once and
        attach to any project. Attached skills steer the agent on top of each project&apos;s own skills file.
      </p>
      <div className="skills-actions">
        <button type="button" className="btn-primary" onClick={() => setGenOpen(true)}>
          ✦ Generate with AI
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => openEditor({ id: null, name: "", description: "", body: "" })}
        >
          + New skill
        </button>
      </div>

      {/* How attached library skills get APPLIED when the agent builds a project.
          Spells out the attach→apply mental model: a skill lives in the library
          until you attach it to a project (from that project's Skills panel);
          attached bodies are injected into the system prompt BEFORE the
          project's own .uniqus/skills.md, which stays the per-project override. */}
      <div
        className="dash-card"
        style={{
          display: "grid",
          gap: 8,
          padding: "14px 16px",
          marginBottom: 8,
          borderRadius: "var(--radius-md)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: "var(--fs-sm)",
            fontWeight: 600,
            color: "var(--text-primary)",
          }}
        >
          <span aria-hidden="true" style={{ color: "var(--brand-magenta)" }}>↳</span>
          How attached skills apply
        </div>
        <p style={{ margin: 0, fontSize: "var(--fs-sm)", color: "var(--text-dim)", lineHeight: 1.55 }}>
          A skill here is just a reusable rule-set — it does nothing on its own until you{" "}
          <strong style={{ color: "var(--text-primary)", fontWeight: 600 }}>attach it to a project</strong>{" "}
          from that project&apos;s workspace Skills panel. When the agent builds, every attached skill is
          injected into its system prompt{" "}
          <strong style={{ color: "var(--text-primary)", fontWeight: 600 }}>before</strong> the project&apos;s own{" "}
          <code
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-xs)",
              color: "var(--text-muted)",
            }}
          >
            .uniqus/skills.md
          </code>
          . So attached skills set the baselines for that project, and the project&apos;s own skills file
          refines or overrides them.
        </p>
      </div>

      <div className="section-title">
        <div className="head">
          <span className="eyebrow">Your library</span>
          <h2>Your skills</h2>
        </div>
        {skills !== null && skills.length > 0 && (
          <span className="sub">
            {skills.length} skill{skills.length === 1 ? "" : "s"} · attach them from any project&apos;s Skills panel
          </span>
        )}
      </div>

      {skills === null ? (
        <div className="proj-grid" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="proj proj-tile">
              <div className="proj-cover" style={{ background: "var(--bg-surface-active)" }} />
              <div className="proj-tile-head">
                <span className="proj-avatar" style={{ background: "var(--bg-surface-active)" }} />
              </div>
              <div className="proj-tile-link">
                <h3 style={{ color: "transparent" }}>·</h3>
                <p className="desc" />
                <div className="meta" />
              </div>
            </div>
          ))}
        </div>
      ) : skills.length === 0 ? (
        <div className="dash-card skills-empty">
          <div className="skills-empty-plus" aria-hidden="true">✦</div>
          <h2>No skills yet</h2>
          <p>
            Describe the rules you keep repeating to the agent — naming conventions, a review checklist, your
            brand voice — and turn them into a skill you attach to every project. Or start from a curated pack
            below.
          </p>
          <div className="skills-actions" style={{ margin: 0 }}>
            <button type="button" className="btn-primary" onClick={() => setGenOpen(true)}>
              ✦ Generate with AI
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => openEditor({ id: null, name: "", description: "", body: "" })}
            >
              Write one by hand
            </button>
          </div>
        </div>
      ) : (
        <div className="proj-grid">
          {skills.map((s) => (
            <div key={s.id} className="proj proj-tile">
              <div className="proj-cover" style={{ background: coverBackground(s.id) }} aria-hidden="true" />
              <div className="proj-tile-head">
                <span className="proj-avatar" style={{ background: avatarColor(s.id) }}>
                  {s.name.trim().charAt(0).toUpperCase() || "·"}
                </span>
              </div>
              <button
                type="button"
                className="proj-tile-link skill-tile-btn"
                onClick={() =>
                  openEditor({ id: s.id, name: s.name, description: s.description ?? "", body: s.body })
                }
              >
                <h3>{s.name}</h3>
                <p className="desc">{s.description || "No description"}</p>
                <div className="meta">
                  <span>{(s.body.length / 1024).toFixed(1)} KB</span>
                  <span title={`Last edited ${relativeTime(s.updated_at)}`}>{relativeTime(s.updated_at)}</span>
                </div>
              </button>
            </div>
          ))}
          <button
            type="button"
            className="proj proj-tile skill-new-tile"
            onClick={() => openEditor({ id: null, name: "", description: "", body: "" })}
          >
            <span className="skill-new-plus" aria-hidden="true">+</span>
            <span className="skill-new-label">New skill</span>
            <span className="skill-new-sub">Write rules by hand or generate from a brief</span>
          </button>
        </div>
      )}

      <div className="section-title">
        <div className="head">
          <span className="eyebrow">Curated</span>
          <h2>Starter packs</h2>
        </div>
        <span className="sub">ready-made design &amp; craft guidance — add one, then tailor it</span>
      </div>
      {packs.length === 0 ? (
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Starter packs are unavailable right now.</p>
      ) : (
        <div className="pack-grid">
          {packs.map((p) => {
            const added = libraryNames.has(p.name.trim().toLowerCase());
            return (
              <div key={p.id} className="pack-card">
                <div className="pack-card-head">
                  <h3>{p.name}</h3>
                  {added && <span className="tile-chip live">✓ added</span>}
                </div>
                <p className="pack-summary">{p.summary}</p>
                <div className="pack-actions">
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => void openPackPreview(p)}
                    disabled={packBusy !== null}
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => void addPack(p)}
                    disabled={packBusy !== null || added}
                  >
                    {packBusy === p.id ? "Adding…" : added ? "In library" : "Add to library"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Editor modal (create + edit, including AI drafts) ─────────────── */}
      {editor && (
        <Modal
          title={editor.id === null ? "New skill" : "Edit skill"}
          subtitle="Plain markdown, injected into the agent's system prompt on projects it's attached to"
          width={760}
          onClose={requestCloseEditor}
          footer={
            <>
              <div className="modal-status" role="status" aria-live="polite">
                {editor.fromAI && dirty === false ? (
                  <span style={{ color: "var(--brand-magenta)" }}>AI draft — review and tweak, then save</span>
                ) : (
                  <>
                    {editor.body.length.toLocaleString()} chars · max 64 KB{dirty ? " · unsaved" : ""}
                  </>
                )}
              </div>
              <div className="modal-actions">
                {editor.id !== null && (
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ color: "var(--conf-low)" }}
                    onClick={() => setConfirmDelete(true)}
                    disabled={busy}
                  >
                    Delete
                  </button>
                )}
                <button type="button" className="btn-secondary" onClick={requestCloseEditor} disabled={busy}>
                  Cancel
                </button>
                <button type="button" className="btn-primary" onClick={() => void save()} disabled={busy}>
                  {busy ? "Saving…" : editor.id === null ? "Create skill" : "Save"}
                </button>
              </div>
            </>
          }
        >
          <div className="skill-editor-grid">
            <div className="skill-editor-row">
              <div className="skill-field">
                <label>Name</label>
                <input
                  className="ds-name"
                  value={editor.name}
                  onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                  placeholder="e.g. TypeScript conventions"
                  maxLength={120}
                />
              </div>
              <div className="skill-field">
                <label>
                  Description <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(optional)</span>
                </label>
                <input
                  className="ds-name"
                  value={editor.description}
                  onChange={(e) => setEditor({ ...editor, description: e.target.value })}
                  placeholder="One line — what this skill is for"
                  maxLength={280}
                />
              </div>
            </div>
            <div className="skill-field">
              <label>
                Skill (markdown)
                {editor.body.length > MAX_BODY && (
                  <span style={{ color: "var(--conf-low)" }}> · over the 64 KB limit</span>
                )}
              </label>
              <textarea
                className="skill-body-input"
                value={editor.body}
                onChange={(e) => setEditor({ ...editor, body: e.target.value })}
                rows={16}
                spellCheck={false}
                placeholder={"# My skill\n\n- Always …\n- Prefer …\n- Never …"}
              />
            </div>
          </div>
        </Modal>
      )}

      {/* Stacked confirms own the keyboard via the Modal stack. */}
      {confirmDiscard && (
        <Modal
          title="Discard unsaved changes?"
          width={420}
          onClose={() => setConfirmDiscard(false)}
          footer={
            <>
              <span />
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setConfirmDiscard(false)}>
                  Keep editing
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => {
                    setConfirmDiscard(false);
                    setEditor(null);
                  }}
                >
                  Discard
                </button>
              </div>
            </>
          }
        >
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-dim)" }}>
            You have unsaved edits to this skill. Closing now will lose them.
          </p>
        </Modal>
      )}

      {confirmDelete && editor?.id && (
        <Modal
          title="Delete this skill?"
          width={440}
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <span />
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setConfirmDelete(false)} disabled={busy}>
                  Cancel
                </button>
                <button type="button" className="btn-danger" onClick={() => void removeCurrent()} disabled={busy}>
                  {busy ? "Deleting…" : "Delete"}
                </button>
              </div>
            </>
          }
        >
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-dim)" }}>
            <strong>{editor.name || "This skill"}</strong> will be removed from your library and detached from
            every project that uses it. This can&apos;t be undone.
          </p>
        </Modal>
      )}

      {/* ── Generate-with-AI modal ────────────────────────────────────────── */}
      {genOpen && (
        <Modal
          title="Generate a skill"
          subtitle="Describe the guidance you want — the agent drafts it, you review before saving"
          width={560}
          onClose={() => (genBusy ? undefined : setGenOpen(false))}
          footer={
            <>
              <div className="modal-status" role="status" aria-live="polite">
                {genBusy && (
                  <span className="ds-activity" style={{ padding: 0 }}>
                    <span className="ds-spinner" /> Drafting your skill…
                  </span>
                )}
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setGenOpen(false)} disabled={genBusy}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void generate()}
                  disabled={genBusy || !genBrief.trim()}
                >
                  {genBusy ? "Generating…" : "✦ Generate"}
                </button>
              </div>
            </>
          }
        >
          <div style={{ display: "grid", gap: 10 }}>
            <textarea
              className="ds-brief"
              value={genBrief}
              onChange={(e) => setGenBrief(e.target.value)}
              maxLength={4000}
              disabled={genBusy}
              placeholder={
                "e.g. A code-review checklist for our React app: accessibility, error states, loading states, and no inline styles…"
              }
            />
            <p className="ds-hint">
              Works best with specifics: the stack, the rules you keep repeating, things the agent should never
              do. The draft opens in the editor — nothing is saved until you click Create.
            </p>
          </div>
        </Modal>
      )}

      {/* ── Starter-pack preview modal ─────────────────────────────────────── */}
      {previewPack && (
        <Modal
          title={previewPack.name}
          subtitle="Curated starter pack — add it to your library, then tailor it like any other skill"
          width={720}
          onClose={() => setPreviewPack(null)}
          footer={
            <>
              <div className="modal-status">{previewPack.body.length.toLocaleString()} chars</div>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setPreviewPack(null)}>
                  Close
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void addPack({ id: previewPack.id, name: previewPack.name, body: previewPack.body })}
                  disabled={packBusy !== null || libraryNames.has(previewPack.name.trim().toLowerCase())}
                >
                  {packBusy === previewPack.id
                    ? "Adding…"
                    : libraryNames.has(previewPack.name.trim().toLowerCase())
                      ? "In library"
                      : "Add to library"}
                </button>
              </div>
            </>
          }
        >
          <pre className="pack-preview-body">{previewPack.body}</pre>
        </Modal>
      )}
    </div>
  );
}
