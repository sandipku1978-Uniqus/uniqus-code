"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { ProjectSummary } from "@uniqus/api-types";
import BrandLockup from "./BrandLockup";
import GuestBanner from "./GuestBanner";
import {
  fetchProjects,
  createProjectFromBriefApi,
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

/** Short example prompts shown as chips under the hero composer. */
const EXAMPLE_PROMPTS = [
  "A dashboard comparing the latest AI models",
  "A booking page with available time slots",
  "An invoice tracker with due-date reminders",
  "A landing page for my bakery with a menu",
];

/** Starter templates shown in the empty state. Each seeds the describe box. */
const STARTERS: ReadonlyArray<{
  icon: string;
  title: string;
  blurb: string;
  prompt: string;
}> = [
  {
    icon: "📊",
    title: "Internal dashboard",
    blurb: "Charts + a filterable data table for your team's metrics.",
    prompt:
      "Build an internal dashboard that shows our key metrics with charts and a filterable, sortable data table.",
  },
  {
    icon: "🤖",
    title: "Slack bot",
    blurb: "Responds to commands and posts daily summaries.",
    prompt:
      "Build a Slack bot that responds to slash commands and posts a daily summary message to a channel.",
  },
  {
    icon: "🧾",
    title: "CRUD app",
    blurb: "Create, edit, search and manage records.",
    prompt:
      "Build a CRUD app to manage records with create/edit/delete, search, and a clean list and detail view.",
  },
  {
    icon: "🌐",
    title: "Landing page",
    blurb: "Hero, features, pricing and a contact form.",
    prompt:
      "Build a modern marketing landing page with a hero, features, pricing, and a contact form.",
  },
];

/**
 * Close a popover when the user clicks anywhere outside `ref.current`.
 * Mirrors the pattern in ChatSessionDropdown — the container-ref check is the
 * thing that makes the listener safe to attach at the window: it only fires
 * for clicks that genuinely happened outside the menu's DOM subtree.
 */
function useOutsideClick(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  onOutside: () => void,
): void {
  useEffect(() => {
    if (!enabled) return;
    const onClick = (e: MouseEvent): void => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onOutside();
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [enabled, onOutside, ref]);
}

/**
 * Extract `owner/repo` from a github.com clone/HTML URL, or null if it isn't
 * a GitHub URL with at least two path segments. Mirrors the orchestrator's
 * parser so the link-choice modal can show the repo name before submitting.
 */
function parseGithubFullName(repoUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(repoUrl);
  } catch {
    return null;
  }
  if (!/(^|\.)github\.com$/i.test(parsed.hostname)) return null;
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, "");
  if (!owner || !repo) return null;
  return `${owner}/${repo}`;
}

