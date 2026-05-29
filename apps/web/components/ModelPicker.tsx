"use client";

import { MODEL_CATALOG, type ModelProvider } from "@uniqus/api-types";
import { useStore } from "@/lib/store";

const PROVIDER_LABEL: Record<ModelProvider, string> = {
  anthropic: "Anthropic — Claude",
  openai: "OpenAI — ChatGPT",
  google: "Google — Gemini",
};

const PROVIDER_ORDER: ModelProvider[] = ["anthropic", "openai", "google"];

/** Human label for the current choice, e.g. "Auto" or "GPT-5.5". */
export function modelChoiceLabel(choice: string): string {
  if (choice === "auto") return "Auto";
  return MODEL_CATALOG.find((m) => m.id === choice)?.label ?? choice;
}

/**
 * Model selector backed by the store's account-wide `model` default.
 *
 * - `variant="compact"` — a small inline <select> for the chat composer.
 * - `variant="settings"` — the same select plus descriptions and the
 *   "results may vary" advisory, for the Settings "Default model" card.
 *
 * "Auto" (the default) lets the orchestrator pick the strongest model per
 * task. Any explicit pick is the Advanced override.
 */
export default function ModelPicker({
  variant = "compact",
}: {
  variant?: "compact" | "settings";
}) {
  const model = useStore((s) => s.model);
  const setModel = useStore((s) => s.setModel);
  const selected = MODEL_CATALOG.find((m) => m.id === model) ?? null;
  const isOverride = model !== "auto";

  const select = (
    <select
      value={model}
      onChange={(e) => setModel(e.target.value)}
      title="Which model the agent runs on. Auto picks the best model per task."
      className="model-picker-select"
      style={{
        background: "var(--bg-elev)",
        border: "1px solid var(--border-default)",
        borderRadius: 6,
        padding: variant === "compact" ? "3px 6px" : "8px 10px",
        color: "var(--text-primary)",
        fontSize: variant === "compact" ? 11 : 13,
        fontFamily: "inherit",
        colorScheme: "dark",
        maxWidth: variant === "compact" ? 150 : 320,
      }}
    >
      <option value="auto">⚡ Auto (recommended)</option>
      {PROVIDER_ORDER.map((provider) => {
        const models = MODEL_CATALOG.filter((m) => m.provider === provider);
        if (models.length === 0) return null;
        return (
          <optgroup key={provider} label={PROVIDER_LABEL[provider]}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );

  if (variant === "compact") {
    return select;
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {select}
      <p className="settings-card-sub" style={{ margin: 0 }}>
        {model === "auto" ? (
          <>
            <strong>Auto</strong> lets Uniqus pick the strongest model for each
            task. It never falls back to a low-tier model.
          </>
        ) : selected ? (
          <>
            <strong>{selected.label}</strong> — {selected.description}
          </>
        ) : (
          <>Custom model: {model}</>
        )}
      </p>
      {isOverride && (
        <p
          style={{
            margin: 0,
            fontSize: 12,
            color: "var(--conf-low, #c0392b)",
          }}
        >
          ⚠ Advanced override active. Results, tool use, and quality may vary by
          provider; switch back to <strong>Auto</strong> for the best experience.
        </p>
      )}
    </div>
  );
}
