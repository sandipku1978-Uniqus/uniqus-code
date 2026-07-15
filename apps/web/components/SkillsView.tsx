"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { skillInvocationName } from "@gate15/api-types";
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
  fetchAccountSettingsApi,
  updateAccountSettingsApi,
  type SkillLibrary,
  type SkillPackSummary,
} from "@/lib/api";

/**
 * Skills tab on the projects homepage. An account-level library of reusable,
 * SKILL.md-compatible instruction sets. Attached skills advertise compact
 * metadata; the agent loads a matching body on demand ahead of the project's
 * own .uniqus/skills.md (the always-on override layer).
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

/**
 * Parse an imported skill file into name/description/body. Supports the standard
 * skill format — a `.md` (or `.txt`/SKILL.md) file with YAML frontmatter
 * (`---\nname: …\ndescription: …\n---`), including folded/literal multiline
 * descriptions. Missing metadata is returned empty so import can explain that
 * modern skills require it.
 */
function parseSkillFile(
  filename: string,
  text: string,
): { name: string; description: string; body: string } {
  const fallbackName = filename.replace(/\.(md|markdown|txt)$/i, "").replace(/[-_]+/g, " ").trim();
  const fm = text.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fm) return { name: fallbackName, description: "", body: text.trim() };
  const [, front, rest] = fm;
  const field = (key: string): string => {
    const lines = front.split(/\r?\n/);
    const index = lines.findIndex((line) => new RegExp(`^${key}\\s*:`, "i").test(line));
    if (index < 0) return "";
    const match = lines[index].match(new RegExp(`^${key}\\s*:\\s*(.*)$`, "i"));
    if (!match) return "";
    const raw = match[1].trim();
    if (raw === ">" || raw === "|") {
      const continuation: string[] = [];
      for (let i = index + 1; i < lines.length && /^\s+/.test(lines[i]); i++) {
        continuation.push(lines[i].trim());
      }
      return (raw === ">" ? continuation.join(" ") : continuation.join("\n")).trim();
    }
    // Strip surrounding quotes a YAML string may carry.
    return raw.replace(/^["']|["']$/g, "").trim();
  };
  const name = field("name") || fallbackName;
  const description = field("description");
  return { name, description, body: rest.trim() || text.trim() };
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
  // Library skill ids marked "use on every new project" (account default_skill_
  // library_ids). A default skill is auto-attached to new projects, so it's
  // active on the first turn without re-selecting it.
  const [defaultIds, setDefaultIds] = useState<string[]>([]);
  const [defaultBusy, setDefaultBusy] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    // Which library skills are the account's "every new project" defaults.
    fetchAccountSettingsApi()
      .then((r) => setDefaultIds(r.settings.default_skill_library_ids ?? []))
      .catch(() => setDefaultIds([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest]);

  const defaultSet = useMemo(() => new Set(defaultIds), [defaultIds]);

  /** Toggle a skill as an every-new-project default; persists to account settings. */
  async function toggleDefault(id: string) {
    if (defaultBusy) return;
    const next = defaultSet.has(id) ? defaultIds.filter((x) => x !== id) : [...defaultIds, id];
    setDefaultBusy(id);
    // Optimistic — revert on failure.
    const prev = defaultIds;
    setDefaultIds(next);
    try {
      const { settings } = await updateAccountSettingsApi({ default_skill_library_ids: next });
      setDefaultIds(settings.default_skill_library_ids ?? next);
      toast.success(
        next.includes(id) ? "Added to every new project" : "Removed from new-project defaults",
      );
    } catch (e) {
      setDefaultIds(prev);
      toast.error(`Couldn't update default: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDefaultBusy(null);
    }
  }

  /** Import a skill from a .md file (optional frontmatter → name/description). */
  async function handleImportFiles(files: FileList | null) {
    if (!files || files.length === 0 || importBusy) return;
    setImportBusy(true);
    let created = 0;
    try {
      for (const file of Array.from(files)) {
        const text = await file.text();
        if (text.length > MAX_BODY) {
          toast.error(`"${file.name}" exceeds the 64 KB limit — skipped`);
          continue;
        }
        const parsed = parseSkillFile(file.name, text);
        if (!parsed.name.trim() || !parsed.description.trim() || !parsed.body.trim()) {
          toast.error(`"${file.name}" needs name and description frontmatter plus instructions — skipped`);
          continue;
        }
        await createSkillLibraryApi({
          name: parsed.name.slice(0, 120),
          description: parsed.description.slice(0, 280) || null,
          body: parsed.body,
        });
        created++;
      }
      if (created > 0) {
        toast.success(`Imported ${created} skill${created === 1 ? "" : "s"}`);
        await load();
      }
    } catch (e) {
      toast.error(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setImportBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

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
    const description = editor.description.trim();
    if (!description) return toast.error("Add a description so the agent knows when to load this skill.");
    if (editor.body.length > MAX_BODY) return toast.error("Skill body exceeds the 64 KB limit.");
    setBusy(true);
    try {
      if (editor.id === null) {
        await createSkillLibraryApi({ name, description, body: editor.body });
        toast.success("Skill created");
      } else {
        await updateSkillLibraryApi(editor.id, {
          name,
          description,
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

  function exportCurrent() {
    if (!editor) return;
    const yamlString = (value: string): string => JSON.stringify(value.trim());
    const content = [
      "---",
      `name: ${yamlString(editor.name)}`,
      `description: ${yamlString(editor.description)}`,
      "---",
      "",
      editor.body.trim(),
      "",
    ].join("\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "SKILL.md";
    anchor.click();
    URL.revokeObjectURL(url);
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
        Reusable, SKILL.md-compatible expertise you attach to projects. The agent discovers skills by name and
        description, then loads the full instructions only when a task matches or you invoke one explicitly.
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
        <button
          type="button"
          className="btn-secondary"
          onClick={() => fileInputRef.current?.click()}
          disabled={importBusy}
          title="Import a SKILL.md with required name and description frontmatter"
        >
          {importBusy ? "Importing…" : "↑ Import skill"}
        </button>
        {/* Hidden file input backing the Import button. Accepts the standard
            skill file formats (.md / .markdown / .txt, incl. a SKILL.md). */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.markdown,.txt,text/markdown,text/plain"
          multiple
          style={{ display: "none" }}
          onChange={(e) => void handleImportFiles(e.target.files)}
        />
      </div>

      {/* Attach → discover → load, with .uniqus/skills.md as always-on guidance. */}
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
          <span aria-hidden="true" style={{ color: "var(--accent-text)" }}>↳</span>
          How modern skills apply
        </div>
        <p style={{ margin: 0, fontSize: "var(--fs-sm)", color: "var(--text-dim)", lineHeight: 1.55 }}>
          A skill becomes available after you{" "}
          <strong style={{ color: "var(--text-primary)", fontWeight: 600 }}>attach it to a project</strong>{" "}
          from the workspace Skills panel. Its name and description stay discoverable; the agent loads the full
          instructions only when the task matches. To invoke one explicitly, type <code>$skill-name</code> in chat.
          Skills use <code>$</code>; <code>/name</code> is reserved for commands. This keeps context
          focused. The project&apos;s own{" "}
          <code
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-xs)",
              color: "var(--text-muted)",
            }}
          >
            .uniqus/skills.md
          </code>
          {" "}file remains always-on and can refine loaded skills.
        </p>
      </div>

      <div className="section-title">
        <div className="head">
          <span className="eyebrow">Your library</span>
          <h2>Your skills</h2>
        </div>
        {skills !== null && skills.length > 0 && (
          <span className="sub">
            {skills.length} skill{skills.length === 1 ? "" : "s"} · attach from any project&apos;s Skills panel, or
            tap the ★ on a skill to <strong>auto-apply it to every new project</strong> — so it&apos;s already
            active on the first turn, no re-attaching
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
          {skills.map((s) => {
            const isDefault = defaultSet.has(s.id);
            const invocation = `$${skillInvocationName(s.name)}`;
            return (
              <div key={s.id} className="proj proj-tile">
                <div className="proj-cover" style={{ background: coverBackground(s.id) }} aria-hidden="true" />
                <div className="proj-tile-head">
                  <span className="proj-avatar" style={{ background: avatarColor(s.id) }}>
                    {s.name.trim().charAt(0).toUpperCase() || "·"}
                  </span>
                  {/* "Auto-apply to every new project" toggle — a star that
                      persists to the account's default_skill_library_ids. The
                      label spells out what the star does so it doesn't read as a
                      bare "favorite" (item 11). */}
                  <button
                    type="button"
                    className="skill-default-star"
                    data-on={isDefault ? "true" : "false"}
                    disabled={defaultBusy === s.id}
                    onClick={() => void toggleDefault(s.id)}
                    aria-pressed={isDefault}
                    aria-label={
                      isDefault
                        ? "Auto-applied to every new project — click to stop"
                        : "Auto-apply this skill to every new project"
                    }
                    title={
                      isDefault
                        ? "Auto-applied to every new project — click to stop"
                        : "Auto-apply to every new project (active on the first turn, no re-attaching)"
                    }
                  >
                    <span aria-hidden>{isDefault ? "★" : "☆"}</span>
                    <span className="skill-default-star-label">
                      {isDefault ? "Auto-applied" : "Auto-apply"}
                    </span>
                  </button>
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
                  <div className="skill-invocation-hint">
                    <span>Use in chat</span>
                    <code>{invocation}</code>
                  </div>
                  <div className="meta">
                    {isDefault && <span className="tile-chip live">★ Auto-applied to new projects</span>}
                    <span>{(s.body.length / 1024).toFixed(1)} KB</span>
                    <span title={`Last edited ${relativeTime(s.updated_at)}`}>{relativeTime(s.updated_at)}</span>
                  </div>
                </button>
              </div>
            );
          })}
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
          subtitle="SKILL.md compatible · discovered by metadata and loaded only when relevant"
          width={760}
          onClose={requestCloseEditor}
          footer={
            <>
              <div className="modal-status" role="status" aria-live="polite">
                {editor.fromAI && dirty === false ? (
                  <span style={{ color: "var(--accent-text)" }}>AI draft — review and tweak, then save</span>
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
                <button type="button" className="btn-ghost" onClick={exportCurrent} disabled={busy}>
                  Export SKILL.md
                </button>
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
                <label htmlFor="skill-editor-name">Name</label>
                <input
                  id="skill-editor-name"
                  className="ds-name"
                  value={editor.name}
                  onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                  placeholder="e.g. TypeScript conventions"
                  maxLength={120}
                />
              </div>
              <div className="skill-field">
                <label htmlFor="skill-editor-description">
                  Description{" "}
                  <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(required trigger metadata)</span>
                </label>
                <input
                  id="skill-editor-description"
                  className="ds-name"
                  value={editor.description}
                  onChange={(e) => setEditor({ ...editor, description: e.target.value })}
                  placeholder="What it does and when the agent should load it"
                  maxLength={280}
                />
              </div>
            </div>
            <div className="skill-field">
              <label htmlFor="skill-editor-body">
                Skill (markdown)
                {editor.body.length > MAX_BODY && (
                  <span style={{ color: "var(--conf-low)" }}> · over the 64 KB limit</span>
                )}
              </label>
              <textarea
                id="skill-editor-body"
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
              aria-label="Describe the skill to generate"
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
