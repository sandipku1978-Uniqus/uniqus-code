"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  listDesignSystemsApi,
  getDesignSystemApi,
  createDesignSystemApi,
  updateDesignSystemApi,
  deleteDesignSystemApi,
  analyzeDesignSystemApi,
  tweakDesignSystemApi,
  fetchProjects,
  fetchGithubStatus,
  fetchGithubRepos,
  githubOauthStartUrl,
  fetchFigmaStatus,
  figmaOauthStartUrl,
  type DesignSystem,
  type DesignTokens,
  type DesignFindings,
  type GithubStatus,
  type GithubRepoSummary,
  type FigmaStatus,
} from "@/lib/api";
import type { ProjectSummary } from "@uniqus/api-types";
import {
  DEFAULT_DESIGN_TOKENS,
  type DesignComponentTokens,
  type ButtonVariantSpec,
} from "@uniqus/api-types";
import { toast } from "@/lib/toast";
import DesignSystemPreview from "./DesignSystemPreview";

/**
 * Design Systems tab. Agent-driven: pick a source (a brief + reference images, an
 * existing project, a public/private GitHub repo, a live URL, a .zip, or Figma),
 * the agent analyzes it into an UNSAVED draft + a findings breakdown you approve
 * or deny per-category, refine with AI at any time, then save. A saved system can
 * be re-opened, refined, and edited; attach it to a project from the new-project
 * picker so the coding agent generates on-system.
 */
type CreateMode =
  | "describe"
  | "blank"
  | "project"
  | "github"
  | "publicgithub"
  | "url"
  | "zip"
  | "figma";

const CREATE_TABS: ReadonlyArray<readonly [CreateMode, string]> = [
  ["describe", "Describe"],
  ["blank", "Blank"],
  ["project", "From Project"],
  ["github", "Private GitHub"],
  ["publicgithub", "Public GitHub"],
  ["url", "Live URL"],
  ["zip", "Upload .zip"],
  ["figma", "Figma"],
];

type ApproveState = {
  colors: boolean;
  typography: boolean;
  components: boolean;
  spacing: boolean;
  notes: boolean;
};
const ALL_APPROVED: ApproveState = {
  colors: true,
  typography: true,
  components: true,
  spacing: true,
  notes: true,
};

