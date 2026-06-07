"use client";

import type {
  AccountSettings,
  AccountUsageStats,
  CurrentUser,
  DeploymentState,
  DesignSystem,
  DesignTokens,
  ProjectSummary,
  UploadedFileSummary,
} from "@uniqus/api-types";

// Production deployments must set NEXT_PUBLIC_ORCHESTRATOR_URL — the
// orchestrator usually runs on a different hostname (Railway etc.) than the
// web app (Vercel). The window-derived fallback is for local dev only and
// matches the page's TLS state so we don't trigger mixed-content blocks.
function defaultApiBase(): string {
  if (process.env.NEXT_PUBLIC_ORCHESTRATOR_URL) {
    return process.env.NEXT_PUBLIC_ORCHESTRATOR_URL;
  }
  if (typeof window !== "undefined") {
    const isHttps = window.location.protocol === "https:";
    const proto = isHttps ? "https" : "http";
    // Plain http (the documented local-dev setup: web on :4242) ALWAYS targets
    // the orchestrator on :8787 — never the page's own port, which would point
    // REST at the Next.js dev server and 404 every call. This mirrors
    // ws-client.ts and PreviewPanel.tsx. For https (self-host behind a proxy)
    // assume same-origin and honor the page's explicit port (e.g. :3001).
    const port = isHttps ? (window.location.port ? `:${window.location.port}` : "") : ":8787";
    return `${proto}://${window.location.hostname}${port}`;
  }
  return "http://localhost:8787";
}

const API_BASE = defaultApiBase();
export function getApiBase(): string { return API_BASE; }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${body || res.statusText}`);
  }
  return (await res.json()) as T;
}

export const fetchMe = (): Promise<{ user: CurrentUser }> => api("/api/me");

// ── Account settings (custom prompt + default skills) ─────────────────────────

export type { AccountSettings } from "@uniqus/api-types";

export const fetchAccountSettingsApi = (): Promise<{ settings: AccountSettings }> =>
  api("/api/account/settings");

export const updateAccountSettingsApi = (
  patch: Partial<AccountSettings>,
): Promise<{ settings: AccountSettings }> =>
  api("/api/account/settings", {
    method: "PUT",
    body: JSON.stringify(patch),
  });

export const fetchProjects = (): Promise<{ projects: ProjectSummary[] }> =>
  api("/api/projects");

// ── Account usage rollup (dashboard widgets) ──────────────────────────────────

export type { AccountUsageStats } from "@uniqus/api-types";

export const fetchUsageStatsApi = (): Promise<{ stats: AccountUsageStats }> =>
  api("/api/account/usage-stats");

export const createProjectApi = (
  name: string,
  description?: string,
): Promise<{ project: ProjectSummary }> =>
  api("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name, description }),
  });

/**
 * NL project creation: hand the orchestrator a free-form brief, get back
 * a created project plus a refined first message ready to fire as the
 * agent's opening turn. Costs one Haiku call (~$0.0003, ~200ms).
 */
export const createProjectFromBriefApi = (
  brief: string,
  designSystemId?: string | null,
): Promise<{ project: ProjectSummary; first_message: string }> =>
  api("/api/projects/from-brief", {
    method: "POST",
    body: JSON.stringify({ brief, design_system_id: designSystemId ?? null }),
  });

// ── Design systems (global, per-user) ─────────────────────────────────────────

export type { DesignSystem, DesignTokens } from "@uniqus/api-types";

export const listDesignSystemsApi = (): Promise<{ design_systems: DesignSystem[] }> =>
  api("/api/design-systems");

export const getDesignSystemApi = (id: string): Promise<{ design_system: DesignSystem }> =>
  api(`/api/design-systems/${id}`);

export const createDesignSystemApi = (
  name: string,
  tokens?: DesignTokens,
): Promise<{ design_system: DesignSystem }> =>
  api("/api/design-systems", { method: "POST", body: JSON.stringify({ name, tokens }) });

export const updateDesignSystemApi = (
  id: string,
  patch: { name?: string; tokens?: DesignTokens },
): Promise<{ design_system: DesignSystem }> =>
  api(`/api/design-systems/${id}`, { method: "PUT", body: JSON.stringify(patch) });

export const deleteDesignSystemApi = (id: string): Promise<{ ok: true }> =>
  api(`/api/design-systems/${id}`, { method: "DELETE" });

export const setProjectDesignSystemApi = (
  projectId: string,
  designSystemId: string | null,
): Promise<{ ok: true; design_system_id: string | null }> =>
  api(`/api/projects/${projectId}/design-system`, {
    method: "POST",
    body: JSON.stringify({ design_system_id: designSystemId }),
  });

/** Import a codebase from GitHub and let the agent infer a design system from it.
 *  `useOauth` clones with the user's stored GitHub token (for private repos
 *  picked from the connected-account dropdown); omit it for public URLs/PATs. */
export const inferDesignSystemGithubApi = (
  name: string,
  repoUrl: string,
  opts?: { branch?: string; pat?: string; useOauth?: boolean },
): Promise<{ design_system: DesignSystem }> =>
  api("/api/design-systems/infer-github", {
    method: "POST",
    body: JSON.stringify({
      name,
      repo_url: repoUrl,
      branch: opts?.branch,
      pat: opts?.pat,
      use_oauth: opts?.useOauth,
    }),
  });

/** Import a .zip codebase and infer a design system. Multipart (no JSON helper). */
export async function inferDesignSystemZipApi(
  name: string,
  file: File,
): Promise<{ design_system: DesignSystem }> {
  const fd = new FormData();
  fd.append("name", name);
  fd.append("file", file);
  const res = await fetch(`${API_BASE}/api/design-systems/infer-zip`, {
    method: "POST",
    credentials: "include",
    body: fd,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${body || res.statusText}`);
  }
  return (await res.json()) as { design_system: DesignSystem };
}

