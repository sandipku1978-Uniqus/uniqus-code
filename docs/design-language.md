# Uniqus Code — house design language

The visual identity shared by the public marketing site and the project
dashboard. Use this when building or restyling **Uniqus-branded surfaces** so new
work reads as one product. It is portable: paste it into any tool (Claude,
ChatGPT, Gemini, a designer brief) — every value below is inline, no lookups
required.

Distilled from three sources of truth:

- Marketing — [apps/web/app/page.tsx](../apps/web/app/page.tsx),
  [apps/web/app/(marketing)/layout.tsx](../apps/web/app/(marketing)/layout.tsx)
- Dashboard home — [apps/web/components/ProjectPicker.tsx](../apps/web/components/ProjectPicker.tsx)
- Tokens (single source of truth) — `:root` in [apps/web/app/globals.css](../apps/web/app/globals.css)
- Craft backbone — [services/orchestrator/src/agent/designGuidance.ts](../services/orchestrator/src/agent/designGuidance.ts)

---

## 0. Scope — when this applies (read first)

The agent-loop craft rules say *"purple/violet gradients are the most overused
AI default — reach for them only when the brief genuinely calls for it,"* and
that an applied design system **overrides the default aesthetic while the craft
rules still apply.** This document is exactly that: the Uniqus **house pack**.

- **Apply it** when the work *is* a Uniqus surface — the marketing site, the
  dashboard, in-app UI — or when someone explicitly asks for "the Uniqus look."
  Here the purple→magenta gradient is deliberate brand identity, not a default.
- **Do not apply it** to arbitrary user app projects built inside the product.
  Those get their own per-project art direction (and should avoid defaulting to
  purple). Forcing the house palette onto every project is itself a failure.

The one-sentence direction: **a precision instrument in warm near-black — calm
tinted dark surfaces and disciplined type, lit by a single purple→magenta brand
gradient used as a scalpel, never a paint roller.**

---

## 1. Foundations

### 1.1 Use tokens, never raw hex

Everything below is defined as a CSS variable in `globals.css :root` and flipped
for light mode / compact density. Read these via `var(--token)` — hardcoding a
hex is how the app and the public site drift apart. Brand, accent, type, radii,
and motion are **theme-agnostic**; only surface / text / border / semantic
tokens flip between themes.

### 1.2 Brand (theme-agnostic)

| Token | Value | Use |
|---|---|---|
| `--brand-purple` | `#482879` | Brand base; structure, not active cues |
| `--brand-magenta` | `#B21E7D` | The accent — see below |
| `--brand-purple-hi` | `#5a32a0` | Lifted purple for glows/gradients |
| `--brand-gradient` | `linear-gradient(135deg, #482879, #B21E7D)` | Primary buttons, send button, active pills, gradient-text accent word |
| `--accent` / `--accent-primary` | `#B21E7D` | **Magenta**, not purple |

**Magenta is the accent, not purple.** On a near-black surface the dark brand
purple (`#482879`) is almost invisible as an active/selected/focus cue, so
magenta carries every "this is live/selected/focused" signal: focus rings,
active states, the one highlight per view. Purple stays for brand structure,
ambient glows, and the gradient's dark stop.

### 1.3 Surfaces — dark is primary (app scope)

A warm near-black ramp with a faint blue-violet cast. Keep the relative steps; don't invent in-between shades.

| Token | Dark | Role |
|---|---|---|
| `--bg-dark` | `#0a0b10` | Page |
| `--bg-pane` | `#0d0e14` | Panes / topbar / status bar |
| `--bg-surface` | `#15161f` | Cards, raised surfaces |
| `--bg-surface-hover` | `#1d1e29` | Card hover |
| `--bg-surface-active` | `#242532` | Pressed / selected fill |
| `--bg-elev` | `#1d1e29` | Raised fields (inputs) |
| `--bg-code` | `#07080d` | Deepest: code / tool-output |
| `--bg-chat` | `#12131c` | Chat column |

### 1.4 Surfaces — marketing scope (`--mk-*`)

