"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createProjectFromBriefApi } from "@/lib/api";
import { useStore } from "@/lib/store";
import { useAutoGrowTextarea } from "@/lib/useAutoGrowTextarea";
import ModelPicker from "./ModelPicker";
import MicButton from "./MicButton";

/**
 * Where a logged-out visitor's typed idea is parked while they sign in. The
 * dashboard (ProjectPicker) reads this on mount and drops it into the describe
 * box, so the idea survives the auth round-trip (the WorkOS return URL is fixed
 * to /projects, so we can't carry it as a query param). sessionStorage is
 * origin-scoped and survives the OAuth redirect within the same tab.
 */
export const PENDING_BRIEF_KEY = "uniqus.pendingBrief";

/** ChatPanel hydrates its composer from this localStorage key per project.
 * Shared with the dashboard composer (ProjectPicker) so a brief started there
 * with attachments lands as a ready-to-send draft in the workspace. */
export function draftKeyFor(projectId: string): string {
  return `uniqus.draft.${projectId}`;
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The hero / bottom "chat box" on the marketing page. A real composer with the
 * same control set as the workspace: + attachments, a model dropdown, a plan
 * toggle, a mic, and send. Type an idea and it either starts a project (signed
 * in) or carries the idea into sign-in.
 */
export default function LandingPrompt({
  variant,
  signedIn,
  ctaHref,
  ctaLabel,
  placeholder,
  suggestions,
}: {
  variant: "hero" | "bottom";
  signedIn: boolean;
  ctaHref: string;
  ctaLabel: string;
  placeholder: string;
  suggestions?: readonly string[];
}) {
  const router = useRouter();
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const setModeManual = useStore((s) => s.setModeManual);
  const setBriefFiles = useStore((s) => s.setBriefFiles);

  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isHero = variant === "hero";
  const planOn = mode === "plan-then-execute";

  // Grow the box with content up to ~10 lines, then scroll (capped on short
  // screens). Shared with the dashboard + workspace composers.
  useAutoGrowTextarea(taRef, text);

  // Reflect the real new-project default (plan mode on for the first turn) in
  // the toggle. Programmatic (setMode, not setModeManual) so it doesn't count
  // as a manual choice — the workspace still respects an explicit toggle later.
  useEffect(() => {
    setMode("plan-then-execute");
  }, [setMode]);

  function addFiles(list: FileList | null): void {
    if (!list || list.length === 0) return;
    setFiles((current) => {
      const next = [...current];
      for (const file of Array.from(list)) {
        const dup = next.some(
          (e) =>
            e.name === file.name &&
            e.size === file.size &&
            e.lastModified === file.lastModified,
        );
        if (!dup) next.push(file);
      }
      return next;
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function submit(e?: React.FormEvent): Promise<void> {
    e?.preventDefault();
    if (busy) return;
    const brief = text.trim();
    // Empty box → behave like the old static CTA: just go to the target.
    if (!brief) {
      router.push(ctaHref);
      return;
    }
    // Logged out → stash the idea so it survives sign-in, then send to auth.
    // (Attachments need a project, so the + is disabled until signed in.)
    if (!signedIn) {
      try {
        sessionStorage.setItem(PENDING_BRIEF_KEY, brief);
      } catch {
        /* private mode / disabled storage — the idea just won't carry over */
      }
      router.push(ctaHref);
      return;
    }
    // Signed in (WorkOS or guest) → turn the idea into a project. Carry the
    // plan-mode choice through as ?plan= so the workspace's first turn honors
    // it (the store's `mode` is reset per-project on workspace mount).
    setBusy(true);
    const planQ = `plan=${planOn ? "1" : "0"}`;
    try {
      const { project, first_message } = await createProjectFromBriefApi(brief);
      if (files.length > 0) {
        // Stage the attachments + the refined first message for the workspace
        // composer, and DON'T auto-fire — so the user lands with their idea and
        // files ready to review and send (reusing ChatPanel's upload-on-send).
        setBriefFiles(files);
        try {
          localStorage.setItem(draftKeyFor(project.id), first_message);
        } catch {
          /* draft is a nicety; the user can retype if storage is unavailable */
        }
        router.push(`/projects/${project.id}?${planQ}`);
      } else {
        // No attachments → fire the brief as the first turn automatically.
        router.push(
          `/projects/${project.id}?brief=${encodeURIComponent(first_message)}&${planQ}`,
        );
      }
    } catch {
      // Don't dead-end on a transient error — hand the idea to the dashboard,
      // which surfaces a proper error and lets them retry.
      try {
        sessionStorage.setItem(PENDING_BRIEF_KEY, brief);
      } catch {
        /* see note above */
      }
      router.push("/projects");
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    // Enter sends; Shift+Enter inserts a newline.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <>
      <form
        className={isHero ? "hero-prompt" : "bottom-prompt"}
        onSubmit={submit}
        // Click anywhere on the card (except a button/control) focuses the
        // field — preserves the "click to type" feel of the old box.
        onClick={(e) => {
          const t = e.target as HTMLElement;
          if (!t.closest("button") && !t.closest(".model-picker-trigger")) {
            taRef.current?.focus();
          }
        }}
      >
        <textarea
          ref={taRef}
          className={isHero ? "hp-input" : "bp-input"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label={placeholder}
          disabled={busy}
          rows={isHero ? 2 : 3}
        />

        {files.length > 0 && (
          <div className="composer-attachments">
            {files.map((file, i) => (
              <span
                key={`${file.name}-${file.size}-${file.lastModified}`}
                className="attachment-chip"
              >
                <span className="attachment-name" title={file.name}>
                  {file.name}
                </span>
                <span className="attachment-size">{formatFileSize(file.size)}</span>
                <button
                  type="button"
                  onClick={() => setFiles((c) => c.filter((_, idx) => idx !== i))}
                  title={`Remove ${file.name}`}
                  aria-label={`Remove ${file.name}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="hp-bar">
          <div className="hp-left">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(e) => addFiles(e.target.files)}
            />
            <button
              type="button"
              className="hp-icon-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={!signedIn || busy}
              title={signedIn ? "Attach files" : "Sign in to attach files"}
              aria-label="Attach files"
            >
              <PlusIcon />
            </button>
            <ModelPicker variant="compact" />
            <button
              type="button"
              className={`hp-plan${planOn ? " on" : ""}`}
              onClick={() =>
                setModeManual(planOn ? "execute-only" : "plan-then-execute")
              }
              aria-pressed={planOn}
              title="Plan mode — Uniqus proposes a plan you can edit before it builds"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Plan
            </button>
          </div>
          <div className="hp-right">
            <MicButton
              className="hp-icon-btn"
              disabled={busy}
              onText={(t) => setText((prev) => (prev ? `${prev} ${t}` : t))}
            />
            <button type="submit" className="hp-send" aria-label={ctaLabel} title={ctaLabel} disabled={busy}>
              <ArrowUpIcon />
            </button>
          </div>
        </div>
      </form>

      {isHero && suggestions && suggestions.length > 0 && (
        <div className="hero-suggestions">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              className="hero-chip"
              onClick={() => {
                setText(s);
                taRef.current?.focus();
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}
