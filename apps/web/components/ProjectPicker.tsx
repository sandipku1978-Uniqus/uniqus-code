"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { DeploymentState, ProjectSummary, Organization } from "@uniqus/api-types";
import BrandLockup from "./BrandLockup";
import GuestBanner from "./GuestBanner";
import DatabasesView from "./DatabasesView";
import DesignSystemsView from "./DesignSystemsView";
import SkillsView from "./SkillsView";
import KnowledgeView from "./KnowledgeView";
import WorkspaceSwitcher from "./WorkspaceSwitcher";
import OrgMembersView from "./OrgMembersView";
import OrgSettingsView from "./OrgSettingsView";
import OrgUsageView from "./OrgUsageView";
import TemplatesView from "./TemplatesView";
import { ProjectPreview } from "./UiPreview";
import Popover from "./Popover";
import Modal from "./Modal";
import FirstRunWizard from "./FirstRunWizard";
import { Skeleton } from "./Skeleton";
import ModelPicker from "./ModelPicker";
import MicButton from "./MicButton";
import { useStore } from "@/lib/store";
import { toast } from "@/lib/toast";
import { useAutoGrowTextarea } from "@/lib/useAutoGrowTextarea";
import { PENDING_BRIEF_KEY, draftKeyFor } from "./LandingPrompt";
import {
  fetchProjects,
  fetchUsageStatsApi,
  createProjectFromBriefApi,
  importGithubApi,
  importZipApi,
  updateProjectApi,
  deleteProjectApi,
  fetchOrgsApi,
  createOrgApi,
  setProjectOrgApi,
  fetchGithubStatus,
  fetchGithubRepos,
  disconnectGithubApi,
  githubOauthStartUrl,
  listDesignSystemsApi,
  type AccountUsageStats,
  type GithubStatus,
  type GithubRepoSummary,
  type DesignSystem,
} from "@/lib/api";

