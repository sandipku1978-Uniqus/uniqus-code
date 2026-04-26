"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ProjectSummary } from "@uniqus/api-types";
import {
  fetchProjects,
  createProjectApi,
  importGithubApi,
  importZipApi,
} from "@/lib/api";

type Mode = "blank" | "zip" | "github";

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
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [mode, setMode] = useState<Mode>("blank");
  const [name, setName] = useState("");

  // Import form state
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [pat, setPat] = useState("");
  const [zipFile, setZipFile] = useState<File | null>(null);

  useEffect(() => {
    fetchProjects()
      .then((r) => setProjects(r.projects))
      .catch((e) => setError(e.message));
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (creating) return;
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      if (mode === "blank") {
        const { project } = await createProjectApi(name.trim());
        router.push(`/projects/${project.id}`);
        return;
      }
      if (mode === "github") {
        if (!repoUrl.trim()) {
          setError("repo URL is required");
          setCreating(false);
          return;
        }
        const { project } = await importGithubApi({
          name: name.trim(),
          repo_url: repoUrl.trim(),
          branch: branch.trim() || undefined,
          pat: pat.trim() || undefined,
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

  return (
    <>
      <nav className="topnav">
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Link href="/" className="lockup">
            <span className="mark">u</span>
            <span>uniqus</span>
            <span className="slash">/</span>
            <span className="code">code</span>
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
                  (mode === "github" && !repoUrl.trim()) ||
                  (mode === "zip" && !zipFile)
                }
              >
                {creating
                  ? mode === "blank"
                    ? "Creating…"
                    : "Importing…"
                  : mode === "blank"
                  ? "+ New project"
                  : mode === "zip"
                  ? "Upload & import"
                  : "Clone & import"}
              </button>
            </form>

            {mode === "github" && (
              <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
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
                  PAT is used once to clone, never stored. Use a fine-scoped token
                  with read access to the target repo only.
                </p>
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
                <Link key={p.id} href={`/projects/${p.id}`} className="proj">
                  <h3>{p.name}</h3>
                  <p className="desc">{p.description ?? "No description"}</p>
                  <div className="meta">
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span className="status">
                        <span className="d" /> Idle
                      </span>
                    </div>
                    <span>{relativeTime(p.updated_at)}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </main>
      </div>
    </>
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
