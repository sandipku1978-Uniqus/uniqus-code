import type { ReactNode } from "react";
import type { Art } from "@/lib/templates";

/**
 * Generated "screenshot" artwork — pure SVG, no stored images, server/client safe.
 *
 * Two surfaces share one visual idea (a tiny app UI rendered as wireframe), so a
 * project tile and a template card read as the same product:
 *  - <TemplatePreview art> — a floating light app window on the card's gradient,
 *    one bespoke scene per app type (dashboard, kanban, landing, …).
 *  - <ProjectPreview id hue> — the hue gradient becomes the app's header and a
 *    light content panel below shows a UI motif picked deterministically from the
 *    project id, so every project keeps a distinct, recognizable preview.
 */

// Wireframe palette — light "screenshot" surface with warm-gray content.
const PANEL = "#f6f7fb";
const HEAD = "#ffffff";
const LINE = "#e4e6f0";
const INK = "#c5c9d8"; // primary content bars
const INK2 = "#dadded"; // secondary / faint
const INK3 = "#aeb3c7"; // darker text-ish
const RED = "#ff5f57";
const AMBER = "#febc2e";
const GREEN = "#28c840";

type R = {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  rx?: number;
  o?: number;
  stroke?: string;
};

/** Terse rect helper — keeps the scenes readable. */
function B({ x, y, w, h, fill, rx = 2.5, o, stroke }: R) {
  return (
    <rect
      x={x}
      y={y}
      width={w}
      height={h}
      rx={rx}
      fill={fill}
      opacity={o}
      stroke={stroke}
      strokeWidth={stroke ? 1 : undefined}
    />
  );
}

/** The floating window chrome for template scenes (body region: x30–290, y40–184). */
function Win({ children }: { children: ReactNode }) {
  return (
    <>
      {/* soft drop shadow (offset solid, no filter id to collide on) */}
      <rect x="30" y="26" width="260" height="160" rx="13" fill="#000" opacity="0.22" />
      <rect x="30" y="20" width="260" height="164" rx="13" fill={PANEL} stroke={LINE} strokeWidth="1.5" />
      {/* title bar */}
      <path d="M31 33 a12 12 0 0 1 12-12 h234 a12 12 0 0 1 12 12 v7 H31 Z" fill={HEAD} />
      <line x1="31" y1="40" x2="289" y2="40" stroke={LINE} strokeWidth="1" />
      <circle cx="45" cy="30" r="3.2" fill={RED} />
      <circle cx="56" cy="30" r="3.2" fill={AMBER} />
      <circle cx="67" cy="30" r="3.2" fill={GREEN} />
      <rect x="120" y="26" width="80" height="8" rx="4" fill={INK2} />
      {children}
    </>
  );
}

const ART_ACCENT: Record<Art, string> = {
  admin: "#6366f1",
  crm: "#8b5cf6",
  dashboard: "#3b82f6",
  wiki: "#14b8a6",
  landing: "#ec4899",
  waitlist: "#10b981",
  blog: "#f59e0b",
  pricing: "#d946ef",
  billing: "#0ea5e9",
  storefront: "#f43f5e",
  subscription: "#06b6d4",
  booking: "#7c3aed",
};

