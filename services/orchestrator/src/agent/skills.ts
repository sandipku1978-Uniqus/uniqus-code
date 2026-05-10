import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Per-project Skills (Plan §3.8).
 *
 * A markdown doc the user maintains per project at `.uniqus/skills.md`.
 * Treated as a system-prompt extension: the orchestrator prepends it to the
 * system prompt at every turn so the agent is steered toward the user's
 * conventions ("brand voice", "always use Python 3.11", "never edit
 * /vendor", etc.) without having to repeat them in chat.
 *
 * The Skills file is just a regular file in the sandbox — it shows up in
 * the file tree, syncs to Storage, and the user can edit it from the IDE.
 * The dedicated Skills modal in the topbar is a convenience surface; the
 * underlying data is the file on disk.
 */

const SKILLS_PATH = ".uniqus/skills.md";
const MAX_SKILLS_BYTES = 64 * 1024;

export function skillsRelPath(): string {
  return SKILLS_PATH;
}

export async function readSkills(sandboxDir: string): Promise<string | null> {
  const full = path.resolve(sandboxDir, SKILLS_PATH);
  if (!full.startsWith(path.resolve(sandboxDir) + path.sep)) return null;
  try {
    const buf = await fs.readFile(full);
    if (buf.length === 0) return null;
    if (buf.length > MAX_SKILLS_BYTES) {
      return buf.subarray(0, MAX_SKILLS_BYTES).toString("utf-8");
    }
    return buf.toString("utf-8");
  } catch {
    return null;
  }
}

export async function writeSkills(sandboxDir: string, content: string): Promise<void> {
  const full = path.resolve(sandboxDir, SKILLS_PATH);
  if (!full.startsWith(path.resolve(sandboxDir) + path.sep)) {
    throw new Error("skills path escapes sandbox");
  }
  const trimmed = content.length > MAX_SKILLS_BYTES
    ? content.slice(0, MAX_SKILLS_BYTES)
    : content;
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, trimmed, "utf-8");
}

export function formatSkillsForPrompt(skills: string | null): string {
  if (!skills || !skills.trim()) return "";
  return `\n\nProject Skills (user-maintained guidance — follow these unless they contradict a system rule above):\n${skills.trim()}\n`;
}

/**
 * Curated design skill packs (Plan §5 — "pre-built skill markdowns the user
 * opts into via a picker"). Layered on top of the generic Skills mechanism;
 * applying one writes the pack body to .uniqus/skills.md (or appends to
 * existing skills, depending on UI choice).
 */
export interface SkillPack {
  id: string;
  name: string;
  summary: string;
  body: string;
}

export const SKILL_PACKS: readonly SkillPack[] = [
  {
    id: "hi-fi-minimal",
    name: "Hi-fi Minimal",
    summary: "Generous whitespace, neutral palette, single accent color, system fonts.",
    body: `# Design: Hi-fi Minimal

- Use a neutral palette: white background (#fff), near-black text (#111), one cool gray for borders (#e5e7eb).
- One accent color used sparingly for primary actions only. Default: #2563eb. Never apply it to whole surfaces.
- System font stack: -apple-system, "Segoe UI", Roboto, sans-serif. Avoid Google Fonts unless asked.
- Generous whitespace: container padding starts at 24px, sections separated by 64px on desktop.
- Buttons: 1px border, 8px radius, no shadows. Hover changes border to accent.
- No gradients, no decorative emoji, no glassmorphism. Clean rectangular cards with 1px borders.
- Use real product copy, not Lorem Ipsum, when visible content is unspecified.
`,
  },
  {
    id: "retro-pixel",
    name: "Retro Pixel",
    summary: "8-bit feel, monospace display, pixel-perfect borders, NES-era palette.",
    body: `# Design: Retro Pixel

- Pixel-art-style monospace display font (e.g. "Press Start 2P" via Google Fonts) for headings, system mono for body.
- Hard-edged 2px solid borders only, no rounded corners (border-radius: 0).
- Palette inspired by NES: #1d1d1d background, #f8f8f8 text, #ff004d accent, #29adff secondary, #00e436 success.
- Buttons render as sharp rectangles with a 4px box-shadow offset (no blur) for a "pressed" feel.
- Pixelated images: image-rendering: pixelated.
- Avoid gradients and antialiased curves. Squares and rectangles only.
`,
  },
  {
    id: "liquid-glass",
    name: "Liquid Glass",
    summary: "Translucent surfaces, blurred backdrops, soft saturated gradients.",
    body: `# Design: Liquid Glass

- Translucent surfaces with backdrop-filter: blur(20px) saturate(180%) on cards/modals.
- Background gradient: soft, saturated, rotating between purple/pink/cyan. Animate slowly if performance allows.
- Card surfaces: rgba(255,255,255,0.08) on dark backgrounds, rgba(255,255,255,0.5) on light.
- 1px translucent borders (rgba(255,255,255,0.2)) to define edges.
- 16-24px border-radius. Soft outer glows on hover (box-shadow).
- Sans-serif system stack, 400-500 weights only. Light tracking on headings.
- Avoid hard 1.0-alpha colors except for primary action buttons.
`,
  },
  {
    id: "brutalist",
    name: "Brutalist",
    summary: "Raw HTML feel, oversized type, harsh borders, mono accents.",
    body: `# Design: Brutalist

- Default browser styles for forms — no fancy custom inputs.
- Black-on-white or white-on-black. One accent color (try #ff5500 or #ffeb3b) used as backgrounds for blocks.
- Massive headlines: clamp(48px, 10vw, 120px) line-height 0.95.
- Mono font for code AND captions: "JetBrains Mono", monospace.
- 4px solid borders, no border-radius. Hard drop shadows: 6px 6px 0 #000.
- Layouts can be intentionally asymmetric, with elements "breaking" the grid.
- No animations, no gradients, no soft colors. Embrace the rawness.
`,
  },
  {
    id: "apple-hig",
    name: "Apple HIG",
    summary: "iOS-inspired: rounded rects, SF-like fonts, soft shadows, restrained color.",
    body: `# Design: Apple HIG

- Font stack: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", sans-serif.
- Rounded everything: 12px on cards, 8px on buttons, 16px on modals/sheets.
- Subtle shadows: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04). No hard edges.
- iOS system colors: blue #007aff (primary), red #ff3b30 (destructive), green #34c759 (success), gray #8e8e93 (secondary).
- Plenty of whitespace; line-height 1.4-1.5 on body copy.
- Use SF Symbols equivalents (Heroicons solid) where possible. Avoid emoji UI.
- Light vibrancy effects on overlays (backdrop-filter blur(40px)).
`,
  },
  {
    id: "material-3",
    name: "Material 3",
    summary: "Material You: elevation tokens, dynamic color, generous touch targets.",
    body: `# Design: Material 3

- Use Material 3 tokens conceptually: surface, primary, secondary, tertiary; on-surface for text on each.
- Default light theme: surface #fffbfe, primary #6750a4, on-primary #ffffff, secondary container #e8def8.
- Buttons: filled (primary action), tonal (secondary), outlined, text — pick the right variant for hierarchy.
- Touch targets minimum 48dp. Density-aware: tighten on desktop only when explicitly desktop-only.
- Elevation via subtle shadows + tint: cards at level 1 (1dp blur, ~4% primary tint).
- Roboto or "Roboto Flex" for sans-serif. Display sizes 36-57px.
- 28px radius on FABs, 12-16px on cards/buttons.
- Use icons from Material Symbols (rounded variant by default).
`,
  },
];

export function findPackById(id: string): SkillPack | null {
  return SKILL_PACKS.find((p) => p.id === id) ?? null;
}
