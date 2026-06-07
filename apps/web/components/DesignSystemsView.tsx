"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  listDesignSystemsApi,
  getDesignSystemApi,
  createDesignSystemApi,
  updateDesignSystemApi,
  deleteDesignSystemApi,
  inferDesignSystemGithubApi,
  inferDesignSystemZipApi,
  fetchGithubStatus,
  fetchGithubRepos,
  githubOauthStartUrl,
  type DesignSystem,
  type DesignTokens,
  type GithubStatus,
  type GithubRepoSummary,
} from "@/lib/api";
import { DEFAULT_DESIGN_TOKENS } from "@uniqus/api-types";
import { toast } from "@/lib/toast";
import DesignSystemPreview from "./DesignSystemPreview";

/**
 * Design Systems tab on the projects page. Global, per-user, reusable token sets
 * the agent generates against. Create one (blank), infer one from a codebase
 * (a connected-GitHub repo, a public URL, or a .zip), edit its tokens with a
 * live preview, and attach it to projects from the new-project picker.
 */
type CreateMode = "blank" | "github" | "url" | "zip";

const CREATE_TABS: ReadonlyArray<readonly [CreateMode, string]> = [
  ["blank", "Blank"],
  ["github", "From GitHub"],
  ["url", "From URL"],
  ["zip", "Upload .zip"],
];