/** Body content per app type. Coordinates stay within x42–278, y50–174. */
function scene(art: Art, a: string): ReactNode {
  switch (art) {
    case "dashboard": {
      const bars = [16, 26, 20, 32, 27, 38, 33];
      return (
        <>
          {[42, 122, 202].map((x) => (
            <g key={x}>
              <B x={x} y={50} w={70} h={28} fill={HEAD} stroke={LINE} />
              <B x={x + 8} y={58} w={18} h={4} fill={a} />
              <B x={x + 8} y={66} w={40} h={6} fill={INK} />
            </g>
          ))}
          <B x={42} y={88} w={236} h={86} fill={HEAD} stroke={LINE} />
          {bars.map((bh, i) => (
            <B key={i} x={56 + i * 30} y={162 - bh} w={18} h={bh} fill={i >= 5 ? a : INK} rx={2} />
          ))}
        </>
      );
    }
    case "admin":
      return (
        <>
          <B x={31} y={41} w={54} h={143} fill="#eef0f7" rx={0} />
          {[54, 68, 82, 96].map((y, i) => (
            <B key={y} x={40} y={y} w={36} h={5} fill={i === 0 ? a : INK} rx={2.5} />
          ))}
          <B x={96} y={52} w={130} h={11} fill={INK2} rx={5.5} />
          <B x={250} y={52} w={28} h={11} fill={a} rx={3} />
          {[72, 90, 108, 126, 144].map((y) => (
            <g key={y}>
              <B x={96} y={y} w={104} h={9} fill={INK} />
              <B x={244} y={y} w={34} h={9} fill={a} o={0.4} rx={4.5} />
            </g>
          ))}
        </>
      );
    case "crm":
      return (
        <>
          {[42, 122, 202].map((x, c) => (
            <g key={x}>
              <B x={x} y={52} w={68} h={9} fill={a} o={c === 1 ? 0.9 : 0.35} rx={4.5} />
              {[68, 98, 128].slice(0, c === 0 ? 3 : 2).map((y) => (
                <g key={y}>
                  <B x={x} y={y} w={68} h={24} fill={HEAD} stroke={LINE} />
                  <B x={x + 7} y={y + 6} w={40} h={4} fill={INK} />
                  <B x={x + 7} y={y + 14} w={26} h={4} fill={INK2} />
                </g>
              ))}
            </g>
          ))}
        </>
      );
    case "wiki":
      return (
        <>
          <B x={31} y={41} w={60} h={143} fill="#eef0f7" rx={0} />
          {[
            [40, 54, 42],
            [48, 66, 30],
            [48, 78, 34],
            [40, 90, 38],
            [48, 102, 26],
          ].map(([x, y, w], i) => (
            <B key={y} x={x} y={y} w={w} h={5} fill={i === 0 ? a : INK} />
          ))}
          <B x={102} y={52} w={120} h={10} fill={INK3} />
          {[
            [72, 170],
            [84, 158],
            [96, 174],
            [108, 140],
            [120, 165],
            [132, 110],
          ].map(([y, w]) => (
            <B key={y} x={102} y={y} w={w} h={5} fill={INK2} />
          ))}
        </>
      );
    case "blog":
      return (
        <>
          <B x={42} y={50} w={236} h={46} fill={a} o={0.3} rx={6} />
          <B x={42} y={106} w={150} h={9} fill={INK3} />
          {[122, 134, 146].map((y, i) => (
            <B key={y} x={42} y={y} w={[230, 220, 176][i]} h={5} fill={INK2} />
          ))}
          <line x1="42" y1="160" x2="278" y2="160" stroke={LINE} />
          <B x={42} y={166} w={28} h={6} fill={INK} />
          <B x={78} y={166} w={120} h={6} fill={INK2} />
        </>
      );
    case "landing":
      return (
        <>
          <circle cx={48} cy={54} r={4} fill={a} />
          {[176, 198, 220].map((x) => (
            <B key={x} x={x} y={51} w={14} h={5} fill={INK} />
          ))}
          <B x={246} y={48} w={30} h={12} fill={a} rx={6} />
          <B x={108} y={78} w={104} h={9} fill={INK3} rx={4.5} />
          <B x={120} y={94} w={80} h={5} fill={INK2} />
          <B x={138} y={106} w={44} h={13} fill={a} rx={6.5} />
          {[42, 118, 194].map((x) => (
            <g key={x}>
              <B x={x} y={134} w={70} h={36} fill={HEAD} stroke={LINE} />
              <circle cx={x + 14} cy={148} r={5} fill={a} opacity={0.5} />
              <B x={x + 26} y={145} w={34} h={4} fill={INK} />
              <B x={x + 10} y={158} w={50} h={4} fill={INK2} />
            </g>
          ))}
        </>
      );
    case "waitlist":
      return (
        <>
          <B x={100} y={66} w={120} h={10} fill={INK3} rx={5} />
          <B x={116} y={84} w={88} h={5} fill={INK2} />
          <B x={82} y={100} w={118} h={18} fill={HEAD} stroke={LINE} rx={9} />
          <B x={92} y={106} w={70} h={6} fill={INK2} />
          <B x={206} y={100} w={36} h={18} fill={a} rx={9} />
          {[0, 1, 2, 3].map((i) => (
            <circle key={i} cx={132 + i * 14} cy={134} r={6} fill={i === 3 ? a : INK} stroke={PANEL} strokeWidth={1.5} />
          ))}
          <B x={196} y={131} w={26} h={5} fill={INK2} />
        </>
      );
    case "pricing":
      return (
        <>
          {[44, 122, 200].map((x, i) => {
            const mid = i === 1;
            return (
              <g key={x}>
                <B x={x} y={mid ? 50 : 58} w={64} h={mid ? 116 : 100} fill={HEAD} stroke={mid ? a : LINE} rx={7} />
                <B x={x + 10} y={mid ? 60 : 68} w={30} h={9} fill={mid ? a : INK3} />
                {[mid ? 80 : 88, mid ? 92 : 100, mid ? 104 : 112].map((y) => (
                  <B key={y} x={x + 10} y={y} w={44} h={4} fill={INK2} />
                ))}
                <B x={x + 10} y={mid ? 142 : 134} w={44} h={12} fill={a} o={mid ? 1 : 0.4} rx={6} />
              </g>
            );
          })}
        </>
      );
    case "billing":
      return (
        <>
          <B x={42} y={52} w={56} h={34} fill={a} rx={6} />
          <B x={49} y={74} w={42} h={4} fill="#fff" o={0.7} />
          <B x={49} y={64} w={16} h={4} fill="#fff" o={0.5} />
          <B x={112} y={56} w={120} h={6} fill={INK} />
          <B x={112} y={70} w={96} h={6} fill={INK2} />
          {[100, 116, 132].map((y) => (
            <g key={y}>
              <B x={42} y={y} w={120} h={7} fill={INK2} />
              <B x={236} y={y} w={42} h={7} fill={INK} />
            </g>
          ))}
          <line x1="42" y1="152" x2="278" y2="152" stroke={LINE} />
          <B x={42} y={158} w={62} h={8} fill={INK3} />
          <B x={232} y={158} w={46} h={8} fill={a} />
        </>
      );
    case "storefront":
      return (
        <>
          {[42, 122, 202].map((x) =>
            [52, 114].map((y) => (
              <g key={`${x}-${y}`}>
                <B x={x} y={y} w={68} h={56} fill={HEAD} stroke={LINE} rx={6} />
                <B x={x + 7} y={y + 7} w={54} h={28} fill={INK2} rx={4} />
                <B x={x + 7} y={y + 40} w={30} h={5} fill={INK} />
                <circle cx={x + 58} cy={y + 44} r={5} fill={a} />
              </g>
            )),
          )}
        </>
      );
    case "subscription":
      return (
        <>
          <B x={42} y={52} w={112} h={66} fill={HEAD} stroke={LINE} rx={7} />
          <B x={52} y={62} w={44} h={6} fill={INK3} />
          <B x={52} y={76} w={64} h={9} fill={a} o={0.8} />
          <B x={52} y={98} w={92} h={7} fill={INK2} rx={3.5} />
          <B x={52} y={98} w={56} h={7} fill={a} rx={3.5} />
          {[56, 86, 116].map((y) => (
            <g key={y}>
              <B x={166} y={y} w={56} h={5} fill={INK} />
              <B x={166} y={y + 9} w={108} h={6} fill={INK2} rx={3} />
              <B x={166} y={y + 9} w={[70, 40, 90][[56, 86, 116].indexOf(y)]} h={6} fill={a} o={0.7} rx={3} />
            </g>
          ))}
        </>
      );
    case "booking":
      return (
        <>
          <B x={42} y={52} w={72} h={9} fill={INK3} />
          <circle cx={262} cy={56} r={4} fill={INK} />
          <circle cx={276} cy={56} r={4} fill={INK} />
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <B key={i} x={44 + i * 34} y={70} w={16} h={4} fill={INK2} />
          ))}
          {[0, 1, 2, 3].map((row) =>
            [0, 1, 2, 3, 4, 5, 6].map((col) => {
              const booked = (row * 7 + col) % 5 === 2;
              return (
                <B
                  key={`${row}-${col}`}
                  x={44 + col * 34}
                  y={80 + row * 23}
                  w={28}
                  h={18}
                  fill={booked ? a : HEAD}
                  o={booked ? 0.85 : 1}
                  stroke={booked ? undefined : LINE}
                  rx={3}
                />
              );
            }),
          )}
        </>
      );
  }
}