The marketing site runs on its own slightly different ramp so the public pages
read a touch crisper; it shares the brand tokens.

| Token | Value | Role |
|---|---|---|
| `--mk-bg` | `#07080d` | Marketing page base |
| `--mk-panel-solid` | `#12131c` | Panel/card base (usually mixed translucent) |
| `--mk-line` | `rgba(255,255,255,0.11)` | Hairline border |
| `--mk-line-strong` | `rgba(255,255,255,0.18)` | Emphasis border (hover/focus) |
| `--mk-text` | `#f4f2ee` | Primary text |
| `--mk-muted` | `#a8a39b` | Secondary text |
| `--mk-dim` | `#716d66` | Eyebrows, captions |
| `--mk-cyan` / `--mk-teal` / `--mk-green` | `#38bdf8` / `#2dd4bf` / `#64d29b` | Rare cool accents in product visuals (grids, "live" dot) — never compete with magenta |

### 1.5 Text — warm ramp (app scope)

Warm, not cool gray. Primary is brightened toward the marketing `#f4f2ee` so app
surfaces never read duller than the public site.

| Token | Dark | Use |
|---|---|---|
| `--text-primary` | `#efede7` | Body, headings |
| `--text-muted` | `#93908a` | Secondary copy |
| `--text-dim` | `#7c7a72` | Hints, captions, criteria (AA-legible) |
| `--text-xdim` | `#3a3830` | Non-text decoration only — never small text |

### 1.6 Borders

| Token | Dark | Use |
|---|---|---|
| `--border-default` | `#2a2b37` | Default 1px hairline |
| `--border-light` | `#1d1e29` | Faint dividers |
| `--border-strong` | `rgba(255,255,255,0.17)` | Hover/focus emphasis — lift reads as a border change, not piled-on shadow |
| `--border-active` | `#482879` | Active outlines |

### 1.7 Semantic (confidence/status)

Each foreground pairs with a ~10% translucent background fill.

| State | Fg | Bg |
|---|---|---|
| High / live / success | `--conf-high` `#34d399` | `rgba(16,185,129,0.10)` |
| Medium / building / warn | `--conf-medium` `#fbbf24` | `rgba(245,158,11,0.10)` |
| Low / failed / error | `--conf-low` `#f87171` | `rgba(239,68,68,0.10)` |

### 1.8 Typography

Two families: one sans (`--font-sans`, loaded in the app shell) for body and
headings, one mono (`--font-mono`) for eyebrows, micro-labels, metrics, code,
and crumbs. Always end stacks with a system fallback; never let the fallback be
the visible identity.

**Type scale — snap to these, no half-pixels** (half-pixel sizes render fuzzy
and signal ad-hoc sizing):

`--fs-2xs 10` · `--fs-xs 11` · `--fs-sm 12` · `--fs-base 13` · `--fs-md 14` ·
`--fs-lg 16` · `--fs-xl 20` · `--fs-2xl 24` · `--fs-3xl 32`. Body default 14px /
line-height 1.6.

**Display type is large and *light*, not extrabold** (heavy display weight is
the default tell):

| Surface | Size | Weight | Tracking |
|---|---|---|---|
| Marketing hero `h1` | `clamp(40px, 5vw, 60px)` | 500 | `-0.025em` |
| Marketing section `h2` | `clamp(32px, 4vw, 56px)` | 650 | `0`, `text-wrap: balance`, `max-width: 18ch` |
| Marketing split-band `h2` | `clamp(44px, 6vw, 78px)` | 650 | tight |
| CTA / bottom `h2` | `clamp(44px, 5.5vw, 74px)` | 760 | `0` |
| Dashboard `h1` | `clamp(34px, 4.4vw, 56px)` | 500 | `-0.025em` |
| Marquee words | `clamp(17px, 2vw, 28px)` | 750 | `0` |

- Get contrast *within* a headline by accenting one phrase (gradient text), not
  by making everything 800-weight. Reserve 700+ for small UI elements.
