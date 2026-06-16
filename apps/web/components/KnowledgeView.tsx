"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Modal from "./Modal";
import { toast } from "@/lib/toast";
import {
  listKnowledgeDocumentsApi,
  uploadKnowledgeDocumentsApi,
  getKnowledgeDocumentApi,
  updateKnowledgeDocumentApi,
  deleteKnowledgeDocumentApi,
  downloadKnowledgeDocumentApi,
  type KnowledgeDocument,
} from "@/lib/api";

/**
 * Knowledge tab on the projects homepage. An account-level LIBRARY of documents
 * the user uploads once — regulations, standards, research papers, datasets,
 * internal policies, specs — that the agent can reference across ALL of their
 * projects via the `knowledge_search` tool (it shows up in chat like web_search).
 *
 * The raw file is stored as-is (downloadable); its text is extracted on upload
 * and that's what powers search. Tiles mirror the projects/skills dashboard so
 * the tab reads as part of the same surface.
 */

// Broad accept hint — the server stores anything, but these are the formats we
// extract searchable text from (others are kept as downloadable references).
const ACCEPT = [
  ".pdf", ".xlsx", ".xls", ".docx", ".csv", ".tsv", ".txt", ".md", ".markdown",
  ".json", ".html", ".htm", ".xml", ".yaml", ".yml", ".rtf", ".log", ".sql",
].join(",");

/** Deterministic hue from an id — same trick as the project/skill tiles. */
function docHue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}
function avatarColor(id: string): string {
  return `hsl(${docHue(id)} 55% 28%)`;
}
function coverBackground(id: string): string {
  const h = docHue(id);
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

function prettyBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Short uppercase type label from the filename extension. */
function fileTypeLabel(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  const ext = i >= 0 ? fileName.slice(i + 1).toUpperCase() : "";
  return ext || "FILE";
}

/** A line-art document glyph for the avatar — one stroke weight, no emoji. */
function DocIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="13" y2="17" />
    </svg>
  );
}

interface DetailState {
  doc: KnowledgeDocument;
  content: string | null; // null while loading
  /** True when the content fetch failed (distinct from "loaded but empty"). */
  contentError: boolean;
  title: string;
  description: string;
}

