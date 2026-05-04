"use client";

import type { CurrentUser, DeploymentState, ProjectSummary } from "@uniqus/api-types";

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
    const port = isHttps ? "" : ":8787";
    return `${proto}://${window.location.hostname}${port}`;
  }
  return "http://localhost:8787";
}

const API_BASE = defaultApiBase();

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

export const fetchProjects = (): Promise<{ projects: ProjectSummary[] }> =>
  api("/api/projects");

export const createProjectApi = (
  name: string,
  description?: string,
): Promise<{ project: ProjectSummary }> =>
  api("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name, description }),
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

export const fetchGithubStatus = (): Promise<GithubStatus> =>
  api("/api/github/status");

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
