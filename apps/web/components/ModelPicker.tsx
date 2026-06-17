"use client";

import { useEffect, useRef, useState } from "react";
import {
  MODEL_CATALOG,
  type ModelProvider,
  type ThinkingEffort,
} from "@uniqus/api-types";
import { useStore } from "@/lib/store";
import Popover from "./Popover";

const PROVIDER_LABEL: Record<ModelProvider, string> = {
  anthropic: "Anthropic — Claude",
  openai: "OpenAI — ChatGPT",
  google: "Google — Gemini",
};

const PROVIDER_ORDER: ModelProvider[] = ["anthropic", "openai", "google"];

const THINKING_OPTIONS: { value: ThinkingEffort; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

/** Human label for the current model choice, e.g. "Auto" or "GPT-5.5". */
export function modelChoiceLabel(choice: string): string {
  if (choice === "auto") return "Auto";
  return MODEL_CATALOG.find((m) => m.id === choice)?.label ?? choice;
}

/** Avoid SSR/client hydration mismatch: model + thinking come from localStorage. */
function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/**
 * Model + reasoning-effort picker.
 *
 * - `variant="compact"` — a small trigger in the chat composer that opens a
 *   popover: Auto on top, an expandable "More models" list (grouped by
 *   provider), and a thinking-effort segmented control.
 * - `variant="settings"` — the same choices rendered inline (no popover) plus
 *   the Advanced-override advisory, for the Settings "Default model" card.
 *
 * "Auto" lets the orchestrator pick the strongest model per task; any explicit
 * pick is the Advanced override. Thinking effort applies to every choice.
 */
export default function ModelPicker({
  variant = "compact",
}: {
  variant?: "compact" | "settings";
}) {
  return variant === "settings" ? <SettingsPicker /> : <CompactPicker />;
}

// ── Compact (composer) — trigger + popover ──────────────────────────────────

function CompactPicker() {
  const model = useStore((s) => s.model);
  const setModel = useStore((s) => s.setModel);
  const thinking = useStore((s) => s.thinking);
  const setThinking = useStore((s) => s.setThinking);
  const mounted = useMounted();

  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Before mount, render the SSR-safe defaults so hydration matches.
  const curModel = mounted ? model : "auto";
  const curThinking = mounted ? thinking : "medium";

  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="model-picker-trigger"
        title="Model & thinking effort"
        aria-haspopup="true"
        aria-expanded={open ? "true" : "false"}
      >
        {/* Collapsed trigger: just a "Model" button — the chosen model and
            thinking effort live inside the popover, not on the composer. */}
        <span style={{ fontWeight: 600 }}>Model</span>
        <span style={{ opacity: 0.55, fontSize: 9 }}>▾</span>
      </button>

      {/* Portaled + fixed so it can't be clipped by the composer / chat pane
          overflow, nor painted under the editor pane to its right. Opens above
          the composer (top-start), flipping below only if there's no room. */}
      <Popover
        open={open}
        anchorRef={triggerRef}
        placement="top-start"
        onRequestClose={() => setOpen(false)}
        className="model-picker-pop"
      >
        <PickerBody
          model={curModel}
          thinking={curThinking}
          flyout
          onPickModel={(m) => {
            setModel(m);
            setOpen(false);
          }}
          onPickThinking={setThinking}
        />
      </Popover>
    </div>
  );
}

// ── Settings — inline ───────────────────────────────────────────────────────

function SettingsPicker() {
  const model = useStore((s) => s.model);
  const setModel = useStore((s) => s.setModel);
  const thinking = useStore((s) => s.thinking);
  const setThinking = useStore((s) => s.setThinking);
  const mounted = useMounted();

  const curModel = mounted ? model : "auto";
  const curThinking = mounted ? thinking : "medium";
  const isOverride = curModel !== "auto";

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div
        style={{
          border: "1px solid var(--border-default)",
          borderRadius: 8,
          padding: 12,
          background: "var(--bg-elev)",
        }}
      >
        <PickerBody
          model={curModel}
          thinking={curThinking}
          onPickModel={setModel}
          onPickThinking={setThinking}
        />
      </div>
      {isOverride && (
        <p style={{ margin: 0, fontSize: 12, color: "var(--conf-low)" }}>
          ⚠ Advanced override active. Results, tool use, and quality may vary by
          provider; switch back to <strong>Auto</strong> for the best experience.
        </p>
      )}
    </div>
  );
}

// ── Shared body ─────────────────────────────────────────────────────────────

