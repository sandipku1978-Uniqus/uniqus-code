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