export default function KnowledgeView({ isGuest }: { isGuest: boolean }) {
  const [docs, setDocs] = useState<KnowledgeDocument[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Track nested dragenter/leave so the overlay doesn't flicker over children.
  const dragDepth = useRef(0);

  async function load() {
    setLoadError(null);
    setDocs(null);
    try {
      const { documents } = await listKnowledgeDocumentsApi();
      setDocs(documents);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Couldn't load documents: ${msg}`);
      // Keep docs null + record the error so the UI shows a retry block, not the
      // "no documents yet" empty state (which would hide the failure).
      setLoadError(msg);
    }
  }

  useEffect(() => {
    if (isGuest) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest]);

  const stats = useMemo(() => {
    const list = docs ?? [];
    const totalBytes = list.reduce((sum, d) => sum + (d.size_bytes || 0), 0);
    const searchable = list.filter((d) => d.extracted).length;
    return { count: list.length, totalBytes, searchable };
  }, [docs]);

  async function uploadFiles(files: File[]) {
    if (files.length === 0 || uploading) return;
    setUploading(true);
    try {
      const { documents } = await uploadKnowledgeDocumentsApi(files);
      const added = documents.length;
      const notIndexed = documents.filter((d) => !d.extracted).length;
      toast.success(
        `Added ${added} document${added === 1 ? "" : "s"}` +
          (notIndexed > 0 ? ` · ${notIndexed} stored but not searchable` : ""),
      );
      await load();
    } catch (e) {
      toast.error(`Upload failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (isGuest) return;
    const files = Array.from(e.dataTransfer.files ?? []);
    void uploadFiles(files);
  }

  async function openDetail(doc: KnowledgeDocument) {
    setDetail({
      doc,
      content: null,
      contentError: false,
      title: doc.title,
      description: doc.description ?? "",
    });
    setConfirmDelete(false);
    try {
      const { content } = await getKnowledgeDocumentApi(doc.id);
      setDetail((cur) =>
        cur && cur.doc.id === doc.id ? { ...cur, content, contentError: false } : cur,
      );
    } catch (e) {
      toast.error(`Couldn't open document: ${e instanceof Error ? e.message : String(e)}`);
      setDetail((cur) =>
        cur && cur.doc.id === doc.id ? { ...cur, content: "", contentError: true } : cur,
      );
    }
  }

  const detailDirty =
    detail !== null &&
    (detail.title.trim() !== detail.doc.title ||
      detail.description.trim() !== (detail.doc.description ?? ""));

  async function saveDetail() {
    if (!detail || saving) return;
    const title = detail.title.trim();
    if (!title) return toast.error("Give the document a title.");
    setSaving(true);
    try {
      const { document } = await updateKnowledgeDocumentApi(detail.doc.id, {
        title,
        description: detail.description.trim() || null,
      });
      setDocs((cur) => (cur ?? []).map((d) => (d.id === document.id ? document : d)));
      setDetail((cur) => (cur ? { ...cur, doc: document } : cur));
      toast.success("Saved");
    } catch (e) {
      toast.error(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  async function removeDoc() {
    if (!detail || saving) return;
    setSaving(true);
    try {
      await deleteKnowledgeDocumentApi(detail.doc.id);
      setDocs((cur) => (cur ?? []).filter((d) => d.id !== detail.doc.id));
      toast.success("Document removed");
      setConfirmDelete(false);
      setDetail(null);
    } catch (e) {
      toast.error(`Couldn't delete: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  if (isGuest) {
    return (
      <div className="dash-page" style={{ maxWidth: 880 }}>
        <span className="page-eyebrow">Agent</span>
        <h1>Knowledge</h1>
        <div className="dash-card">
          <p className="card-sub" style={{ marginBottom: 0 }}>
            Sign in with an account to build a Knowledge library — upload your documents once and
            the agent can reference them in any project.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="dash-page ds-page"
      onDragEnter={(e) => {
        e.preventDefault();
        dragDepth.current += 1;
        if (e.dataTransfer.types?.includes("Files")) setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        e.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={onDrop}
      style={{ position: "relative" }}
    >
      <header className="coll-head">
        <span className="page-eyebrow">Agent</span>
        <h1>
          Your <span className="grad">knowledge</span>
        </h1>
        <p className="lede">
          Upload the documents your work relies on — regulations, standards, research papers,
          datasets, internal policies. Uniqus extracts their text so the agent can search them in
          any project with the <code>knowledge_search</code> tool, right alongside your prompts.
        </p>
      </header>

      <div className="skills-actions">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          onChange={(e) => void uploadFiles(Array.from(e.target.files ?? []))}
        />
        <button
          type="button"
          className="btn-primary"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? "Uploading…" : "⬆ Upload documents"}
        </button>
        <span className="kb-accept-hint">
          PDF, Word, Excel, CSV, Markdown, text &amp; more · up to 25 MB each
        </span>
      </div>

      {docs !== null && docs.length > 0 && (
        <div className="metric-strip">
          <KbMetric value={stats.count} label="Documents" />
          <KbMetric
            value={stats.searchable}
            label="Searchable"
            dot={stats.searchable > 0 ? "live" : "dim"}
          />
          <KbMetric value={prettyBytes(stats.totalBytes)} label="Total size" />
        </div>
      )}

      <div className="section-title">
        <div className="head">
          <span className="eyebrow">Your library</span>
          <h2>Documents</h2>
        </div>
        {docs !== null && docs.length > 0 && (
          <span className="sub">
            {docs.length} document{docs.length === 1 ? "" : "s"} · available to the agent in every
            project
          </span>
        )}
      </div>

      {loadError ? (
        <div className="dash-card" style={{ textAlign: "left", padding: 24 }}>
          <p style={{ margin: "0 0 6px", color: "var(--text-primary)", fontSize: 14, fontWeight: 600 }}>
            Couldn&apos;t load your documents
          </p>
          <p style={{ margin: "0 0 14px", color: "var(--text-muted)", fontSize: 12 }}>{loadError}</p>
          <button type="button" className="btn-secondary" onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : docs === null ? (
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
      ) : docs.length === 0 ? (
        <div className="dash-card skills-empty">
          <div className="skills-empty-plus" aria-hidden="true">
            <DocIcon size={20} />
          </div>
          <h2>No documents yet</h2>
          <p>
            Drag files here, or upload the documents the agent should know about — a regulation it
            must follow, a spec to build against, a dataset to reason over. They&apos;re searchable
            from every project.
          </p>
          <div className="skills-actions" style={{ margin: 0 }}>
            <button
              type="button"
              className="btn-primary"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? "Uploading…" : "⬆ Upload documents"}
            </button>
          </div>
        </div>
      ) : (
        <div className="proj-grid">
          {docs.map((d) => (
            <div key={d.id} className="proj proj-tile">
              <div
                className="proj-cover"
                style={{ background: coverBackground(d.id) }}
                aria-hidden="true"
              >
                <span className="kb-filetype">{fileTypeLabel(d.file_name)}</span>
              </div>
              <div className="proj-tile-head">
                <span className="proj-avatar" style={{ background: avatarColor(d.id) }}>
                  <DocIcon />
                </span>
              </div>
              <button
                type="button"
                className="proj-tile-link skill-tile-btn"
                onClick={() => void openDetail(d)}
              >
                <h3>{d.title}</h3>
                <p className="desc">{d.description || d.file_name}</p>
                <div className="meta">
                  <span className="kb-meta-status">
                    <span
                      className={`metric-dot ${d.extracted ? "live" : "dim"}`}
                      aria-hidden="true"
                    />
                    {d.extracted ? "Searchable" : "Stored"}
                  </span>
                  <span title={`Uploaded ${relativeTime(d.created_at)}`}>
                    {prettyBytes(d.size_bytes)} · {relativeTime(d.created_at)}
                  </span>
                </div>
              </button>
            </div>
          ))}
          <button
            type="button"
            className="proj proj-tile skill-new-tile"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <span className="skill-new-plus" aria-hidden="true">
              +
            </span>
            <span className="skill-new-label">{uploading ? "Uploading…" : "Add documents"}</span>
            <span className="skill-new-sub">Drop files here or click to browse</span>
          </button>
        </div>
      )}

      {/* Drag-and-drop overlay */}
      {dragging && (
        <div className="kb-dropzone" aria-hidden="true">
          <div className="kb-dropzone-inner">
            <DocIcon size={26} />
            <span>Drop to add to your Knowledge library</span>
          </div>
        </div>
      )}

      {/* ── Document detail / preview modal ──────────────────────────────────── */}
      {detail && (
        <Modal
          title={detail.doc.title}
          subtitle={
            <>
              <code>{detail.doc.file_name}</code> · {prettyBytes(detail.doc.size_bytes)}
              {detail.doc.extracted ? (
                <> · {detail.doc.char_count.toLocaleString()} chars indexed</>
              ) : (
                <> · not searchable (stored for download)</>
              )}
            </>
          }
          width={820}
          onClose={() => setDetail(null)}
          footer={
            <>
              <div className="modal-status">
                <button
                  type="button"
                  className="db-ext-link"
                  onClick={() =>
                    void downloadKnowledgeDocumentApi(detail.doc.id, detail.doc.file_name)
                  }
                >
                  ↓ Download original
                </button>
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ color: "var(--conf-low)" }}
                  onClick={() => setConfirmDelete(true)}
                  disabled={saving}
                >
                  Delete
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setDetail(null)}
                  disabled={saving}
                >
                  Close
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void saveDetail()}
                  disabled={saving || !detailDirty}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </>
          }
        >
          <div className="skill-editor-grid">
            <div className="skill-editor-row">
              <div className="skill-field">
                <label>Title</label>
                <input
                  className="ds-name"
                  value={detail.title}
                  onChange={(e) => setDetail({ ...detail, title: e.target.value })}
                  placeholder="What is this document?"
                  maxLength={200}
                />
              </div>
              <div className="skill-field">
                <label>
                  Note <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(optional)</span>
                </label>
                <input
                  className="ds-name"
                  value={detail.description}
                  onChange={(e) => setDetail({ ...detail, description: e.target.value })}
                  placeholder="One line — when should the agent use it?"
                  maxLength={500}
                />
              </div>
            </div>
            <div className="skill-field">
              <label>
                Extracted text{" "}
                <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                  — what the agent searches
                </span>
              </label>
              {detail.content === null ? (
                <p className="db-empty-note">Loading…</p>
              ) : detail.contentError ? (
                <p className="db-empty-note" style={{ color: "var(--conf-medium)" }}>
                  Couldn&apos;t load the extracted text — please try again.
                </p>
              ) : detail.content.trim() ? (
                <pre className="kb-content-preview">{detail.content}</pre>
              ) : (
                <p className="db-empty-note">
                  No text could be extracted from this file, so it isn&apos;t searchable — but the
                  original is stored and downloadable.
                </p>
              )}
            </div>
          </div>
        </Modal>
      )}

      {confirmDelete && detail && (
        <Modal
          title="Delete this document?"
          width={440}
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <span />
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setConfirmDelete(false)}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => void removeDoc()}
                  disabled={saving}
                >
                  {saving ? "Deleting…" : "Delete"}
                </button>
              </div>
            </>
          }
        >
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-dim)", lineHeight: 1.6 }}>
            <strong>{detail.doc.title}</strong> will be removed from your Knowledge library and the
            agent will no longer be able to search it. This can&apos;t be undone.
          </p>
        </Modal>
      )}
    </div>
  );
}

/** One cell of the knowledge metric strip — mirrors DbMetric in DatabasesView. */
function KbMetric({
  value,
  label,
  dot,
}: {
  value: number | string;
  label: string;
  dot?: "live" | "warn" | "dim";
}) {
  return (
    <div className="metric-cell">
      <span className="metric-value">
        {dot && <span className={`metric-dot ${dot}`} aria-hidden="true" />}
        {value}
      </span>
      <span className="metric-label">{label}</span>
    </div>
  );
}
