"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { ProjectSummary } from "@uniqus/api-types";
import BrandLockup from "./BrandLockup";
import {
  fetchProjects,
  createProjectApi,
  importGithubApi,
  importZipApi,
  updateProjectApi,
  deleteProjectApi,
  fetchGithubStatus,
  fetchGithubRepos,
  disconnectGithubApi,
  githubOauthStartUrl,
  type GithubStatus,
  type GithubRepoSummary,
} from "@/lib/api";

const ICON_CHOICES = [
  "🚀", "✨", "📊", "📈", "🤖", "⚡",
  "💼", "🛠️", "🧪", "📝", "📦", "🎯",
];

/**
 * Auto-derive a short display name from a free-form brief. Takes the
 * first ~5 words, lowercases, and joins with hyphens — close to how a
 * dev would name a repo. Caps at 40 chars; if the brief is too short
 * to derive anything, falls back to "untitled-project-<short id>".
 */
function deriveNameFromBrief(brief: string): string {
  const words = brief
    .toLowerCase()
    .replace(/[^\w\s-]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w));
  const head = words.slice(0, 5).join("-");
  const trimmed = head.slice(0, 40).replace(/-+$/, "");
  if (trimmed.length >= 3) return trimmed;
  return `untitled-${Math.random().toString(36).slice(2, 7)}`;
}

const STOP_WORDS = new Set([
  "a", "an", "the", "i", "want", "need", "build", "make", "create", "to", "for",
  "with", "and", "or", "of", "in", "on", "that", "this", "it", "is", "are",
]);

