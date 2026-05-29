"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { createGithubRepoApi, fetchGithubStatus } from "@/lib/api";
import Modal from "./Modal";

/**
 * Topbar button: create a fresh GitHub repo for this project (always private),
 * push the current sandbox as the initial commit, and remember the repo URL on
 * the project record.
 *
 * States:
 *   - No GitHub OAuth: prompt to connect (linkout to /api/github/start).
 *   - Connected, no repo yet: "Create GitHub repo" button → POST .../create-github-repo.
 *   - Connected, repo exists: compact link to the repo URL on github.com.
 */
export default function GithubRepoButton({ projectId }: { projectId: string }) {
  const project = useStore((s) => s.project);
  const setProject = useStore((s) => s.setProject);
  const addSystem = useStore((s) => s.addSystem);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Guard against accidental repo creation — confirm before the (irreversible,
  // outward-facing) create + push.
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let cancel = false;
    fetchGithubStatus()
      .then((s) => {
        if (!cancel) setConnected(s.connected);
      })
      .catch(() => {
        if (!cancel) setConnected(false);
      });
    return () => {
      cancel = true;
    };
  }, []);

  // Auto-clear transient errors after a few seconds so the button doesn't sit
  // in a stuck error state.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 5_000);
    return () => clearTimeout(t);
  }, [error]);

  const repoUrl = project?.github_repo_url ?? null;
  const repoFullName = project?.github_repo_full_name ?? null;

  if (repoUrl) {
    return (
      <a
        href={repoUrl}
        target="_blank"
        rel="noreferrer"
        className="toggle-btn"
        title={`Open ${repoFullName ?? repoUrl} on github.com`}
        style={{ textDecoration: "none" }}
      >
        <GithubIcon />
        <span>{repoFullName ?? "GitHub"}</span>
      </a>
    );
  }

  if (connected === false) {
    return (
      <a
        href="/api/github/start?return=/projects"
        className="toggle-btn"
        title="Connect your GitHub account to create a repo for this project"
        style={{ textDecoration: "none" }}
      >
        <GithubIcon />
        <span>Connect GitHub</span>
      </a>
    );
  }

  async function doCreate(): Promise<void> {
    if (busy || !project) return;
    setConfirming(false);
    setBusy(true);
    setError(null);
    try {
      const r = await createGithubRepoApi(projectId);
      // Optimistically update the project in the store so the next render
      // shows the linked-repo state without refetching.
      setProject({
        ...project,
        github_repo_url: r.repo_url,
        github_repo_full_name: r.repo_full_name,
      });
      if (r.pushed) {
        addSystem(`GitHub repo created: ${r.repo_full_name} · pushed initial commit`);
      } else {
        addSystem(
          `GitHub repo created: ${r.repo_full_name} · initial push skipped (${r.push_note ?? "unknown reason"}). ` +
            `Push from the agent with: git remote add origin ${r.repo_url}.git ; git push -u origin ${r.default_branch}`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      addSystem(`GitHub repo creation failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => !busy && project && setConfirming(true)}
        disabled={busy || connected === null}
        className="toggle-btn"
        title="Create a fresh private GitHub repo for this project + push the initial commit"
      >
        <GithubIcon />
        <span>{busy ? "Creating…" : "Create GitHub repo"}</span>
      </button>

      {confirming && (
        <Modal
          title="Create a GitHub repo?"
          subtitle={project ? `For project “${project.name}”` : undefined}
          onClose={() => setConfirming(false)}
          width={460}
          footer={
            <>
              <span className="modal-status">This can’t be undone from here.</span>
              <div className="modal-actions">
                <button type="button" className="btn-ghost" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
                <button type="button" className="btn-primary" onClick={doCreate}>
                  Create repo
                </button>
              </div>
            </>
          }
        >
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--text-muted)" }}>
            This creates a new <strong>private</strong> GitHub repository on your connected account
            and pushes the current project as the initial commit. Use this once per project — if you
            already have a repo, push to it from the agent instead.
          </p>
        </Modal>
      )}
    </>
  );
}

function GithubIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.1c-3.3.7-4-1.6-4-1.6-.5-1.4-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.6-.3-5.4-1.3-5.4-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.5.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3" />
    </svg>
  );
}
