"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import BrandLockup from "./BrandLockup";
import ModelPicker from "./ModelPicker";
import AppearanceCard from "./AppearanceCard";
import CustomPromptsCard from "./CustomPromptsCard";
import Modal from "./Modal";
import { toast } from "@/lib/toast";
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
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    if (isGuest) return;
    fetchGithubStatus()
      .then(setGithub)
      .catch(() => setGithub({ connected: false, login: null, connected_at: null }));
  }, [isGuest]);

  async function handleDisconnectGithub(): Promise<void> {
    setDisconnecting(true);
    try {
      await disconnectGithubApi();
      setGithub({ connected: false, login: null, connected_at: null });
      setConfirmingDisconnect(false);
      toast.success("GitHub disconnected");
    } catch (err) {
      // Was previously swallowed — surface it so the user knows it failed (§D).
      toast.error(
        `Couldn't disconnect GitHub: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setDisconnecting(false);
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
                  onClick={() => setConfirmingDisconnect(true)}
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
            These live inside each project because they differ per project. Per-project
            Skills extend the account-wide default skills set below.
          </p>
          <div className="settings-row">
            <span className="k">Skills (agent instructions)</span>
            <span className="v">Open a project, then the Skills button in its top bar</span>
          </div>
          <div className="settings-row">
            <span className="k">Secrets / API keys</span>
            <span className="v">Open a project, then the Secrets button in its top bar</span>
          </div>
          <div className="settings-row">
            <span className="k">Connectors</span>
            <span className="v">Configured per project from the agent tools</span>
          </div>
        </div>

        {/* Appearance — functional (theme + density, account-wide client pref) */}
        <AppearanceCard />

        <div className="settings-card">
          <h2>Default model</h2>
          <p className="settings-card-sub">
            Choose which model the coding agent runs on. <strong>Auto</strong>{" "}
            lets Uniqus pick the strongest model for each task. Under{" "}
            <strong>Advanced</strong>, override it with a specific model from
            Anthropic (Claude), OpenAI (ChatGPT), or Google (Gemini). This is
            your account-wide default; you can also change it per turn from the
            chat composer.
          </p>
          <div style={{ marginTop: 12 }}>
            <ModelPicker variant="settings" />
          </div>
        </div>

        {/* Custom prompts & default skills — functional (account-wide, persisted) */}
        <CustomPromptsCard />
      </div>

      {confirmingDisconnect && (
        <Modal
          title="Disconnect GitHub?"
          width={460}
          onClose={() => !disconnecting && setConfirmingDisconnect(false)}
          footer={
            <>
              <span />
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setConfirmingDisconnect(false)}
                  disabled={disconnecting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={handleDisconnectGithub}
                  disabled={disconnecting}
                >
                  {disconnecting ? "Disconnecting…" : "Disconnect"}
                </button>
              </div>
            </>
          }
        >
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--text-muted)" }}>
            You’ll need to reconnect to import private repos or create repos. Repositories
            already on github.com are left untouched.
          </p>
        </Modal>
      )}
    </>
  );
}
