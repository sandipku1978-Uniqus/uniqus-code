import type { CSSProperties } from "react";

type BrandLockupProps = {
  compact?: boolean;
  className?: string;
  style?: CSSProperties;
};

/**
 * Gate 15 mark: a square steel plate with one machined (45°) notched corner,
 * filled with the ember→signal gradient, carrying a stencilled "15" in
 * near-black. Drawn as geometry (no <text>) so it is font-independent and
 * stays crisp at 16px chrome sizes and at 512px raster.
 *
 * The gradient id is a constant rather than useId(): the lockup renders many
 * times per page, but every instance emits an IDENTICAL <defs>, so a duplicate
 * id resolves to the same paint. A constant also keeps this a *server*
 * component — page.tsx and the other call sites render it on the server.
 */
const PLATE_GRADIENT_ID = "gate15-plate-grad";

/** Plate outline: square, top-right corner cut at 45°. */
const PLATE = "M2 2 H20.6 L30 11.4 V30 H2 Z";

/**
 * Stencilled "15". Segmented, square-cut blocks — the numeral is built the way
 * a signage stencil is, not drawn as a typeface glyph.
 */
const NUMERALS = [
  // "1" — stem + angled flag
  "M9.6 10 H12.8 V24 H9.6 Z",
  "M9.6 10 L6.6 12.5 V15.3 L9.6 12.8 Z",
  // "5" — top bar, upper-left stem, middle bar, lower-right stem, bottom bar
  "M16.4 10 H25.4 V13.2 H16.4 Z",
  "M16.4 13.2 H19.6 V15.4 H16.4 Z",
  "M16.4 15.4 H24.6 V18.6 H16.4 Z",
  "M22.2 18.6 H25.4 V20.8 H22.2 Z",
  "M16.4 20.8 H25.4 V24 H16.4 Z",
].join(" ");

export function BrandMark({
  className,
  style,
  title,
}: {
  className?: string;
  style?: CSSProperties;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      role="img"
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
      className={className}
      style={{ width: "100%", height: "100%", display: "block", ...style }}
    >
      <defs>
        <linearGradient
          id={PLATE_GRADIENT_ID}
          x1="0"
          y1="0"
          x2="32"
          y2="32"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#FF5A1F" />
          <stop offset="1" stopColor="#FFC53D" />
        </linearGradient>
      </defs>
      <path d={PLATE} fill={`url(#${PLATE_GRADIENT_ID})`} />
      <path d={NUMERALS} fill="#140D07" fillRule="evenodd" />
    </svg>
  );
}

export default function BrandLockup({
  compact = false,
  className,
  style,
}: BrandLockupProps) {
  return (
    <span className={["lockup", className].filter(Boolean).join(" ")} style={style}>
      <span className="mark">
        <BrandMark />
      </span>
      {!compact && (
        // `code` is kept purely as a CSS hook: the existing responsive rule that
        // strips the wordmark out of a narrow IDE topbar targets `.lockup .code`.
        <span
          className="wordmark code"
          style={{ fontWeight: 700, letterSpacing: "0.02em", whiteSpace: "nowrap" }}
        >
          GATE <span style={{ color: "var(--accent-text, #FF6A00)" }}>15</span>
        </span>
      )}
    </span>
  );
}
