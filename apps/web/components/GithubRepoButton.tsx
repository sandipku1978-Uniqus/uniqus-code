"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useStore } from "@/lib/store";
import {
  createGithubRepoApi,
  disconnectProjectRepoApi,
  fetchGithubStatus,
  githubOauthStartUrl,
} from "@/lib/api";
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
  const [statusError, setStatusError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Guard against accidental repo creation — confirm before the (irreversible,
  // outward-facing) create + push.
  const [confirming, setConfirming] = useState(false);
  // Repo visibility chosen in the confirm dialog (UI/UX audit §D — was
  // hardcoded private with no choice).
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  // "Disconnect repo" confirm — clears the stale link so the user can relink.
  const [unlinking, setUnlinking] = useState(false);
  const searchParams = useSearchParams();
  const githubFlag = searchParams?.get("github") ?? null;
  const intentKey = `gate15.github.intent:${projectId}`;

  const loadStatus = useCallback(() => {
    let cancel = false;
    setConnected(null);
    setStatusError(null);
    fetchGithubStatus()
      .then((s) => {
        if (!cancel) setConnected(s.connected);
      })
      .catch((statusErr) => {
        if (!cancel) {
          setStatusError(
            statusErr instanceof Error ? statusErr.message : "Couldn't check GitHub",
          );
        }
      });
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => loadStatus(), [loadStatus, githubFlag]);

  useEffect(() => {
    if (!connected || githubFlag !== "connected") return;
    let resume = false;
    try {
      resume = sessionStorage.getItem(intentKey) === "create-repo";
      sessionStorage.removeItem(intentKey);
    } catch {
      // Storage may be unavailable; returning to the project still succeeds.
    }
    if (resume) setConfirming(true);
    const url = new URL(window.location.href);
    url.searchParams.delete("github");
    url.searchParams.delete("reason");
    window.history.replaceState({}, "", url.pathname + url.search);
  }, [connected, githubFlag, intentKey]);

  function startConnect(): void {
    try {
      sessionStorage.setItem(intentKey, "create-repo");
    } catch {
      // The return path still preserves the project even without auto-resume.
    }
    window.location.href = githubOauthStartUrl(
      `${window.location.origin}/projects/${encodeURIComponent(projectId)}`,
    );
  }

  // Auto-clear transient errors after a few seconds so the button doesn't sit
  // in a stuck error state.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 5_000);
    return () => clearTimeout(t);
  }, [error]);

  const repoUrl = project?.github_repo_url ?? null;
  const repoFullName = project?.github_repo_full_name ?? null;

  async function doDisconnect(): Promise<void> {
    if (busy || !project) return;
    setUnlinking(false);
    setBusy(true);
    setError(null);
    try {
      await disconnectProjectRepoApi(projectId);
      // Clear the link in the store so the button drops back to the
      // create/connect state — without this the user is stuck pointing at a
      // repo that may no longer exist.
      setProject({
        ...project,
        github_repo_url: null,
        github_repo_full_name: null,
      });
      addSystem(`Disconnected GitHub repo${repoFullName ? ` (${repoFullName})` : ""}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      addSystem(`Disconnecting GitHub repo failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  if (repoUrl) {
    return (
      <>
        <span className="repo-link-group">
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
          <button
            type="button"
            onClick={() => !busy && setUnlinking(true)}
            disabled={busy}
            className="repo-unlink-btn"
            title="Disconnect this repo (e.g. it was deleted/renamed on GitHub). Doesn't delete anything on GitHub."
            aria-label="Disconnect GitHub repo"
          >
            {busy ? "…" : "✕"}
          </button>
        </span>

        {unlinking && (
          <Modal
            title="Disconnect this GitHub repo?"
            subtitle={repoFullName ?? repoUrl ?? undefined}
            onClose={() => setUnlinking(false)}
            width={460}
            footer={
              <>
                <span className="modal-status">Doesn’t delete anything on GitHub.</span>
                <div className="modal-actions">
                  <button type="button" className="btn-ghost" onClick={() => setUnlinking(false)}>
                    Cancel
                  </button>
                  <button type="button" className="btn-primary" onClick={doDisconnect}>
                    Disconnect
                  </button>
                </div>
              </>
            }
          >
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--text-muted)" }}>
              This only removes the link stored on this project — the repository on
              github.com is left untouched. Use it if the repo was deleted or renamed
              on GitHub and you want to create or link a different one.
            </p>
          </Modal>
        )}
      </>
    );
  }

  if (statusError) {
    return (
      <button
        type="button"
        className="toggle-btn"
        onClick={() => loadStatus()}
        title="Connection status unavailable. Your GitHub connection may still be active."
      >
        <GithubIcon />
        <span>Retry GitHub status</span>
      </button>
    );
  }

  if (connected === false) {
    return (
      <button
        type="button"
        onClick={startConnect}
        className="toggle-btn"
        title="Connect GitHub, then return here to create a repo for this project"
      >
        <GithubIcon />
        <span>Connect GitHub</span>
      </button>
    );
  }

  async function doCreate(): Promise<void> {
    if (busy || !project) return;
    // Keep the dialog OPEN through the request so a failure is shown in the
    // dialog (not just a fleeting system line) — only close on success (§D).
    setBusy(true);
    setError(null);
    try {
      const r = await createGithubRepoApi(projectId, { private: visibility === "private" });
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
      setConfirming(false);
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
        title="Create a fresh GitHub repo for this project + push the initial commit"
      >
        <GithubIcon />
        <span>{busy ? "Creating…" : "Create GitHub repo"}</span>
      </button>

      {confirming && (
        <Modal
          title="Create a GitHub repo?"
          subtitle={project ? `For project “${project.name}”` : undefined}
          onClose={() => !busy && setConfirming(false)}
          width={460}
          footer={
            <>
              <span className={`modal-status${error ? " error" : ""}`} role="status" aria-live="polite">
                {error ?? "This can’t be undone from here."}
              </span>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button type="button" className="btn-primary" onClick={doCreate} disabled={busy}>
                  {busy ? "Creating…" : "Create repo"}
                </button>
              </div>
            </>
          }
        >
          <p style={{ margin: "0 0 12px", fontSize: 13, lineHeight: 1.6, color: "var(--text-muted)" }}>
            This creates a new GitHub repository on your connected account and pushes the current
            project as the initial commit. Use this once per project — if you already have a repo,
            push to it from the agent instead.
          </p>
          <fieldset style={{ border: 0, margin: 0, padding: 0, display: "grid", gap: 8 }}>
            <legend className="sr-only">Repository visibility</legend>
            {(["private", "public"] as const).map((v) => (
              <label
                key={v}
                style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer", fontSize: 13 }}
              >
                <input
                  type="radio"
                  name="repo-visibility"
                  value={v}
                  checked={visibility === v}
                  onChange={() => setVisibility(v)}
                  disabled={busy}
                  style={{ marginTop: 2 }}
                />
                <span>
                  <strong>{v === "private" ? "Private" : "Public"}</strong>
                  <span style={{ color: "var(--text-dim)", marginLeft: 6 }}>
                    {v === "private"
                      ? "Only you and collaborators can see it."
                      : "Anyone on the internet can see this repository."}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
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