export default function DesignSystemsView({ isGuest }: { isGuest: boolean }) {
  const [systems, setSystems] = useState<DesignSystem[] | null>(null);
  // The working editor doc. id === "" means an unsaved draft under review.
  const [draft, setDraft] = useState<DesignSystem | null>(null);
  const [reviewFindings, setReviewFindings] = useState<DesignFindings | null>(null);
  const [approved, setApproved] = useState<ApproveState>(ALL_APPROVED);
  const [creating, setCreating] = useState(false);
  const [draftNonce, setDraftNonce] = useState(0);

  // Composer state
  const [createMode, setCreateMode] = useState<CreateMode>("describe");
  const [newName, setNewName] = useState("");
  const [describeText, setDescribeText] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [repoUrl, setRepoUrl] = useState("");
  const [liveUrl, setLiveUrl] = useState("");
  const [figmaUrl, setFigmaUrl] = useState("");
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [selectedProject, setSelectedProject] = useState("");
  const [selectedRepo, setSelectedRepo] = useState("");

  const [busy, setBusy] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeActivity, setAnalyzeActivity] = useState("");
  const [refining, setRefining] = useState(false);
  const [refineText, setRefineText] = useState("");
  // Per-item approve flags for the discovered component catalog (parallel to
  // draft.tokens.components.catalog). Rebuilt whenever a new draft loads.
  const [approvedCatalog, setApprovedCatalog] = useState<boolean[]>([]);

  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);

  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [github, setGithub] = useState<GithubStatus | null>(null);
  const [repos, setRepos] = useState<GithubRepoSummary[] | null>(null);
  const [figma, setFigma] = useState<FigmaStatus | null>(null);

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
    fetchProjects().then((r) => setProjects(r.projects)).catch(() => setProjects([]));
    fetchGithubStatus()
      .then(setGithub)
      .catch(() => setGithub({ connected: false, login: null, connected_at: null }));
    fetchFigmaStatus()
      .then(setFigma)
      .catch(() => setFigma({ connected: false, handle: null, connected_at: null }));
  }, [isGuest, load]);

  useEffect(() => {
    if (isGuest || !github?.connected) return;
    fetchGithubRepos()
      .then((r) => setRepos(r.repos))
      .catch(() => setRepos([]));
  }, [github?.connected, isGuest]);

  // Surface the Figma OAuth round-trip when it redirects back to /projects.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const result = params.get("figma");
    if (!result) return;
    if (result === "connected") {
      toast.success("Figma connected");
      fetchFigmaStatus().then(setFigma).catch(() => {});
      setCreateMode("figma");
    } else if (result === "error") {
      toast.error(`Couldn't connect Figma${params.get("reason") ? `: ${params.get("reason")}` : ""}`);
    }
    params.delete("figma");
    params.delete("reason");
    const qs = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
  }, []);

  // Auto-open the most recent system so the page lands on something useful.
  useEffect(() => {
    if (!systems || systems.length === 0 || draft || creating) return;
    select(systems[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systems, draft, creating]);

  // Rebuild editable color rows whenever a brand-new draft is loaded.
  useEffect(() => {
    if (!draft) {
      setColorRows([]);
      setApprovedCatalog([]);
      return;
    }
    setColorRows(
      Object.entries(draft.tokens.colors).map(([name, value]) => ({
        id: `c${idc.current++}`,
        name,
        value,
      })),
    );
    setApprovedCatalog((draft.tokens.components?.catalog ?? []).map(() => true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftNonce]);

  function openDraft(ds: DesignSystem, findings: DesignFindings | null) {
    setDraft(ds);
    setReviewFindings(findings);
    setApproved(ALL_APPROVED);
    setCreating(false);
    setRefineText("");
    setDraftNonce((n) => n + 1);
  }

  const select = useCallback((id: string) => {
    getDesignSystemApi(id)
      .then((r) => openDraft(r.design_system, null))
      .catch((e) => toast.error(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetComposer() {
    setNewName("");
    setDescribeText("");
    setImages([]);
    setRepoUrl("");
    setLiveUrl("");
    setFigmaUrl("");
    setZipFile(null);
    setSelectedProject("");
    setSelectedRepo("");
  }

  async function createBlank() {
    if (busy || analyzing) return; // re-entry guard (C-26): keyboard paths bypass the disabled button
    const name = newName.trim();
    if (!name) return toast.error("Give the design system a name first.");
    setBusy(true);
    try {
      const { design_system } = await createDesignSystemApi(name, DEFAULT_DESIGN_TOKENS);
      resetComposer();
      load();
      openDraft(design_system, null);
      toast.success("Design system created");
    } catch (e) {
      toast.error(`Couldn't create: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function runCreate() {
    if (busy || analyzing) return; // re-entry guard (C-26): Cmd/Ctrl+Enter bypasses the disabled button
    if (createMode === "blank") return void createBlank();

    const fd = new FormData();
    if (createMode === "describe") {
      if (!describeText.trim() && images.length === 0) {
        return toast.error("Describe the system or attach a reference image/PDF.");
      }
      fd.set("source", "brief");
      if (describeText.trim()) fd.set("brief", describeText.trim());
      images.forEach((f) => fd.append("file", f));
    } else if (createMode === "project") {
      if (!selectedProject) return toast.error("Pick a project.");
      fd.set("source", "project");
      fd.set("project_id", selectedProject);
    } else if (createMode === "github") {
      const repo = repos?.find((r) => r.full_name === selectedRepo);
      if (!repo) return toast.error("Pick a repository from the list.");
      fd.set("source", "github");
      fd.set("repo_url", repo.clone_url);
      fd.set("repo_full_name", repo.full_name);
      fd.set("use_oauth", "true");
    } else if (createMode === "publicgithub") {
      if (!repoUrl.trim()) return toast.error("Enter a public GitHub repo URL.");
      fd.set("source", "github");
      fd.set("repo_url", repoUrl.trim());
      fd.set("use_oauth", "false");
    } else if (createMode === "url") {
      if (!liveUrl.trim()) return toast.error("Enter a website URL.");
      fd.set("source", "url");
      fd.set("url", liveUrl.trim());
    } else if (createMode === "zip") {
      if (!zipFile) return toast.error("Choose a .zip file.");
      fd.set("source", "zip");
      fd.append("file", zipFile);
    } else if (createMode === "figma") {
      if (!figmaUrl.trim()) return toast.error("Paste a Figma file URL.");
      fd.set("source", "figma");
      fd.set("url", figmaUrl.trim());
    }

    setAnalyzing(true);
    setAnalyzeActivity("");
    try {
      const { draft: d } = await analyzeDesignSystemApi(fd, (m) => setAnalyzeActivity(m));
      const name = newName.trim() || d.name;
      openDraft({ id: "", name, tokens: d.tokens, created_at: "", updated_at: "" }, d.findings);
      toast.success("Draft ready — review the findings, refine, then save.");
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes("github_not_connected")) toast.error("Connect GitHub first (Settings → GitHub).");
      else if (m.includes("figma_not_connected")) toast.error("Connect Figma first.");
      else toast.error(`Analyze failed: ${m}`);
    } finally {
      setAnalyzing(false);
      setAnalyzeActivity("");
    }
  }

  async function approveDraft() {
    if (!draft) return;
    let t = draft.tokens;
    if (!approved.colors) t = { ...t, colors: DEFAULT_DESIGN_TOKENS.colors };
    if (!approved.typography) t = { ...t, fonts: DEFAULT_DESIGN_TOKENS.fonts, typeScale: DEFAULT_DESIGN_TOKENS.typeScale };
    if (!approved.spacing) t = { ...t, radius: DEFAULT_DESIGN_TOKENS.radius, spacing: DEFAULT_DESIGN_TOKENS.spacing };
    if (!approved.components) t = { ...t, components: DEFAULT_DESIGN_TOKENS.components };
    if (!approved.notes) t = { ...t, notes: "" };
    // Keep only the catalog components the user approved.
    if (t.components?.catalog && t.components.catalog.length && approvedCatalog.length) {
      const kept = t.components.catalog.filter((_, i) => approvedCatalog[i] !== false);
      t = { ...t, components: { ...t.components, catalog: kept.length ? kept : undefined } };
    }
    setBusy(true);
    try {
      const { design_system } = await createDesignSystemApi(draft.name.trim() || "Design system", t);
      resetComposer();
      load();
      openDraft(design_system, null);
      toast.success("Design system saved");
    } catch (e) {
      toast.error(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function discardDraft() {
    setDraft(null);
    setReviewFindings(null);
    setCreating(true);
  }

  async function refine() {
    if (!draft || !refineText.trim()) return;
    setRefining(true);
    try {
      const { tokens } = await tweakDesignSystemApi(draft.tokens, refineText.trim());
      setDraft({ ...draft, tokens });
      setRefineText("");
      setDraftNonce((n) => n + 1);
      toast.success("Refined — review the changes.");
    } catch (e) {
      toast.error(`Refine failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRefining(false);
    }
  }

  async function save() {
    if (!draft || !draft.id) return;
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
      if (draft?.id === id) {
        setDraft(null);
        setReviewFindings(null);
      }
      load();
      toast.success("Design system deleted");
    } catch (e) {
      toast.error(`Couldn't delete: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  // ── token editing helpers ──
  function patchTokens(patch: Partial<DesignTokens>) {
    setDraft((d) => (d ? { ...d, tokens: { ...d.tokens, ...patch } } : d));
  }
  function commitRows(rows: { id: string; name: string; value: string }[]) {
    setColorRows(rows);
    const rec: Record<string, string> = {};
    for (const r of rows) {
      const n = r.name.trim();
      if (n) rec[n] = r.value;
    }
    setDraft((d) => (d ? { ...d, tokens: { ...d.tokens, colors: rec } } : d));
  }
  const setRow = (id: string, patch: Partial<{ name: string; value: string }>) =>
    commitRows(colorRows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addRow = () => commitRows([...colorRows, { id: `c${idc.current++}`, name: "", value: "#000000" }]);
  const removeRow = (id: string) => commitRows(colorRows.filter((r) => r.id !== id));

  function setComp(key: keyof DesignComponentTokens, value: unknown) {
    setDraft((d) => (d ? { ...d, tokens: { ...d.tokens, components: { ...(d.tokens.components ?? {}), [key]: value } } } : d));
  }
  function patchButton(patch: Partial<NonNullable<DesignComponentTokens["button"]>>) {
    setDraft((d) => {
      if (!d) return d;
      const b = d.tokens.components?.button ?? {};
      return { ...d, tokens: { ...d.tokens, components: { ...(d.tokens.components ?? {}), button: { ...b, ...patch } } } };
    });
  }
  function setVariant(i: number, patch: Partial<ButtonVariantSpec>) {
    setDraft((d) => {
      if (!d) return d;
      const b = d.tokens.components?.button ?? {};
      const vs = [...(b.variants ?? [])];
      vs[i] = { ...vs[i], ...patch };
      return { ...d, tokens: { ...d.tokens, components: { ...(d.tokens.components ?? {}), button: { ...b, variants: vs } } } };
    });
  }
  function addVariant() {
    setDraft((d) => {
      if (!d) return d;
      const b = d.tokens.components?.button ?? {};
      const vs = [...(b.variants ?? []), { name: "new", background: "primary", foreground: "#ffffff" }];
      return { ...d, tokens: { ...d.tokens, components: { ...(d.tokens.components ?? {}), button: { ...b, variants: vs } } } };
    });
  }
  function removeVariant(i: number) {
    setDraft((d) => {
      if (!d) return d;
      const b = d.tokens.components?.button ?? {};
      const vs = (b.variants ?? []).filter((_, j) => j !== i);
      return { ...d, tokens: { ...d.tokens, components: { ...(d.tokens.components ?? {}), button: { ...b, variants: vs } } } };
    });
  }

  const returnTo = typeof window !== "undefined" ? window.location.origin + "/projects" : "/projects";

  function actionLabel(): string {
    if (createMode === "blank") return "+ Create";
    if (analyzing) return "Analyzing…";
    return createMode === "describe" ? "✨ Generate" : "Analyze";
  }
  function actionDisabled(): boolean {
    if (busy || analyzing) return true;
    switch (createMode) {
      case "blank":
        return !newName.trim();
      case "describe":
        return !describeText.trim() && images.length === 0;
      case "project":
        return !selectedProject;
      case "github":
        return !selectedRepo;
      case "publicgithub":
        return !repoUrl.trim();
      case "url":
        return !liveUrl.trim();
      case "zip":
        return !zipFile;
      case "figma":
        return !figma?.connected || !figmaUrl.trim();
      default:
        return false;
    }
  }

  function renderComposer() {
    return (
      <div className="ds-gradient-frame">
        <div className="ds-composer">
          <div className="dash-tabs ds-tabs" role="tablist" aria-label="Create method">
            {CREATE_TABS.map(([m, label]) => (
              <button key={m} type="button" role="tab" aria-selected={createMode === m} onClick={() => setCreateMode(m)}>
                {label}
              </button>
            ))}
          </div>

          {createMode === "describe" && (
            <>
              <textarea
                className="ds-brief"
                value={describeText}
                onChange={(e) => setDescribeText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    runCreate();
                  }
                }}
                placeholder={
                  "Describe the brand or product. e.g.\n" +
                  "“A warm, friendly neighbourhood bakery — soft creams and browns, rounded, approachable.”\n" +
                  "Attach a moodboard, screenshot or brand PDF for the agent to match."
                }
                rows={5}
                aria-label="Design brief"
              />
              <div className="ds-attach-row">
                <button type="button" className="btn-secondary" style={smallBtn} onClick={() => imageRef.current?.click()}>
                  + Attach image / PDF
                </button>
                {images.map((f, i) => (
                  <span key={`${f.name}-${i}`} className="ds-chip">
                    {f.name}
                    <button type="button" aria-label="Remove" onClick={() => setImages((xs) => xs.filter((_, j) => j !== i))}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </>
          )}

          {createMode === "blank" && (
            <p className="ds-hint">Starts from a sensible default palette, type and components you can edit.</p>
          )}

          {createMode === "project" && (
            <select className="ui-select" value={selectedProject} onChange={(e) => setSelectedProject(e.target.value)} aria-label="Project">
              <option value="">{projects === null ? "Loading your projects…" : "— select a project —"}</option>
              {(projects ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}

          {createMode === "github" &&
            (github?.connected ? (
              <select className="ui-select" value={selectedRepo} onChange={(e) => setSelectedRepo(e.target.value)} aria-label="Repository">
                <option value="">{repos === null ? "Loading your repos…" : "— select a repository —"}</option>
                {(repos ?? []).map((r) => (
                  <option key={r.full_name} value={r.full_name}>
                    {r.full_name}
                    {r.private ? " (private)" : ""}
                  </option>
                ))}
              </select>
            ) : (
              <div className="ds-connect">
                <span>Connect GitHub to infer from a private repo you have access to.</span>
                <a className="btn-primary" style={smallBtn} href={githubOauthStartUrl(returnTo)}>
                  Connect GitHub
                </a>
              </div>
            ))}

          {createMode === "publicgithub" && (
            <>
              <input className="ds-name" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/owner/repo" aria-label="Public repository URL" />
              <p className="ds-hint">Clones a public repo and reads its Tailwind/CSS/theme files.</p>
            </>
          )}

          {createMode === "url" && (
            <>
              <input className="ds-name" value={liveUrl} onChange={(e) => setLiveUrl(e.target.value)} placeholder="https://stripe.com" aria-label="Website URL" />
              <p className="ds-hint">Fetches the live site&apos;s CSS + theme colors and infers tokens from them.</p>
            </>
          )}

          {createMode === "zip" && (
            <div className="ds-attach-row">
              <button type="button" className="btn-secondary" style={smallBtn} onClick={() => fileRef.current?.click()}>
                {zipFile ? "Change .zip" : "Choose .zip"}
              </button>
              {zipFile && <span className="ds-chip">{zipFile.name}</span>}
              <span className="ds-hint" style={{ width: "100%" }}>We read the archive&apos;s theme files and infer tokens.</span>
            </div>
          )}

          {createMode === "figma" &&
            (figma?.connected ? (
              <>
                <input className="ds-name" value={figmaUrl} onChange={(e) => setFigmaUrl(e.target.value)} placeholder="https://www.figma.com/design/<key>/…" aria-label="Figma file URL" />
                <p className="ds-hint">
                  Connected{figma.handle ? ` as ${figma.handle}` : ""}. Reads the file&apos;s published color &amp; text styles.
                </p>
              </>
            ) : (
              <div className="ds-connect">
                <span>Connect Figma to infer a system from a file&apos;s published styles.</span>
                <a className="btn-primary" style={smallBtn} href={figmaOauthStartUrl(returnTo)}>
                  Connect Figma
                </a>
              </div>
            ))}

          {createMode !== "figma" || figma?.connected ? (
            <div className="ds-composer-actions">
              <input
                className="ds-name ds-name-inline"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && createMode === "blank") runCreate();
                }}
                placeholder={createMode === "blank" ? "Design system name…" : "Name (optional)"}
                aria-label="Name"
              />
              <button type="button" className="btn-primary" onClick={runCreate} disabled={actionDisabled()}>
                {actionLabel()}
              </button>
            </div>
          ) : null}

          {analyzing && (
            <div className="ds-activity" aria-live="polite">
              <span className="ds-spinner" aria-hidden="true" />
              {analyzeActivity || "Working…"}
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderFindings(f: DesignFindings) {
    const catalog = draft?.tokens.components?.catalog ?? [];
    const cats: { key: keyof ApproveState; label: string; items: string[] }[] = [
      { key: "colors", label: "Colors", items: f.colors },
      { key: "typography", label: "Typography", items: f.typography },
      { key: "components", label: "Components", items: f.components },
      { key: "spacing", label: "Spacing & radius", items: f.spacing },
      { key: "notes", label: "Notes", items: f.notes },
    ];
    return (
      <div className="dash-card ds-findings">
        <div className="ds-findings-head">
          <div>
            <h2>Review the agent&apos;s findings</h2>
            <p className="card-sub" style={{ margin: 0 }}>
              From {f.source}. Untick a group to drop it (it reverts to a sensible default), refine with AI, then approve.
            </p>
          </div>
        </div>
        <div className="ds-findings-grid">
          {cats.map((c) => (
            <label key={c.key} className={`ds-finding${approved[c.key] ? "" : " denied"}`}>
              <div className="ds-finding-top">
                <input type="checkbox" checked={approved[c.key]} onChange={(e) => setApproved((a) => ({ ...a, [c.key]: e.target.checked }))} />
                <span className="ds-finding-label">{c.label}</span>
              </div>
              <ul>
                {c.items.length === 0 ? <li className="muted">—</li> : c.items.map((it, i) => <li key={i}>{it}</li>)}
              </ul>
            </label>
          ))}
        </div>

        {catalog.length > 0 && (
          <div className="ds-catalog-review">
            <div className="ds-catalog-review-head">
              Components found — keep which? <span>(rendered in the live preview →)</span>
            </div>
            <div className="ds-catalog-list">
              {catalog.map((c, i) => (
                <label key={i} className={`ds-catalog-chip${approvedCatalog[i] === false ? " denied" : ""}`} title={c.description ?? ""}>
                  <input
                    type="checkbox"
                    checked={approvedCatalog[i] !== false}
                    onChange={(e) => setApprovedCatalog((a) => a.map((v, j) => (j === i ? e.target.checked : v)))}
                  />
                  <span className="ds-catalog-chip-name">{c.name}</span>
                  <span className="ds-catalog-chip-type">{c.type}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderRefine() {
    return (
      <div className="ds-refine">
        <input
          value={refineText}
          onChange={(e) => setRefineText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") refine();
          }}
          placeholder="Refine with AI — e.g. “make it warmer and more rounded”"
          style={{ ...inputStyle, flex: 1 }}
          disabled={refining}
        />
        <button type="button" className="btn-secondary" style={smallBtn} onClick={refine} disabled={refining || !refineText.trim()}>
          {refining ? "Refining…" : "✨ Refine"}
        </button>
      </div>
    );
  }

  function renderComponentEditor(d: DesignSystem) {
    const b = d.tokens.components?.button ?? {};
    const inp = d.tokens.components?.input ?? {};
    const card = d.tokens.components?.card ?? {};
    const badge = d.tokens.components?.badge ?? {};
    const variants = b.variants ?? [];
    return (
      <>
        <Field label="Buttons">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
            <LabeledInput label="Radius" small value={b.radius ?? ""} onChange={(v) => patchButton({ radius: v })} />
            <LabeledInput label="Pad X" small value={b.paddingX ?? ""} onChange={(v) => patchButton({ paddingX: v })} />
            <LabeledInput label="Pad Y" small value={b.paddingY ?? ""} onChange={(v) => patchButton({ paddingY: v })} />
            <LabeledInput
              label="Weight"
              small
              value={b.fontWeight != null ? String(b.fontWeight) : ""}
              onChange={(v) => patchButton({ fontWeight: v.trim() ? Number(v) || undefined : undefined })}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            {variants.map((v, i) => (
              <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input value={v.name} onChange={(e) => setVariant(i, { name: e.target.value })} placeholder="name" style={{ ...inputStyle, width: 92 }} />
                <input value={v.background ?? ""} onChange={(e) => setVariant(i, { background: e.target.value })} placeholder="bg" style={{ ...inputStyle, minWidth: 0 }} />
                <input value={v.foreground ?? ""} onChange={(e) => setVariant(i, { foreground: e.target.value })} placeholder="text" style={{ ...inputStyle, minWidth: 0 }} />
                <input value={v.border ?? ""} onChange={(e) => setVariant(i, { border: e.target.value })} placeholder="border" style={{ ...inputStyle, minWidth: 0 }} />
                <button type="button" className="btn-ghost" style={iconBtn} onClick={() => removeVariant(i)} aria-label="Remove variant">×</button>
              </div>
            ))}
            <button type="button" className="btn-secondary" style={{ ...smallBtn, alignSelf: "flex-start" }} onClick={addVariant}>+ Add variant</button>
          </div>
          <p className="ds-hint" style={{ marginTop: 6 }}>
            bg / text / border take a color token name (e.g. <code>primary</code>) or a CSS color (<code>transparent</code> for ghost).
          </p>
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <Field label="Input radius">
            <input value={inp.radius ?? ""} onChange={(e) => setComp("input", { ...inp, radius: e.target.value })} style={inputStyle} />
          </Field>
          <Field label="Card radius">
            <input value={card.radius ?? ""} onChange={(e) => setComp("card", { ...card, radius: e.target.value })} style={inputStyle} />
          </Field>
          <Field label="Badge style">
            <select
              className="ui-select"
              value={badge.variant ?? "soft"}
              onChange={(e) => setComp("badge", { ...badge, variant: e.target.value as NonNullable<DesignComponentTokens["badge"]>["variant"] })}
            >
              <option value="soft">soft</option>
              <option value="solid">solid</option>
              <option value="outline">outline</option>
            </select>
          </Field>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Card padding">
            <input value={card.padding ?? ""} onChange={(e) => setComp("card", { ...card, padding: e.target.value })} style={inputStyle} />
          </Field>
          <Field label="Card shadow">
            <input value={card.shadow ?? ""} onChange={(e) => setComp("card", { ...card, shadow: e.target.value })} style={inputStyle} placeholder="none" />
          </Field>
        </div>
      </>
    );
  }

  function renderEditor(d: DesignSystem) {
    const reviewing = reviewFindings != null;
    return (
      <>
        {reviewing && reviewFindings ? renderFindings(reviewFindings) : null}
        <div className="ds-editor">
          <div className="dash-card ds-editor-controls">
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
              <input
                value={d.name}
                onChange={(e) => setDraft({ ...d, name: e.target.value })}
                style={{ ...inputStyle, flex: 1, fontSize: 15, fontWeight: 600 }}
                aria-label="Design system name"
              />
              {reviewing ? (
                <>
                  <button type="button" className="btn-primary" style={smallBtn} onClick={approveDraft} disabled={busy}>
                    {busy ? "Saving…" : "Approve & save"}
                  </button>
                  <button type="button" className="btn-ghost" style={smallBtn} onClick={discardDraft} disabled={busy}>
                    Discard
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="btn-primary" style={smallBtn} onClick={save} disabled={busy}>
                    {busy ? "Saving…" : "Save"}
                  </button>
                  {/* Two-step confirm (C-25): the Delete API is permanent with no
                      undo and sits next to Save — a single misclick destroyed the
                      design system. First click arms; second click confirms. */}
                  {confirmDeleteId === d.id ? (
                    <>
                      <button
                        type="button"
                        className="btn-ghost"
                        style={{ ...smallBtn, color: "var(--conf-high, #e5484d)" }}
                        onClick={() => {
                          setConfirmDeleteId(null);
                          void remove(d.id);
                        }}
                        disabled={busy}
                      >
                        Confirm delete
                      </button>
                      <button type="button" className="btn-ghost" style={smallBtn} onClick={() => setConfirmDeleteId(null)} disabled={busy}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn-ghost" style={{ ...smallBtn, color: "var(--conf-medium, #d98a3d)" }} onClick={() => setConfirmDeleteId(d.id)} disabled={busy}>
                      Delete
                    </button>
                  )}
                </>
              )}
            </div>

            {renderRefine()}

            <Field label="Mode">
              <select className="ui-select" value={d.tokens.mode} onChange={(e) => patchTokens({ mode: e.target.value as DesignTokens["mode"] })}>
                <option value="light">light</option>
                <option value="dark">dark</option>
                <option value="system">system</option>
              </select>
            </Field>

            <Collapsible title="Colors" defaultOpen>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {colorRows.map((row) => (
                  <div key={row.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input value={row.name} onChange={(e) => setRow(row.id, { name: e.target.value })} placeholder="name" style={{ ...inputStyle, width: 130 }} />
                    <input type="color" value={normalizeHex(row.value)} onChange={(e) => setRow(row.id, { value: e.target.value })} style={{ width: 34, height: 28, padding: 0, border: "1px solid var(--border-default)", borderRadius: 6, background: "transparent" }} />
                    <input value={row.value} onChange={(e) => setRow(row.id, { value: e.target.value })} style={{ ...inputStyle, flex: 1, fontFamily: "ui-monospace,monospace", fontSize: 11 }} />
                    <button type="button" className="btn-ghost" style={iconBtn} onClick={() => removeRow(row.id)} aria-label="Remove color">×</button>
                  </div>
                ))}
                <button type="button" className="btn-secondary" style={{ ...smallBtn, alignSelf: "flex-start" }} onClick={addRow}>+ Add color</button>
              </div>
            </Collapsible>

            <Collapsible title="Fonts">
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <LabeledInput label="Body" value={d.tokens.fonts.body} onChange={(v) => patchTokens({ fonts: { ...d.tokens.fonts, body: v } })} />
                <LabeledInput label="Heading" value={d.tokens.fonts.heading} onChange={(v) => patchTokens({ fonts: { ...d.tokens.fonts, heading: v } })} />
                <LabeledInput label="Mono" value={d.tokens.fonts.mono ?? ""} onChange={(v) => patchTokens({ fonts: { ...d.tokens.fonts, mono: v } })} />
              </div>
            </Collapsible>

            <Collapsible title="Scale, radius & spacing">
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
            </Collapsible>

            <Collapsible title="Components" defaultOpen>
              {renderComponentEditor(d)}
            </Collapsible>

            <Collapsible title="Notes (voice, density, motion)">
              <textarea value={d.tokens.notes ?? ""} onChange={(e) => patchTokens({ notes: e.target.value })} rows={4} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }} />
            </Collapsible>
          </div>

          <div className="ds-preview-col">
            <div className="ds-preview-label">Live preview</div>
            <DesignSystemPreview tokens={d.tokens} name={d.name} />
          </div>
        </div>
      </>
    );
  }

  const hiddenInputs = (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".zip"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) setZipFile(f);
        }}
      />
      <input
        ref={imageRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          const fs = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (fs.length) setImages((xs) => [...xs, ...fs].slice(0, 6));
        }}
      />
    </>
  );

  if (isGuest) {
    return (
      <div className="dash-page" style={{ maxWidth: 880 }}>
        <span className="page-eyebrow">Brand</span>
        <h1>Design Systems</h1>
        <div className="dash-card">
          <p className="card-sub" style={{ marginBottom: 0 }}>
            Sign in with an account to create reusable design systems.
          </p>
        </div>
      </div>
    );
  }

  // Show the hero (composer) only when there's NO working draft and either no
  // systems exist yet or the user explicitly hit "+ New". A draft (review or
  // edit) always takes precedence so a first-ever generation is reviewable even
  // with zero saved systems.
  const hasSystems = (systems?.length ?? 0) > 0;
  const showHero = systems !== null && !draft && (!hasSystems || creating);
  const listCard = (
    <div className="dash-card ds-list">
      <div className="ds-list-head">
        <span>Your systems</span>
        <button
          type="button"
          className="btn-ghost ds-new"
          onClick={() => {
            setCreating(true);
            setDraft(null);
            setReviewFindings(null);
          }}
        >
          + New
        </button>
      </div>
      <div className="ds-list-items">
        {(systems ?? []).map((s) => {
          const swatches = Object.values(s.tokens?.colors ?? {});
          const count = swatches.length;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => select(s.id)}
              className={`ds-sys-row${draft?.id === s.id ? " active" : ""}`}
            >
              <span className="ds-sys-ribbon" aria-hidden="true">
                {(swatches.length ? swatches : ["var(--bg-surface-active)"]).slice(0, 6).map((c, i) => (
                  <span key={`${i}-${c}`} style={{ background: c }} />
                ))}
              </span>
              <span className="ds-sys-name">{s.name}</span>
              <span className="ds-sys-meta">
                {count} color{count === 1 ? "" : "s"} · {s.tokens?.mode ?? "light"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="dash-page ds-page">
      <header className="coll-head">
        <span className="page-eyebrow">Brand</span>
        <h1>
          Design <span className="grad">systems</span>
        </h1>
        <p className="lede">
          Reusable token sets — color, type, spacing AND components — the agent generates against. Describe a brand, point
          it at a project / repo / live site / Figma file, review what it finds, then attach it to a project so every
          screen stays on-system.
        </p>
      </header>
      {hiddenInputs}

      {systems === null ? (
        <p style={mutedSmall}>Loading…</p>
      ) : showHero ? (
        <div className="ds-empty">
          {hasSystems && (
            <button type="button" className="btn-ghost ds-cancel" onClick={() => setCreating(false)}>
              ← Back to your systems
            </button>
          )}
          <div className="ds-plus" aria-hidden="true">
            <PlusIcon />
          </div>
          <h2>{hasSystems ? "New design system" : "Create your first design system"}</h2>
          <p>
            Describe your brand or point the agent at an existing source. It analyzes colors, type and components into a
            draft you review, refine and save.
          </p>
          {renderComposer()}
        </div>
      ) : draft ? (
        hasSystems ? (
          <div className="ds-layout">
            {listCard}
            <div className="ds-main">{renderEditor(draft)}</div>
          </div>
        ) : (
          <div className="ds-main ds-main-solo">{renderEditor(draft)}</div>
        )
      ) : (
        <div className="ds-layout">
          {listCard}
          <div className="ds-main">
            <p style={mutedSmall}>Loading…</p>
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

/**
 * Collapsible editor section. Uses local state (not a controlled `open` prop) so
 * a parent re-render on every keystroke doesn't snap it back to its default.
 */
function Collapsible({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="ds-collapse">
      <button type="button" className="ds-collapse-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>{title}</span>
        <span className="ds-collapse-chev" aria-hidden="true">▾</span>
      </button>
      {/* Always mounted so the body can animate open/closed via the
          grid-template-rows 0fr↔1fr trick (no fixed height needed). */}
      <div className="ds-collapse-region" data-open={open}>
        <div className="ds-collapse-body">{children}</div>
      </div>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  small,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  small?: boolean;
}) {
  if (small) {
    return (
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{label}</span>
        <input value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle} />
      </label>
    );
  }
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <span style={{ width: 60, fontSize: 11, color: "var(--text-muted)" }}>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
    </div>
  );
}

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