const ICON_CHOICES = [
  "🚀", "✨", "📊", "📈", "🤖", "⚡",
  "💼", "🛠️", "🧪", "📝", "📦", "🎯",
];

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Short example prompts shown as chips under the hero composer. */
const EXAMPLE_PROMPTS = [
  "An expense approval workflow with a status trail",
  "A SOX control register with owners and test status",
  "A budget vs. actuals dashboard by department",
  "An audit evidence log with sign-off status",
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
    icon: "✅",
    title: "Approval workflow",
    blurb: "Submit, route, and approve with a clear status trail.",
    prompt:
      "Build an expense approval workflow where staff submit expenses and managers approve or reject them, with policy checks over a configurable limit and an immutable activity log of who did what and when.",
  },
  {
    icon: "📋",
    title: "Control register",
    blurb: "Controls, owners, test status, and audit evidence.",
    prompt:
      "Build a SOX control register: a table of internal controls with owner, frequency, last test date, pass/fail/overdue status, and an evidence note, plus filtering and a summary of how many passed, failed, or are overdue.",
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

/** Stable hue for a project id — shared by the avatar and the tile cover so
 *  the two always agree. */
function projectHue(projectId: string): number {
  let hash = 0;
  for (let i = 0; i < projectId.length; i++) {
    hash = (hash * 31 + projectId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

function fallbackTileColor(projectId: string): string {
  return `hsl(${projectHue(projectId)} 55% 28%)`;
}

/**
 * Deterministic duotone cover for a project tile: a diagonal gradient on the
 * project's hue plus a brighter radial bloom from the top-right corner. Pure
 * CSS — gives every project a visual identity without any stored artwork.
 */
function coverBackground(projectId: string): string {
  const h = projectHue(projectId);
  const h2 = (h + 42) % 360;
  return [
    `radial-gradient(130% 160% at 88% -30%, hsl(${h2} 72% 48% / 0.8), transparent 58%)`,
    `linear-gradient(118deg, hsl(${h} 58% 31%), hsl(${(h + 24) % 360} 54% 19%))`,
  ].join(", ");
}

/**
 * Map a project's most-recent deploy state to the status dot's color class, a
 * short text label, and an accurate tooltip. The dot is never color-only — the
 * label always rides alongside it. `null`/`undefined` ⇒ the project has never
 * deployed (gray "Not deployed"), which is the common case.
 */
function deployStatus(state: DeploymentState | null | undefined): {
  dotClass: "live" | "building" | "failed" | "none";
  label: string;
  title: string;
} {
  switch (state) {
    case "READY":
      return {
        dotClass: "live",
        label: "Live",
        title: "Latest deploy is live.",
      };
    case "BUILDING":
    case "QUEUED":
      return {
        dotClass: "building",
        label: "Building",
        title:
          state === "QUEUED"
            ? "A deploy is queued and about to build."
            : "A deploy is currently building.",
      };
    case "ERROR":
      return {
        dotClass: "failed",
        label: "Failed",
        title: "The latest deploy failed — open the project and redeploy.",
      };
    case "CANCELED":
      return {
        dotClass: "none",
        label: "Canceled",
        title: "The latest deploy was canceled.",
      };
    default:
      return {
        dotClass: "none",
        label: "Not deployed",
        title: "This project hasn't been deployed yet.",
      };
  }
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
  const [usage, setUsage] = useState<AccountUsageStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Distinct from the in-form `error` so a project-load failure can render a
  // real error+retry block instead of dead-ending on the skeleton (§E).
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [mode, setMode] = useState<Mode>("describe");
  const [name, setName] = useState("");

  // Describe mode: a fuller-paragraph brief that's run through Haiku 4.5
  // server-side to extract a sane project name and a refined first prompt.
  // Distinct state so the user can flip tabs without losing their brief.
  const [describeText, setDescribeText] = useState("");
  const [refining, setRefining] = useState(false);
  // First-run wizard (B6): the brief awaiting enrichment, or null.
  const [wizardBrief, setWizardBrief] = useState<string | null>(null);
  const onboarded = useStore((s) => s.seenHints["onboarded"]);
  const markHintSeen = useStore((s) => s.markHintSeen);

  // Hero-style composer controls (mirror LandingPrompt). `mode` above is the
  // tab selector; `planMode` is the store's plan/execute toggle, kept separate.
  const planMode = useStore((s) => s.mode);
  const setPlanMode = useStore((s) => s.setMode);
  const setPlanModeManual = useStore((s) => s.setModeManual);
  const setBriefFiles = useStore((s) => s.setBriefFiles);
  const [describeFiles, setDescribeFiles] = useState<File[]>([]);
  const describeFileInputRef = useRef<HTMLInputElement>(null);
  const zipFileInputRef = useRef<HTMLInputElement>(null);
  const describeTaRef = useRef<HTMLTextAreaElement>(null);
  // Grow the describe box with content up to ~10 lines, then scroll — same
  // expanding behavior as the landing-hero and workspace composers.
  useAutoGrowTextarea(describeTaRef, describeText);
  // Reflect the real new-project default (plan on for the first turn). Programmatic
  // (setMode, not setModeManual) so it doesn't count as a manual choice — the
  // workspace still resets mode per-project and honors an explicit toggle later.
  useEffect(() => {
    setPlanMode("plan-then-execute");
  }, [setPlanMode]);

  function addDescribeFiles(list: FileList | null): void {
    if (!list || list.length === 0) return;
    setDescribeFiles((current) => {
      const next = [...current];
      for (const file of Array.from(list)) {
        const dup = next.some(
          (e) =>
            e.name === file.name &&
            e.size === file.size &&
            e.lastModified === file.lastModified,
        );
        if (!dup) next.push(file);
      }
      return next;
    });
    if (describeFileInputRef.current) describeFileInputRef.current.value = "";
  }

  // Per-project menu state. Tracks which tile's dropdown is open so
  // clicking elsewhere closes it; rename/icon dialogs are inline modals.
  const [menuFor, setMenuFor] = useState<string | null>(null);

  // Sidebar view selector. Default is the home dashboard (Brief Uniqus +
  // recent tiles). "all" shows every project as a richer card with URL +
  // repo + status; "recent" shows the same data sorted by activity with
  // more verbose timestamps.
  // "members" | "usage" | "settings" are the org-context views, only reachable
  // (and only shown in the nav) while an organization workspace is active.
  type View =
    | "home"
    | "templates"
    | "all"
    | "recent"
    | "databases"
    | "design-systems"
    | "skills"
    | "knowledge"
    | "members"
    | "usage"
    | "settings";
  const [view, setView] = useState<View>("home");

  // Active dashboard workspace (P3.1): null = Personal, else an org id. Persisted
  // account-wide in the store; the project list + new-project target follow it.
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useStore((s) => s.setActiveWorkspace);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [createOrgOpen, setCreateOrgOpen] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [creatingOrg, setCreatingOrg] = useState(false);
  const activeOrg = activeWorkspaceId ? orgs.find((o) => o.id === activeWorkspaceId) ?? null : null;
  const ORG_VIEWS = new Set<View>(["members", "usage", "settings"]);

  const [editing, setEditing] = useState<{
    project: ProjectSummary;
    field: "rename" | "icon" | "delete";
  } | null>(null);

  // Import form state
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [pat, setPat] = useState("");
  const [zipFile, setZipFile] = useState<File | null>(null);

  // Design systems available to attach to a new project ("" = none).
  const [designSystems, setDesignSystems] = useState<DesignSystem[]>([]);
  const [designSystemId, setDesignSystemId] = useState<string>("");
  useEffect(() => {
    if (isGuest) return;
    listDesignSystemsApi()
      .then((r) => setDesignSystems(r.design_systems))
      .catch(() => setDesignSystems([]));
  }, [isGuest]);

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

  const loadProjects = useCallback(() => {
    setProjectsError(null);
    setProjects(null);
    // Scope to the active workspace: "personal" lists un-orged projects; an org
    // id lists that org's projects (membership-checked server-side). Guests have
    // no org concept, so they always read Personal regardless of any stale id.
    const ws = isGuest ? "personal" : activeWorkspaceId ?? "personal";
    fetchProjects(ws)
      .then((r) => setProjects(r.projects))
      .catch((e) => setProjectsError(e instanceof Error ? e.message : String(e)));
  }, [activeWorkspaceId, isGuest]);

  // A guest should never carry an org workspace (e.g. a stale id left in
  // localStorage by a prior signed-in session) — force back to Personal.
  useEffect(() => {
    if (isGuest && activeWorkspaceId) setActiveWorkspace(null);
  }, [isGuest, activeWorkspaceId, setActiveWorkspace]);

  useEffect(() => {
    loadProjects();
    // Usage rollup for the dashboard widgets. Best-effort — a failure (e.g.
    // the usage table not yet migrated) just leaves the widgets at zero.
    fetchUsageStatsApi()
      .then((r) => setUsage(r.stats))
      .catch(() => {});
  }, [loadProjects]);

  // Load the user's organizations for the workspace switcher, and reconcile a
  // persisted active workspace against reality: if the stored org id is no
  // longer one the user belongs to (left/deleted), fall back to Personal.
  const loadOrgs = useCallback(async () => {
    try {
      const { orgs } = await fetchOrgsApi();
      setOrgs(orgs);
      if (activeWorkspaceId && !orgs.some((o) => o.id === activeWorkspaceId)) {
        setActiveWorkspace(null);
      }
    } catch {
      setOrgs([]);
    }
    // activeWorkspaceId intentionally omitted: this is a mount-time load +
    // reconcile; switching workspaces doesn't need to refetch the org list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isGuest) return; // guests have no org/workspace concept
    void loadOrgs();
  }, [isGuest, loadOrgs]);

  // When the active workspace changes to Personal, leave any org-only view
  // (Members/Usage/Settings) — they have no meaning without an org.
  function switchWorkspace(id: string | null) {
    if (id === activeWorkspaceId) return;
    setActiveWorkspace(id);
    setMenuFor(null);
    if (id === null && ORG_VIEWS.has(view)) setView("home");
  }

  async function createOrg() {
    const name = orgName.trim();
    if (!name || creatingOrg) return;
    setCreatingOrg(true);
    try {
      const { org } = await createOrgApi(name);
      setOrgs((prev) => [...prev, org]);
      setOrgName("");
      setCreateOrgOpen(false);
      setActiveWorkspace(org.id);
      setView("members"); // land in the new org ready to invite teammates
      toast.success(`Created ${org.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create organization");
    } finally {
      setCreatingOrg(false);
    }
  }

  function handleOrgRemoved() {
    // After leaving/deleting the active org: drop back to Personal and refresh.
    setActiveWorkspace(null);
    setView("home");
    void loadOrgs();
  }

  // A logged-out visitor who typed an idea into the landing-page composer is
  // bounced here through sign-in. Their idea was parked in sessionStorage so it
  // survives the round-trip — pick it up, drop it into the Describe box, and
  // make sure we're on the home view so they can start with one click.
  useEffect(() => {
    let pending: string | null = null;
    try {
      pending = sessionStorage.getItem(PENDING_BRIEF_KEY);
    } catch {
      /* storage unavailable — nothing to restore */
    }
    if (!pending || !pending.trim()) return;
    try {
      sessionStorage.removeItem(PENDING_BRIEF_KEY);
    } catch {
      /* ignore */
    }
    setView("home");
    setMode("describe");
    setDescribeText(pending);
  }, []);

  // Pull GitHub connection state on mount, and again whenever the query
  // string flips to `?github=connected` (the OAuth callback bounces the
  // user back here). Picks up the new login without a manual refresh.
  const githubFlag = searchParams?.get("github") ?? null;
  useEffect(() => {
    if (isGuest) return; // guests have no GitHub access
    // Abort the previous fetch on re-fire so a slow earlier response can't
    // stomp the newer `connected` state when githubFlag flips rapidly.
    const ctrl = new AbortController();
    fetchGithubStatus(ctrl.signal)
      .then((s) => setGithub(s))
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setGithub({ connected: false, login: null, connected_at: null });
      });
    return () => ctrl.abort();
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

  // Turn a brief into a project + open the workspace (shared by the direct path,
  // the first-run wizard, and the Templates tab). `rethrow` lets a caller that
  // renders its own error UI (TemplatesView) catch the failure instead of the
  // home hero's inline `error` block, which isn't mounted on other tabs.
  async function proceedCreate(
    brief: string,
    opts?: { rethrow?: boolean },
  ): Promise<void> {
    setRefining(true);
    setError(null);
    // Carry the plan-mode choice through as ?plan= so the workspace's first turn
    // honors it (the store's `mode` is reset per-project on workspace mount).
    const planQ = `plan=${planMode === "plan-then-execute" ? "1" : "0"}`;
    try {
      const { project, first_message } = await createProjectFromBriefApi(
        brief,
        designSystemId || null,
        activeWorkspaceId, // create inside the active workspace (null = personal)
      );
      if (describeFiles.length > 0) {
        // Stage the attachments + refined first message so the user lands in the
        // workspace with their idea and files ready to review and send — DON'T
        // auto-fire (reuses ChatPanel's briefFiles + draft hydration).
        setBriefFiles(describeFiles);
        try {
          localStorage.setItem(draftKeyFor(project.id), first_message);
        } catch {
          /* draft is a nicety; the user can retype if storage is unavailable */
        }
        router.push(`/projects/${project.id}?${planQ}`);
      } else {
        router.push(
          `/projects/${project.id}?brief=${encodeURIComponent(first_message)}&${planQ}`,
        );
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("createProjectFromBrief failed", err);
      setRefining(false);
      if (opts?.rethrow) throw err;
      setError(
        "Something went wrong turning your idea into a project. Try rephrasing, or simplify the description.",
      );
    }
  }

  // Templates tab: a curated starter's first brief runs through the very same
  // create-from-brief path. Rethrow so TemplatesView can toast on failure (and
  // reset its own per-card "Creating…" state); on success this navigates away.
  async function handleUseTemplate(prompt: string): Promise<void> {
    await proceedCreate(prompt, { rethrow: true });
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
      // Soft minimum so a one-word brief ("app") doesn't sail through into a
      // vague project — nudge for a sentence instead (§A).
      if (trimmed.length < 12) {
        setError("Tell us a little more — even one sentence about what it should do helps.");
        return;
      }
      // First-run wizard (B6): the first time someone submits a fairly short
      // brief, sharpen it with who/what-data before building. Skippable, and
      // only ever shown once. A clearly-detailed brief (longer) skips it.
      if (!onboarded && trimmed.length < 140) {
        setError(null);
        setWizardBrief(trimmed);
        return;
      }
      await proceedCreate(trimmed);
      return;
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
          orgId: activeWorkspaceId ?? undefined,
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
        org_id: activeWorkspaceId ?? undefined,
      });
      router.push(`/projects/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCreating(false);
    }
  }

  // Move a project between workspaces (personal ⇄ org). The moved project leaves
  // the current workspace's list, so drop it locally for an instant update; a
  // reload would also work but this avoids the flash.
  async function handleMoveProject(
    project: ProjectSummary,
    targetOrgId: string | null,
  ): Promise<void> {
    if ((project.org_id ?? null) === targetOrgId) {
      setMenuFor(null);
      return;
    }
    try {
      await setProjectOrgApi(project.id, targetOrgId);
      setMenuFor(null);
      setProjects((current) => (current ?? []).filter((p) => p.id !== project.id));
      const dest = targetOrgId ? orgs.find((o) => o.id === targetOrgId)?.name ?? "the organization" : "Personal";
      toast.success(`Moved “${project.name}” to ${dest}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't move project");
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
      // Rethrow so the DeleteDialog clears its pending/spinner state and
      // re-enables the button for a retry (on success the dialog unmounts).
      throw err;
    }
  }

  // Outside-click dismissal lives inside each ProjectTile / TimelineRow
  // via its own containerRef — see useOutsideClick below. A global window
  // listener here would also fire for clicks on the open menu's own items
  // unless every child handler stopped propagation, which is brittle.

  return (
    <>
      {wizardBrief !== null && (
        <FirstRunWizard
          initialBrief={wizardBrief}
          onClose={() => {
            // X / backdrop = cancel: close without building (the brief stays in
            // the box so they can edit + resubmit), and mark onboarded so the
            // wizard is genuinely once-only.
            setWizardBrief(null);
            markHintSeen("onboarded");
          }}
          onComplete={(refined) => {
            setWizardBrief(null);
            markHintSeen("onboarded");
            void proceedCreate(refined);
          }}
        />
      )}
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
          <span>
            We couldn&apos;t move your guest projects to your signed-in account yet — but
            nothing was lost. Your guest projects are still safe; retry, or sign out and
            back in.
          </span>
          <a
            href="/api/guest/convert"
            className="btn-ghost"
            style={{ fontSize: 12, padding: "3px 9px", marginLeft: "auto" }}
          >
            Retry
          </a>
          <a
            href="/docs"
            className="btn-ghost"
            style={{ fontSize: 12, padding: "3px 9px" }}
          >
            Documentation
          </a>
        </div>
      )}

      <div className="dash-shell">
        <aside className="dash-side">
          {!isGuest && (
            <div className="group" style={{ paddingBottom: 4 }}>
              <WorkspaceSwitcher
                orgs={orgs}
                activeWorkspaceId={activeWorkspaceId}
                personalLabel={displayLabel}
                onSelect={switchWorkspace}
                onCreate={() => {
                  setOrgName("");
                  setCreateOrgOpen(true);
                }}
              />
            </div>
          )}
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
              onClick={() => setView("templates")}
              className={`nav-item${view === "templates" ? " active" : ""}`}
            >
              <span className="ic">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="3" width="18" height="7" rx="1" />
                  <rect x="3" y="14" width="9" height="7" rx="1" />
                  <rect x="16" y="14" width="5" height="7" rx="1" />
                </svg>
              </span>
              Templates
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
            <button
              type="button"
              onClick={() => setView("databases")}
              className={`nav-item${view === "databases" ? " active" : ""}`}
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
                  <ellipse cx="12" cy="5" rx="9" ry="3" />
                  <path d="M3 5v14a9 3 0 0 0 18 0V5" />
                  <path d="M3 12a9 3 0 0 0 18 0" />
                </svg>
              </span>
              Databases
            </button>
            <button
              type="button"
              onClick={() => setView("design-systems")}
              className={`nav-item${view === "design-systems" ? " active" : ""}`}
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
                  <circle cx="13.5" cy="6.5" r="2.5" />
                  <circle cx="17.5" cy="10.5" r="2.5" />
                  <circle cx="8.5" cy="7.5" r="2.5" />
                  <circle cx="6.5" cy="12.5" r="2.5" />
                  <path d="M12 2a10 10 0 1 0 0 20 2 2 0 0 0 2-2 2 2 0 0 1 2-2h1a4 4 0 0 0 4-4 8 8 0 0 0-9-8z" />
                </svg>
              </span>
              Design Systems
            </button>
            <button
              type="button"
              onClick={() => setView("skills")}
              className={`nav-item${view === "skills" ? " active" : ""}`}
            >
              <span className="ic">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 2l2.4 6.9H21l-5.3 4.1 2 6.9L12 16.9 6.3 19.9l2-6.9L3 8.9h6.6z" />
                </svg>
              </span>
              Skills
            </button>
            <button
              type="button"
              onClick={() => setView("knowledge")}
              className={`nav-item${view === "knowledge" ? " active" : ""}`}
            >
              <span className="ic">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                </svg>
              </span>
              Knowledge
            </button>
          </div>

          {/* Organization context: only meaningful while an org workspace is active. */}
          {activeOrg && (
            <div className="group">
              <div className="label-micro">{activeOrg.name}</div>
              <button
                type="button"
                onClick={() => setView("members")}
                className={`nav-item${view === "members" ? " active" : ""}`}
              >
                <span className="ic">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                </span>
                Members
              </button>
              <button
                type="button"
                onClick={() => setView("usage")}
                className={`nav-item${view === "usage" ? " active" : ""}`}
              >
                <span className="ic">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="20" x2="18" y2="10" />
                    <line x1="12" y1="20" x2="12" y2="4" />
                    <line x1="6" y1="20" x2="6" y2="14" />
                  </svg>
                </span>
                Usage
              </button>
              <button
                type="button"
                onClick={() => setView("settings")}
                className={`nav-item${view === "settings" ? " active" : ""}`}
              >
                <span className="ic">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                </span>
                Settings
              </button>
            </div>
          )}


          <div className="group">
            <div className="label-micro">Help &amp; account</div>
            <Link href="/docs" className="nav-item">
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
              Documentation
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
              {isGuest ? "Sign in to keep your work across devices" : "More on Pro — coming soon"}
            </div>
          </div>
        </aside>

        <main className="dash-main">
          {view === "templates" ? (
            <TemplatesView onUse={handleUseTemplate} />
          ) : view === "databases" ? (
            <DatabasesView isGuest={isGuest} />
          ) : view === "design-systems" ? (
            <DesignSystemsView isGuest={isGuest} />
          ) : view === "skills" ? (
            <SkillsView isGuest={isGuest} />
          ) : view === "knowledge" ? (
            <KnowledgeView isGuest={isGuest} />
          ) : view === "members" && activeWorkspaceId ? (
            <OrgMembersView orgId={activeWorkspaceId} />
          ) : view === "usage" && activeWorkspaceId ? (
            <OrgUsageView orgId={activeWorkspaceId} />
          ) : view === "settings" && activeWorkspaceId ? (
            <OrgSettingsView
              orgId={activeWorkspaceId}
              onRenamed={(name) =>
                setOrgs((prev) =>
                  prev.map((o) => (o.id === activeWorkspaceId ? { ...o, name } : o)),
                )
              }
              onRemoved={handleOrgRemoved}
            />
          ) : view === "all" || view === "recent" ? (
            <ProjectListView
              view={view}
              projects={projects}
              orgs={orgs}
              onEdit={(field, project) => setEditing({ project, field })}
              onMove={handleMoveProject}
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
              {activeOrg && (
                <>
                  {" "}
                  <span style={{ color: "var(--text-muted)" }}>
                    New projects are created in <strong>{activeOrg.name}</strong>.
                  </span>
                </>
              )}
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

            <form
              onSubmit={handleCreate}
              className={`newproj-form${mode === "describe" ? " newproj-describe" : ""}`}
            >
              {mode === "describe" ? (
                <>
                  <textarea
                    autoFocus
                    ref={describeTaRef}
                    className="hp-input"
                    value={describeText}
                    onChange={(e) => setDescribeText(e.target.value)}
                    placeholder="Describe the app or internal tool you want — what should it do?"
                    aria-label="Describe your project"
                    disabled={refining}
                    rows={2}
                    onKeyDown={(e) => {
                      // Enter sends; Shift+Enter inserts a newline (matches the hero box).
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void handleCreate(e as unknown as React.FormEvent);
                      }
                    }}
                  />
                  {describeFiles.length > 0 && (
                    <div className="composer-attachments">
                      {describeFiles.map((file, i) => (
                        <span
                          key={`${file.name}-${file.size}-${file.lastModified}`}
                          className="attachment-chip"
                        >
                          <span className="attachment-name" title={file.name}>
                            {file.name}
                          </span>
                          <span className="attachment-size">{formatFileSize(file.size)}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setDescribeFiles((c) => c.filter((_, idx) => idx !== i))
                            }
                            title={`Remove ${file.name}`}
                            aria-label={`Remove ${file.name}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="hp-bar">
                    <div className="hp-left">
                      <input
                        ref={describeFileInputRef}
                        type="file"
                        multiple
                        hidden
                        onChange={(e) => addDescribeFiles(e.target.files)}
                      />
                      <button
                        type="button"
                        className="hp-icon-btn"
                        onClick={() => describeFileInputRef.current?.click()}
                        disabled={refining}
                        title="Attach files"
                        aria-label="Attach files"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                      </button>
                      <ModelPicker variant="compact" />
                      {designSystems.length > 0 && (
                        <select
                          value={designSystemId}
                          onChange={(e) => setDesignSystemId(e.target.value)}
                          disabled={refining}
                          title="Attach a design system so the agent generates against your tokens"
                          aria-label="Design system"
                          className="ui-select hp-select"
                        >
                          <option value="">No design system</option>
                          {designSystems.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      )}
                      <button
                        type="button"
                        className={`hp-plan${planMode === "plan-then-execute" ? " on" : ""}`}
                        onClick={() =>
                          setPlanModeManual(
                            planMode === "plan-then-execute"
                              ? "execute-only"
                              : "plan-then-execute",
                          )
                        }
                        aria-pressed={planMode === "plan-then-execute"}
                        title="Plan mode — Uniqus proposes a plan you can edit before it builds"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        Plan
                      </button>
                    </div>
                    <div className="hp-right">
                      <MicButton
                        className="hp-icon-btn"
                        disabled={refining}
                        onText={(t) => setDescribeText((prev) => (prev ? `${prev} ${t}` : t))}
                      />
                      <button
                        type="submit"
                        className="hp-send"
                        aria-label="Start building"
                        title="Start building"
                        disabled={refining || !describeText.trim()}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M12 19V5M5 12l7-7 7 7" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <p className="newproj-hint">
                    We&apos;ll name the project and turn this into your first prompt.{" "}
                    <span style={{ color: "var(--text-dim)" }}>
                      Enter to start, Shift+Enter for a new line.
                    </span>
                  </p>
                </>
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
                  <Skeleton height={36} radius={6} />
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
                      <Skeleton height={36} radius={6} />
                    ) : (
                      <select
                        value={selectedRepo}
                        onChange={(e) => setSelectedRepo(e.target.value)}
                        disabled={creating}
                        aria-label="GitHub repository to clone"
                        className="ui-select"
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
                    <label style={branchFieldStyle}>
                      <span style={branchLabelStyle}>Branch (optional)</span>
                      <input
                        value={branch}
                        onChange={(e) => setBranch(e.target.value)}
                        placeholder="e.g. main, develop"
                        disabled={creating}
                        aria-label="Branch to clone (optional)"
                        style={fieldStyle}
                      />
                      <span style={branchHelpStyle}>
                        Defaults to the repo&apos;s default branch.
                      </span>
                    </label>
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
                      <label style={{ ...branchFieldStyle, flex: 1 }}>
                        <span style={branchLabelStyle}>Branch (optional)</span>
                        <input
                          value={branch}
                          onChange={(e) => setBranch(e.target.value)}
                          placeholder="e.g. main, develop"
                          disabled={creating}
                          aria-label="Branch to clone (optional)"
                          style={fieldStyle}
                        />
                        <span style={branchHelpStyle}>
                          Defaults to the repo&apos;s default branch.
                        </span>
                      </label>
                      <label style={{ ...branchFieldStyle, flex: 1 }}>
                        <span style={branchLabelStyle}>Access token</span>
                        <input
                          type="password"
                          value={pat}
                          onChange={(e) => setPat(e.target.value)}
                          placeholder="GitHub PAT (only for private repos)"
                          disabled={creating}
                          autoComplete="off"
                          aria-label="GitHub personal access token (optional)"
                          style={fieldStyle}
                        />
                        <span style={branchHelpStyle}>
                          Only needed for private repos.
                        </span>
                      </label>
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
                {/* Native file inputs render white-on-white on the dark surface,
                    so we hide the control and drive it from a visible styled
                    button — same affordance as the describe-mode attach button. */}
                <input
                  ref={zipFileInputRef}
                  type="file"
                  accept=".zip,application/zip"
                  aria-label="Project source .zip file"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    if (file && !/\.zip$/i.test(file.name)) {
                      toast.error("Please choose a .zip file");
                      setZipFile(null);
                      if (zipFileInputRef.current) zipFileInputRef.current.value = "";
                      return;
                    }
                    setZipFile(file);
                  }}
                  disabled={creating}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => zipFileInputRef.current?.click()}
                    disabled={creating}
                    style={{ fontSize: 13 }}
                  >
                    {zipFile ? "Change file" : "Choose .zip file"}
                  </button>
                  {zipFile ? (
                    <span className="attachment-chip">
                      <span className="attachment-name" title={zipFile.name}>
                        {zipFile.name}
                      </span>
                      <span className="attachment-size">
                        {formatFileSize(zipFile.size)}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setZipFile(null);
                          if (zipFileInputRef.current) zipFileInputRef.current.value = "";
                        }}
                        disabled={creating}
                        title={`Remove ${zipFile.name}`}
                        aria-label={`Remove ${zipFile.name}`}
                      >
                        ×
                      </button>
                    </span>
                  ) : (
                    <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
                      No file chosen
                    </span>
                  )}
                </div>
                <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>
                  Up to 250 MB compressed. <code>.git/</code> and{" "}
                  <code>node_modules/</code> are skipped on extract.
                </p>
              </div>
            )}

            {error && (
              <div
                style={{ color: "var(--conf-low)", fontSize: 12, marginTop: 10 }}
                role="alert"
              >
                {error}
              </div>
            )}

              {/* Example chips show on every tab — clicking one bounces back to
                  Describe mode with the prompt seeded (startFromExample sets the
                  mode), so they're a useful nudge even on the import tabs (§A). */}
              <div className="dash-chips">
                {mode !== "describe" && (
                  <span style={{ fontSize: 11, color: "var(--text-dim)", alignSelf: "center", marginRight: 4 }}>
                    Or start from an idea:
                  </span>
                )}
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
            </div>
          </div>

          {projects !== null && projects.length > 0 && (
            <DashboardWidgets stats={usage} projectCount={projects.length} />
          )}

          <div className="section-title">
            <div className="head">
              <span className="eyebrow">Workspace</span>
              <h2>Recent projects</h2>
            </div>
            {projects !== null && projects.length > 3 && (
              <button
                type="button"
                className="btn-ghost"
                style={{ fontSize: 12 }}
                onClick={() => setView("all")}
              >
                View all {projects.length} →
              </button>
            )}
          </div>

          {projects === null && !projectsError && <ProjectGridSkeleton />}

          {projectsError && (
            <div className="empty-state" style={{ textAlign: "left", padding: "24px" }}>
              <p style={{ margin: "0 0 6px", color: "var(--text-primary)", fontSize: 14, fontWeight: 600 }}>
                Couldn’t load your projects
              </p>
              <p style={{ margin: "0 0 14px", color: "var(--text-muted)", fontSize: 12 }}>
                {projectsError}
              </p>
              <button type="button" className="btn-secondary" onClick={loadProjects}>
                Retry
              </button>
            </div>
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
                    <span className="ic" aria-hidden="true">{s.icon}</span>
                    <span className="t">{s.title}</span>
                    <span className="d">{s.blurb}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {projects !== null && projects.length > 0 && (
            <div className="proj-grid">
              {/* Three most-recently-active projects (listProjects sorts by
                  updated_at desc). The full list lives in the All projects view. */}
              {projects.slice(0, 3).map((p) => (
                <ProjectTile
                  key={p.id}
                  project={p}
                  menuOpen={menuFor === p.id}
                  onOpenMenu={(open) => setMenuFor(open ? p.id : null)}
                  onEdit={(field) => setEditing({ project: p, field })}
                  orgs={orgs}
                  onMove={handleMoveProject}
                />
              ))}
            </div>
          )}

            </>
          )}

          {/* Edit dialogs live OUTSIDE the view ternary so Rename/Icon/Delete
              work in All/Recent (ProjectListView) too — not just Home (C-4).
              `editing` is set by onEdit from every view; rendering them only in
              the home branch meant clicking them elsewhere set state but showed
              nothing, then popped a stale dialog on returning Home. */}
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

          {linkPrompt && (
            <LinkRepoDialog
              repoFullName={linkPrompt.fullName}
              onChoice={(link) => void doGithubImport(link)}
              onCancel={() => setLinkPrompt(null)}
            />
          )}

          {createOrgOpen && (
            <Modal
              title="Create an organization"
              subtitle="A shared workspace for your team's projects, members, and budget."
              width={460}
              onClose={() => {
                if (!creatingOrg) setCreateOrgOpen(false);
              }}
              footer={
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => setCreateOrgOpen(false)}
                    disabled={creatingOrg}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => void createOrg()}
                    disabled={creatingOrg || !orgName.trim()}
                  >
                    {creatingOrg ? "Creating…" : "Create organization"}
                  </button>
                </div>
              }
            >
              <label
                htmlFor="new-org-name"
                style={{
                  display: "block",
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--fs-2xs)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "var(--text-dim)",
                  marginBottom: 6,
                }}
              >
                Organization name
              </label>
              <input
                id="new-org-name"
                className="ui-input"
                autoFocus
                placeholder="Acme Inc"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void createOrg();
                }}
                style={{
                  width: "100%",
                  background: "var(--bg-elev)",
                  border: "1px solid var(--border-default)",
                  borderRadius: "var(--radius-md)",
                  color: "var(--text-primary)",
                  padding: "9px 11px",
                  fontSize: "var(--fs-md)",
                }}
              />
              <p style={{ color: "var(--text-dim)", fontSize: "var(--fs-xs)", marginTop: 10 }}>
                You&apos;ll be the owner. Invite teammates and create projects inside it once it&apos;s set up.
              </p>
            </Modal>
          )}
        </main>
      </div>
    </>
  );
}

