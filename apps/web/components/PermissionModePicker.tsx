"use client";

import { useRef, useState } from "react";
import type { PermissionMode } from "@gate15/api-types";
import { useStore } from "@/lib/store";
import { send } from "@/lib/ws-client";
import Popover from "./Popover";

interface ModeMeta {
  value: PermissionMode;
  /** Short label for the collapsed trigger. */
  short: string;
  /** Full label inside the menu. */
  label: string;
  sub: string;
}

/** The four modes, ordered most-cautious → most-permissive (top to bottom). */
const MODES: ModeMeta[] = [
  {
    value: "plan",
    short: "Plan",
    label: "Plan first",
    sub: "Investigate and propose a plan before changing anything.",
  },
  {
    value: "default",
    short: "Ask edits",
    label: "Ask before edits",
    sub: "Pause for approval before each edit, command, or risky op.",
  },
  {
    value: "acceptEdits",
    short: "Auto edits",
    label: "Auto-accept edits",
    sub: "Run edits & routine commands; still ask for dangerous/expensive ops.",
  },
  {
    value: "bypass",
    short: "Bypass",
    label: "Bypass permissions",
    sub: "Run everything without asking. No safety prompts.",
  },
];

const META = (m: PermissionMode): ModeMeta => MODES.find((x) => x.value === m) ?? MODES[2];

/**
 * The composer's permission-mode dropdown — the extension of the old binary Plan
 * toggle. Picks one of the four PermissionModes. Stays enabled while the agent is
 * running so the mode can be changed mid-turn: a live change emits
 * `set_permission_mode`, which the agent loop honors on its very next tool call.
 */
export default function PermissionModePicker() {
  const permissionMode = useStore((s) => s.permissionMode);
  const setPermissionModeManual = useStore((s) => s.setPermissionModeManual);
  const busy = useStore((s) => s.busy);
  const connected = useStore((s) => s.connected);

  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const cur = META(permissionMode);

  const pick = (mode: PermissionMode): void => {
    setOpen(false);
    if (mode === permissionMode) return;
    setPermissionModeManual(mode);
    // Mid-turn: push the change to the live run so it takes effect on the next
    // tool. When idle the mode just rides on the next user_message, so there's
    // nothing to send.
    if (busy && connected) {
      send({ type: "set_permission_mode", mode });
    }
  };

  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`plan-toggle ${permissionMode !== "bypass" ? "on" : ""}`}
        title="Permission mode — how much the agent does before pausing for you. Change it any time, even mid-run."
        aria-haspopup="true"
        aria-expanded={open ? "true" : "false"}
      >
        <PermissionLevelIcon mode={cur.value} />
        {cur.short}
        <svg aria-hidden="true" viewBox="0 0 12 12" width="10" height="10" fill="none" style={{ opacity: 0.55 }}>
          <path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <Popover
        open={open}
        anchorRef={triggerRef}
        placement="top-start"
        onRequestClose={() => setOpen(false)}
        className="model-picker-pop"
        role="menu"
        ariaLabel="Permission mode"
      >
        <div style={{ display: "grid", gap: 6, minWidth: 256 }}>
          <div className="label-micro">Permission mode</div>
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              role="menuitemradio"
              aria-checked={m.value === permissionMode}
              onClick={() => pick(m.value)}
              className="model-picker-option"
              data-active={m.value === permissionMode ? "true" : "false"}
            >
              <span style={{ display: "grid", gap: 1, textAlign: "left" }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
                  <span aria-hidden style={{ display: "inline-flex", marginRight: 6, opacity: 0.8, verticalAlign: "middle" }}>
                    <PermissionLevelIcon mode={m.value} />
                  </span>
                  {m.label}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.35 }}>
                  {m.sub}
                </span>
              </span>
              {m.value === permissionMode && (
                <svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12" fill="none" style={{ color: "var(--accent-text)" }}>
                  <path d="m3.5 8 3 3 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          ))}
          {busy && (
            <p style={{ margin: "2px 2px 0", fontSize: 11, color: "var(--text-dim)", lineHeight: 1.4 }}>
              Switching now affects the running turn from its next step.
            </p>
          )}
        </div>
      </Popover>
    </div>
  );
}

function PermissionLevelIcon({ mode }: { mode: PermissionMode }) {
  const filled = mode === "plan" ? 1 : mode === "default" ? 2 : mode === "acceptEdits" ? 3 : 4;
  return (
    <svg aria-hidden="true" viewBox="0 0 16 12" width="14" height="12" fill="none">
      {[0, 1, 2, 3].map((index) => (
        <rect
          key={index}
          x={index * 4 + 0.5}
          y={8 - index * 2}
          width="3"
          height={4 + index * 2}
          rx="1"
          fill={index < filled ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1"
          opacity={index < filled ? 0.9 : 0.35}
        />
      ))}
    </svg>
  );
}
