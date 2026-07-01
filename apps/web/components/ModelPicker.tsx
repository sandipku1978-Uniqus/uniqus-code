"use client";

import { useEffect, useRef, useState } from "react";
import {
  MODEL_CATALOG,
  thinkingEffortsForModel,
  clampThinkingEffort,
  type ModelProvider,
  type ThinkingEffort,
} from "@uniqus/api-types";
import { useStore } from "@/lib/store";
import Popover from "./Popover";

const PROVIDER_LABEL: Record<ModelProvider, string> = {
  anthropic: "Anthropic — Claude",
  zai: "Z.ai — GLM",
  openai: "OpenAI — ChatGPT",
  google: "Google — Gemini",
};

const PROVIDER_ORDER: ModelProvider[] = ["anthropic", "zai", "openai", "google"];

/** Human label for one reasoning-effort rung. */
const EFFORT_LABEL: Record<ThinkingEffort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "X-High",
  max: "Max",
};

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
 * - `variant="compact"` — a small trigger in the chat composer that shows the
 *   CURRENT model and opens a popover to change it, with the thinking-effort
 *   control (an on/off toggle + a Claude-Code-style discrete slider) below.
 * - `variant="settings"` — the same picker rendered inline (no popover) plus the
 *   Advanced-override advisory, for the Settings "Default model" card.
 *
 * "Auto" lets the orchestrator pick the strongest model per task; any explicit
 * pick is the Advanced override. The effort slider is ADAPTIVE — it renders only
 * the rungs the selected model actually supports (Claude low→max; GLM high/max;
 * OpenAI/Gemini low→high) via `thinkingEffortsForModel`.
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
  const thinking = useStore((s) => s.thinking);
  const thinkingEnabled = useStore((s) => s.thinkingEnabled);
  const mounted = useMounted();

  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Before mount, render the SSR-safe defaults so hydration matches.
  const curModel = mounted ? model : "auto";
  const curThinking = mounted ? thinking : "medium";
  const curEnabled = mounted ? thinkingEnabled : true;

  // Trigger shows the current model + a compact effort badge, e.g. "Auto · Max"
  // or "Auto · off" — the whole picker's state at a glance.
  const badge = curEnabled ? EFFORT_LABEL[curThinking] : "off";

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
        <span style={{ fontWeight: 600 }}>{modelChoiceLabel(curModel)}</span>
        <span className="model-picker-badge">{badge}</span>
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
        <PickerBody flyout onDone={() => setOpen(false)} />
      </Popover>
    </div>
  );
}

// ── Settings — inline ───────────────────────────────────────────────────────