export default function DesignSystemsView({ isGuest }: { isGuest: boolean }) {
  const [systems, setSystems] = useState<DesignSystem[] | null>(null);
  const [draft, setDraft] = useState<DesignSystem | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [createMode, setCreateMode] = useState<CreateMode>("blank");
  const [repoUrl, setRepoUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Connected-GitHub state — mirrors the new-project picker so the user can
  // infer a system from a repo they already have access to (private included).
  const [github, setGithub] = useState<GithubStatus | null>(null);
  const [repos, setRepos] = useState<GithubRepoSummary[] | null>(null);
  const [selectedRepo, setSelectedRepo] = useState("");

  // Editable color rows with STABLE ids — the editor's source of truth. Keying
  // rows by a mutable color name remounts the row mid-rename (losing focus); ids
  // fix that. The canonical tokens.colors Record is rebuilt from these on change.
  const [colorRows, setColorRows] = useState<{ id: string; name: string; value: string }[]>([]);
  const idc = useRef(0);

  const load = useCallback(() => {
    listDesignSystemsApi()
      .then((r) => setSystems(r.design_systems))
      .catch((e) => {
        setSystems([]);
        toast.error(`Couldn't load design systems: ${e instanceof Error ? e.message : String(e)}`);
      });
  }, []);

  useEffect(() => {
    if (isGuest) return;
    load();
    fetchGithubStatus()
      .then(setGithub)
      .catch(() => setGithub({ connected: false, login: null, connected_at: null }));
  }, [isGuest, load]);

  // Once connected, pull the repo list so the dropdown is ready.
  useEffect(() => {
    if (isGuest || !github?.connected) return;
    fetchGithubRepos()
      .then((r) => setRepos(r.repos))
      .catch(() => setRepos([]));
  }, [github?.connected, isGuest]);

  // Rebuild editable color rows whenever a DIFFERENT system is opened (draft.id
  // changes). Editing fields on the same system keeps the id, so rows persist.
  useEffect(() => {
    if (!draft) {
      setColorRows([]);
      return;
    }
    setColorRows(
      Object.entries(draft.tokens.colors).map(([name, value]) => ({
        id: `c${idc.current++}`,
        name,
        value,
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id]);

  const select = useCallback((id: string) => {
    getDesignSystemApi(id)
      .then((r) => setDraft(r.design_system))
      .catch((e) => toast.error(e instanceof Error ? e.message : String(e)));
  }, []);

  function resetComposer() {
    setNewName("");
    setRepoUrl("");
    setSelectedRepo("");
  }

  async function create() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const { design_system } = await createDesignSystemApi(name, DEFAULT_DESIGN_TOKENS);
      resetComposer();
      load();
      setDraft(design_system);
      toast.success("Design system created");
    } catch (e) {
      toast.error(`Couldn't create: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function importFromSelectedRepo() {
    const name = newName.trim();
    if (!name) return toast.error("Give the design system a name first.");
    const repo = repos?.find((r) => r.full_name === selectedRepo);
    if (!repo) return toast.error("Pick a repository from the list.");
    setImporting(true);
    try {
      const { design_system } = await inferDesignSystemGithubApi(name, repo.clone_url, {
        useOauth: true,
      });
      resetComposer();
      load();
      setDraft(design_system);
      toast.success("Design system inferred — review and tweak the tokens.");
    } catch (e) {
      toast.error(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setImporting(false);
    }
  }

  async function importFromUrl() {
    const name = newName.trim();
    if (!name) return toast.error("Give the design system a name first.");
    if (!repoUrl.trim()) return toast.error("Enter a public GitHub repo URL.");
    setImporting(true);
    try {
      const { design_system } = await inferDesignSystemGithubApi(name, repoUrl.trim());
      resetComposer();
      load();
      setDraft(design_system);
      toast.success("Design system inferred — review and tweak the tokens.");
    } catch (e) {
      toast.error(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setImporting(false);
    }
  }

  async function importFromZip(file: File) {
    const name = newName.trim();
    if (!name) {
      toast.error("Give the design system a name first.");
      return;
    }
    setImporting(true);
    try {
      const { design_system } = await inferDesignSystemZipApi(name, file);
      resetComposer();
      load();
      setDraft(design_system);
      toast.success("Design system inferred — review and tweak the tokens.");
    } catch (e) {
      toast.error(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setImporting(false);
    }
  }

  function runCreate() {
    if (!newName.trim()) return toast.error("Give the design system a name first.");
    if (createMode === "blank") return void create();
    if (createMode === "github") return void importFromSelectedRepo();
    if (createMode === "url") return void importFromUrl();
    if (createMode === "zip") return fileRef.current?.click();
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      const { design_system } = await updateDesignSystemApi(draft.id, {
        name: draft.name,
        tokens: draft.tokens,
      });
      setDraft(design_system);
      load();
      toast.success("Saved");
    } catch (e) {
      toast.error(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await deleteDesignSystemApi(id);
      if (draft?.id === id) setDraft(null);
      load();
      toast.success("Design system deleted");
    } catch (e) {
      toast.error(`Couldn't delete: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  // ── token editing helpers (operate on draft.tokens immutably) ──
  function patchTokens(patch: Partial<DesignTokens>) {
    setDraft((d) => (d ? { ...d, tokens: { ...d.tokens, ...patch } } : d));
  }
  // Rebuild the canonical tokens.colors Record from the editable rows on every
  // change. Empty-named rows are kept in the editor but excluded from the
  // record; a later duplicate name wins (last write).
  function commitRows(rows: { id: string; name: string; value: string }[]) {
    setColorRows(rows);
    const rec: Record<string, string> = {};
    for (const r of rows) {
      const n = r.name.trim();
      if (n) rec[n] = r.value;
    }
    setDraft((d) => (d ? { ...d, tokens: { ...d.tokens, colors: rec } } : d));
  }
  function setRow(id: string, patch: Partial<{ name: string; value: string }>) {
    commitRows(colorRows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function addRow() {
    commitRows([...colorRows, { id: `c${idc.current++}`, name: "", value: "#000000" }]);
  }
  function removeRow(id: string) {
    commitRows(colorRows.filter((r) => r.id !== id));
  }

  // Shared create/import composer (gradient-framed). Used both in the empty
  // state and the right pane when nothing is selected.
  const returnTo =
    typeof window !== "undefined" ? window.location.origin + "/projects" : "/projects";
  const actionLabel =
    createMode === "blank"
      ? "Create"
      : importing
        ? "Inferring…"
        : createMode === "zip"
          ? "Choose .zip"
          : createMode === "github"
            ? "Infer from repo"
            : "Infer from URL";
  const actionDisabled =
    busy ||
    importing ||
    !newName.trim() ||
    (createMode === "github" && !selectedRepo) ||
    (createMode === "url" && !repoUrl.trim());

  function renderComposer() {
    return (
      <div className="ds-gradient-frame">
        <div className="ds-composer">
          <div className="dash-tabs ds-tabs" role="tablist" aria-label="Create method">
            {CREATE_TABS.map(([m, label]) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={createMode === m}
                onClick={() => setCreateMode(m)}
              >
                {label}
              </button>
            ))}
          </div>

          <input
            className="ds-name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && createMode === "blank") runCreate();
            }}
            placeholder="Design system name…"
            aria-label="Design system name"
          />

          {createMode === "blank" && (
            <p className="ds-hint">Starts from a sensible default palette and type you can edit.</p>
          )}

          {createMode === "github" &&
            (github?.connected ? (
              <select
                className="ds-name"
                value={selectedRepo}
                onChange={(e) => setSelectedRepo(e.target.value)}
                aria-label="Repository to infer from"
                style={{ colorScheme: "dark" }}
              >
                <option value="">
                  {repos === null ? "Loading your repos…" : "— select a repository —"}
                </option>
                {(repos ?? []).map((r) => (
                  <option key={r.full_name} value={r.full_name}>
                    {r.full_name}
                    {r.private ? " (private)" : ""}
                  </option>
                ))}
              </select>
            ) : (
              <div className="ds-connect">
                <span>Connect GitHub to infer from a repo you already have access to.</span>
                <a className="btn-primary" style={smallBtn} href={githubOauthStartUrl(returnTo)}>
                  Connect GitHub
                </a>
              </div>
            ))}

          {createMode === "url" && (
            <>
              <input
                className="ds-name"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/owner/repo"
                disabled={importing}
                aria-label="Public repository URL"
              />
              <p className="ds-hint">Reads a public repo&apos;s Tailwind/CSS/theme files and infers tokens.</p>
            </>
          )}

          {createMode === "zip" && (
            <p className="ds-hint">Upload a project .zip — we read its theme files and infer tokens you can edit.</p>
          )}

          <div className="ds-composer-actions">
            <button type="button" className="btn-primary" onClick={runCreate} disabled={actionDisabled}>
              {createMode === "blank" ? "+ " : ""}
              {actionLabel}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderEditor(d: DesignSystem) {
    return (
      <div className="ds-editor">
        <div className="dash-card ds-editor-controls">
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
            <input
              value={d.name}
              onChange={(e) => setDraft({ ...d, name: e.target.value })}
              style={{ ...inputStyle, flex: 1, fontSize: 15, fontWeight: 600 }}
              aria-label="Design system name"
            />
            <button type="button" className="btn-primary" style={smallBtn} onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className="btn-ghost"
              style={{ ...smallBtn, color: "var(--conf-medium, #d98a3d)" }}
              onClick={() => remove(d.id)}
              disabled={busy}
            >
              Delete
            </button>
          </div>

          <Field label="Mode">
            <select
              value={d.tokens.mode}
              onChange={(e) => patchTokens({ mode: e.target.value as DesignTokens["mode"] })}
              style={inputStyle}
            >
              <option value="light">light</option>
              <option value="dark">dark</option>
              <option value="system">system</option>
            </select>
          </Field>

          <Field label="Colors">
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {colorRows.map((row) => (
                <div key={row.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    value={row.name}
                    onChange={(e) => setRow(row.id, { name: e.target.value })}
                    placeholder="name"
                    style={{ ...inputStyle, width: 130 }}
                  />
                  <input
                    type="color"
                    value={normalizeHex(row.value)}
                    onChange={(e) => setRow(row.id, { value: e.target.value })}
                    style={{ width: 34, height: 28, padding: 0, border: "1px solid var(--border-default)", borderRadius: 6, background: "transparent" }}
                  />
                  <input
                    value={row.value}
                    onChange={(e) => setRow(row.id, { value: e.target.value })}
                    style={{ ...inputStyle, flex: 1, fontFamily: "ui-monospace,monospace", fontSize: 11 }}
                  />
                  <button type="button" className="btn-ghost" style={iconBtn} onClick={() => removeRow(row.id)} aria-label="Remove color">
                    ×
                  </button>
                </div>
              ))}
              <button type="button" className="btn-secondary" style={{ ...smallBtn, alignSelf: "flex-start" }} onClick={addRow}>
                + Add color
              </button>
            </div>
          </Field>

          <Field label="Fonts">
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <LabeledInput label="Body" value={d.tokens.fonts.body} onChange={(v) => patchTokens({ fonts: { ...d.tokens.fonts, body: v } })} />
              <LabeledInput label="Heading" value={d.tokens.fonts.heading} onChange={(v) => patchTokens({ fonts: { ...d.tokens.fonts, heading: v } })} />
              <LabeledInput label="Mono" value={d.tokens.fonts.mono ?? ""} onChange={(v) => patchTokens({ fonts: { ...d.tokens.fonts, mono: v } })} />
            </div>
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <Field label="Type scale">
              <input value={d.tokens.typeScale ?? ""} onChange={(e) => patchTokens({ typeScale: e.target.value })} style={inputStyle} />
            </Field>
            <Field label="Radius">
              <input value={d.tokens.radius} onChange={(e) => patchTokens({ radius: e.target.value })} style={inputStyle} />
            </Field>
            <Field label="Spacing unit">
              <input value={d.tokens.spacing ?? ""} onChange={(e) => patchTokens({ spacing: e.target.value })} style={inputStyle} />
            </Field>
          </div>

          <Field label="Notes (voice, density, motion — freeform guidance for the agent)">
            <textarea value={d.tokens.notes ?? ""} onChange={(e) => patchTokens({ notes: e.target.value })} rows={4} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }} />
          </Field>
        </div>

        <div className="ds-preview-col">
          <div className="ds-preview-label">Live preview</div>
          <DesignSystemPreview tokens={d.tokens} name={d.name} />
        </div>
      </div>
    );
  }

  // Hidden file input shared by the zip-import flow (rendered once).
  const hiddenFile = (
    <input
      ref={fileRef}
      type="file"
      accept=".zip"
      style={{ display: "none" }}
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) void importFromZip(f);
      }}
    />
  );

  if (isGuest) {
    return (
      <div className="dash-page" style={{ maxWidth: 880 }}>
        <h1>Design Systems</h1>
        <div className="dash-card">
          <p className="card-sub" style={{ marginBottom: 0 }}>
            Sign in with an account to create reusable design systems.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="dash-page ds-page">
      <h1>Design Systems</h1>
      <p className="lede">
        Reusable token sets (color, type, spacing) the agent generates against.
        Create one here, then attach it to a project from the new-project picker —
        every screen stays on-system.
      </p>
      {hiddenFile}

      {systems === null ? (
        <p style={mutedSmall}>Loading…</p>
      ) : systems.length === 0 ? (
        <div className="ds-empty">
          <div className="ds-plus" aria-hidden="true">
            <PlusIcon />
          </div>
          <h2>Create a design system</h2>
          <p>
            Reusable color, type and spacing tokens the agent builds against. Start
            from a sensible blank, or infer one from an existing codebase.
          </p>
          {renderComposer()}
        </div>
      ) : (
        <div className="ds-layout">
          <div className="dash-card ds-list">
            <div className="ds-list-head">
              <span>Your systems</span>
              <button
                type="button"
                className="btn-ghost ds-new"
                onClick={() => {
                  setDraft(null);
                  setCreateMode("blank");
                }}
              >
                + New
              </button>
            </div>
            <div className="ds-list-items">
              {systems.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => select(s.id)}
                  className={`dash-listrow${draft?.id === s.id ? " active" : ""}`}
                >
                  <span style={{ display: "flex", gap: 3 }}>
                    {Object.values(s.tokens?.colors ?? {})
                      .slice(0, 4)
                      .map((c, i) => (
                        <span
                          key={`${i}-${c}`}
                          style={{ width: 12, height: 12, borderRadius: 3, background: c, border: "1px solid var(--border-default)" }}
                        />
                      ))}
                  </span>
                  <span style={{ fontSize: 13, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.name}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="ds-main">
            {draft ? (
              renderEditor(draft)
            ) : (
              <>
                <div className="ds-main-head">
                  <h2>New design system</h2>
                  <p>Add another reusable token set — blank or inferred from a codebase.</p>
                </div>
                {renderComposer()}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PlusIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

function LabeledInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <span style={{ width: 60, fontSize: 11, color: "var(--text-muted)" }}>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
    </div>
  );
}

/**
 * <input type=color> only accepts 6-digit hex. Pass 6-digit through, expand
 * 3-digit (#fff → #ffffff), and fall back to black for non-hex (rgb()/hsl()/var)
 * — the text field beside it still holds the real value, this only feeds the swatch.
 */
function normalizeHex(v: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v;
  const m = /^#([0-9a-fA-F]{3})$/.exec(v.trim());
  if (m) {
    const [r, g, b] = m[1].split("");
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return "#000000";
}

const inputStyle: CSSProperties = {
  width: "100%",
  background: "var(--bg-dark)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-sm)",
  color: "var(--text-primary)",
  padding: "6px 8px",
  fontSize: 12.5,
  fontFamily: "inherit",
};
const smallBtn: CSSProperties = { fontSize: 12, padding: "6px 12px", whiteSpace: "nowrap" };
const iconBtn: CSSProperties = { fontSize: 16, lineHeight: 1, padding: "0 8px", color: "var(--text-muted)" };
const mutedSmall: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.6 };
