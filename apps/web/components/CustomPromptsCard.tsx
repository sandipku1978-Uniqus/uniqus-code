"use client";

import { useEffect, useState } from "react";
import { SKILL_PACKS } from "@uniqus/api-types";
import {
  fetchAccountSettingsApi,
  updateAccountSettingsApi,
  type AccountSettings,
} from "@/lib/api";

/**
 * Settings → Custom prompts & default skills. Account-wide, persisted on the
 * orchestrator (users.custom_prompt / users.default_skills):
 *
 * - Custom prompt is appended to the agent's system prompt on every turn, on
 *   top of each project's own Skills file.
 * - Default skills are written into a new project's `.uniqus/skills.md` at
 *   creation, so the conventions apply from the first turn.
 *
 * Both fields save independently; the button is enabled only when something
 * changed versus what's on the server.
 */

const CUSTOM_PROMPT_MAX = 16 * 1024;
const DEFAULT_SKILLS_MAX = 64 * 1024;

type Status =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

const fieldStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--bg-elev)",
  border: "1px solid var(--border-default)",
  borderRadius: 6,
  padding: "10px 12px",
  color: "var(--text-primary)",
  fontFamily: "var(--font-mono-stack)",
  fontSize: 12.5,
  lineHeight: 1.5,
  resize: "vertical",
  minHeight: 96,
};

export default function CustomPromptsCard() {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  // `saved` is the server snapshot; the inputs are the working copy. Dirty =
  // any field differs from the snapshot.
  const [saved, setSaved] = useState<AccountSettings>({ custom_prompt: "", default_skills: "" });
  const [customPrompt, setCustomPrompt] = useState("");
  const [defaultSkills, setDefaultSkills] = useState("");

  useEffect(() => {
    let alive = true;
    fetchAccountSettingsApi()
      .then(({ settings }) => {
        if (!alive) return;
        setSaved(settings);
        setCustomPrompt(settings.custom_prompt);
        setDefaultSkills(settings.default_skills);
        setStatus({ kind: "ready" });
      })
      .catch((err) => {
        if (!alive) return;
        setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      alive = false;
    };
  }, []);

  const dirty =
    customPrompt !== saved.custom_prompt || defaultSkills !== saved.default_skills;
  const overLimit =
    customPrompt.length > CUSTOM_PROMPT_MAX || defaultSkills.length > DEFAULT_SKILLS_MAX;
  const busy = status.kind === "loading" || status.kind === "saving";

  async function handleSave(): Promise<void> {
    if (!dirty || overLimit) return;
    setStatus({ kind: "saving" });
    // Send only what changed, so saving one field doesn't rewrite the other.
    const patch: Partial<AccountSettings> = {};
    if (customPrompt !== saved.custom_prompt) patch.custom_prompt = customPrompt;
    if (defaultSkills !== saved.default_skills) patch.default_skills = defaultSkills;
    try {
      const { settings } = await updateAccountSettingsApi(patch);
      setSaved(settings);
      setCustomPrompt(settings.custom_prompt);
      setDefaultSkills(settings.default_skills);
      setStatus({ kind: "saved" });
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className="settings-card">
      <h2>Custom prompts &amp; default skills</h2>
      <p className="settings-card-sub">
        Account-wide settings the agent uses across every project. The custom
        prompt is added to the agent on every turn; default skills are copied
        into each new project’s Skills file when you create it.
      </p>

      {status.kind === "loading" ? (
        <div className="settings-row">
          <span className="k">Status</span>
          <span className="v">loading…</span>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 18 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
              Custom prompt
            </span>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Standing instructions for the agent — coding conventions, tone,
              languages to prefer. Applied on top of per-project Skills; it never
              overrides system, security, or tool rules.
            </span>
            <textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="e.g. Always use TypeScript with strict mode. Prefer functional React components. Write concise commit messages."
              spellCheck={false}
              style={fieldStyle}
            />
            <span
              style={{
                fontSize: 11,
                color:
                  customPrompt.length > CUSTOM_PROMPT_MAX
                    ? "var(--conf-low)"
                    : "var(--text-dim)",
                textAlign: "right",
              }}
            >
              {customPrompt.length.toLocaleString()} / {CUSTOM_PROMPT_MAX.toLocaleString()}
            </span>
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
              Default skills
            </span>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Markdown seeded into every new project’s Skills file
              (<code>.uniqus/skills.md</code>). Existing projects and imported
              repos are left untouched. Edit per project from the workspace.
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
                Start from a curated design pack:
              </span>
              <select
                value=""
                onChange={(e) => {
                  const pack = SKILL_PACKS.find((p) => p.id === e.target.value);
                  if (!pack) return;
                  setDefaultSkills((prev) =>
                    prev.trim() ? `${prev.trim()}\n\n${pack.body}` : pack.body,
                  );
                }}
                title="Append a curated design-direction pack to your default skills"
                style={{
                  background: "var(--bg-elev)",
                  border: "1px solid var(--border-default)",
                  borderRadius: 6,
                  padding: "6px 8px",
                  color: "var(--text-primary)",
                  fontSize: 12,
                  fontFamily: "inherit",
                }}
              >
                <option value="">Add a pack…</option>
                {SKILL_PACKS.map((p) => (
                  <option key={p.id} value={p.id} title={p.summary}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              value={defaultSkills}
              onChange={(e) => setDefaultSkills(e.target.value)}
              placeholder={"# Project conventions\n\n- Use the design tokens in styles/tokens.css\n- Keep components under 200 lines"}
              spellCheck={false}
              style={{ ...fieldStyle, minHeight: 140 }}
            />
            <span
              style={{
                fontSize: 11,
                color:
                  defaultSkills.length > DEFAULT_SKILLS_MAX
                    ? "var(--conf-low)"
                    : "var(--text-dim)",
                textAlign: "right",
              }}
            >
              {defaultSkills.length.toLocaleString()} / {DEFAULT_SKILLS_MAX.toLocaleString()}
            </span>
          </label>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              type="button"
              className="btn-primary"
              onClick={handleSave}
              disabled={!dirty || overLimit || busy}
              style={{ fontSize: 13 }}
            >
              {status.kind === "saving" ? "Saving…" : "Save changes"}
            </button>
            {status.kind === "saved" && !dirty && (
              <span style={{ fontSize: 12, color: "var(--conf-high)" }}>Saved</span>
            )}
            {status.kind === "error" && (
              <span style={{ fontSize: 12, color: "var(--conf-low)" }}>{status.message}</span>
            )}
            {overLimit && (
              <span style={{ fontSize: 12, color: "var(--conf-low)" }}>
                Too long — trim before saving.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
