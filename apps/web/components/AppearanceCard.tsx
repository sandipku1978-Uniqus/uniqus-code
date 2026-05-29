"use client";

import { useEffect } from "react";
import {
  useStore,
  hydrateAppearanceFromStorage,
  type ThemeChoice,
  type DensityChoice,
} from "@/lib/store";

/**
 * Settings → Appearance. Theme (dark/light) + density (comfortable/compact),
 * both backed by the store's account-wide, localStorage-persisted prefs. The
 * setters apply the choice to <html> immediately (and an inline bootstrap in
 * the root layout applies it before first paint), so the change is live the
 * moment a segment is clicked — no save button.
 */

const THEME_OPTIONS: { value: ThemeChoice; label: string; hint: string }[] = [
  { value: "dark", label: "Dark", hint: "Near-black surfaces (default)." },
  { value: "light", label: "Light", hint: "Warm near-white surfaces." },
];

const DENSITY_OPTIONS: { value: DensityChoice; label: string; hint: string }[] = [
  { value: "comfortable", label: "Comfortable", hint: "Roomier spacing (default)." },
  { value: "compact", label: "Compact", hint: "Tighter rows and type." },
];

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      style={{
        display: "inline-flex",
        gap: 2,
        padding: 2,
        background: "var(--bg-elev)",
        border: "1px solid var(--border-default)",
        borderRadius: 8,
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
              fontSize: 12,
              fontWeight: 600,
              padding: "6px 14px",
              borderRadius: 6,
              color: active ? "#fff" : "var(--text-muted)",
              background: active ? "var(--brand-gradient)" : "transparent",
              transition: "color var(--dur-base) ease, background var(--dur-base) ease",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export default function AppearanceCard() {
  const theme = useStore((s) => s.theme);
  const density = useStore((s) => s.density);
  const setTheme = useStore((s) => s.setTheme);
  const setDensity = useStore((s) => s.setDensity);

  // Reconcile the SSR-safe store defaults with the persisted choice once
  // hydration is done (see hydrateAppearanceFromStorage).
  useEffect(() => {
    hydrateAppearanceFromStorage();
  }, []);

  const themeHint = THEME_OPTIONS.find((o) => o.value === theme)?.hint;
  const densityHint = DENSITY_OPTIONS.find((o) => o.value === density)?.hint;

  return (
    <div className="settings-card">
      <h2>Appearance</h2>
      <p className="settings-card-sub">
        Theme and density for the whole app. Saved on this device and applied
        instantly.
      </p>

      <div className="settings-row">
        <span className="k">
          Theme
          <span style={{ display: "block", color: "var(--text-dim)", fontSize: 11, marginTop: 2 }}>
            {themeHint}
          </span>
        </span>
        <Segmented value={theme} options={THEME_OPTIONS} onChange={setTheme} />
      </div>

      <div className="settings-row">
        <span className="k">
          Density
          <span style={{ display: "block", color: "var(--text-dim)", fontSize: 11, marginTop: 2 }}>
            {densityHint}
          </span>
        </span>
        <Segmented value={density} options={DENSITY_OPTIONS} onChange={setDensity} />
      </div>
    </div>
  );
}