export function TemplatePreview({ art }: { art: Art }) {
  const a = ART_ACCENT[art] ?? "#7c6cff";
  return (
    <svg
      className="ui-preview"
      viewBox="0 0 320 200"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-hidden="true"
    >
      <Win>{scene(art, a)}</Win>
    </svg>
  );
}

// ── Project tiles ────────────────────────────────────────────────────────────

type Motif = "cards" | "chart" | "rows" | "kanban";
const MOTIFS: Motif[] = ["cards", "chart", "rows", "kanban"];

function hashIndex(s: string, n: number): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % n;
}

/** Compact motif filling the light panel (x8–312, y32–82). */
function motifScene(m: Motif, a: string): ReactNode {
  switch (m) {
    case "cards":
      return (
        <>
          {[12, 84, 156, 228].map((x) => (
            <g key={x}>
              <B x={x} y={36} w={60} h={42} fill={HEAD} stroke={LINE} rx={5} />
              <B x={x + 8} y={44} w={16} h={4} fill={a} />
              <B x={x + 8} y={54} w={36} h={6} fill={INK} />
              <B x={x + 8} y={66} w={28} h={4} fill={INK2} />
            </g>
          ))}
        </>
      );
    case "chart":
      return (
        <>
          <B x={12} y={36} w={70} h={42} fill={HEAD} stroke={LINE} rx={5} />
          <B x={20} y={44} w={18} h={4} fill={a} />
          <B x={20} y={54} w={44} h={7} fill={INK} />
          <B x={98} y={36} w={210} h={42} fill={HEAD} stroke={LINE} rx={5} />
          {[14, 22, 17, 28, 23, 31, 26, 34].map((bh, i) => (
            <B key={i} x={110 + i * 24} y={72 - bh} w={14} h={bh} fill={i >= 6 ? a : INK} rx={2} />
          ))}
        </>
      );
    case "rows":
      return (
        <>
          <B x={8} y={26} w={56} h={62} fill="#eef0f7" rx={0} />
          {[36, 50, 64].map((y, i) => (
            <B key={y} x={16} y={y} w={36} h={5} fill={i === 0 ? a : INK} />
          ))}
          {[38, 54, 70].map((y) => (
            <g key={y}>
              <B x={76} y={y} w={150} h={9} fill={INK} />
              <B x={258} y={y} w={48} h={9} fill={a} o={0.4} rx={4.5} />
            </g>
          ))}
        </>
      );
    case "kanban":
      return (
        <>
          {[12, 116, 220].map((x, c) => (
            <g key={x}>
              <B x={x} y={34} w={88} h={8} fill={a} o={c === 1 ? 0.9 : 0.35} rx={4} />
              {[48, 68].map((y) => (
                <g key={y}>
                  <B x={x} y={y} w={88} h={16} fill={HEAD} stroke={LINE} rx={4} />
                  <B x={x + 8} y={y + 5} w={50} h={4} fill={INK} />
                </g>
              ))}
            </g>
          ))}
        </>
      );
  }
}

export function ProjectPreview({ id, hue }: { id: string; hue: number }) {
  const a = `hsl(${hue} 72% 62%)`;
  const motif = MOTIFS[hashIndex(id, MOTIFS.length)];
  return (
    <svg
      className="ui-preview"
      viewBox="0 0 320 88"
      preserveAspectRatio="xMidYMin slice"
      role="img"
      aria-hidden="true"
    >
      {/* window dots + address pill float over the gradient header (transparent) */}
      <circle cx="14" cy="13" r="3" fill="#fff" opacity="0.75" />
      <circle cx="25" cy="13" r="3" fill="#fff" opacity="0.55" />
      <circle cx="36" cy="13" r="3" fill="#fff" opacity="0.4" />
      <rect x="120" y="9" width="84" height="8" rx="4" fill="#fff" opacity="0.2" />
      {/* light content panel */}
      <rect x="0" y="26" width="320" height="62" fill={PANEL} />
      <line x1="0" y1="26.5" x2="320" y2="26.5" stroke={LINE} strokeWidth="1" />
      {motifScene(motif, a)}
    </svg>
  );
}