function fallbackTileColor(projectId: string): string {
  let hash = 0;
  for (let i = 0; i < projectId.length; i++) {
    hash = (hash * 31 + projectId.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 55% 28%)`;
}

type Mode = "blank" | "zip" | "github";
type GithubAuthMode = "oauth" | "pat";

export default function ProjectPicker({
  userEmail,
  userName,
  signOutUrl,
}: {
  userEmail: string;
  userName: string | null;
  signOutUrl: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [mode, setMode] = useState<Mode>("blank");
  const [name, setName] = useState("");

  // One-sentence project creation: blank mode collapses name+brief into
  // a single textarea. The user types what they want; we derive a name
  // and pass the brief through ?brief= so the workspace fires it as the
  // first turn once the WS connects.
  const [brief, setBrief] = useState("");
  const [showNameOverride, setShowNameOverride] = useState(false);

  // Per-project menu state. Tracks which tile's dropdown is open so
  // clicking elsewhere closes it; rename/icon dialogs are inline modals.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    project: ProjectSummary;
    field: "rename" | "icon" | "delete";
  } | null>(null);

  // Import form state
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [pat, setPat] = useState("");
  const [zipFile, setZipFile] = useState<File | null>(null);

  // GitHub OAuth state
  const [github, setGithub] = useState<GithubStatus | null>(null);
  const [githubAuthMode, setGithubAuthMode] = useState<GithubAuthMode>("oauth");
  const [repos, setRepos] = useState<GithubRepoSummary[] | null>(null);
  const [reposError, setReposError] = useState<string | null>(null);
  const [selectedRepo, setSelectedRepo] = useState<string>(""); // full_name

  useEffect(() => {
    fetchProjects()
      .then((r) => setProjects(r.projects))
      .catch((e) => setError(e.message));
  }, []);

  // Pull GitHub connection state on mount, and again whenever the query
  // string flips to `?github=connected` (the OAuth callback bounces the
  // user back here). Picks up the new login without a manual refresh.
  const githubFlag = searchParams?.get("github") ?? null;
  useEffect(() => {
    fetchGithubStatus()
      .then((s) => setGithub(s))
      .catch(() => setGithub({ connected: false, login: null, connected_at: null }));
  }, [githubFlag]);

  // When the user is connected, default to OAuth mode and fetch their
  // repos so the dropdown is ready before they switch to "Clone GitHub".
  useEffect(() => {
    if (!github?.connected) return;
    setGithubAuthMode("oauth");
    setReposError(null);
    fetchGithubRepos()
      .then((r) => setRepos(r.repos))
      .catch((err) => setReposError(err instanceof Error ? err.message : String(err)));
  }, [github?.connected]);

  // Surface OAuth callback failures in the UI; clear the param so a refresh
  // doesn't replay the message.
  useEffect(() => {
    if (githubFlag === "error") {
      const reason = searchParams?.get("reason") ?? "unknown";
      setError(`GitHub connect failed: ${reason}`);
      router.replace("/projects");
    } else if (githubFlag === "connected") {
      router.replace("/projects");
    }
  }, [githubFlag, router, searchParams]);

  async function handleConnectGithub(): Promise<void> {
    // Top-level nav so cookies for the orchestrator subdomain go with the
    // request — fetch() would be useless here (the orchestrator 302s to
    // github.com, which the browser would block as opaque-redirect).
    window.location.href = githubOauthStartUrl(window.location.origin + "/projects");
  }

  async function handleDisconnectGithub(): Promise<void> {
    try {
      await disconnectGithubApi();
      setGithub({ connected: false, login: null, connected_at: null });
      setRepos(null);
      setSelectedRepo("");
      setGithubAuthMode("pat");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (creating) return;

    // Blank mode now leads with a brief. Either (a) brief alone — derive
    // the name from it; (b) brief + manual name override; (c) name only
    // (legacy path, still supported by toggling "Set name manually").
    if (mode === "blank") {
      const trimmedBrief = brief.trim();
      const trimmedName = name.trim();
      if (!trimmedBrief && !trimmedName) return;
      const finalName = trimmedName || deriveNameFromBrief(trimmedBrief);
      setCreating(true);
      setError(null);
      try {
        const { project } = await createProjectApi(finalName);
        const target = trimmedBrief
          ? `/projects/${project.id}?brief=${encodeURIComponent(trimmedBrief)}`
          : `/projects/${project.id}`;
        router.push(target);
        return;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setCreating(false);
        return;
      }
    }

    // Import flows still require a manual project name.
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      if (mode === "github") {
        // Two paths: OAuth (user picked from their connected-account dropdown)
        // or PAT/manual URL fallback. The OAuth path doesn't ask the user
        // to type a URL — we resolve it from the selected repo's clone_url.
        const useOauth = githubAuthMode === "oauth" && github?.connected;
        let resolvedUrl = repoUrl.trim();
        if (useOauth) {
          const repo = repos?.find((r) => r.full_name === selectedRepo);
          if (!repo) {
            setError("pick a repository from the list");
            setCreating(false);
            return;
          }
          resolvedUrl = repo.clone_url;
        }
        if (!resolvedUrl) {
          setError("repo URL is required");
          setCreating(false);
          return;
        }
        const { project } = await importGithubApi({
          name: name.trim(),
          repo_url: resolvedUrl,
          branch: branch.trim() || undefined,
          pat: !useOauth ? pat.trim() || undefined : undefined,
          use_oauth: useOauth || undefined,
        });
        router.push(`/projects/${project.id}`);
        return;
      }
      if (mode === "zip") {
        if (!zipFile) {
          setError("please pick a .zip file");
          setCreating(false);
          return;
        }
        const { project } = await importZipApi({
          name: name.trim(),
          file: zipFile,
        });
        router.push(`/projects/${project.id}`);
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCreating(false);
    }
  }

  async function handleRename(project: ProjectSummary, newName: string): Promise<void> {
    try {
      const r = await updateProjectApi(project.id, { name: newName });
      setProjects((current) =>
        (current ?? []).map((p) => (p.id === project.id ? r.project : p)),
      );
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSetIcon(project: ProjectSummary, icon: string | null): Promise<void> {
    try {
      const r = await updateProjectApi(project.id, { icon });
      setProjects((current) =>
        (current ?? []).map((p) => (p.id === project.id ? r.project : p)),
      );
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDelete(project: ProjectSummary): Promise<void> {
    try {
      await deleteProjectApi(project.id);
      setProjects((current) => (current ?? []).filter((p) => p.id !== project.id));
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // Close any open per-tile menu when the user clicks outside the picker.
  useEffect(() => {
    if (!menuFor) return;
    const close = (): void => setMenuFor(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuFor]);

  return (
    <>
      <nav className="topnav">
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Link href="/" style={{ textDecoration: "none" }}>
            <BrandLockup />
          </Link>
        </div>
        <div className="right">
          <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
            {userName ?? userEmail}
          </span>
          <a href={signOutUrl} className="btn-ghost" style={{ fontSize: 12 }}>
            Sign out
          </a>
        </div>
      </nav>

      <div className="dash-shell">
        <aside className="dash-side">
          <div className="group">
            <div className="nav-item active">
              <span className="ic">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
              </span>
              Home
            </div>
            <div className="nav-item">
              <span className="ic">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M3 7h18M3 12h18M3 17h12" />
                </svg>
              </span>
              All projects
              <span className="count">{projects?.length ?? "—"}</span>
            </div>
            <div className="nav-item">
              <span className="ic">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </span>
              Recent
            </div>
          </div>

          <div className="group">
            <div className="label-micro">Workspace</div>
            <div className="nav-item">
              <span className="ic">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <path d="M8 21h8M12 17v4" />
                </svg>
              </span>
              Deployments
            </div>
            <div className="nav-item">
              <span className="ic">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <ellipse cx="12" cy="5" rx="9" ry="3" />
                  <path d="M3 5v14a9 3 0 0 0 18 0V5" />
                </svg>
              </span>
              Datasets
            </div>
          </div>

          <div className="usage">
            <div className="row">
              <span>Projects</span>
              <span className="v">{projects?.length ?? 0}</span>
            </div>
            <div className="row">
              <span>Plan</span>
              <span className="v">Free</span>
            </div>
            <div className="bar">
              <div className="fill" style={{ width: "20%" }} />
            </div>
          </div>
        </aside>

        <main className="dash-main">
          <div className="pagehead">
            <div>
              <h1>
                Welcome back, {(userName ?? userEmail).split(" ")[0] || "friend"}.
              </h1>
              <p>Pick up where you left off — or hand a new brief to Codex.</p>
            </div>
          </div>

          <div className="newproj">
            <h2>Brief Codex.</h2>
            <p className="lede">Start fresh, or bring an existing codebase.</p>

            <div
              role="tablist"
              style={{
                display: "flex",
                gap: 4,
                marginBottom: 12,
                borderBottom: "1px solid var(--border-default)",
              }}
            >
              {(
                [
                  ["blank", "Blank project"],
                  ["zip", "Upload .zip"],
                  ["github", "Clone GitHub"],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => {
                    setMode(m);
                    setError(null);
                  }}
                  style={{
                    padding: "8px 12px",
                    background: "transparent",
                    border: "none",
                    color: mode === m ? "var(--text-primary)" : "var(--text-muted)",
                    borderBottom:
                      mode === m
                        ? "2px solid var(--text-primary)"
                        : "2px solid transparent",
                    fontSize: 13,
                    cursor: "pointer",
                    marginBottom: -1,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <form onSubmit={handleCreate} className="newproj-form">
              {mode === "blank" ? (
                <div className="newproj-blank">
                  <textarea
                    autoFocus
                    value={brief}
                    onChange={(e) => setBrief(e.target.value)}
                    placeholder="Describe what you want — e.g. a Slack bot that posts new HubSpot deals to #revenue every Monday."
                    disabled={creating}
                    rows={3}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        void handleCreate(e as unknown as React.FormEvent);
                      }
                    }}
                  />
                  <div className="newproj-blank-row">
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => setShowNameOverride((v) => !v)}
                      disabled={creating}
                      style={{ fontSize: 11 }}
                    >
                      {showNameOverride ? "Hide name override" : "Set name manually"}
                    </button>
                    <button
                      type="submit"
                      className="btn-primary"
                      disabled={
                        creating ||
                        (!brief.trim() && !name.trim())
                      }
                    >
                      {creating ? "Creating…" : "Brief Codex →"}
                    </button>
                  </div>
                  {showNameOverride && (
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Project name (auto-derived from brief if blank)"
                      disabled={creating}
                      style={fieldStyle}
                    />
                  )}
                  <p className="newproj-hint">
                    {brief.trim()
                      ? `Codex will run this as your first turn. Project name will be "${name.trim() || deriveNameFromBrief(brief)}".`
                      : "Press ⌘/Ctrl + Enter to submit. Codex picks up from your brief on the next screen."}
                  </p>
                </div>
              ) : (
                <>
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Project name — e.g. acme-billing-portal"
                    disabled={creating}
                  />
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={
                      !name.trim() ||
                      creating ||
                      (mode === "github" &&
                        (githubAuthMode === "oauth" && github?.connected
                          ? !selectedRepo
                          : !repoUrl.trim())) ||
                      (mode === "zip" && !zipFile)
                    }
                  >
                    {creating
                      ? "Importing…"
                      : mode === "zip"
                        ? "Upload & import"
                        : "Clone & import"}
                  </button>
                </>
              )}
            </form>

            {mode === "github" && (
              <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                {github === null ? (
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    checking GitHub connection…
                  </div>
                ) : github.connected ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "8px 10px",
                      border: "1px solid var(--border-default)",
                      borderRadius: 6,
                      background: "var(--bg-elev)",
                    }}
                  >
                    <span style={{ fontSize: 12, color: "var(--text-primary)" }}>
                      Connected as <strong>@{github.login}</strong>
                    </span>
                    <button
                      type="button"
                      onClick={handleDisconnectGithub}
                      disabled={creating}
                      className="btn-ghost"
                      style={{ fontSize: 11 }}
                    >
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "8px 10px",
                      border: "1px dashed var(--border-default)",
                      borderRadius: 6,
                    }}
                  >
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      Connect your GitHub to pick a repo without pasting a URL or
                      PAT.
                    </span>
                    <button
                      type="button"
                      onClick={handleConnectGithub}
                      disabled={creating}
                      className="btn-primary"
                      style={{ fontSize: 12, padding: "6px 10px" }}
                    >
                      Connect GitHub
                    </button>
                  </div>
                )}

                {github?.connected && (
                  <div
                    role="tablist"
                    style={{ display: "flex", gap: 4, fontSize: 12 }}
                  >
                    {(
                      [
                        ["oauth", "Pick from my repos"],
                        ["pat", "Paste URL / PAT"],
                      ] as const
                    ).map(([m, label]) => (
                      <button
                        key={m}
                        type="button"
                        role="tab"
                        aria-selected={githubAuthMode === m}
                        onClick={() => setGithubAuthMode(m)}
                        style={{
                          padding: "4px 8px",
                          background:
                            githubAuthMode === m
                              ? "var(--bg-elev)"
                              : "transparent",
                          border: "1px solid var(--border-default)",
                          borderRadius: 4,
                          color:
                            githubAuthMode === m
                              ? "var(--text-primary)"
                              : "var(--text-muted)",
                          cursor: "pointer",
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}

                {github?.connected && githubAuthMode === "oauth" ? (
                  <>
                    {reposError ? (
                      <div style={{ color: "var(--conf-low)", fontSize: 12 }}>
                        couldn’t load repos: {reposError}
                      </div>
                    ) : repos === null ? (
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        loading repos…
                      </div>
                    ) : (
                      <select
                        value={selectedRepo}
                        onChange={(e) => setSelectedRepo(e.target.value)}
                        disabled={creating}
                        // colorScheme tells the browser to render the native
                        // <option> popup in dark mode. Without it, options
                        // render on a white system background regardless of
                        // the <select>'s own styling.
                        style={{ ...fieldStyle, colorScheme: "dark" }}
                      >
                        <option value="">— select a repository —</option>
                        {repos.map((r) => (
                          <option key={r.full_name} value={r.full_name}>
                            {r.full_name}
                            {r.private ? " (private)" : ""}
                          </option>
                        ))}
                      </select>
                    )}
                    <input
                      value={branch}
                      onChange={(e) => setBranch(e.target.value)}
                      placeholder="branch (optional, default = repo default)"
                      disabled={creating}
                      style={fieldStyle}
                    />
                    <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>
                      Cloned with your GitHub OAuth token. Token stays encrypted on
                      our server; revoke any time from GitHub → Settings →
                      Applications.
                    </p>
                  </>
                ) : (
                  <>
                    <input
                      className="newproj-input"
                      value={repoUrl}
                      onChange={(e) => setRepoUrl(e.target.value)}
                      placeholder="https://github.com/owner/repo.git"
                      disabled={creating}
                      style={fieldStyle}
                    />
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        value={branch}
                        onChange={(e) => setBranch(e.target.value)}
                        placeholder="branch (optional, default = repo default)"
                        disabled={creating}
                        style={{ ...fieldStyle, flex: 1 }}
                      />
                      <input
                        type="password"
                        value={pat}
                        onChange={(e) => setPat(e.target.value)}
                        placeholder="GitHub PAT (only for private repos)"
                        disabled={creating}
                        autoComplete="off"
                        style={{ ...fieldStyle, flex: 1 }}
                      />
                    </div>
                    <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>
                      PAT is used once to clone, never stored. Use a fine-scoped
                      token with read access to the target repo only.
                    </p>
                  </>
                )}
              </div>
            )}

            {mode === "zip" && (
              <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                <input
                  type="file"
                  accept=".zip,application/zip"
                  onChange={(e) => setZipFile(e.target.files?.[0] ?? null)}
                  disabled={creating}
                  style={{ fontSize: 13, color: "var(--text-muted)" }}
                />
                <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>
                  Up to 250 MB compressed. <code>.git/</code> and{" "}
                  <code>node_modules/</code> are skipped on extract.
                </p>
              </div>
            )}

            {error && (
              <div style={{ color: "var(--conf-low)", fontSize: 12, marginTop: 10 }}>
                {error}
              </div>
            )}
          </div>

          <div className="section-title">
            <h2>Your projects</h2>
          </div>

          {projects === null && (
            <div style={{ color: "var(--text-muted)", fontSize: 13 }}>loading…</div>
          )}

          {projects !== null && projects.length === 0 && (
            <div className="empty-state">
              No projects yet. Brief Codex above to start one.
            </div>
          )}

          {projects !== null && projects.length > 0 && (
            <div className="proj-grid">
              {projects.map((p) => (
                <ProjectTile
                  key={p.id}
                  project={p}
                  menuOpen={menuFor === p.id}
                  onOpenMenu={(open) => setMenuFor(open ? p.id : null)}
                  onEdit={(field) => setEditing({ project: p, field })}
                />
              ))}
            </div>
          )}

          {editing && editing.field === "rename" && (
            <RenameDialog
              project={editing.project}
              onCancel={() => setEditing(null)}
              onSubmit={(name) => handleRename(editing.project, name)}
            />
          )}

          {editing && editing.field === "icon" && (
            <IconDialog
              project={editing.project}
              onCancel={() => setEditing(null)}
              onPick={(icon) => handleSetIcon(editing.project, icon)}
            />
          )}

          {editing && editing.field === "delete" && (
            <DeleteDialog
              project={editing.project}
              onCancel={() => setEditing(null)}
              onConfirm={() => handleDelete(editing.project)}
            />
          )}
        </main>
      </div>
    </>
  );
}

function ProjectTile({
  project,
  menuOpen,
  onOpenMenu,
  onEdit,
}: {
  project: ProjectSummary;
  menuOpen: boolean;
  onOpenMenu: (open: boolean) => void;
  onEdit: (field: "rename" | "icon" | "delete") => void;
}) {
  return (
    <div className="proj proj-tile">
      <div className="proj-tile-head">
        <ProjectAvatar project={project} />
        <button
          type="button"
          className="proj-menu-btn"
          aria-label="Project actions"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onOpenMenu(!menuOpen);
          }}
        >
          ⋯
        </button>
        {menuOpen && (
          <div
            className="proj-menu"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                onOpenMenu(false);
                onEdit("rename");
              }}
            >
              Rename
            </button>
            <button
              type="button"
              onClick={() => {
                onOpenMenu(false);
                onEdit("icon");
              }}
            >
              Change icon
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => {
                onOpenMenu(false);
                onEdit("delete");
              }}
            >
              Delete
            </button>
          </div>
        )}
      </div>
      <Link href={`/projects/${project.id}`} className="proj-tile-link">
        <h3>{project.name}</h3>
        <p className="desc">{project.description ?? "No description"}</p>
        <div className="meta">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="status">
              <span className="d" /> Idle
            </span>
          </div>
          <span>{relativeTime(project.updated_at)}</span>
        </div>
      </Link>
    </div>
  );
}

function ProjectAvatar({ project }: { project: ProjectSummary }) {
  if (project.icon) {
    return <span className="proj-avatar emoji">{project.icon}</span>;
  }
  return (
    <span
      className="proj-avatar"
      style={{ background: fallbackTileColor(project.id) }}
    >
      {project.name.trim().charAt(0).toUpperCase() || "·"}
    </span>
  );
}

function RenameDialog({
  project,
  onCancel,
  onSubmit,
}: {
  project: ProjectSummary;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const [value, setValue] = useState(project.name);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  return (
    <div className="proj-dialog-overlay" onClick={onCancel}>
      <div className="proj-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Rename project</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = value.trim();
            if (trimmed && trimmed !== project.name) onSubmit(trimmed);
            else onCancel();
          }}
        >
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            style={fieldStyle}
            maxLength={80}
          />
          <div className="proj-dialog-actions">
            <button type="button" onClick={onCancel} className="btn-ghost">
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={!value.trim()}>
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function IconDialog({
  project,
  onCancel,
  onPick,
}: {
  project: ProjectSummary;
  onCancel: () => void;
  onPick: (icon: string | null) => void;
}) {
  return (
    <div className="proj-dialog-overlay" onClick={onCancel}>
      <div className="proj-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Pick an icon for "{project.name}"</h3>
        <div className="proj-icon-grid">
          {ICON_CHOICES.map((icon) => (
            <button
              key={icon}
              type="button"
              onClick={() => onPick(icon)}
              className={`proj-icon-choice ${project.icon === icon ? "selected" : ""}`}
            >
              {icon}
            </button>
          ))}
        </div>
        <div className="proj-dialog-actions">
          <button type="button" onClick={onCancel} className="btn-ghost">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onPick(null)}
            className="btn-ghost"
            disabled={!project.icon}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteDialog({
  project,
  onCancel,
  onConfirm,
}: {
  project: ProjectSummary;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [confirmName, setConfirmName] = useState("");
  const matches = confirmName.trim() === project.name;
  return (
    <div className="proj-dialog-overlay" onClick={onCancel}>
      <div className="proj-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Delete "{project.name}"?</h3>
        <p className="proj-dialog-warn">
          This permanently removes the project, its files, its chat history,
          and any deployments tracked by Uniqus. The action cannot be undone.
        </p>
        <input
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
          placeholder={`Type "${project.name}" to confirm`}
          style={fieldStyle}
          autoFocus
        />
        <div className="proj-dialog-actions">
          <button type="button" onClick={onCancel} className="btn-ghost">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!matches}
            className="btn-danger"
          >
            Delete project
          </button>
        </div>
      </div>
    </div>
  );
}


const fieldStyle: React.CSSProperties = {
  background: "var(--bg-elev)",
  border: "1px solid var(--border-default)",
  borderRadius: 6,
  padding: "8px 10px",
  color: "var(--text-primary)",
  fontSize: 13,
  fontFamily: "inherit",
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.floor((now - then) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 604800) return `${Math.floor(sec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}