export interface CreateGithubRepoResult {
  repo_url: string;
  repo_full_name: string;
  default_branch: string;
  /** True when the orchestrator was able to push the initial commit. */
  pushed: boolean;
  /** Set when push was attempted but failed — surface to user as a hint. */
  push_note?: string;
}

/**
 * Create a fresh GitHub repo for a project, using the user's existing GitHub
 * OAuth token. Defaults to private; pass `private: false` for a public repo.
 * Best-effort initial push from the host-side sandbox dir; pushed=false means
 * the user needs to push from the agent themselves.
 */
export const createGithubRepoApi = (
  projectId: string,
  body: { name?: string; private?: boolean } = {},
): Promise<CreateGithubRepoResult> =>
  api(`/api/projects/${projectId}/create-github-repo`, {
    method: "POST",
    body: JSON.stringify(body),
  });

/**
 * Clear a project's linked GitHub repo (metadata only — does NOT delete the
 * repo on GitHub). Lets a user unstick a project that points at a repo they
 * deleted/renamed on GitHub's side, then create or link a different one.
 */
export const disconnectProjectRepoApi = (
  projectId: string,
): Promise<{ ok: true }> =>
  api(`/api/projects/${projectId}/github-repo`, { method: "DELETE" });

// ── Chat sessions (Phase 2.x) ────────────────────────────────────────────────

