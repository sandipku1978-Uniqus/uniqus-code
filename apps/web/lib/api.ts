"use client";

import type {
  AccountSettings,
  AccountUsageStats,
  AgentTask,
  AuditEvent,
  BillingPlan,
  BillingStatus,
  Comment,
  CurrentUser,
  DeploymentState,
  DesignSystem,
  DesignTokens,
  FlowRunStatus,
  FlowStep,
  KnowledgeDocument,
  ProjectFlow,
  OrgMember,
  Organization,
  OrgUsageSummary,
  ProjectMember,
  ProjectSummary,
  Role,
  SkillLibrary,
  UploadedFileSummary,
} from "@gate15/api-types";

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

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let message = body || res.statusText || `Request failed (${res.status})`;
    let code: string | undefined;
    if (body) {
      try {
        const parsed = JSON.parse(body) as { error?: unknown; message?: unknown; code?: unknown };
        const parsedMessage = typeof parsed.error === "string"
          ? parsed.error
          : typeof parsed.message === "string"
            ? parsed.message
            : null;
        if (parsedMessage) message = parsedMessage;
        if (typeof parsed.code === "string") code = parsed.code;
      } catch {
        // Keep a non-JSON response body as the actionable error message.
      }
    }
    throw new ApiError(message, res.status, code);
  }
  return (await res.json()) as T;
}

export const fetchMe = (): Promise<{ user: CurrentUser }> => api("/api/me");

// ── Account settings (custom prompt + default skills) ─────────────────────────

export type { AccountSettings } from "@gate15/api-types";

export const fetchAccountSettingsApi = (): Promise<{ settings: AccountSettings }> =>
  api("/api/account/settings");

export const updateAccountSettingsApi = (
  patch: Partial<AccountSettings>,
): Promise<{ settings: AccountSettings }> =>
  api("/api/account/settings", {
    method: "PUT",
    body: JSON.stringify(patch),
  });

// ── Bring-your-own provider keys (F7) ─────────────────────────────────────────

export type ByokProvider = "anthropic" | "openai" | "google" | "zai";

/** Which providers this account has a key for (names only — values never leave the server). */
export const fetchAccountProviderKeysApi = (): Promise<{ providers: ByokProvider[] }> =>
  api("/api/account/provider-keys");

export const setAccountProviderKeyApi = (
  provider: ByokProvider,
  key: string,
): Promise<{ ok: true; providers: ByokProvider[] }> =>
  api("/api/account/provider-keys", {
    method: "PUT",
    body: JSON.stringify({ provider, key }),
  });

export const deleteAccountProviderKeyApi = (
  provider: ByokProvider,
): Promise<{ ok: true; providers: ByokProvider[] }> =>
  api("/api/account/provider-keys", {
    method: "DELETE",
    body: JSON.stringify({ provider }),
  });

/**
 * List the projects in a workspace (P3.1). `workspace` is "personal" (the
 * user's un-orged projects), an org id, or omitted/"all" for the legacy
 * aggregate of every project the user can reach.
 */
export const fetchProjects = (
  workspace?: string | null,
  signal?: AbortSignal,
): Promise<{ projects: ProjectSummary[] }> =>
  api(`/api/projects${workspace ? `?workspace=${encodeURIComponent(workspace)}` : ""}`, {
    signal,
  });

// ── Account usage rollup (dashboard widgets) ──────────────────────────────────

export type { AccountUsageStats } from "@gate15/api-types";

export const fetchUsageStatsApi = (): Promise<{ stats: AccountUsageStats }> =>
  api("/api/account/usage-stats");

// ── Platform billing (Stripe-hosted Checkout + Customer Portal) ──────────────

export type { BillingPlan, BillingStatus } from "@gate15/api-types";

export type CheckoutBillingPlan = Exclude<BillingPlan, "free">;

export const fetchBillingStatusApi = (): Promise<{ billing: BillingStatus }> =>
  api("/api/billing/status");

