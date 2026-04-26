import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Surfaces
        bg: "#0c0c11",
        surface: "#16161e",
        "surface-hover": "#1e1e28",
        "surface-active": "#252530",
        // Text
        primary: "#e4e2dc",
        muted: "#8a8880",
        dim: "#5a5850",
        xdim: "#3a3830",
        // Borders
        border: "#2a2a35",
        "border-light": "#1e1e28",
        // Brand
        purple: "#482879",
        magenta: "#B21E7D",
        "purple-hi": "#5a32a0",
        // Semantic
        "conf-high": "#34d399",
        "conf-medium": "#fbbf24",
        "conf-low": "#f87171",
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
