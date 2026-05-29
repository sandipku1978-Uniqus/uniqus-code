"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import BrandLockup from "./BrandLockup";
import {
  fetchGithubStatus,
  disconnectGithubApi,
  githubOauthStartUrl,
  type GithubStatus,
} from "@/lib/api";

export default function SettingsView({
  userEmail,
  userName,
  signOutUrl,
  accountType = "standard",
}: {
  userEmail: string | null;
  userName: string | null;
  signOutUrl: string;
  accountType?: "standard" | "guest";
}) {
  const isGuest = accountType === "guest";
  const [github, setGithub] = useState<GithubStatus | null>(null);

  useEffect(() => {
    if (isGuest) return;
    fetchGithubStatus()
      .then(setGithub)
      .catch(() => setGithub({ connected: false, login: null, connected_at: null }));
  }, [isGuest]);

  async function handleDisconnectGithub(): Promise<void> {
    try {
      await disconnectGithubApi();
      setGithub({ connected: false, login: null, connected_at: null });
    } catch {
      /* surfaced via the status row staying connected; no-op */
    }
  }

  return (
    <>
      <nav className="topnav">
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Link href="/" style={{ textDecoration: "none" }}>
            <BrandLockup />
          </Link>
        </div>
        <div className="right">
          <Link href="/projects" className="btn-ghost" style={{ fontSize: 12 }}>
            ← Back to projects
          </Link>
        </div>
      </nav>

      <div className="settings-wrap">
        <h1>Settings</h1>
        <p className="settings-lede">
          Account and workspace preferences. Some items are project-scoped and
          live in the workspace itself — see the pointers below.
        </p>

        {/* Profile — functional */}
        <div className="settings-card">
          <h2>Profile</h2>
          <p className="settings-card-sub">Who you’re signed in as.</p>
          <div className="settings-row">
            <span className="k">Name</span>
            <span className="v">{userName ?? "—"}</span>
          </div>
          <div className="settings-row">
            <span className="k">Email</span>
            <span className="v">{userEmail ?? (isGuest ? "guest session" : "—")}</span>
          </div>
          <div className="settings-row">
            <span className="k">Account type</span>
            <span className="v">{isGuest ? "Guest" : "Standard"}</span>
          </div>
          <div className="settings-row">
            <span className="k">Session</span>
            <a href={signOutUrl} className="btn-ghost" style={{ fontSize: 12 }}>
              Sign out
            </a>
          </div>
        </div>

        {/* GitHub — functional (standard accounts only) */}
        {!isGuest && (
          <div className="settings-card">
            <h2>GitHub</h2>
            <p className="settings-card-sub">
              Connect GitHub to import private repos and push projects without
              pasting a token each time.
            </p>
            {github === null ? (
              <div className="settings-row">
                <span className="k">Status</span>
                <span className="v">checking…</span>
              </div>
            ) : github.connected ? (
              <div className="settings-row">
                <span className="k">
                  Connected as <strong>@{github.login}</strong>
                </span>
                <button
                  type="button"
                  onClick={handleDisconnectGithub}
                  className="btn-ghost"
                  style={{ fontSize: 12 }}
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="settings-row">
                <span className="k">Not connected</span>
                <a
                  href={githubOauthStartUrl(
                    typeof window !== "undefined"
                      ? window.location.origin + "/settings"
                      : "/settings",
                  )}
                  className="btn-primary"
                  style={{ fontSize: 12, padding: "6px 12px", textDecoration: "none" }}
                >
                  Connect GitHub
                </a>
              </div>
            )}
          </div>
        )}

        {/* Project-scoped configuration — pointers, not duplicated UI */}
        <div className="settings-card">
          <h2>Per-project configuration</h2>
          <p className="settings-card-sub">
            These are configured inside each project’s workspace, since they
            differ per project.
          </p>
          <div className="settings-row">
            <span className="k">Skills (agent instructions)</span>
            <span className="v">Workspace → Skills</span>
          </div>
          <div className="settings-row">
            <span className="k">Secrets / API keys</span>
            <span className="v">Workspace → Secrets</span>
          </div>
          <div className="settings-row">
            <span className="k">Connectors</span>
            <span className="v">Workspace → agent tools</span>
          </div>
        </div>

        {/* Scaffolded — not yet backed by persistence */}
        <div className="settings-card soon">
          <h2>
            Appearance<span className="settings-soon-badge">soon</span>
          </h2>
          <p className="settings-card-sub">
            Theme and density options. Today the app uses a single dark theme.
          </p>
        </div>

        <div className="settings-card soon">
          <h2>
            Default model<span className="settings-soon-badge">soon</span>
          </h2>
          <p className="settings-card-sub">
            Choose which Claude model the agent uses by default, and an optional
            faster model for lighter turns. Not yet configurable — the platform
            currently selects models per task.
          </p>
        </div>

        <div className="settings-card soon">
          <h2>
            Custom prompts &amp; default skills
            <span className="settings-soon-badge">soon</span>
          </h2>
          <p className="settings-card-sub">
            Account-wide system-prompt additions and skills applied to every new
            project. For now, set these per project under Skills.
          </p>
        </div>
      </div>
    </>
  );
}