- Body 14–17px, line-height 1.5–1.7, measure ≤ ~60ch.
- Micro-labels / eyebrows: 10–11px **mono**, UPPERCASE, letter-spacing
  `0.06–0.1em`, in `--text-dim` / `--mk-dim`.

### 1.9 Radii

`--radius-sm 6` · `--radius-md 8` · `--radius-lg 12` · `--radius-xl 16` ·
`--radius-full 9999`. Cards land on `lg` (12). The hero composer goes `xl` (16).
A few signature panels (the marketing model console) go bigger (~44px) — those
are deliberate one-offs, not the default.

### 1.10 Motion

| Token | Value |
|---|---|
| `--dur-fast` | `120ms` (hover, press, micro) |
| `--dur-base` | `200ms` (most transitions) |
| `--dur-slow` | `300ms` (entrances) |
| `--ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)` — entrances & most UI |
| `--ease-spring` | `cubic-bezier(0.34, 1.4, 0.5, 1)` — pops (menus, toggles) |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` — moves |

- Standard entrance: `fadeInUp` — opacity 0→1 + `translateY(8px)`→0, slow/ease-out.
- Micro-interactions on everything interactive: hover lift `translateY(-1px to -3px)`,
  press `scale(0.95–0.97)`, magenta focus ring.
- At most one signature motion moment per screen. Always honor
  `prefers-reduced-motion`. CSS-first.

### 1.11 Spacing

One scale, 4/8px steps. Section vertical rhythm on marketing is generous
(`~108px` band padding); the dashboard is calm-but-dense. Pick a density on
purpose per surface — never mix ad-hoc gaps.

---

## 2. Composition — the backbone

Asymmetry is the default; uniform symmetry is the structural tell of machine
output. Equal-size repetition is **opt-in**, justified only by true collections
(the project grid, the model-card grid) — never the reflex.

- Build on a 12-column grid, then place content **unevenly**. Splits are
  `0.74 / 1`, `0.78 / 1`, `0.9 / 0.85` — **never `6/6`.** One side carries a
  product visual, the other the section head.
- **No two adjacent sections share width + alignment + structure.** The page
  alternates: full-bleed gradient hero → contained asymmetric bands →
  full-bleed marquee → contained bands → full-bleed gradient CTA.
- **One breakout per screen** — exactly one element escapes its container. One
  is a decision; three is noise.
- Asymmetry is placed *on* the grid (a ratio you can name), not sloppy gaps.
- In the dashboard, asymmetry = hierarchy, not decoration: a centered hero
  composer given real estate, then a calm aligned grid below. Alignment stays
  perfect; rows stay calm (tabular numerals).
- Prefer **hairline-divided editorial rows/cells** over yet another card grid
  for steps/features (see §3.7).

---

## 3. Signature moves & component patterns

These are the recognizable, reusable Uniqus devices. Use them; don't reinvent.

### 3.1 Buttons

- **Primary** (`.btn-primary`): `--brand-gradient` fill, white text, `radius-md`,
  weight 600, 13px. Hover `opacity: 0.9` + `translateY(-1px)`. **Disabled is a
  flat gray** (`--bg-surface-active` / `--text-dim`), *not* a faded gradient — a
  faded gradient reads as "broken."
- **Secondary** (`.btn-secondary`): `--bg-surface` + `--border-default`; hover
  lifts border to `--text-muted` and bg to `--bg-surface-hover`.
- **Ghost** (`.btn-ghost`): transparent; hover `--bg-surface-hover`.

### 3.2 The purple→magenta gradient hero / CTA (signature #1)

The hero and the closing CTA share one full-bleed background:

```css
background: linear-gradient(180deg,
  var(--bg-dark) 0%, var(--brand-purple) 48%, var(--brand-magenta) 100%);
