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
  icon: string;
}

/** The four modes, ordered most-cautious → most-permissive (top to bottom). */
const MODES: ModeMeta[] = [
  {
    value: "plan",
    short: "Plan",
    label: "Plan first",
    sub: "Investigate and propose a plan before changing anything.",
    icon: "◔",
  },
  {
    value: "default",
    short: "Ask edits",
    label: "Ask before edits",
    sub: "Pause for approval before each edit, command, or risky op.",
    icon: "◑",
  },
  {
    value: "acceptEdits",
    short: "Auto edits",
    label: "Auto-accept edits",
    sub: "Run edits & routine commands; still ask for dangerous/expensive ops.",
    icon: "◕",
  },
  {
    value: "bypass",
    short: "Bypass",
    label: "Bypass permissions",
    sub: "Run everything without asking. No safety prompts.",
    icon: "●",
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
        <span aria-hidden style={{ fontSize: 11 }}>
          {cur.icon}
        </span>
        {cur.short}
        <span style={{ opacity: 0.55, fontSize: 9 }}>▾</span>
      </button>

      <Popover
        open={open}
        anchorRef={triggerRef}
        placement="top-start"
        onRequestClose={() => setOpen(false)}
        className="model-picker-pop"
      >
        <div style={{ display: "grid", gap: 6, minWidth: 256 }}>
          <div className="label-micro">Permission mode</div>
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => pick(m.value)}
              className="model-picker-option"
              data-active={m.value === permissionMode ? "true" : "false"}
            >
              <span style={{ display: "grid", gap: 1, textAlign: "left" }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
                  <span aria-hidden style={{ marginRight: 6, opacity: 0.8 }}>
                    {m.icon}
                  </span>
                  {m.label}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.35 }}>
                  {m.sub}
                </span>
              </span>
              {m.value === permissionMode && (
                <span style={{ color: "var(--accent)", fontSize: 12 }}>✓</span>
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