function ModelList({
  model,
  onPick,
}: {
  model: string;
  onPick: (m: string) => void;
}) {
  return (
    <>
      {PROVIDER_ORDER.map((provider) => {
        const models = MODEL_CATALOG.filter((m) => m.provider === provider);
        if (models.length === 0) return null;
        return (
          <div key={provider} style={{ display: "grid", gap: 4 }}>
            <div className="label-micro" style={{ marginTop: 4 }}>
              {PROVIDER_LABEL[provider]}
            </div>
            {models.map((m) => (
              <OptionRow
                key={m.id}
                label={m.label}
                sub={m.description}
                active={model === m.id}
                onClick={() => onPick(m.id)}
              />
            ))}
          </div>
        );
      })}
    </>
  );
}

/**
 * The composer's "More models" flyout. A Popover (portaled to <body>, fixed) so
 * it can't be clipped by the chat pane's overflow or painted under the editor /
 * file panes to its right. Opens to the right of the trigger and flips to the
 * left when there isn't room; capped to the viewport with an internal scroll.
 */
function ModelFlyout({
  model,
  onPick,
}: {
  model: string;
  onPick: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="model-picker-more"
        data-open={open ? "true" : "false"}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open ? "true" : "false"}
      >
        <span>More models</span>
        <span style={{ fontSize: 9, opacity: 0.6 }}>▸</span>
      </button>
      <Popover
        open={open}
        anchorRef={btnRef}
        placement="right-start"
        gap={8}
        onRequestClose={() => setOpen(false)}
        className="model-picker-flyout"
        role="menu"
        style={{ maxHeight: "min(440px, 65vh)", zIndex: 120 }}
      >
        <ModelList
          model={model}
          onPick={(m) => {
            setOpen(false);
            onPick(m);
          }}
        />
      </Popover>
    </>
  );
}

function PickerBody({
  model,
  thinking,
  onPickModel,
  onPickThinking,
  flyout = false,
}: {
  model: string;
  thinking: ThinkingEffort;
  onPickModel: (m: string) => void;
  onPickThinking: (t: ThinkingEffort) => void;
  /** Compact (composer) opens "More models" as a side flyout; settings inlines it. */
  flyout?: boolean;
}) {
  // Inline mode: auto-expand the list when a specific model is already chosen.
  const [showInline, setShowInline] = useState(!flyout && model !== "auto");

  return (
    <div style={{ display: "grid", gap: 8, minWidth: 248 }}>
      <div className="label-micro">Model</div>

      <OptionRow
        label="⚡ Auto"
        sub="Recommended — strongest model per task"
        active={model === "auto"}
        onClick={() => onPickModel("auto")}
      />

      {flyout ? (
        <ModelFlyout model={model} onPick={onPickModel} />
      ) : (
        <>
          <button
            type="button"
            className="model-picker-more"
            onClick={() => setShowInline((s) => !s)}
            aria-expanded={showInline ? "true" : "false"}
          >
            <span>{showInline ? "Hide models" : "More models"}</span>
            <span style={{ fontSize: 9, opacity: 0.6 }}>{showInline ? "▴" : "▾"}</span>
          </button>
          {showInline && <ModelList model={model} onPick={onPickModel} />}
        </>
      )}

      <div style={{ borderTop: "1px solid var(--border-default)", margin: "4px 0" }} />

      <div className="label-micro">Thinking effort</div>
      <Segmented value={thinking} options={THINKING_OPTIONS} onChange={onPickThinking} />
      <p style={{ margin: 0, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.4 }}>
        More effort = deeper reasoning before acting, at the cost of latency and
        tokens.
      </p>
    </div>
  );
}

function OptionRow({
  label,
  sub,
  active,
  onClick,
}: {
  label: string;
  sub: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="model-picker-option"
      data-active={active ? "true" : "false"}
    >
      <span style={{ display: "grid", gap: 1, textAlign: "left" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
          {label}
        </span>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{sub}</span>
      </span>
      {active && <span style={{ color: "var(--accent)", fontSize: 12 }}>✓</span>}
    </button>
  );
}

function Segmented({
  value,
  options,
  onChange,
}: {
  value: ThinkingEffort;
  options: { value: ThinkingEffort; label: string }[];
  onChange: (v: ThinkingEffort) => void;
}) {
  return (
    <div
      role="radiogroup"
      style={{
        display: "inline-flex",
        gap: 2,
        padding: 2,
        background: "var(--bg-surface)",
        border: "1px solid var(--border-default)",
        borderRadius: 6,
        width: "fit-content",
      }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active ? "true" : "false"}
            onClick={() => onChange(opt.value)}
            style={{
              border: 0,
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 11,
              fontWeight: 600,
              padding: "4px 12px",
              borderRadius: 4,
              color: active ? "#fff" : "var(--text-muted)",
              background: active ? "var(--brand-gradient)" : "transparent",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