export interface ChatSessionSummary {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export const fetchChatSessionsApi = (
  projectId: string,
): Promise<{ sessions: ChatSessionSummary[] }> =>
  api(`/api/projects/${projectId}/chat-sessions`);

export const createChatSessionApi = (
  projectId: string,
  title?: string,
): Promise<{ session: ChatSessionSummary }> =>
  api(`/api/projects/${projectId}/chat-sessions`, {
    method: "POST",
    body: JSON.stringify({ title }),
  });

export const renameChatSessionApi = (
  projectId: string,
  sessionId: string,
  title: string,
): Promise<{ session: ChatSessionSummary }> =>
  api(`/api/projects/${projectId}/chat-sessions/${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });

export const deleteChatSessionApi = (
  projectId: string,
  sessionId: string,
): Promise<{ ok: true }> =>
  api(`/api/projects/${projectId}/chat-sessions/${sessionId}`, {
    method: "DELETE",
  });

export const updateProjectApi = (
  projectId: string,
  patch: { name?: string; description?: string | null; icon?: string | null },
): Promise<{ project: ProjectSummary }> =>
  api(`/api/projects/${projectId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

export const deleteProjectApi = (
  projectId: string,
): Promise<{ ok: true }> =>
  api(`/api/projects/${projectId}`, { method: "DELETE" });

export const fileOpApi = (
  projectId: string,
  body:
    | { op: "create_dir"; path: string }
    | { op: "rename"; from: string; to: string }
    | { op: "delete"; path: string },
): Promise<{ ok: true }> =>
  api(`/api/projects/${projectId}/files`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export interface ImportResultMeta {
  files_imported: number;
  total_bytes: number;
  stripped_root: string | null;
}

export const importGithubApi = (input: {
  name: string;
  description?: string;
  repo_url: string;
  branch?: string;
  pat?: string;
  use_oauth?: boolean;
  /** When true, link the created project to the cloned repo. */
  link_repo?: boolean;
  /** owner/repo, when known (OAuth repo picker). */
  repo_full_name?: string;
}): Promise<{ project: ProjectSummary; import: ImportResultMeta }> =>
  api("/api/projects/import-github", {
    method: "POST",
    body: JSON.stringify(input),
  });

export interface GithubStatus {
  connected: boolean;
  login: string | null;
  connected_at: string | null;
}

export interface GithubRepoSummary {
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  clone_url: string;
  updated_at: string;
}

// Accepts an optional AbortSignal so callers can cancel an in-flight status
// fetch when rapid re-fires would otherwise let a stale response stomp newer
// state (see ProjectPicker's github-status effect).
export const fetchGithubStatus = (signal?: AbortSignal): Promise<GithubStatus> =>
  api("/api/github/status", { signal });

export const fetchGithubRepos = (): Promise<{ repos: GithubRepoSummary[] }> =>
  api("/api/github/repos");

export const disconnectGithubApi = (): Promise<{ ok: true }> =>
  api("/api/github/disconnect", { method: "POST" });

/**
 * Build the absolute URL the user's browser navigates to when starting the
 * GitHub OAuth dance. Top-level navigation (not fetch) — the orchestrator
 * 302s to github.com, then back to /api/github/callback, then back to
 * `returnTo` (which we set to the current page so the user lands where they
 * started).
 */
export function githubOauthStartUrl(returnTo: string): string {
  const u = new URL(`${API_BASE}/api/github/start`);
  u.searchParams.set("return", returnTo);
  return u.toString();
}

// ── Vercel ────────────────────────────────────────────────────────────────────

export interface VercelStatus {
  connected: boolean;
  user_login: string | null;
  team_id: string | null;
  connected_at: string | null;
}

export const fetchVercelStatus = (): Promise<VercelStatus> =>
  api("/api/vercel/status");

export const disconnectVercelApi = (): Promise<{ ok: true }> =>
  api("/api/vercel/disconnect", { method: "POST" });

export function vercelOauthStartUrl(returnTo: string): string {
  const u = new URL(`${API_BASE}/api/vercel/start`);
  u.searchParams.set("return", returnTo);
  return u.toString();
}

// ── Supabase ────────────────────────────────────────────────────────────────────

export interface SupabaseStatus {
  connected: boolean;
  org_id: string | null;
  org_name: string | null;
  connected_at: string | null;
}

export const fetchSupabaseStatus = (): Promise<SupabaseStatus> =>
  api("/api/supabase/status");

export const disconnectSupabaseApi = (): Promise<{ ok: true }> =>
  api("/api/supabase/disconnect", { method: "POST" });

export function supabaseOauthStartUrl(returnTo: string): string {
  const u = new URL(`${API_BASE}/api/supabase/start`);
  u.searchParams.set("return", returnTo);
  return u.toString();
}

export interface SupabaseProjectInfo {
  id?: string;
  ref?: string;
  name?: string;
  region?: string;
  status?: string;
  organization_id?: string;
  created_at?: string;
}

export const fetchSupabaseProjects = (): Promise<{ projects: SupabaseProjectInfo[] }> =>
  api("/api/supabase/projects");

// ── Deployments ───────────────────────────────────────────────────────────────

export interface DeploymentSummary {
  id: string;
  vercel_deployment_id: string;
  vercel_url: string | null;
  state: DeploymentState;
  error_message: string | null;
  target: "production" | "preview";
  created_at: string;
}

export interface DeployStartResponse {
  deployment_id: string;
  vercel_deployment_id: string;
  vercel_url: string;
  inspector_url: string;
  state: DeploymentState;
}

export const deployProjectApi = (
  projectId: string,
  body: { env: Record<string, string>; target?: "production" | "preview" },
): Promise<DeployStartResponse> =>
  api(`/api/projects/${projectId}/deploy`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const listDeploymentsApi = (
  projectId: string,
): Promise<{ deployments: DeploymentSummary[] }> =>
  api(`/api/projects/${projectId}/deployments`);

/**
 * Upload a zip via multipart/form-data. Doesn't go through the JSON `api()` helper
 * because we mustn't set Content-Type — the browser writes the boundary itself.
 */
export async function importZipApi(input: {
  name: string;
  description?: string;
  file: File;
}): Promise<{ project: ProjectSummary; import: ImportResultMeta }> {
  const fd = new FormData();
  fd.append("name", input.name);
  if (input.description) fd.append("description", input.description);
  fd.append("file", input.file);

  const res = await fetch(`${API_BASE}/api/projects/import-zip`, {
    method: "POST",
    credentials: "include",
    body: fd,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${body || res.statusText}`);
  }
  return (await res.json()) as { project: ProjectSummary; import: ImportResultMeta };
}

export const runProjectApi = (
  projectId: string,
): Promise<{
  id: string;
  port: number;
  command: string;
  public_url: string;
  config_source: "agent" | "user" | "detected";
}> =>
  api(`/api/projects/${projectId}/run`, {
    method: "POST",
    body: "{}",
  });

export const stopServerApi = (
  projectId: string,
  serverId: string,
): Promise<{ ok: true }> =>
  api(`/api/projects/${projectId}/servers/${serverId}`, { method: "DELETE" });

// ── Fly.io deploy ─────────────────────────────────────────────────────────────

export interface DeployTargetSummary {
  shape: "node" | "python" | "go" | "static" | "unknown";
  recommended: "vercel" | "fly" | null;
}

export const fetchDeployTargetApi = (
  projectId: string,
): Promise<DeployTargetSummary> =>
  api(`/api/projects/${projectId}/deploy-target`);

export const flyDeployApi = (
  projectId: string,
  body: { app_name: string; region?: string; env_vars?: Record<string, string> },
): Promise<{ ok: boolean; app: string; url: string; log: string }> =>
  api(`/api/projects/${projectId}/fly-deploy`, {
    method: "POST",
    body: JSON.stringify(body),
  });

// ── Checkpoints ───────────────────────────────────────────────────────────────

export interface CheckpointMeta {
  sha: string;
  short_sha: string;
  message: string;
  created_at: string;
}

export const fetchCheckpointsApi = (
  projectId: string,
): Promise<{ checkpoints: CheckpointMeta[] }> =>
  api(`/api/projects/${projectId}/checkpoints`);

export const restoreCheckpointApi = (
  projectId: string,
  sha: string,
): Promise<{ ok: true; restored_to: string }> =>
  api(`/api/projects/${projectId}/checkpoints/${sha}/restore`, { method: "POST" });

// ── Secrets ───────────────────────────────────────────────────────────────────

export interface SecretSummary {
  id: string;
  name: string;
  /**
   * Environment slot. Same `name` can exist in multiple envs with different
   * values (e.g. "production" vs "development"). Defaults to "default" when
   * the caller doesn't specify one.
   */
  env: string;
  description: string | null;
  updated_at: string;
}

/**
 * env="*" returns secrets across every env (default behavior — the modal
 * shows them all so the user can manage multi-env setups). A specific env
 * name (e.g. "production") filters to that env's slot.
 */
export const fetchSecretsApi = (
  projectId: string,
  env: string = "*",
): Promise<{ secrets: SecretSummary[] }> =>
  api(`/api/projects/${projectId}/secrets?env=${encodeURIComponent(env)}`);

export const upsertSecretApi = (
  projectId: string,
  body: { name: string; value: string; env?: string; description?: string | null },
): Promise<{ secret: SecretSummary }> =>
  api(`/api/projects/${projectId}/secrets`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const deleteSecretApi = (
  projectId: string,
  name: string,
  env: string = "default",
): Promise<{ ok: true }> =>
  api(
    `/api/projects/${projectId}/secrets/${name}?env=${encodeURIComponent(env)}`,
    { method: "DELETE" },
  );

// ── Slash commands ────────────────────────────────────────────────────────────

export interface SlashCommandSummary {
  name: string;
  summary: string;
  source: "builtin" | "project";
}

export const fetchSlashCommandsApi = (
  projectId: string,
): Promise<{ commands: SlashCommandSummary[] }> =>
  api(`/api/projects/${projectId}/slash-commands`);

// ── Skills ────────────────────────────────────────────────────────────────────

export const fetchSkillsApi = (
  projectId: string,
): Promise<{ content: string; path: string }> =>
  api(`/api/projects/${projectId}/skills`);

export const writeSkillsApi = (
  projectId: string,
  content: string,
): Promise<{ ok: true }> =>
  api(`/api/projects/${projectId}/skills`, {
    method: "PUT",
    body: JSON.stringify({ content }),
  });

export interface SkillPackSummary {
  id: string;
  name: string;
  summary: string;
}

export const fetchSkillPacksApi = (): Promise<{ packs: SkillPackSummary[] }> =>
  api(`/api/skill-packs`);

export const applySkillPackApi = (
  projectId: string,
  packId: string,
  mode: "replace" | "append" = "replace",
): Promise<{ ok: true; content: string }> =>
  api(`/api/projects/${projectId}/skill-packs/${packId}`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  });

export async function uploadProjectFilesApi(input: {
  projectId: string;
  files: File[];
}): Promise<{ files: UploadedFileSummary[] }> {
  const fd = new FormData();
  input.files.forEach((file) => fd.append("files", file));

  const res = await fetch(`${API_BASE}/api/projects/${input.projectId}/uploads`, {
    method: "POST",
    credentials: "include",
    body: fd,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${body || res.statusText}`);
  }
  return (await res.json()) as { files: UploadedFileSummary[] };
}

// ── Guest / education accounts ────────────────────────────────────────────────

export interface GuestCreateResult {
  recovery_code: string;
  display_name: string;
}

/**
 * Create a free guest account. Hits the web app's own route handler (not the
 * orchestrator directly) so the uniqus-guest cookie is set first-party with the
 * web app's WORKOS_COOKIE_DOMAIN — otherwise the cookie is host-only to the
 * orchestrator and the dashboard never sees it. Returns the one-time code.
 */
export const createGuestApi = async (): Promise<GuestCreateResult> => {
  const res = await fetch("/api/guest", {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`guest signup failed: ${body || res.statusText}`);
  }
  return (await res.json()) as GuestCreateResult;
};

/** Error thrown by guest restore, carrying the HTTP status so the UI can
 *  distinguish an unrecognised code (401/404) from a transient failure. */
export class RestoreError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "RestoreError";
    this.status = status;
  }
}

/** Re-attach to an existing guest account via its recovery code. */
export const restoreGuestApi = async (
  recoveryCode: string,
): Promise<{ display_name: string | null }> => {
  let res: Response;
  try {
    res = await fetch("/api/guest/restore", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recovery_code: recoveryCode }),
    });
  } catch {
    // Network failure (offline, DNS, CORS) — status 0 signals "transient".
    throw new RestoreError(0, "network error");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new RestoreError(res.status, `restore failed: ${body || res.statusText}`);
  }
  return (await res.json()) as { display_name: string | null };
};

/** Re-display the logged-in guest's own recovery code (for the yellow banner). */
export const fetchGuestRecoveryCodeApi = (): Promise<{
  recovery_code: string | null;
}> => api("/api/guest/recovery-code");