function SettingsPicker() {
  const model = useStore((s) => s.model);
  const mounted = useMounted();
  const curModel = mounted ? model : "auto";
  const isOverride = curModel !== "auto";

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div className="model-picker-card">
        <PickerBody />
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
          <div key={provider} style={{ display: "grid", gap: 2 }}>
            <div className="label-micro" style={{ marginTop: 2 }}>
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
 * The composer's model flyout, anchored to the current-model row. A Popover
 * (portaled to <body>, fixed) so it can't be clipped by the chat pane overflow
 * or painted under the editor / file panes to its right.
 */
function ModelFlyout({
  model,
  onPick,
  anchorRef,
  open,
  onClose,
}: {
  model: string;
  onPick: (m: string) => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Popover
      open={open}
      anchorRef={anchorRef}
      placement="right-start"
      gap={8}
      onRequestClose={onClose}
      className="model-picker-flyout"
      role="menu"
      style={{ maxHeight: "min(440px, 65vh)", zIndex: 120 }}
    >
      <div className="label-micro" style={{ marginBottom: 4 }}>
        Choose a model
      </div>
      <OptionRow
        label="⚡ Auto"
        sub="Recommended — strongest model per task"
        active={model === "auto"}
        onClick={() => onPick("auto")}
      />
      <ModelList model={model} onPick={onPick} />
    </Popover>
  );
}

function PickerBody({
  flyout = false,
  onDone,
}: {
  /** Compact (composer) opens the model list as a side flyout; settings inlines it. */
  flyout?: boolean;
  onDone?: () => void;
}) {
  const model = useStore((s) => s.model);
  const setModel = useStore((s) => s.setModel);
  const thinking = useStore((s) => s.thinking);
  const setThinking = useStore((s) => s.setThinking);
  const thinkingEnabled = useStore((s) => s.thinkingEnabled);
  const setThinkingEnabled = useStore((s) => s.setThinkingEnabled);

  // Inline (settings): expand the list when a specific model is already chosen.
  const [expanded, setExpanded] = useState(!flyout && model !== "auto");
  const modelRowRef = useRef<HTMLButtonElement>(null);

  // Switching model re-scopes the effort slider; clamp the current rung into the
  // new model's supported set (never escalating) so the selection stays valid.
  const pickModel = (m: string) => {
    setModel(m);
    const clamped = clampThinkingEffort(thinking, m);
    if (clamped !== thinking) setThinking(clamped);
    setExpanded(false);
    onDone?.();
  };

  const efforts = thinkingEffortsForModel(model);
  // If the persisted rung isn't in this model's set (e.g. account default "max"
  // on a GPT model), show the clamped rung as active without mutating storage.
  const activeEffort = efforts.includes(thinking) ? thinking : clampThinkingEffort(thinking, model);

  return (
    <div style={{ display: "grid", gap: 10, minWidth: 258 }}>
      <div className="label-micro">Model</div>

      {/* Current model — click to change (flyout in the composer, inline expand
          in settings). This is the "shows current model, click to change" row. */}
      <button
        ref={modelRowRef}
        type="button"
        className="model-picker-current"
        data-open={expanded ? "true" : "false"}
        onClick={() => setExpanded((e) => !e)}
        aria-haspopup="true"
        aria-expanded={expanded ? "true" : "false"}
      >
        <span style={{ display: "grid", gap: 1, textAlign: "left", minWidth: 0 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)" }}>
            {model === "auto" ? "⚡ Auto" : modelChoiceLabel(model)}
          </span>
          <span
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {model === "auto"
              ? "Strongest model per task"
              : (MODEL_CATALOG.find((m) => m.id === model)?.description ?? "Advanced override")}
          </span>
        </span>
        <span style={{ fontSize: 10, opacity: 0.6, flexShrink: 0 }}>
          {flyout ? "›" : expanded ? "▴" : "▾"}
        </span>
      </button>

      {flyout ? (
        <ModelFlyout
          model={model}
          onPick={pickModel}
          anchorRef={modelRowRef}
          open={expanded}
          onClose={() => setExpanded(false)}
        />
      ) : (
        expanded && (
          <div style={{ display: "grid", gap: 4 }}>
            <OptionRow
              label="⚡ Auto"
              sub="Recommended — strongest model per task"
              active={model === "auto"}
              onClick={() => pickModel("auto")}
            />
            <ModelList model={model} onPick={pickModel} />
          </div>
        )
      )}

      <div className="model-picker-sep" />

      {/* Thinking: on/off toggle + adaptive Claude-Code-style effort slider. */}
      <div className="model-picker-think-head">
        <span className="label-micro" style={{ margin: 0 }}>
          Thinking{thinkingEnabled ? ` · ${EFFORT_LABEL[activeEffort]}` : ""}
        </span>
        <Toggle checked={thinkingEnabled} onChange={setThinkingEnabled} label="Extended thinking" />
      </div>

      <EffortSlider
        value={activeEffort}
        options={efforts}
        disabled={!thinkingEnabled}
        onChange={setThinking}
      />
      <p style={{ margin: 0, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.4 }}>
        {thinkingEnabled
          ? "Higher effort = deeper reasoning before acting, at the cost of latency and tokens."
          : "Thinking off — fastest, cheapest responses; the model answers without a reasoning pass."}
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
      <span style={{ display: "grid", gap: 1, textAlign: "left", minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
          {label}
        </span>
        <span
          style={{
            fontSize: 11,
            color: "var(--text-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {sub}
        </span>
      </span>
      {active && <span style={{ color: "var(--accent)", fontSize: 12, flexShrink: 0 }}>✓</span>}
    </button>
  );
}

/** A compact on/off switch (Claude-Code-style pill). */
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      className="model-picker-toggle"
      data-on={checked ? "true" : "false"}
      onClick={() => onChange(!checked)}
    >
      <span className="model-picker-toggle-knob" />
    </button>
  );
}

/**
 * A discrete effort slider modelled on Claude Code's — a filled track with a
 * knob at the selected rung and clickable tick stops for each supported rung.
 * Adaptive: `options` is the model's supported set (2–5 rungs). Disabled when
 * thinking is toggled off (rendered greyed, non-interactive).
 */
function EffortSlider({
  value,
  options,
  disabled,
  onChange,
}: {
  value: ThinkingEffort;
  options: ThinkingEffort[];
  disabled?: boolean;
  onChange: (v: ThinkingEffort) => void;
}) {
  const idx = Math.max(0, options.indexOf(value));
  const last = Math.max(1, options.length - 1);
  // Knob/fill position as a percentage across the track (first stop = 0%).
  const pct = (idx / last) * 100;

  return (
    <div
      className="effort-slider"
      data-disabled={disabled ? "true" : "false"}
      role="radiogroup"
      aria-label="Thinking effort"
    >
      <div className="effort-slider-track" aria-hidden>
        <div className="effort-slider-fill" style={{ width: `${pct}%` }} />
        <div className="effort-slider-knob" style={{ left: `${pct}%` }} />
      </div>
      <div className="effort-slider-stops">
        {options.map((opt, i) => {
          const active = opt === value;
          return (
            <button
              key={opt}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              className="effort-slider-stop"
              data-active={active ? "true" : "false"}
              // Nudge the first/last labels inward so they don't clip the edges.
              style={{
                justifySelf: i === 0 ? "start" : i === options.length - 1 ? "end" : "center",
              }}
              onClick={() => onChange(opt)}
            >
              {EFFORT_LABEL[opt]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