```

Copy is centered on it; the CTA headline is the page's largest type
(`clamp(44px, 5.5vw, 74px)`, weight 760). This is the brand's single boldest
move — use it to **open and close** a page, not in the middle.

### 3.3 Brand radial glow (signature #2 — ambient light)

Behind the dashboard composer and the marketing hero copy, a soft low glow —
*ambient light, not a subject*:

```css
background:
  radial-gradient(60% 60% at 50% 45%, rgba(178,30,125,0.30), transparent 70%),
  radial-gradient(70% 70% at 38% 60%, rgba(72,40,121,0.28), transparent 72%);
filter: blur(40px); opacity: 0.9;
```

If the first thing a screenshot reads as is the glow, halve it.

### 3.4 Gradient-text accent word (signature #3)

Accent exactly **one** word/phrase in a headline with the brand gradient via
`background-clip: text` (the `.grad` span — "Let's build something, *Aarav*";
"Build with *the AI you trust*"). The rest stays in the foreground neutral. The
accent is a scalpel — never gradient-text a whole heading, never one per section.

### 3.5 Glassy prompt composer (signature #4)

The centerpiece "try it" affordance. Translucent panel + faint top sheen +
backdrop blur + deep shadow + `radius-xl`:

```css
background:
  linear-gradient(180deg, color-mix(in srgb, #fff 5%, transparent), transparent 58%),
  color-mix(in srgb, var(--mk-panel-solid) 88%, transparent);
backdrop-filter: blur(14px);
box-shadow: 0 30px 80px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04);
```

- Hover lifts (`translateY(-2px)`) and tints the border toward magenta.
- `:focus-within` → magenta ring: `0 0 0 3px rgba(178,30,125,0.20)`.
- The send control is a **gradient-filled circle** with a magenta glow shadow;
  press `scale(0.95)`.

### 3.6 Mono eyebrow pill & micro-labels (signature #5)

- **Eyebrow pill** (`.eyebrow`): inline-flex, mono 11px, hairline border,
  `radius-full`, glassy bg, leading with a small **status dot** (green, with a
  soft halo ring) — e.g. "● Private beta for serious builders."
- **Section eyebrow** (`.label-eyebrow`): block, mono 11px, UPPERCASE, tracked
  `~0.06em`, `--mk-dim` — sits above each section `h2`.
- **`.label-micro`**: 10px, weight 600, UPPERCASE, `0.06em`, `--text-dim`.

### 3.7 Full-bleed marquee band (signature #6)

A full-width strip of capability words at large weighted type
(`clamp(17px, 2vw, 28px)`, weight 750), alternating opacity, with **every third
word in magenta**, over a faintly tinted gradient. Breaks up the page between
contained bands without another card grid.

### 3.8 Asymmetric split band (signature #7)

`grid-template-columns: minmax(300px, 0.74fr) minmax(520px, 1fr)` — section head
on the narrow side, a **product visual** on the wide side (a model "console," a
workspace "rack," a grid-textured panel). Stack to one column under ~1180px.

### 3.9 Glassy panel cards — one depth technique (signature #8)

Cards (`.feature`, `.model-console`, `.trust-card`, stat cards) share:

```css
border: 1px solid var(--mk-line);
background:
  linear-gradient(180deg, color-mix(in srgb, #fff 4%, transparent), transparent),
  color-mix(in srgb, var(--mk-panel-solid) 82%, transparent);
border-radius: var(--radius-lg);
```

Hover: `translateY(-3px)` + `--border-strong` + a slightly denser panel. **One
depth technique only** — a hairline border plus a faint top sheen. Never stack
border *and* shadow *and* tinted fill on the same element.

### 3.10 Hairline-divided collection (signature #9)

Steps/features render as a grid with **1px gaps over an `--mk-line` background**,
each cell a panel — the gaps become hairline dividers. Big mono index numerals,
title, then muted body. Prefer this editorial structure to a row of identical
icon-title cards.

### 3.11 Segmented pill control (signature #10)

A pill rail (`radius-full`, 2–4px padding) with the active segment **filled by
the brand gradient** (`.dash-tabs`) or lifted with a purple tint (`.view-toggle`).

### 3.12 Deterministic duotone project cover (signature #11)

Every project tile gets generated artwork — no stored images. A hue derived from
the project id drives a diagonal gradient + a top-right radial bloom, with a fine
white **dot-grid texture** overlaid and masked to fade downward; the project
avatar straddles the cover's bottom edge so the tile reads as *cover + identity*,
not a gray box with a letter:

```css
/* coverBackground(projectId) */
radial-gradient(130% 160% at 88% -30%, hsl(H2 72% 48% / 0.8), transparent 58%),
linear-gradient(118deg, hsl(H 58% 31%), hsl(H+24 54% 19%))
```

### 3.13 Stat / metric cards

Subtle top-sheen panel; the value in **mono, `font-variant-numeric: tabular-nums`**,
26px weight 650; the label in mono 10px UPPERCASE tracked. Hover lifts the border
to `--border-strong`.

### 3.14 Status dots — never color-only

A status dot **always** rides next to a text label (accessibility): live = green,
building = amber, failed = red, none/never = dim. Color alone never carries
meaning.

### 3.15 Active nav item

Not a solid fill — a quiet tint: `color-mix(in srgb, var(--brand-magenta) 9%,
var(--bg-surface))` background + a magenta-tinted border + the icon recolored to
magenta.

---

## 4. Finish — the last 10%

- **Real content** in the product's voice: plausible names, numbers, dates.
  Never lorem ipsum, "John Doe", or "$0.00" stat cards.
- **Focus** is always visible: `2px solid var(--brand-magenta)`, offset 2px
  (inset `-2px` on dense rows/tabs that clip an outer ring).
- **Numerics**: tabular-nums, right-aligned, with units; metrics use the mono
  stack.
- **Every state gets craft**: skeletons that match the layout (`skeleton`
  pulse), empty states with one clear action (dashed border), explicit error
  styling (`--conf-low`).
- **Chrome**: custom 8px scrollbar (`--border-default` thumb), styled
  `::selection`, real `<title>`, favicon, `theme-color`.
- **Theme parity**: a light theme exists and flips only surface/text/border/
  semantic tokens (brand/accent/type/radii/motion are theme-agnostic), set
  before paint so there's no flash. A compact density flips type rhythm and
  paddings. **Don't half-build a theme** — if you touch one, keep both whole.
- **Icons**: one set, one stroke weight. Never emoji as UI icons.

---

## 5. Banned — these out the work as generic

- Inter/Roboto/system-ui as the *visible* identity; heavy-weight-everything
  display type.
- The template hero: centered heading + one paragraph + two buttons + a row of
  three identical icon-title-text cards.
- Any row of 3+ identical cards, or `6/6` splits repeated, outside true
  collections.
- `border` AND `shadow` AND tinted background stacked on one element;
  `rounded-2xl + shadow-md` on everything.
- Gradient text on *every* heading; glow everywhere; effect stacking (grain +
  cursor glow + aurora + outlined words + marquee all at once — at most **two**
  page-wide devices).
- Magenta (or any accent) used everywhere — if everything is accented, nothing
  is.
- A faded-gradient disabled button; color-only status; placeholder boxes / TODO
  copy; a half-built second theme.

---

## 6. Self-check (after a screenshot pass)

Interrogate the screenshot **structurally first**, then stylistically:

1. **Silhouette** — squint. Is it a column of same-width boxes? Do any two
   adjacent sections share the same skeleton? Is every card in a grid the same
   size? Does anything break its container (the one intended breakout)? Structural
   failures need **recomposition** (change the section map), not re-skinning.
2. **Brand** — is there exactly **one** brand-gradient moment carrying the eye
   (or a deliberate hero+CTA pair), or has magenta leaked into every section?
3. **Type** — does the display type commit (large, ~500–650 weight, tight
   leading), or is it timid and same-size as the body?
4. **Tell test** — "could this be mistaken for a template or an AI default?" If
   yes, diagnose *which* failure before touching code. A **flat** result needs
   *more* (braver type, one stronger signature); a **busy** result needs *less*
   (delete devices until one signature remains). Refinement is usually deletion.

Then screenshot again.