function fallbackTileColor(projectId: string): string {
  let hash = 0;
  for (let i = 0; i < projectId.length; i++) {
    hash = (hash * 31 + projectId.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 55% 28%)`;
}

type Mode = "describe" | "zip" | "github";
type GithubAuthMode = "oauth" | "pat";

const MODE_TABS: ReadonlyArray<readonly [Mode, string]> = [
  ["describe", "Describe your idea"],
  ["zip", "Upload .zip"],
  ["github", "Clone GitHub"],
];

export default function ProjectPicker({
  userEmail,
  userName,
  signOutUrl,
  accountType = "standard",
  convertFailed = false,
}: {
  userEmail: string | null;
  userName: string | null;
  signOutUrl: string;
  accountType?: "standard" | "guest";
  convertFailed?: boolean;
}) {
  const router = useRouter();
  const isGuest = accountType === "guest";
  const displayLabel = userName ?? userEmail ?? "there";
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [mode, setMode] = useState<Mode>("describe");
  const [name, setName] = useState("");

  // Describe mode: a fuller-paragraph brief that's run through Haiku 4.5
  // server-side to extract a sane project name and a refined first prompt.
  // Distinct state so the user can flip tabs without losing their brief.
  const [describeText, setDescribeText] = useState("");
  const [refining, setRefining] = useState(false);

  // Per-project menu state. Tracks which tile's dropdown is open so
  // clicking elsewhere closes it; rename/icon dialogs are inline modals.
  const [menuFor, setMenuFor] = useState<string | null>(null);

  // Sidebar view selector. Default is the home dashboard (Brief Uniqus +
  // recent tiles). "all" shows every project as a richer card with URL +
  // repo + status; "recent" shows the same data sorted by activity with
  // more verbose timestamps.
  type View = "home" | "all" | "recent";
  const [view, setView] = useState<View>("home");

  const [editing, setEditing] = useState<{
    project: ProjectSummary;
    field: "rename" | "icon" | "delete";
  } | null>(null);

  // Import form state
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [pat, setPat] = useState("");
  const [zipFile, setZipFile] = useState<File | null>(null);

  // Clone-GitHub link choice: when set, the "Connect this project to the repo?"
  // modal is open and the import is paused until the user answers.
  const [linkPrompt, setLinkPrompt] = useState<{
    resolvedUrl: string;
    fullName: string | null;
    useOauth: boolean;
  } | null>(null);

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
    if (isGuest) return; // guests have no GitHub access
    fetchGithubStatus()
      .then((s) => setGithub(s))
      .catch(() => setGithub({ connected: false, login: null, connected_at: null }));
  }, [githubFlag, isGuest]);

  // When the user is connected, default to OAuth mode and fetch their
  // repos so the dropdown is ready before they switch to "Clone GitHub".
  useEffect(() => {
    if (isGuest || !github?.connected) return;
    setGithubAuthMode("oauth");
    setReposError(null);
    fetchGithubRepos()
      .then((r) => setRepos(r.repos))
      .catch((err) => setReposError(err instanceof Error ? err.message : String(err)));
  }, [github?.connected, isGuest]);

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

  // Chip / starter-card click: switch to Describe mode and seed the brief.
  // Switching from another tab remounts the describe textarea, whose autoFocus
  // pulls it into view — so a click from the empty-state cards scrolls up too.
  function startFromExample(prompt: string): void {
    setError(null);
    setMode("describe");
    setDescribeText(prompt);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (creating) return;

    // Describe mode: send the full paragraph to the orchestrator, which
    // calls Haiku to produce a sane name + a refined first message, then
    // creates the project. Forward the refined first_message through ?brief=
    // so the workspace fires it as the agent's opening turn.
    if (mode === "describe") {
      const trimmed = describeText.trim();
      if (!trimmed) return;
      setRefining(true);
      setError(null);
      try {
        const { project, first_message } = await createProjectFromBriefApi(trimmed);
        router.push(
          `/projects/${project.id}?brief=${encodeURIComponent(first_message)}`,
        );
        return;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setRefining(false);
        return;
      }
    }

    // Import flows still require a manual project name.
    if (!name.trim()) return;

    // GitHub clone is special: before we create anything, ask whether to link
    // the project to the source repo. Resolve the clone URL + owner/repo here,
    // then open the intrusive choice modal — the actual import runs from
    // doGithubImport once the user answers.
    if (mode === "github") {
      // Two paths: OAuth (user picked from their connected-account dropdown)
      // or PAT/manual URL fallback. The OAuth path resolves the URL from the
      // selected repo's clone_url.
      const useOauth = githubAuthMode === "oauth" && !!github?.connected;
      let resolvedUrl = repoUrl.trim();
      let fullName: string | null = null;
      if (useOauth) {
        const repo = repos?.find((r) => r.full_name === selectedRepo);
        if (!repo) {
          setError("pick a repository from the list");
          return;
        }
        resolvedUrl = repo.clone_url;
        fullName = repo.full_name;
      } else {
        if (!resolvedUrl) {
          setError("repo URL is required");
          return;
        }
        fullName = parseGithubFullName(resolvedUrl);
      }
      setError(null);
      setLinkPrompt({ resolvedUrl, fullName, useOauth });
      return;
    }

    setCreating(true);
    setError(null);
    try {
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

  // Runs the actual GitHub import once the user has answered the link-choice
  // modal. `linkRepo` true → the server records github_repo_* on the project.
  async function doGithubImport(linkRepo: boolean): Promise<void> {
    if (!linkPrompt || creating) return;
    const { resolvedUrl, fullName, useOauth } = linkPrompt;
    setLinkPrompt(null);
    setCreating(true);
    setError(null);
    try {
      const { project } = await importGithubApi({
        name: name.trim(),
        repo_url: resolvedUrl,
        branch: branch.trim() || undefined,
        pat: !useOauth ? pat.trim() || undefined : undefined,
        use_oauth: useOauth || undefined,
        link_repo: linkRepo || undefined,
        repo_full_name: linkRepo && fullName ? fullName : undefined,
      });
      router.push(`/projects/${project.id}`);
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

  // Outside-click dismissal lives inside each ProjectTile / RichProjectCard
  // via its own containerRef — see useOutsideClick below. A global window
  // listener here would also fire for clicks on the open menu's own items
  // unless every child handler stopped propagation, which is brittle.

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
            {displayLabel}
          </span>
          <a href={signOutUrl} className="btn-ghost" style={{ fontSize: 12 }}>
            Sign out
          </a>
        </div>
      </nav>

      {isGuest && <GuestBanner />}
      {convertFailed && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 16px",
            fontSize: 12,
            background: "rgba(220, 90, 90, 0.1)",
            borderBottom: "1px solid rgba(220, 90, 90, 0.35)",
            color: "var(--text-primary)",
          }}
        >
          <span>We couldn&apos;t move your guest projects onto this account.</span>
          <a
            href="/api/guest/convert"
            className="btn-ghost"
            style={{ fontSize: 12, padding: "3px 9px", marginLeft: "auto" }}
          >
            Retry
          </a>
        </div>
      )}

      <div className="dash-shell">
        <aside className="dash-side">
          <div className="group">
            <button
              type="button"
              onClick={() => setView("home")}
              className={`nav-item${view === "home" ? " active" : ""}`}
            >
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
            </button>
            <button
              type="button"
              onClick={() => setView("all")}
              className={`nav-item${view === "all" ? " active" : ""}`}
            >
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
            </button>
            <button
              type="button"
              onClick={() => setView("recent")}
              className={`nav-item${view === "recent" ? " active" : ""}`}
            >
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
            </button>
          </div>

          <div className="group">
            <div className="label-micro">Workspace</div>
            <div className="nav-item soon" aria-disabled="true" title="Coming soon">
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
              <span className="count">soon</span>
            </div>
            <div className="nav-item soon" aria-disabled="true" title="Coming soon">
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
              <span className="count">soon</span>
            </div>
          </div>

          <div className="group">
            <div className="label-micro">Help &amp; account</div>
            <Link href="/guide" className="nav-item">
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
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </span>
              User guide
            </Link>
            <Link href="/settings" className="nav-item">
              <span className="ic">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </span>
              Settings
            </Link>
          </div>

          <div className="usage">
            <div className="row">
              <span>Plan</span>
              <span className="v">{isGuest ? "Guest" : "Free"}</span>
            </div>
            <div className="row">
              <span>Projects</span>
              <span className="v">{projects?.length ?? 0}</span>
            </div>
            <div className="upgrade" title="Higher limits and team features are on the way.">
              {isGuest ? "Sign in to save your work" : "More on Pro — coming soon"}
            </div>
          </div>
        </aside>

        <main className="dash-main">
          {view === "all" || view === "recent" ? (
            <ProjectListView
              view={view}
              projects={projects}
              onEdit={(field, project) => setEditing({ project, field })}
              menuFor={menuFor}
              onOpenMenu={(id, open) => setMenuFor(open ? id : null)}
            />
          ) : (
            <>
          <div className="dash-hero">
            <h1>
              Let&apos;s build something,{" "}
              <span className="grad">{displayLabel.split(" ")[0] || "friend"}</span>
            </h1>
            <p className="lede">
              Describe what you want to build, or bring an existing codebase.
            </p>

            <div className="dash-hero-card">
              <div role="tablist" className="dash-tabs">
                {MODE_TABS.filter(
                  ([m]) => !isGuest || m !== "github",
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
                  >
                    {label}
                  </button>
                ))}
              </div>

            <form onSubmit={handleCreate} className="newproj-form">
              {mode === "describe" ? (
                <div className="newproj-blank">
                  <textarea
                    autoFocus
                    value={describeText}
                    onChange={(e) => setDescribeText(e.target.value)}
                    placeholder={
                      "Describe the project in your own words. Examples:\n" +
                      '  "A website for my bakery with a menu, photos, and a contact form."\n' +
                      '  "A booking page for my consulting business, with available time slots."\n' +
                      '  "An app that tracks my invoices and reminds me when they’re due."\n' +
                      "Uniqus picks the project name and turns this into the first prompt."
                    }
                    disabled={refining}
                    rows={6}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        void handleCreate(e as unknown as React.FormEvent);
                      }
                    }}
                  />
                  <div className="newproj-blank-row">
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      Polished by Haiku 4.5 · ~200ms · adds nothing the brief doesn&apos;t imply
                    </span>
                    <button
                      type="submit"
                      className="btn-primary"
                      disabled={refining || !describeText.trim()}
                    >
                      {refining ? "Refining brief…" : "Brief & start →"}
                    </button>
                  </div>
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

            {!isGuest && mode === "github" && (
              <div className="newproj-extra" style={{ display: "grid", gap: 10, marginTop: 10 }}>
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
              <div className="newproj-extra" style={{ display: "grid", gap: 8, marginTop: 10 }}>
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

              {mode === "describe" && (
                <div className="dash-chips">
                  {EXAMPLE_PROMPTS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      className="dash-chip"
                      title={`Use: ${p}`}
                      onClick={() => startFromExample(p)}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="section-title">
            <h2>Your projects</h2>
          </div>

          {projects === null && (
            <div style={{ color: "var(--text-muted)", fontSize: 13 }}>loading…</div>
          )}

          {projects !== null && projects.length === 0 && (
            <div className="empty-state" style={{ textAlign: "left", padding: "24px" }}>
              <p style={{ margin: "0 0 14px", color: "var(--text-muted)", fontSize: 13 }}>
                No projects yet — start from a template, or describe your own above.
              </p>
              <div className="starter-grid">
                {STARTERS.map((s) => (
                  <button
                    key={s.title}
                    type="button"
                    className="starter-card"
                    onClick={() => startFromExample(s.prompt)}
                  >
                    <span className="ic">{s.icon}</span>
                    <span className="t">{s.title}</span>
                    <span className="d">{s.blurb}</span>
                  </button>
                ))}
              </div>
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
            </>
          )}

          {linkPrompt && (
            <LinkRepoDialog
              repoFullName={linkPrompt.fullName}
              onChoice={(link) => void doGithubImport(link)}
              onCancel={() => setLinkPrompt(null)}
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
  const tileRef = useRef<HTMLDivElement>(null);
  useOutsideClick(tileRef, menuOpen, () => onOpenMenu(false));
  return (
    <div className="proj proj-tile" ref={tileRef}>
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
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span
              className="status"
              title="Saved and ready to open — the sandbox is restored when you open it, so you can chat with the agent and Run a preview."
            >
              <span className="d" /> Ready
            </span>
            <span className="tile-chips">
              {project.vercel_project_name && (
                <span className="tile-chip live" title="Published to Vercel">
                  ▲ live
                </span>
              )}
              {project.github_repo_url && (
                <span className="tile-chip" title="Linked to a GitHub repo">
                  ◉ repo
                </span>
              )}
            </span>
          </div>
          <span title={`Last edited ${relativeTime(project.updated_at)}`}>
            {relativeTime(project.updated_at)}
          </span>
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

/**
 * Intrusive choice shown before a Clone-GitHub project is created: connect the
 * new project to the source repo, or not. "Yes" records github_repo_* (the
 * workspace then shows the repo and can push back, given GitHub is connected);
 * "No" leaves it as the default unconnected project.
 */
function LinkRepoDialog({
  repoFullName,
  onChoice,
  onCancel,
}: {
  repoFullName: string | null;
  onChoice: (link: boolean) => void;
  onCancel: () => void;
}) {
  return (
    <div className="proj-dialog-overlay" onClick={onCancel}>
      <div className="proj-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Connect this project to GitHub?</h3>
        <p className="proj-dialog-warn" style={{ color: "var(--text-muted)" }}>
          {repoFullName ? (
            <>
              Link this project to <strong>{repoFullName}</strong> so the
              workspace shows the repo and can push changes back to it (pushing
              needs your GitHub connected). Choose <strong>No</strong> to start
              unconnected — you can link a repo later from the workspace.
            </>
          ) : (
            <>
              Link this project to the repo you&apos;re cloning so the workspace
              shows it and can push changes back. Choose <strong>No</strong> to
              start unconnected — you can link a repo later from the workspace.
            </>
          )}
        </p>
        <div className="proj-dialog-actions">
          <button type="button" onClick={() => onChoice(false)} className="btn-ghost">
            No, don&apos;t connect
          </button>
          <button
            type="button"
            onClick={() => onChoice(true)}
            className="btn-primary"
            disabled={!repoFullName}
            title={
              repoFullName
                ? `Link to ${repoFullName}`
                : "Couldn't determine the repo — clone will proceed unconnected"
            }
          >
            Yes, connect repo
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

/**
 * "All projects" + "Recent" view. Same data, different sort: All shows
 * projects alphabetically; Recent shows them by `updated_at` descending so
 * the freshest work is at the top. Cards are richer than the home tiles —
 * each surfaces the deploy URL, GitHub repo link, and a friendly status
 * line so the user can jump straight to whichever surface they want.
 */
function ProjectListView({
  view,
  projects,
  onEdit,
  menuFor,
  onOpenMenu,
}: {
  view: "all" | "recent";
  projects: ProjectSummary[] | null;
  onEdit: (field: "rename" | "icon" | "delete", project: ProjectSummary) => void;
  menuFor: string | null;
  onOpenMenu: (id: string, open: boolean) => void;
}) {
  const sorted = (() => {
    if (!projects) return null;
    const copy = [...projects];
    if (view === "recent") {
      copy.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    } else {
      copy.sort((a, b) => a.name.localeCompare(b.name));
    }
    return copy;
  })();

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>{view === "all" ? "All projects" : "Recent activity"}</h1>
          <p>
            {view === "all"
              ? "Every project you own. Click a card to open the workspace, or use the buttons to jump to its repo or deployment."
              : "Most recently touched first. Each card shows the project's last update plus its repo and deploy URLs."}
          </p>
        </div>
      </div>
      {sorted === null ? (
        <div style={{ color: "var(--text-muted)", fontSize: 13 }}>loading…</div>
      ) : sorted.length === 0 ? (
        <div className="empty-state">
          No projects yet. Head back to <strong>Home</strong> and start one.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {sorted.map((p) => (
            <RichProjectCard
              key={p.id}
              project={p}
              menuOpen={menuFor === p.id}
              onOpenMenu={(open) => onOpenMenu(p.id, open)}
              onEdit={(field) => onEdit(field, p)}
              showFullTimestamp={view === "recent"}
            />
          ))}
        </div>
      )}
    </>
  );
}

function RichProjectCard({
  project,
  menuOpen,
  onOpenMenu,
  onEdit,
  showFullTimestamp,
}: {
  project: ProjectSummary;
  menuOpen: boolean;
  onOpenMenu: (open: boolean) => void;
  onEdit: (field: "rename" | "icon" | "delete") => void;
  showFullTimestamp: boolean;
}) {
  // Vercel deploy URL: derived from `vercel_project_name` since that's what
  // we persist after the first deploy. Returns null when the project has
  // never deployed.
  const vercelUrl =
    project.vercel_project_name && project.vercel_project_name.trim()
      ? `https://${project.vercel_project_name}.vercel.app`
      : null;
  const repoUrl = project.github_repo_url ?? null;
  const repoName = project.github_repo_full_name ?? null;
  const updated = showFullTimestamp
    ? new Date(project.updated_at).toLocaleString()
    : relativeTime(project.updated_at);
  const cardRef = useRef<HTMLDivElement>(null);
  useOutsideClick(cardRef, menuOpen, () => onOpenMenu(false));
  const router = useRouter();

  return (
    <div
      ref={cardRef}
      className="proj proj-tile"
      // Whole card is clickable. Inner links/buttons stopPropagation so they
      // keep their own behavior (open repo/deploy URL, open the menu) instead
      // of also firing this navigation. The title Link below keeps keyboard
      // users a real, focusable link.
      onClick={() => router.push(`/projects/${project.id}`)}
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        alignItems: "start",
        gap: 16,
        padding: 14,
      }}
    >
      <ProjectAvatar project={project} />
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <Link
            href={`/projects/${project.id}`}
            onClick={(e) => e.stopPropagation()}
            style={{
              color: "var(--text-primary)",
              textDecoration: "none",
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            {project.name}
          </Link>
          <span
            className="status"
            title="Saved and ready to open — sandbox restored on open. Dot is green when the project is in a good state."
            style={{ fontSize: 11, color: "var(--text-muted)" }}
          >
            <span className="d" /> Ready · edited {updated}
          </span>
        </div>
        <div
          className="desc"
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
            marginBottom: 8,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {project.description ?? "No description"}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, fontSize: 11 }}>
          {vercelUrl ? (
            <CardChip
              href={vercelUrl}
              title={`Open ${vercelUrl}`}
              icon="▲"
              label={vercelUrl.replace(/^https:\/\//, "")}
            />
          ) : (
            <CardChip
              muted
              icon="▲"
              label="Not published yet"
              title="Open the project and click Deploy in the topbar to publish it"
            />
          )}
          {repoUrl ? (
            <CardChip
              href={repoUrl}
              title={`Open ${repoName ?? repoUrl} on github.com`}
              icon="◉"
              label={repoName ?? "GitHub repo"}
            />
          ) : (
            <CardChip
              muted
              icon="◉"
              label="GitHub not connected"
              title="Open the project and click Create GitHub repo in the topbar to connect"
            />
          )}
        </div>
      </div>
      <div style={{ position: "relative", display: "flex", gap: 8, alignSelf: "center" }}>
        <Link
          href={`/projects/${project.id}`}
          onClick={(e) => e.stopPropagation()}
          className="btn-primary"
          style={{ fontSize: 12, padding: "6px 12px", textDecoration: "none" }}
        >
          Open
        </Link>
        <button
          type="button"
          className="proj-menu-btn"
          aria-label="Project actions"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onOpenMenu(!menuOpen);
          }}
          style={{ position: "static" }}
        >
          ⋯
        </button>
        {menuOpen && (
          <div
            className="proj-menu"
            onClick={(e) => e.stopPropagation()}
            style={{ top: "100%", right: 0 }}
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
    </div>
  );
}

function CardChip({
  href,
  icon,
  label,
  title,
  muted,
}: {
  href?: string;
  icon: string;
  label: string;
  title: string;
  muted?: boolean;
}) {
  const style: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "2px 8px",
    border: "1px solid var(--border-default)",
    borderRadius: 4,
    color: muted ? "var(--text-muted)" : "var(--text-primary)",
    background: "var(--bg-elev)",
    fontSize: 11,
    textDecoration: "none",
    fontFamily: "var(--mono, monospace)",
  };
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        title={title}
        style={style}
        onClick={(e) => e.stopPropagation()}
      >
        <span aria-hidden>{icon}</span>
        <span style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis" }}>
          {label}
        </span>
      </a>
    );
  }
  return (
    <span title={title} style={style}>
      <span aria-hidden>{icon}</span>
      <span>{label}</span>
    </span>
  );
}