export const createBillingCheckoutApi = (input: {
  plan: CheckoutBillingPlan;
  max_monthly_usd?: number;
}): Promise<{ url: string }> =>
  api("/api/billing/checkout", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const fetchBillingCheckoutStatusApi = (
  sessionId: string,
): Promise<{ completed: boolean; fulfilled: boolean }> =>
  api(`/api/billing/checkout/status?session_id=${encodeURIComponent(sessionId)}`);

export const cancelBillingCheckoutApi = (
  attemptId: string,
): Promise<{ canceled: boolean; completed: boolean; session_id?: string }> =>
  api("/api/billing/checkout/cancel", {
    method: "POST",
    body: JSON.stringify({ attempt_id: attemptId }),
  });

export const createBillingPortalApi = (): Promise<{ url: string }> =>
  api("/api/billing/portal", { method: "POST" });

export const createProjectApi = (
  name: string,
  description?: string,
  orgId?: string | null,
): Promise<{ project: ProjectSummary }> =>
  api("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name, description, org_id: orgId ?? null }),
  });

/**
 * NL project creation: hand the orchestrator a free-form brief, get back
 * a created project plus a refined first message ready to fire as the
 * agent's opening turn. Costs one Haiku call (~$0.0003, ~200ms).
 * `orgId` creates the project inside that org workspace (null = personal).
 */
export const createProjectFromBriefApi = (
  brief: string,
  designSystemId?: string | null,
  orgId?: string | null,
): Promise<{ project: ProjectSummary; first_message: string }> =>
  api("/api/projects/from-brief", {
    method: "POST",
    body: JSON.stringify({ brief, design_system_id: designSystemId ?? null, org_id: orgId ?? null }),
  });

// ── Design systems (global, per-user) ─────────────────────────────────────────

export type {
  DesignSystem,
  DesignTokens,
  DesignFindings,
  DesignSystemDraft,
  DiscoveredComponent,
  SkillLibrary,
} from "@gate15/api-types";
import type { DesignSystemDraft as _DesignSystemDraft } from "@gate15/api-types";

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

// ── Skill libraries (reusable account-level Skills) ──────────────────────────
export const listSkillLibrariesApi = (): Promise<{ skills: SkillLibrary[] }> =>
  api("/api/skill-libraries");

export const getSkillLibraryApi = (id: string): Promise<{ skill: SkillLibrary }> =>
  api(`/api/skill-libraries/${id}`);

export const createSkillLibraryApi = (input: {
  name: string;
  description?: string | null;
  body?: string;
}): Promise<{ skill: SkillLibrary }> =>
  api("/api/skill-libraries", { method: "POST", body: JSON.stringify(input) });

export const updateSkillLibraryApi = (
  id: string,
  patch: { name?: string; description?: string | null; body?: string },
): Promise<{ skill: SkillLibrary }> =>
  api(`/api/skill-libraries/${id}`, { method: "PUT", body: JSON.stringify(patch) });

export const deleteSkillLibraryApi = (id: string): Promise<{ ok: true }> =>
  api(`/api/skill-libraries/${id}`, { method: "DELETE" });

/** AI-draft a skill from a brief. UNSAVED — the caller opens it in the editor. */
export const generateSkillLibraryApi = (
  brief: string,
): Promise<{ draft: { name: string; description: string; body: string } }> =>
  api("/api/skill-libraries/generate", { method: "POST", body: JSON.stringify({ brief }) });

export const setProjectSkillLibrariesApi = (
  projectId: string,
  skillLibraryIds: string[],
): Promise<{ ok: true; skill_library_ids: string[] }> =>
  api(`/api/projects/${projectId}/skill-libraries`, {
    method: "POST",
    body: JSON.stringify({ skill_library_ids: skillLibraryIds }),
  });

// ── Knowledge library (account-level documents the agent can search) ──────────

export type { KnowledgeDocument } from "@gate15/api-types";

export const listKnowledgeDocumentsApi = (): Promise<{ documents: KnowledgeDocument[] }> =>
  api("/api/knowledge-documents");

/** Fetch one document incl. its extracted plain text (for the preview pane). */
export const getKnowledgeDocumentApi = (
  id: string,
): Promise<{ document: KnowledgeDocument; content: string }> =>
  api(`/api/knowledge-documents/${id}`);

export const updateKnowledgeDocumentApi = (
  id: string,
  patch: { title?: string; description?: string | null },
): Promise<{ document: KnowledgeDocument }> =>
  api(`/api/knowledge-documents/${id}`, { method: "PUT", body: JSON.stringify(patch) });

export const deleteKnowledgeDocumentApi = (id: string): Promise<{ ok: true }> =>
  api(`/api/knowledge-documents/${id}`, { method: "DELETE" });

