import type { Config } from "tailwindcss";

/**
 * Gate 15 — one warm signal colour on cold industrial steel. The greys are
 * deliberately COOL (gunmetal/graphite): a cold ground is what makes safety
 * orange read as hi-vis. Never warm them toward brown.
 *
 * These mirror the dark-theme `:root` tokens in globals.css, which remain the
 * source of truth for the running UI — this map exists so Tailwind utilities
 * resolve to the same palette.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Surfaces — asphalt / gunmetal
        bg: "#0A0B0C",
        pane: "#0F1113",
        surface: "#16181B",
        "surface-hover": "#1E2125",
        "surface-active": "#262A2F",
        elev: "#1E2125",
        code: "#08090A",
        // Text — painted-steel off-white, neutral, not cream
        primary: "#EDEBE7",
        muted: "#9A9793",
        dim: "#7C7A76",
        xdim: "#3C3A37",
        // Borders
        border: "#2A2E33",
        "border-light": "#1E2125",
        "border-strong": "rgba(255,255,255,0.17)",
        "border-active": "#FF7700",
        // Brand — safety orange on steel. Ink ON ember is near-black (#140D07),
        // never white: #FF7700 + white is ~2.7:1 and fails AA.
        ember: "#FF7700",
        "ember-hi": "#FF8C24",
        signal: "#FFCF3D",
        rust: "#AE460A",
        ink: "#140D07",
        // Semantic — status only. Never use brand `signal` yellow as a warning.
        "conf-high": "#34D399",
        "conf-medium": "#FBBF24",
        "conf-low": "#F87171",
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(135deg, #FF651F, #FFCF3D)",
        hazard:
          "repeating-linear-gradient(45deg, #FF7700 0 8px, transparent 8px 16px)",
      },
      borderRadius: {
        sm: "4px",
        md: "6px",
        lg: "8px",
        xl: "12px",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