// ── Dashboard usage widgets ───────────────────────────────────────────────────

/** Compact token count: 980 → "980", 10800 → "10.8k", 1_250_000 → "1.25M". */
function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}k`;
  }
  return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
}

/** USD with a sensible floor: tiny non-zero spend shows "<$0.01". */
function formatUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "$0.00";
  if (n < 0.01) return "<$0.01";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Agent wall-clock: "0s" / "45s" / "12m" / "3h 20m". */
function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.round(totalSec / 60);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

/**
 * The dashboard's "Your usage" block: headline stat cards (tokens, est. cost,
 * agent time, turns) plus a "Top models" breakdown. Powered by the account-wide
 * usage rollup; renders zeros gracefully while the stats load or before any
 * agent turns have been recorded.
 */
function DashboardWidgets({
  stats,
  projectCount,
}: {
  stats: AccountUsageStats | null;
  projectCount: number;
}) {
  // input/cache_read/cache_creation are now separate buckets. "Total processed"
  // sums them all (what the model actually read), while the sub-line breaks out
  // the cached portion so a small task no longer reads as millions of fresh
  // input tokens — cached reads bill ~0.1× and are reflected in Est. cost.
  const freshIn = stats?.total_input_tokens ?? 0;
  const cacheRead = stats?.total_cache_read_tokens ?? 0;
  const cacheCreate = stats?.total_cache_creation_tokens ?? 0;
  const out = stats?.total_output_tokens ?? 0;
  const totalTokens = freshIn + cacheRead + cacheCreate + out;
  const cachedIn = cacheRead + cacheCreate;
  const topModels = (stats?.top_models ?? []).slice(0, 4);
  const modelTotal = (m: AccountUsageStats["top_models"][number]): number =>
    m.input_tokens + m.cache_read_tokens + m.cache_creation_tokens + m.output_tokens;
  const maxModelTokens = topModels.reduce((max, m) => Math.max(max, modelTotal(m)), 0);

  return (
    <section className="usage-widgets">
      <div className="section-title">
        <div className="head">
          <span className="eyebrow">This account</span>
          <h2>Your usage</h2>
        </div>
        <span className="sub">
          across {projectCount} project{projectCount === 1 ? "" : "s"} · cost is an estimate
        </span>
      </div>
      <div className="usage-stat-grid">
        <StatCard
          label="Tokens"
          value={formatTokens(totalTokens)}
          sub={
            cachedIn > 0
              ? `${formatTokens(freshIn)} in · ${formatTokens(cachedIn)} cached · ${formatTokens(out)} out`
              : `${formatTokens(freshIn)} in · ${formatTokens(out)} out`
          }
        />
        <StatCard label="Est. cost" value={formatUsd(stats?.total_cost_usd ?? 0)} sub="approximate" />
        <StatCard
          label="Agent time"
          value={formatDuration(stats?.total_time_ms ?? 0)}
          sub="total run time"
        />
        <StatCard
          label="Turns"
          value={String(stats?.turns ?? 0)}
          sub="agent responses"
        />
      </div>

      {topModels.length > 0 && (
        <div className="top-models">
          <span className="top-models-title">Top models</span>
          <div className="top-models-list">
            {topModels.map((m) => {
              const total = modelTotal(m);
              const pct = maxModelTokens > 0 ? (total / maxModelTokens) * 100 : 0;
              return (
                <div key={`${m.provider}:${m.model}`} className="top-model-row">
                  <span className="top-model-name" title={m.model}>
                    {m.label}
                  </span>
                  <span className="top-model-bar">
                    <span className="top-model-fill" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="top-model-tokens">
                    {formatTokens(total)} · {m.turns} turn{m.turns === 1 ? "" : "s"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * The ⋯ project-actions dropdown (Rename / Change icon / Delete). Shared by the
 * home ProjectTile, the All-projects gallery tiles, and the Recent TimelineRow.
 * Exposes proper
 * `role="menu"`/`role="menuitem"` semantics plus roving keyboard focus:
 * ArrowUp/Down move between items, Home/End jump to the first/last item, and
 * Escape closes the menu (returning focus to the trigger is the caller's job —
 * here we just signal close). Mouse behaviour is unchanged.
 */
function ProjectActionsMenu({
  anchorRef,
  onEdit,
  onClose,
  orgs,
  currentOrgId,
  onMove,
}: {
  anchorRef: RefObject<HTMLButtonElement | null>;
  onEdit: (field: "rename" | "icon" | "delete") => void;
  onClose: () => void;
  /** Workspaces this project can be moved to. Omitted/empty hides the section. */
  orgs?: Organization[];
  /** The project's current org (null = personal), so the menu omits it as a target. */
  currentOrgId?: string | null;
  onMove?: (orgId: string | null) => void;
}) {
  // Move targets = Personal + every org, minus where it already lives. Only
  // shown when the user actually has an org to move between.
  const moveTargets =
    orgs && orgs.length > 0 && onMove
      ? [{ id: null as string | null, name: "Personal" }, ...orgs.map((o) => ({ id: o.id as string | null, name: o.name }))].filter(
          (t) => t.id !== (currentOrgId ?? null),
        )
      : [];
  const menuRef = useRef<HTMLDivElement>(null);

  // Focus the first item when the menu opens so keyboard users land inside it.
  useEffect(() => {
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]',
    );
    items?.[0]?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ??
        [],
    );
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = current < 0 ? 0 : (current + 1) % items.length;
      items[next].focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = current <= 0 ? items.length - 1 : current - 1;
      items[prev].focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0].focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1].focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <Popover
      open
      anchorRef={anchorRef}
      placement="bottom-end"
      floatingRef={menuRef}
      className="proj-menu"
      role="menu"
      ariaLabel="Project actions"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onClose();
          onEdit("rename");
        }}
      >
        Rename
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onClose();
          onEdit("icon");
        }}
      >
        Change icon
      </button>
      {moveTargets.length > 0 && onMove && (
        <>
          <div className="proj-menu-label" role="presentation">
            Move to
          </div>
          {moveTargets.map((t) => (
            <button
              key={t.id ?? "personal"}
              type="button"
              role="menuitem"
              onClick={() => {
                onClose();
                onMove(t.id);
              }}
            >
              {t.name}
            </button>
          ))}
        </>
      )}
      <button
        type="button"
        role="menuitem"
        className="danger"
        onClick={() => {
          onClose();
          onEdit("delete");
        }}
      >
        Delete
      </button>
    </Popover>
  );
}

function ProjectTile({
  project,
  menuOpen,
  onOpenMenu,
  onEdit,
  orgs,
  onMove,
}: {
  project: ProjectSummary;
  menuOpen: boolean;
  onOpenMenu: (open: boolean) => void;
  onEdit: (field: "rename" | "icon" | "delete") => void;
  orgs?: Organization[];
  onMove?: (project: ProjectSummary, orgId: string | null) => void;
}) {
  const tileRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  useOutsideClick(tileRef, menuOpen, () => onOpenMenu(false));
  return (
    <div className="proj proj-tile" ref={tileRef}>
      <div
        className="proj-cover"
        style={{ background: coverBackground(project.id) }}
        aria-hidden="true"
      >
        <ProjectPreview id={project.id} hue={projectHue(project.id)} />
      </div>
      <div className="proj-tile-head">
        <ProjectAvatar project={project} />
        <button
          type="button"
          ref={menuBtnRef}
          className="proj-menu-btn"
          aria-label="Project actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onOpenMenu(!menuOpen);
          }}
        >
          ⋯
        </button>
        {menuOpen && (
          <ProjectActionsMenu
            anchorRef={menuBtnRef}
            onEdit={onEdit}
            onClose={() => onOpenMenu(false)}
            orgs={orgs}
            currentOrgId={project.org_id ?? null}
            onMove={onMove ? (orgId) => onMove(project, orgId) : undefined}
          />
        )}
      </div>
      <Link href={`/projects/${project.id}`} className="proj-tile-link">
        <h3>{project.name}</h3>
        <p className="desc">{project.description ?? "No description"}</p>
        <div className="meta">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {(() => {
              const ds = deployStatus(project.latest_deploy_state);
              return (
                <span className="status" title={ds.title}>
                  <span className={`d ${ds.dotClass}`} /> {ds.label}
                </span>
              );
            })()}
            <span className="tile-chips">
              {project.vercel_project_name && (
                <span className="tile-chip live" title="Published to Vercel">
                  <span aria-hidden="true">▲</span> live
                </span>
              )}
              {project.github_repo_url && (
                <span className="tile-chip" title="Linked to a GitHub repo">
                  <span aria-hidden="true">◉</span> repo
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

/**
 * Placeholder for the home "Recent projects" grid while the list loads. Mirrors
 * the proj-grid card layout (avatar + title + description + meta) so the page
 * doesn't reflow when the real tiles arrive.
 */
function ProjectGridSkeleton() {
  return (
    <div className="proj-grid" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="proj proj-tile">
          <div className="proj-cover" style={{ background: "var(--bg-surface-active)" }} />
          <div className="proj-tile-head">
            <Skeleton width={36} height={36} radius={10} />
            <Skeleton width={24} height={24} radius={4} />
          </div>
          <div className="proj-tile-link">
            <Skeleton width="60%" height={14} />
            <Skeleton width="90%" height={12} />
            <Skeleton width="75%" height={12} />
            <div className="meta">
              <Skeleton width={56} height={10} />
              <Skeleton width={48} height={10} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Placeholder for the Recent timeline while it loads — one group of hairline-
 * divided rows matching the real `.timeline-row` grid (time · node · body ·
 * action) so the list settles in place when the data resolves.
 */
function RecentTimelineSkeleton() {
  return (
    <div className="timeline" aria-hidden="true">
      <div className="timeline-group">
        <div className="timeline-group-head">
          <Skeleton width={72} height={11} />
        </div>
        <div className="timeline-rows">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="timeline-row">
              <Skeleton width={48} height={11} />
              <span className="timeline-node none" />
              <div className="timeline-body" style={{ gap: 8 }}>
                <Skeleton width="34%" height={13} />
                <Skeleton width="62%" height={11} />
              </div>
              <Skeleton width={60} height={28} radius={6} />
            </div>
          ))}
        </div>
      </div>
    </div>
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
  const formId = "rename-project-form";
  return (
    <Modal
      title="Rename project"
      width={420}
      onClose={onCancel}
      footer={
        <div className="proj-dialog-actions">
          <button type="button" onClick={onCancel} className="btn-ghost">
            Cancel
          </button>
          <button
            type="submit"
            form={formId}
            className="btn-primary"
            disabled={!value.trim()}
          >
            Save
          </button>
        </div>
      }
    >
      <form
        id={formId}
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
          style={{ ...fieldStyle, width: "100%" }}
          maxLength={80}
        />
      </form>
    </Modal>
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
    <Modal
      title={`Pick an icon for "${project.name}"`}
      width={420}
      onClose={onCancel}
      footer={
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
      }
    >
      <div className="proj-icon-grid">
        {ICON_CHOICES.map((icon) => (
          <button
            key={icon}
            type="button"
            onClick={() => onPick(icon)}
            aria-label={`Use the ${icon} icon`}
            aria-pressed={project.icon === icon}
            className={`proj-icon-choice ${project.icon === icon ? "selected" : ""}`}
          >
            {icon}
          </button>
        ))}
      </div>
    </Modal>
  );
}

function DeleteDialog({
  project,
  onCancel,
  onConfirm,
}: {
  project: ProjectSummary;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const [confirmName, setConfirmName] = useState("");
  // Deleting a large project can take ~15s server-side; without a pending state
  // the button just sat there after the click. Track it so we can disable the
  // actions and show an inline spinner until the delete resolves.
  const [deleting, setDeleting] = useState(false);
  const matches = confirmName.trim() === project.name;

  async function handleConfirm(): Promise<void> {
    if (deleting || !matches) return;
    setDeleting(true);
    try {
      await onConfirm();
      // Success: the parent unmounts this dialog — leave `deleting` true so the
      // button stays disabled + spinning through the unmount (no flicker back).
    } catch {
      // Failed: re-enable so the user can retry (handleDelete already surfaced
      // the error banner).
      setDeleting(false);
    }
  }

  return (
    <Modal
      title={`Delete "${project.name}"?`}
      width={420}
      // Block dismissal (X / backdrop) while the delete is in flight so the
      // dialog + spinner stay put until it resolves.
      onClose={deleting ? () => {} : onCancel}
      footer={
        <div className="proj-dialog-actions">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="btn-ghost"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={!matches || deleting}
            aria-busy={deleting}
            className="btn-danger"
            // btn-danger isn't a flex box, so give the spinner + label inline
            // layout (the .ds-spinner span needs a flex parent to size/space).
            style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "center" }}
          >
            {deleting ? (
              <>
                <span className="ds-spinner" aria-hidden="true" /> Deleting…
              </>
            ) : (
              "Delete project"
            )}
          </button>
        </div>
      }
    >
      <p className="proj-dialog-warn">
        This permanently removes the project, its files, its chat history,
        and any deployments tracked by Uniqus. The action cannot be undone.
      </p>
      <input
        value={confirmName}
        onChange={(e) => setConfirmName(e.target.value)}
        placeholder={`Type "${project.name}" to confirm`}
        style={{ ...fieldStyle, width: "100%", marginTop: 12 }}
        autoFocus
      />
    </Modal>
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
    <Modal
      title="Connect this project to GitHub?"
      width={420}
      onClose={onCancel}
      footer={
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
      }
    >
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
    </Modal>
  );
}


const fieldStyle: React.CSSProperties = {
  background: "var(--bg-elev)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-md)",
  padding: "8px 10px",
  color: "var(--text-primary)",
  fontSize: 13,
  fontFamily: "inherit",
};

// A labelled import field: mono uppercase "eyebrow" micro-label stacked over the
// input, with dim helper text beneath. Used for the Branch (optional) + access-
// token fields so the import form reads as a real form, not bare placeholders.
const branchFieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const branchLabelStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "var(--fs-2xs)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--text-dim)",
};

const branchHelpStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-muted)",
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
 * Editorial header shared by the All / Recent collection views. Larger, lighter
 * display type than the stock `.dash-page` h1 (one gradient-accented word), a
 * mono eyebrow above, and a measured lede — the dashboard echo of the marketing
 * section heads.
 */
function CollectionHead({
  eyebrow,
  title,
  lede,
}: {
  eyebrow: string;
  title: React.ReactNode;
  lede: string;
}) {
  return (
    <header className="coll-head">
      <span className="page-eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      <p className="lede">{lede}</p>
    </header>
  );
}

/** One cell of a hairline-divided metric strip: a big mono tabular value over a
 *  mono uppercase label, optionally led by a semantic status dot. */
function MetricCell({
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

/**
 * "All projects" — the full gallery. A deterministic duotone-cover tile per
 * project (signature #11), fronted by an at-a-glance metric strip and a name
 * filter. Equal-size repetition is justified here: this *is* the collection.
 * Deliberately a different silhouette from Recent (a timeline).
 */
function AllProjectsView({
  projects,
  orgs,
  onEdit,
  onMove,
  menuFor,
  onOpenMenu,
}: {
  projects: ProjectSummary[] | null;
  orgs?: Organization[];
  onEdit: (field: "rename" | "icon" | "delete", project: ProjectSummary) => void;
  onMove?: (project: ProjectSummary, orgId: string | null) => void;
  menuFor: string | null;
  onOpenMenu: (id: string, open: boolean) => void;
}) {
  const [q, setQ] = useState("");
  const sorted = projects
    ? [...projects].sort((a, b) => a.name.localeCompare(b.name))
    : null;
  const query = q.trim().toLowerCase();
  const shown =
    sorted && query
      ? sorted.filter(
          (p) =>
            p.name.toLowerCase().includes(query) ||
            (p.description ?? "").toLowerCase().includes(query),
        )
      : sorted;

  // Metrics span the full set, not the filtered view.
  const total = projects?.length ?? 0;
  const live = projects?.filter((p) => p.latest_deploy_state === "READY").length ?? 0;
  const published = projects?.filter((p) => p.vercel_project_name).length ?? 0;
  const linked = projects?.filter((p) => p.github_repo_url).length ?? 0;

  return (
    <>
      <CollectionHead
        eyebrow="Workspace"
        title={
          <>
            All <span className="grad">projects</span>
          </>
        }
        lede="Every project in this workspace, sorted by name. Open one to jump in, or use the ⋯ menu to rename, re-icon, move, or remove it."
      />

      <div className="metric-strip">
        <MetricCell value={total} label="Projects" />
        <MetricCell value={live} label="Live" dot={live > 0 ? "live" : "dim"} />
        <MetricCell value={published} label="Published" />
        <MetricCell value={linked} label="GitHub linked" />
      </div>

      {projects !== null && projects.length > 0 && (
        <div className="coll-toolbar">
          <label className="coll-search">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter projects…"
              aria-label="Filter projects by name or description"
            />
          </label>
          {query && shown && (
            <span className="coll-count">
              {shown.length} of {sorted?.length ?? 0}
            </span>
          )}
        </div>
      )}

      {shown === null ? (
        <ProjectGridSkeleton />
      ) : projects && projects.length === 0 ? (
        <div className="empty-state">
          No projects yet. Head back to <strong>Home</strong> and start one.
        </div>
      ) : shown.length === 0 ? (
        <div className="empty-state">
          No projects match <strong>“{q.trim()}”</strong> — try a different search.
        </div>
      ) : (
        <div className="proj-grid">
          {shown.map((p) => (
            <ProjectTile
              key={p.id}
              project={p}
              menuOpen={menuFor === p.id}
              onOpenMenu={(open) => onOpenMenu(p.id, open)}
              onEdit={(field) => onEdit(field, p)}
              orgs={orgs}
              onMove={onMove}
            />
          ))}
        </div>
      )}
    </>
  );
}

/** Last-touched bucket for the Recent timeline. Day boundaries are local. */
function recencyBucket(
  iso: string,
): "Today" | "Yesterday" | "This week" | "This month" | "Earlier" {
  const t = new Date(iso).getTime();
  const now = new Date();
  const dayMs = 86_400_000;
  const startToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  if (t >= startToday) return "Today";
  if (t >= startToday - dayMs) return "Yesterday";
  if (t >= startToday - 6 * dayMs) return "This week";
  if (t >= startToday - 29 * dayMs) return "This month";
  return "Earlier";
}

const RECENCY_ORDER = [
  "Today",
  "Yesterday",
  "This week",
  "This month",
  "Earlier",
] as const;

/**
 * "Recent" — an activity timeline, deliberately a different shape from the All
 * gallery. Projects bucket by last-touched (Today / This week / …) into
 * hairline-divided rows riding a mono time-rail with status-colored nodes, so a
 * glance reads as "what did I work on, and when."
 */
function RecentView({
  projects,
  orgs,
  onEdit,
  onMove,
  menuFor,
  onOpenMenu,
}: {
  projects: ProjectSummary[] | null;
  orgs?: Organization[];
  onEdit: (field: "rename" | "icon" | "delete", project: ProjectSummary) => void;
  onMove?: (project: ProjectSummary, orgId: string | null) => void;
  menuFor: string | null;
  onOpenMenu: (id: string, open: boolean) => void;
}) {
  const groups = (() => {
    if (!projects) return null;
    const sorted = [...projects].sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );
    const map = new Map<string, ProjectSummary[]>();
    for (const p of sorted) {
      const b = recencyBucket(p.updated_at);
      const arr = map.get(b) ?? [];
      arr.push(p);
      map.set(b, arr);
    }
    return RECENCY_ORDER.filter((o) => map.has(o)).map((o) => ({
      label: o,
      items: map.get(o)!,
    }));
  })();

  return (
    <>
      <CollectionHead
        eyebrow="Workspace"
        title={
          <>
            Recent <span className="grad">activity</span>
          </>
        }
        lede="Your projects grouped by when you last touched them, freshest first — a running log of where your attention has been."
      />
      {groups === null ? (
        <RecentTimelineSkeleton />
      ) : groups.length === 0 ? (
        <div className="empty-state">
          No projects yet. Head back to <strong>Home</strong> and start one.
        </div>
      ) : (
        <div className="timeline">
          {groups.map((g) => (
            <section key={g.label} className="timeline-group">
              <div className="timeline-group-head">
                <span className="t">{g.label}</span>
                <span className="n">{g.items.length}</span>
              </div>
              <div className="timeline-rows">
                {g.items.map((p) => (
                  <TimelineRow
                    key={p.id}
                    project={p}
                    menuOpen={menuFor === p.id}
                    onOpenMenu={(open) => onOpenMenu(p.id, open)}
                    onEdit={(field) => onEdit(field, p)}
                    orgs={orgs}
                    onMove={onMove}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

/** Switches between the two collection silhouettes (gallery vs. timeline). */
function ProjectListView({
  view,
  projects,
  orgs,
  onEdit,
  onMove,
  menuFor,
  onOpenMenu,
}: {
  view: "all" | "recent";
  projects: ProjectSummary[] | null;
  orgs?: Organization[];
  onEdit: (field: "rename" | "icon" | "delete", project: ProjectSummary) => void;
  onMove?: (project: ProjectSummary, orgId: string | null) => void;
  menuFor: string | null;
  onOpenMenu: (id: string, open: boolean) => void;
}) {
  const props = { projects, orgs, onEdit, onMove, menuFor, onOpenMenu };
  return view === "all" ? <AllProjectsView {...props} /> : <RecentView {...props} />;
}

/**
 * One row of the Recent timeline. A mono time-stamp on the left rail, a
 * status-colored node on the connecting line, then the project identity, deploy
 * status, and quick links. The whole row is a clickable/keyboard-activatable
 * link; inner controls are guarded via closest() (same pattern the home tiles
 * use).
 */
function TimelineRow({
  project,
  menuOpen,
  onOpenMenu,
  onEdit,
  orgs,
  onMove,
}: {
  project: ProjectSummary;
  menuOpen: boolean;
  onOpenMenu: (open: boolean) => void;
  onEdit: (field: "rename" | "icon" | "delete") => void;
  orgs?: Organization[];
  onMove?: (project: ProjectSummary, orgId: string | null) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  useOutsideClick(rowRef, menuOpen, () => onOpenMenu(false));
  const router = useRouter();
  const ds = deployStatus(project.latest_deploy_state);
  const vercelUrl =
    project.vercel_project_name && project.vercel_project_name.trim()
      ? `https://${project.vercel_project_name}.vercel.app`
      : null;
  const repoUrl = project.github_repo_url ?? null;
  const repoName = project.github_repo_full_name ?? null;

  return (
    <div
      ref={rowRef}
      className="timeline-row"
      role="link"
      tabIndex={0}
      aria-label={`Open ${project.name}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a,button,input,select,[role="menu"]')) return;
        router.push(`/projects/${project.id}`);
      }}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
          e.preventDefault();
          router.push(`/projects/${project.id}`);
        }
      }}
    >
      <span
        className="timeline-time"
        title={`Last edited ${new Date(project.updated_at).toLocaleString()}`}
      >
        {relativeTime(project.updated_at)}
      </span>
      <span className={`timeline-node ${ds.dotClass}`} aria-hidden="true" />
      <div className="timeline-body">
        <div className="timeline-row-top">
          <ProjectAvatar project={project} />
          <Link
            href={`/projects/${project.id}`}
            className="timeline-name"
            onClick={(e) => e.stopPropagation()}
          >
            {project.name}
          </Link>
          <span className="status" title={ds.title}>
            <span className={`d ${ds.dotClass}`} /> {ds.label}
          </span>
        </div>
        <div className="timeline-meta">
          {project.description && (
            <span className="timeline-desc">{project.description}</span>
          )}
          {vercelUrl && (
            <CardChip
              href={vercelUrl}
              title={`Open ${vercelUrl}`}
              icon="▲"
              label={vercelUrl.replace(/^https:\/\//, "")}
            />
          )}
          {repoUrl && (
            <CardChip
              href={repoUrl}
              title={`Open ${repoName ?? repoUrl} on github.com`}
              icon="◉"
              label={repoName ?? "GitHub repo"}
            />
          )}
        </div>
      </div>
      <div className="timeline-actions">
        <Link
          href={`/projects/${project.id}`}
          onClick={(e) => e.stopPropagation()}
          className="btn-secondary timeline-open"
        >
          Open
        </Link>
        <button
          type="button"
          ref={menuBtnRef}
          className="proj-menu-btn"
          aria-label="Project actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onOpenMenu(!menuOpen);
          }}
        >
          ⋯
        </button>
        {menuOpen && (
          <ProjectActionsMenu
            anchorRef={menuBtnRef}
            onEdit={onEdit}
            onClose={() => onOpenMenu(false)}
            orgs={orgs}
            currentOrgId={project.org_id ?? null}
            onMove={onMove ? (orgId) => onMove(project, orgId) : undefined}
          />
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