/**
 * Upload one or more documents to the account Knowledge library. Multipart (no
 * JSON Content-Type — the browser writes the boundary). The server stores the
 * raw bytes and extracts searchable text per file.
 */
export async function uploadKnowledgeDocumentsApi(
  files: File[],
): Promise<{ documents: KnowledgeDocument[] }> {
  const fd = new FormData();
  files.forEach((file) => fd.append("files", file));
  const res = await fetch(`${API_BASE}/api/knowledge-documents`, {
    method: "POST",
    credentials: "include",
    body: fd,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${body || res.statusText}`);
  }
  return (await res.json()) as { documents: KnowledgeDocument[] };
}

/** Download the original file bytes (credentialed fetch → blob → click). */
export async function downloadKnowledgeDocumentApi(
  id: string,
  fileName: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/knowledge-documents/${id}/raw`, {
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${body || res.statusText}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName || "document";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Agent-driven analysis → an UNSAVED draft (tokens + findings) from any source.
 * Multipart so it can carry a brief + reference images/PDFs or a .zip. Build the
 * FormData with `source` plus the fields that source needs (see the view).
 */
export const analyzeDesignSystemApi = async (
  form: FormData,
  onPhase?: (message: string) => void,
): Promise<{ draft: _DesignSystemDraft }> => {
  const res = await fetch(`${API_BASE}/api/design-systems/analyze`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  // Non-OK (e.g. 400/409 before streaming begins) is a JSON error body.
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${body || res.statusText}`);
  }
  // Otherwise it's a text/event-stream of phase/done/error events.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let draft: _DesignSystemDraft | null = null;
  let errMsg: string | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) >= 0) {
      const rawEvent = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      let event = "message";
      let data = "";
      for (const line of rawEvent.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      if (event === "phase") onPhase?.((parsed as { message?: string }).message ?? "");
      else if (event === "done") draft = (parsed as { draft: _DesignSystemDraft }).draft;
      else if (event === "error") errMsg = (parsed as { error?: string }).error ?? "analyze failed";
    }
  }
  if (errMsg) throw new Error(errMsg);
  if (!draft) throw new Error("analyze returned no draft");
  return { draft };
};

/** Stateless AI refinement: apply a free-text instruction to a tokens object. */
export const tweakDesignSystemApi = (
  tokens: DesignTokens,
  instruction: string,
): Promise<{ tokens: DesignTokens }> =>
  api("/api/design-systems/tweak", {
    method: "POST",
    body: JSON.stringify({ tokens, instruction }),
  });

/** Agent-driven creation: design a full system (colors, type, components) from
 *  a free-form brief. `name` is optional — the model proposes one when omitted. */
export const generateDesignSystemApi = (
  brief: string,
  name?: string,
): Promise<{ design_system: DesignSystem }> =>
  api("/api/design-systems/generate", {
    method: "POST",
    body: JSON.stringify({ brief, name }),
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
): Promise<{
  ok: true;
  path_mapping?: { from: string; to: string };
  removed_path?: string;
  is_directory?: boolean;
}> =>
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
  /** Workspace to import into (org id); null/omitted = personal. */
  org_id?: string | null;
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

// ── Figma ─────────────────────────────────────────────────────────────────────

export interface FigmaStatus {
  connected: boolean;
  handle: string | null;
  connected_at: string | null;
}

export const fetchFigmaStatus = (): Promise<FigmaStatus> => api("/api/figma/status");

export const disconnectFigmaApi = (): Promise<{ ok: true }> =>
  api("/api/figma/disconnect", { method: "POST" });

export function figmaOauthStartUrl(returnTo: string): string {
  const u = new URL(`${API_BASE}/api/figma/start`);
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
  database?: { host?: string; version?: string; postgres_engine?: string };
}

/** A Gate 15 project ↔ Supabase database link (from projects.supabase_project_ref). */
export interface SupabaseLinkInfo {
  ref: string;
  project_id: string;
  project_name: string;
}

export const fetchSupabaseProjects = (): Promise<{
  projects: SupabaseProjectInfo[];
  links?: SupabaseLinkInfo[];
}> => api("/api/supabase/projects");

/** Run SQL against one of the user's Supabase databases (Management API query). */
export interface SupabaseQueryResult {
  rows: unknown;
  requires_confirmation?: true;
  operation?: string;
  confirmation_token?: string;
}

export const supabaseQueryApi = (
  ref: string,
  query: string,
  confirmationToken?: string,
): Promise<SupabaseQueryResult> =>
  api(`/api/supabase/projects/${ref}/query`, {
    method: "POST",
    body: JSON.stringify({ query, confirmation_token: confirmationToken }),
  });

export const supabasePauseApi = (ref: string): Promise<{ ok: true }> =>
  api(`/api/supabase/projects/${ref}/pause`, { method: "POST" });

export const supabaseRestoreApi = (ref: string): Promise<{ ok: true }> =>
  api(`/api/supabase/projects/${ref}/restore`, { method: "POST" });

export const supabaseDeleteApi = (ref: string): Promise<{ ok: true }> =>
  api(`/api/supabase/projects/${ref}`, { method: "DELETE" });

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
  /** Workspace to import into (org id); null/omitted = personal. */
  orgId?: string | null;
}): Promise<{ project: ProjectSummary; import: ImportResultMeta }> {
  const fd = new FormData();
  fd.append("name", input.name);
  if (input.description) fd.append("description", input.description);
  if (input.orgId) fd.append("org_id", input.orgId);
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

// ── Preview share (C3) ─────────────────────────────────────────────────────────

/** Mint a revocable, expiring share link for a running preview server. */
export const createPreviewShareApi = (
  projectId: string,
  serverId: string,
): Promise<{ token: string; path: string; expires_at: string }> =>
  api(`/api/projects/${projectId}/preview/${serverId}/share`, { method: "POST" });

/** Revoke a share token (or all tokens for the server if `token` omitted). */
export const revokePreviewShareApi = (
  projectId: string,
  serverId: string,
  token?: string,
): Promise<{ ok: true }> =>
  api(`/api/projects/${projectId}/preview/${serverId}/share`, {
    method: "DELETE",
    body: JSON.stringify({ token: token ?? null }),
  });

// ── Saved smoke-flows (P2.4) ────────────────────────────────────────────────────

export type { ProjectFlow, FlowStep, FlowRunStatus } from "@gate15/api-types";

/** Per-project saved interaction flows the agent (or user) can replay. */
export const listFlowsApi = (projectId: string): Promise<{ flows: ProjectFlow[] }> =>
  api(`/api/projects/${projectId}/flows`);

export const createFlowApi = (
  projectId: string,
  body: { name: string; description?: string; steps: FlowStep[]; start_path?: string },
): Promise<{ flow: ProjectFlow }> =>
  api(`/api/projects/${projectId}/flows`, { method: "POST", body: JSON.stringify(body) });

export const deleteFlowApi = (projectId: string, flowId: string): Promise<{ ok: true }> =>
  api(`/api/projects/${projectId}/flows/${flowId}`, { method: "DELETE" });

export interface FlowRunResult {
  status: FlowRunStatus;
  summary: string;
  last_run_at: string;
  final_url: string;
  page_title: string;
  steps: { index: number; action: string; ok: boolean; detail?: string; url: string }[];
  assertion_failures: string[];
  console_errors: string[];
  failed_requests: string[];
  a11y_issues: { id: string; help: string; nodes: number }[];
}

/**
 * Replay a saved flow against a running preview. Streams each step live as an
 * `agent_preview_frame` over the WS (into the Preview (Agent) tab) and resolves
 * with the structured pass/fail result for the evidence card.
 */
export const runFlowApi = (
  projectId: string,
  flowId: string,
  body: { server_id?: string; url?: string; path?: string },
): Promise<FlowRunResult> =>
  api(`/api/projects/${projectId}/flows/${flowId}/run`, {
    method: "POST",
    body: JSON.stringify(body),
  });

// ── Export ────────────────────────────────────────────────────────────────────

/**
 * Download the project's source as a .zip (E2). Uses a credentialed fetch (the
 * API is cookie-authed and may be cross-origin, so a bare <a download> wouldn't
 * carry auth) → blob → object-URL → click.
 */
export async function downloadProjectZipApi(
  projectId: string,
  fileName: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/projects/${projectId}/export.zip`, {
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${body || res.statusText}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileName || "project"}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

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

export interface CheckpointFileDelta {
  path: string;
  added: number;
  removed: number;
}

export const fetchCheckpointDiffApi = (
  projectId: string,
  sha: string,
): Promise<{ ok: true; diff: string; truncated: boolean; files: CheckpointFileDelta[] }> =>
  api(`/api/projects/${projectId}/checkpoints/${sha}/diff`);

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
  allowed_hosts: string[];
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
  body: {
    name: string;
    value: string;
    env?: string;
    description?: string | null;
    allowed_hosts?: string[];
  },
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
): Promise<{ content: string; path: string; trusted?: boolean; trust?: "trusted" | "untrusted_import" }> =>
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

// Fetch a pack's body WITHOUT applying it, so the editor can apply it into its
// local buffer and only persist on Save (C-5). This replaces the old flow where
// "Apply" POSTed and the server overwrote skills.md immediately — contradicting
// the "nothing is saved until you click Save" promise and making Undo a no-op
// against the server.
export const fetchSkillPackBodyApi = (
  packId: string,
): Promise<{ id: string; name: string; body: string }> =>
  api(`/api/skill-packs/${packId}`);

export const applySkillPackApi = (
  projectId: string,
  packId: string,
  mode: "replace" | "append" = "replace",
): Promise<{ ok: true; content: string }> =>
  api(`/api/projects/${projectId}/skill-packs/${packId}`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  });

export interface ProjectUploadFailure {
  input_index: number;
  name: string;
  path: string;
  failed_stage: "host" | "vm" | "storage";
  error: string;
  rollback_complete: boolean;
}

export interface ProjectUploadResult {
  files: UploadedFileSummary[];
  failures: ProjectUploadFailure[];
}

export async function uploadProjectFilesApi(input: {
  projectId: string;
  files: File[];
  signal?: AbortSignal;
}): Promise<ProjectUploadResult> {
  const fd = new FormData();
  input.files.forEach((file) => fd.append("files", file));

  const res = await fetch(`${API_BASE}/api/projects/${input.projectId}/uploads`, {
    method: "POST",
    credentials: "include",
    body: fd,
    signal: input.signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${body || res.statusText}`);
  }
  const body = (await res.json()) as Partial<ProjectUploadResult>;
  return { files: body.files ?? [], failures: body.failures ?? [] };
}

// ── Guest / education accounts ────────────────────────────────────────────────

export interface GuestCreateResult {
  recovery_code: string;
  display_name: string;
}

/**
 * Create a free guest account. Hits the web app's own route handler (not the
 * orchestrator directly) so the gate15-guest cookie is set first-party with the
 * web app's WORKOS_COOKIE_DOMAIN — otherwise the cookie is host-only to the
 * orchestrator and the dashboard never sees it. Returns the one-time code.
 */
export const createGuestApi = async (
  captchaToken?: string | null,
): Promise<GuestCreateResult> => {
  const res = await fetch("/api/guest", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ captcha_token: captchaToken ?? "" }),
  });
  if (!res.ok) {
    // Surface the server's friendly message (e.g. the CAPTCHA rejection) rather
    // than the raw JSON envelope.
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `guest signup failed: ${res.statusText}`);
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
  captchaToken?: string | null,
): Promise<{ display_name: string | null }> => {
  let res: Response;
  try {
    res = await fetch("/api/guest/restore", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recovery_code: recoveryCode, captcha_token: captchaToken ?? "" }),
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

// ── Collaboration: project members, orgs, comments, tasks, audit (P3/P8/P10) ──

export const fetchProjectMembersApi = (projectId: string): Promise<{ members: ProjectMember[] }> =>
  api(`/api/projects/${projectId}/members`);

export const addProjectMemberApi = (
  projectId: string,
  email: string,
  role: Role,
): Promise<{ member: ProjectMember }> =>
  api(`/api/projects/${projectId}/members`, { method: "POST", body: JSON.stringify({ email, role }) });

export const setProjectMemberRoleApi = (
  projectId: string,
  userId: string,
  role: Role,
): Promise<{ ok: true }> =>
  api(`/api/projects/${projectId}/members/${userId}`, { method: "PATCH", body: JSON.stringify({ role }) });

export const removeProjectMemberApi = (projectId: string, userId: string): Promise<{ ok: true }> =>
  api(`/api/projects/${projectId}/members/${userId}`, { method: "DELETE" });

export const fetchOrgsApi = (): Promise<{ orgs: Organization[] }> => api("/api/orgs");

export const createOrgApi = (name: string): Promise<{ org: Organization }> =>
  api("/api/orgs", { method: "POST", body: JSON.stringify({ name }) });

/** Org detail + the caller's role on it. */
export const fetchOrgApi = (
  orgId: string,
  signal?: AbortSignal,
): Promise<{ org: Organization; role: Role }> =>
  api(`/api/orgs/${orgId}`, { signal });

export const renameOrgApi = (orgId: string, name: string): Promise<{ ok: true }> =>
  api(`/api/orgs/${orgId}`, { method: "PATCH", body: JSON.stringify({ name }) });

export const deleteOrgApi = (orgId: string): Promise<{ ok: true }> =>
  api(`/api/orgs/${orgId}`, { method: "DELETE" });

/** Leave an org (remove yourself). The sole owner can't — they must transfer or delete. */
export const leaveOrgApi = (orgId: string): Promise<{ ok: true }> =>
  api(`/api/orgs/${orgId}/leave`, { method: "POST" });

/** Org month-to-date spend vs. cap, for the Usage card. */
export const fetchOrgUsageApi = (
  orgId: string,
  signal?: AbortSignal,
): Promise<{ usage: OrgUsageSummary }> =>
  api(`/api/orgs/${orgId}/usage`, { signal });

/** Move a project into an org workspace (orgId) or back to personal (null). */
export const setProjectOrgApi = (
  projectId: string,
  orgId: string | null,
): Promise<{ project: ProjectSummary | null }> =>
  api(`/api/projects/${projectId}/org`, { method: "PATCH", body: JSON.stringify({ org_id: orgId }) });

export const fetchOrgMembersApi = (
  orgId: string,
  signal?: AbortSignal,
): Promise<{ members: OrgMember[] }> =>
  api(`/api/orgs/${orgId}/members`, { signal });

export const addOrgMemberApi = (orgId: string, email: string, role: Role): Promise<{ ok: true }> =>
  api(`/api/orgs/${orgId}/members`, { method: "POST", body: JSON.stringify({ email, role }) });

export const setOrgBudgetApi = (orgId: string, monthlyBudgetUsd: number | null): Promise<{ ok: true }> =>
  api(`/api/orgs/${orgId}/budget`, { method: "PATCH", body: JSON.stringify({ monthly_budget_usd: monthlyBudgetUsd }) });

export const setOrgMemberRoleApi = (orgId: string, userId: string, role: Role): Promise<{ ok: true }> =>
  api(`/api/orgs/${orgId}/members/${userId}`, { method: "PATCH", body: JSON.stringify({ role }) });

export const removeOrgMemberApi = (orgId: string, userId: string): Promise<{ ok: true }> =>
  api(`/api/orgs/${orgId}/members/${userId}`, { method: "DELETE" });

export const fetchCommentsApi = (projectId: string): Promise<{ comments: Comment[] }> =>
  api(`/api/projects/${projectId}/comments`);

export const addCommentApi = (
  projectId: string,
  input: { target_kind: Comment["target_kind"]; target_ref?: string | null; body: string },
): Promise<{ comment: Comment }> =>
  api(`/api/projects/${projectId}/comments`, { method: "POST", body: JSON.stringify(input) });

export const resolveCommentApi = (
  projectId: string,
  commentId: string,
  resolved: boolean,
): Promise<{ ok: true }> =>
  api(`/api/projects/${projectId}/comments/${commentId}`, { method: "PATCH", body: JSON.stringify({ resolved }) });

export const fetchAgentTasksApi = (
  projectId: string,
): Promise<{ tasks: AgentTask[]; task_worker_enabled: boolean }> =>
  api(`/api/projects/${projectId}/tasks`);

export const createAgentTaskApi = (
  projectId: string,
  input: { title: string; prompt: string; branch?: string; acceptance_criteria?: string },
): Promise<{ task: AgentTask }> =>
  api(`/api/projects/${projectId}/tasks`, { method: "POST", body: JSON.stringify(input) });

export const cancelAgentTaskApi = (projectId: string, taskId: string): Promise<{ ok: true }> =>
  api(`/api/projects/${projectId}/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ status: "canceled" }) });

/** Project audit log (now covers the expanded P10.3 kinds). */
export const fetchProjectAuditApi = (projectId: string): Promise<{ events: AuditEvent[] }> =>
  api(`/api/projects/${projectId}/audit`);

/** Switch the project's tracked branch (P1.2). */
export const switchProjectBranchApi = (
  projectId: string,
  branch: string,
): Promise<{ ok: true; linked_branch: string }> =>
  api(`/api/projects/${projectId}/branch`, { method: "POST", body: JSON.stringify({ branch }) });
