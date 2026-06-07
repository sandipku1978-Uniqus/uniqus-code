"use client";

import { type CSSProperties } from "react";
import type { DesignTokens } from "@uniqus/api-types";

/**
 * A live, at-a-glance preview of a design system. Renders a self-contained
 * "mini app" styled entirely with the system's OWN tokens (not the app theme):
 * palette, type, and the STRUCTURED components (button variants, inputs, badges,
 * a card) so consistency of shape — not just color — is visible and updates
 * live as tokens are edited. Color math is defensive: non-hex values
 * (rgb()/hsl()/var()) skip the ramp and fall back gracefully.
 */
export default function DesignSystemPreview({
  tokens,
  name,
}: {
  tokens: DesignTokens;
  name?: string;
}) {
  const c = tokens.colors ?? {};
  const isDark = tokens.mode === "dark";
  const bg = pick(c, ["background", "bg", "base"], isDark ? "#0e0e14" : "#ffffff");
  const surface = pick(c, ["surface", "card", "panel"], isDark ? "#1a1a22" : "#f6f6f8");
  const text = pick(c, ["text", "foreground", "fg", "ink"], isDark ? "#f4f4f6" : "#0e0e14");
  const primary = pick(c, ["primary", "brand", "accent", "action"], "#6d5efc");
  const accent = pick(c, ["accent", "secondary", "success", "brand"], primary);
  const border = pick(c, ["border", "outline", "divider"], withAlpha(text, 0.14));
  const muted = pick(c, ["muted", "subtle", "secondary-text", "text-muted"], withAlpha(text, 0.55));
  const radius = (tokens.radius || "8px").trim();
  const fonts = tokens.fonts ?? { body: "system-ui", heading: "system-ui" };

  // ── resolve structured component specs (palette-key aware) ──
  const comp = tokens.components ?? {};
  const btn = comp.button ?? {};
  const btnRadius = btn.radius ?? radius;
  const btnPad = `${btn.paddingY ?? "8px"} ${btn.paddingX ?? "14px"}`;
  const btnWeight = btn.fontWeight ?? 600;
  const variants =
    btn.variants && btn.variants.length
      ? btn.variants
      : [
          { name: "primary", background: "primary", foreground: "#ffffff" },
          { name: "secondary", background: "surface", foreground: "text", border: "border" },
          { name: "outline", background: "transparent", foreground: "primary", border: "primary" },
          { name: "ghost", background: "transparent", foreground: "muted" },
        ];
  const inp = comp.input ?? {};
  const inRadius = inp.radius ?? radius;
  const inBg = tok(inp.background, c, bg);
  const inBorder = tok(inp.border, c, border);
  const card = comp.card ?? {};
  const cardRadius = card.radius ?? "12px";
  const cardBg = tok(card.background, c, surface);
  const cardBorder = tok(card.border, c, border);
  const cardShadow = card.shadow && card.shadow !== "none" ? card.shadow : "none";
  const cardPad = card.padding ?? "16px";
  const badgeRadius = comp.badge?.radius ?? "999px";
  const badgeVariant = comp.badge?.variant ?? "soft";

  function badgeStyle(color: string): CSSProperties {
    const base: CSSProperties = { borderRadius: badgeRadius, padding: "3px 11px", fontSize: 11, fontWeight: 600 };
    if (badgeVariant === "solid") return { ...base, background: color, color: readableOn(color) };
    if (badgeVariant === "outline") return { ...base, background: "transparent", color, border: `1px solid ${color}` };
    return { ...base, background: withAlpha(color, 0.16), color };
  }

  const shell: CSSProperties = {
    background: bg,
    color: text,
    borderRadius: 14,
    border: `1px solid ${border}`,
    overflow: "hidden",
    fontFamily: fonts.body || "system-ui, sans-serif",
  };
  const panel: CSSProperties = {
    padding: 14,
    borderRadius: 12,
    border: `1px solid ${border}`,
    background: surface,
  };

  return (
    <div style={shell}>
      {/* faux app top bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          borderBottom: `1px solid ${border}`,
          background: surface,
        }}
      >
        <span style={{ width: 9, height: 9, borderRadius: 999, background: primary }} />
        <span style={{ width: 9, height: 9, borderRadius: 999, background: accent }} />
        <span
          style={{
            marginLeft: 6,
            fontFamily: fonts.heading || fonts.body,
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: "-0.01em",
          }}
        >
          {name?.trim() || "Preview"}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 10.5, color: muted, textTransform: "uppercase", letterSpacing: 0.5 }}>
          {tokens.mode}
        </span>
      </div>

      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 18 }}>
        {/* ── Palette ── */}
        <Section label="Palette" muted={muted}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(112px, 1fr))", gap: 10 }}>
            {Object.entries(c).length === 0 ? (
              <span style={{ fontSize: 12, color: muted }}>No colors yet.</span>
            ) : (
              Object.entries(c).map(([key, value]) => {
                const r = ramp(value);
                return (
                  <div key={key} style={{ borderRadius: 10, overflow: "hidden", border: `1px solid ${border}`, background: surface }}>
                    <div style={{ height: 44, background: value }} />
                    {r.length > 0 && (
                      <div style={{ display: "flex", height: 8 }}>
                        {r.map((s, i) => (
                          <div key={i} style={{ flex: 1, background: s }} />
                        ))}
                      </div>
                    )}
                    <div style={{ padding: "7px 9px" }}>
                      <div style={{ fontSize: 11.5, fontWeight: 600, textTransform: "capitalize" }}>{key}</div>
                      <div style={{ fontSize: 10.5, color: muted, fontFamily: fonts.mono || "ui-monospace, monospace" }}>{value}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Section>

        {/* ── Typography ── */}
        <Section label="Typography" muted={muted}>
          <div style={{ ...panel, display: "grid", gridTemplateColumns: "auto 1fr", gap: 16, alignItems: "center" }}>
            <div style={{ fontFamily: fonts.heading || fonts.body, fontSize: 52, fontWeight: 700, lineHeight: 1 }}>Aa</div>
            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontFamily: fonts.heading || fonts.body, fontSize: 18, fontWeight: 600 }}>
                {familyName(fonts.heading)}
                <span style={{ fontSize: 11, color: muted, fontWeight: 400 }}> · Heading</span>
              </div>
              <div style={{ fontFamily: fonts.body, fontSize: 13.5, color: muted, lineHeight: 1.5 }}>
                The quick brown fox jumps over the lazy dog — {familyName(fonts.body)} body.
              </div>
              {fonts.mono ? (
                <div style={{ fontFamily: fonts.mono, fontSize: 12, color: muted }}>
                  const radius = &quot;{radius}&quot;;
                </div>
              ) : null}
              {tokens.typeScale ? <div style={{ fontSize: 11, color: muted }}>Scale · {tokens.typeScale}</div> : null}
            </div>
          </div>
        </Section>

        {/* ── Components ── */}
        <Section label="Components" muted={muted}>
          <div style={{ ...panel, display: "flex", flexDirection: "column", gap: 14 }}>
            {/* button variants */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              {variants.map((v) => {
                const vbg = tok(v.background, c, primary);
                const vfg = v.foreground ? tok(v.foreground, c, readableOn(vbg)) : readableOn(vbg);
                const vborder = v.border ? `1px solid ${tok(v.border, c, border)}` : "1px solid transparent";
                return (
                  <span
                    key={v.name}
                    style={{
                      background: vbg,
                      color: vfg,
                      border: vborder,
                      borderRadius: btnRadius,
                      padding: btnPad,
                      fontSize: 12.5,
                      fontWeight: btnWeight,
                      lineHeight: 1.2,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {cap(v.name)}
                  </span>
                );
              })}
            </div>

            {/* input + icon buttons */}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px",
                  borderRadius: inRadius,
                  border: `1px solid ${inBorder}`,
                  background: inBg,
                  color: muted,
                  fontSize: 12.5,
                }}
              >
                <SearchIcon color={muted} />
                Search…
              </div>
              <span style={iconBtn(primary, readableOn(primary), btnRadius)}>+</span>
              <span style={iconBtn(withAlpha(accent, 0.16), accent, btnRadius)}>★</span>
            </div>

            {/* badges */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <span style={badgeStyle(primary)}>Primary</span>
              <span style={badgeStyle(accent)}>Accent</span>
              <span style={badgeStyle(muted)}>Neutral</span>
            </div>
          </div>
        </Section>

        {/* ── Card sample ── */}
        <Section label="Card" muted={muted}>
          <div style={{ background: cardBg, border: `1px solid ${cardBorder}`, borderRadius: cardRadius, boxShadow: cardShadow, padding: cardPad }}>
            <div style={{ fontFamily: fonts.heading || fonts.body, fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
              Card title
            </div>
            <div style={{ fontSize: 12.5, color: muted, lineHeight: 1.55, marginBottom: 12 }}>
              Surfaces, borders and shadow come straight from the card spec — components stay on-system.
            </div>
            <span
              style={{
                background: tok(variants[0]?.background, c, primary),
                color: variants[0]?.foreground ? tok(variants[0].foreground, c, readableOn(primary)) : readableOn(primary),
                borderRadius: btnRadius,
                padding: btnPad,
                fontSize: 12.5,
                fontWeight: btnWeight,
              }}
            >
              {cap(variants[0]?.name ?? "Primary")}
            </span>
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({ label, muted, children }: { label: string; muted: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: muted }}>{label}</div>
      {children}
    </div>
  );
}

function SearchIcon({ color }: { color: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function iconBtn(background: string, color: string, radius: string): CSSProperties {
  return {
    display: "grid",
    placeItems: "center",
    width: 32,
    height: 32,
    flexShrink: 0,
    background,
    color,
    borderRadius: radius,
    fontSize: 15,
    fontWeight: 700,
  };
}

// ── token + color helpers (defensive: only operate on hex; otherwise pass through) ──

/** Resolve a component color field: a palette token name → its color, else the
 *  raw value ("transparent"/hex/rgb()), else the fallback. */
function tok(value: string | undefined, colors: Record<string, string>, fallback: string): string {
  if (!value) return fallback;
  if (value === "transparent") return "transparent";
  return colors[value] ?? value;
}

function pick(colors: Record<string, string>, names: string[], fallback: string): string {
  for (const n of names) {
    const v = colors[n];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return fallback;
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function parseHex(input: string): { r: number; g: number; b: number } | null {
  const s = input.trim();
  let m = /^#?([0-9a-fA-F]{3})$/.exec(s);
  if (m) {
    const [r, g, b] = m[1].split("");
    return { r: parseInt(r + r, 16), g: parseInt(g + g, 16), b: parseInt(b + b, 16) };
  }
  m = /^#?([0-9a-fA-F]{6})$/.exec(s);
  if (m) {
    const h = m[1];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }
  return null;
}

function luminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const a = [r, g, b].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

/** Pick a legible ink color (near-black / white) for text on top of `color`. */
function readableOn(color: string): string {
  const rgb = parseHex(color);
  if (!rgb) return "#ffffff";
  return luminance(rgb) > 0.5 ? "#0b0b10" : "#ffffff";
}

/** A hex with an alpha channel; falls back to the solid color for non-hex input. */
function withAlpha(color: string, alpha: number): string {
  const rgb = parseHex(color);
  if (!rgb) return color;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function rgbToHsl({ r, g, b }: { r: number; g: number; b: number }) {
  const rr = r / 255,
    gg = g / 255,
    bb = b / 255;
  const max = Math.max(rr, gg, bb),
    min = Math.min(rr, gg, bb);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rr:
        h = (gg - bb) / d + (gg < bb ? 6 : 0);
        break;
      case gg:
        h = (bb - rr) / d + 2;
        break;
      default:
        h = (rr - gg) / d + 4;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToHex(h: number, s: number, l: number): string {
  const ss = s / 100;
  const ll = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = ss * Math.min(ll, 1 - ll);
  const f = (n: number) => {
    const v = ll - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * v)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** A light→dark tint/shade strip of the same hue. Empty for non-hex colors. */
function ramp(color: string): string[] {
  const rgb = parseHex(color);
  if (!rgb) return [];
  const { h, s } = rgbToHsl(rgb);
  const sat = Math.max(10, Math.min(96, s));
  return [86, 70, 54, 38, 24].map((l) => hslToHex(h, sat, l));
}

function familyName(stack?: string): string {
  if (!stack) return "System";
  const first = stack.split(",")[0]?.trim().replace(/^['"]|['"]$/g, "");
  return first || "System";
}
