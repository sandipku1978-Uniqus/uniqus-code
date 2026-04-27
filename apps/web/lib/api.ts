"use client";

import type { CurrentUser, ProjectSummary } from "@uniqus/api-types";

const API_BASE =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ??
  (typeof window !== "undefined" ? `http://${window.location.hostname}:8787` : "http://localhost:8787");

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
}): Promise<{ project: ProjectSummary; import: ImportResultMeta }> =>
  api("/api/projects/import-github", {
    method: "POST",
    body: JSON.stringify(input),
  });

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
