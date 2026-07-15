"use client";

import { useEffect, useRef, useState } from "react";
import {
  MODEL_CATALOG,
  thinkingEffortsForModel,
  clampThinkingEffort,
  type ModelProvider,
  type ThinkingEffort,
} from "@gate15/api-types";
import { useStore } from "@/lib/store";
import Popover from "./Popover";
import Tooltip from "./Tooltip";

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
 * the rungs the selected model actually supports (Claude and GPT-5.6 low→max;
 * older OpenAI models low→xhigh; GLM high/max; Gemini low→high) via
 * `thinkingEffortsForModel`.
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
        <ChevronIcon direction="down" />
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
        role="dialog"
        ariaLabel="Model and thinking settings"
        focusOnOpen
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
          Advanced override active. Results, tool use, and quality may vary by
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
  asOptions = false,
}: {
  model: string;
  onPick: (m: string) => void;
  asOptions?: boolean;
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
                asOption={asOptions}
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
      role="listbox"
      ariaLabel="Choose a model"
      style={{ maxHeight: "min(440px, 65vh)", zIndex: 120 }}
    >
      <div className="label-micro" style={{ marginBottom: 4 }}>
        Choose a model
      </div>
      <OptionRow
        label="Auto"
        sub="Recommended — strongest model per task"
        active={model === "auto"}
        asOption
        onClick={() => onPick("auto")}
      />
      <ModelList model={model} onPick={onPick} asOptions />
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
    // maxWidth is load-bearing in the composer popover: it shrink-wraps its
    // content, so an unconstrained grid sizes to MAX-content — the one-sentence
    // help paragraphs below then render as single ~470px lines and balloon the
    // whole menu. Capping the body makes them wrap and keeps the menu compact.
    // Settings renders inline in a normal-width card, which needs no cap.
    <div style={{ display: "grid", gap: 10, minWidth: 224, maxWidth: flyout ? 248 : undefined }}>
      <div className="label-micro">Model</div>

      {/* Current model — click to change (flyout in the composer, inline expand
          in settings). Single compact line; the model's description shows on
          hover/focus like the option rows. */}
      <Tooltip
        label={
          model === "auto"
            ? "Strongest model per task"
            : (MODEL_CATALOG.find((m) => m.id === model)?.description ?? "Advanced override")
        }
        placement="right"
      >
        <button
          ref={modelRowRef}
          type="button"
          className="model-picker-current"
          data-open={expanded ? "true" : "false"}
          onClick={() => setExpanded((e) => !e)}
          aria-haspopup="true"
          aria-expanded={expanded ? "true" : "false"}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              textAlign: "left",
              minWidth: 0,
            }}
          >
            {model === "auto" ? "Auto" : modelChoiceLabel(model)}
          </span>
          <ChevronIcon direction={flyout ? "right" : expanded ? "up" : "down"} />
        </button>
      </Tooltip>

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
              label="Auto"
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
    </div>
  );
}

function OptionRow({
  label,
  sub,
  active,
  onClick,
  asOption = false,
}: {
  label: string;
  sub: string;
  active: boolean;
  onClick: () => void;
  asOption?: boolean;
}) {
  // Traditional compact menu row: label only. The description lives in a
  // hover/focus tooltip instead of an always-on sub-line — that sub-line is
  // what made the menu balloon to a third of the window.
  return (
    <Tooltip label={sub} placement="right">
      <button
        type="button"
        role={asOption ? "option" : undefined}
        aria-selected={asOption ? active : undefined}
        onClick={onClick}
        className="model-picker-option"
        data-active={active ? "true" : "false"}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: active ? 600 : 500,
            color: "var(--text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            textAlign: "left",
            minWidth: 0,
          }}
        >
          {label}
        </span>
        {active && (
          <svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12" fill="none" style={{ color: "var(--accent-text)", flexShrink: 0 }}>
            <path d="m3.5 8 3 3 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
    </Tooltip>
  );
}

function ChevronIcon({ direction }: { direction: "up" | "down" | "right" }) {
  const path = direction === "right" ? "m4.5 3 3 3-3 3" : direction === "up" ? "m3 7.5 3-3 3 3" : "m3 4.5 3 3 3-3";
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" width="10" height="10" fill="none" style={{ opacity: 0.55, flexShrink: 0 }}>
      <path d={path} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
 * A real, draggable effort slider modelled on Claude Code's — a filled track you
 * can grab and drag (pointer), nudge with the arrow keys, or click a position.
 * The knob snaps to the nearest supported rung. Adaptive: `options` is the
 * model's supported set (2–5 rungs). Disabled when thinking is toggled off.
 * Compact by design: the current rung's name lives in the "Thinking · X" header
 * above (no per-stop label row), and the effort tradeoff is a hover tooltip.
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
  const trackRef = useRef<HTMLDivElement>(null);
  const idx = Math.max(0, options.indexOf(value));
  const last = Math.max(1, options.length - 1);
  // Knob/fill position as a percentage across the track (first stop = 0%).
  const pct = (idx / last) * 100;

  // Map a pointer x-coordinate to the nearest rung and commit it.
  const setFromClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return;
    const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const next = options[Math.round(t * last)];
    if (next && next !== value) onChange(next);
  };

  return (
    <div
      className="effort-slider"
      data-disabled={disabled ? "true" : "false"}
      title={
        disabled
          ? "Thinking off — fastest, cheapest responses"
          : "Higher effort = deeper reasoning before acting, at the cost of latency and tokens"
      }
    >
      <div
        ref={trackRef}
        className="effort-slider-track"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Thinking effort"
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={idx}
        aria-valuetext={EFFORT_LABEL[value]}
        aria-disabled={disabled ? "true" : "false"}
        onPointerDown={(e) => {
          if (disabled) return;
          e.preventDefault();
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          setFromClientX(e.clientX);
        }}
        onPointerMove={(e) => {
          if (disabled || e.buttons === 0) return; // only track while dragging
          setFromClientX(e.clientX);
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "ArrowRight" || e.key === "ArrowUp") {
            e.preventDefault();
            onChange(options[Math.min(last, idx + 1)]);
          } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
            e.preventDefault();
            onChange(options[Math.max(0, idx - 1)]);
          } else if (e.key === "Home") {
            e.preventDefault();
            onChange(options[0]);
          } else if (e.key === "End") {
            e.preventDefault();
            onChange(options[last]);
          }
        }}
      >
        <div className="effort-slider-fill" style={{ width: `${pct}%` }} />
        {options.map((opt, i) => (
          <span
            key={opt}
            className="effort-slider-tick"
            data-active={i <= idx ? "true" : "false"}
            style={{ left: `${(i / last) * 100}%` }}
            aria-hidden
          />
        ))}
        <div className="effort-slider-knob" style={{ left: `${pct}%` }} aria-hidden />
      </div>
    </div>
  );
}
