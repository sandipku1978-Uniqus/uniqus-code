# Gate 15 — house design language

The visual identity shared by the public marketing site and the project
dashboard. Use this when building or restyling **Gate 15-branded surfaces** so
new work reads as one product. It is portable: paste it into any tool (Claude,
ChatGPT, Gemini, a designer brief) — every value below is inline, no lookups
required.

Distilled from four sources of truth:

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
rules still apply.** This document is exactly that: the Gate 15 **house pack**.

- **Apply it** when the work *is* a Gate 15 surface — the marketing site, the
  dashboard, in-app UI — or when someone explicitly asks for "the Gate 15 look."
- **Do not apply it** to arbitrary user app projects built inside the product.
  Those get their own per-project art direction and should not default to the
  house ember/steel any more than they should default to purple. Forcing the
  house palette onto every project is itself a failure.

The one-sentence direction: **one warm signal colour on cold industrial steel —
safety orange and hazard yellow, used as signal, on a cool gunmetal ground of
disciplined uppercase type, machined edges, and borders that do the work.**

The greys are deliberately **cool** (gunmetal/graphite/steel). Cold ground is
what makes safety orange read as hi-vis. Do not warm the greys toward brown — a
warm base under orange goes muddy and monochrome.

Before choosing composition, write the five-line UX brief that the shared craft
guidance requires: **USER, JOB, HIERARCHY, FLOW, RISK**. The house look serves
that brief. If a signature move makes the primary task less clear, remove it.

---

## 1. Foundations

### 1.1 Use tokens, never raw hex

Everything below is defined as a CSS variable in `globals.css :root` and flipped
for light mode / compact density. Read these via `var(--token)` — hardcoding a
hex is how the app and the public site drift apart. Brand, type, radii, and
motion are **theme-agnostic**; surface / text / border / semantic tokens flip
between themes, and so does **`--accent-text`** (see §1.2).

### 1.2 Brand — the ember ramp (theme-agnostic)

These are the only warm hues in the system.

| Token | Value | Use |
|---|---|---|
| `--brand-ember` | `#FF7700` | **Primary.** Safety orange: buttons, active state, focus, borders |
| `--brand-ember-hi` | `#FF8C24` | Hover / lifted ember |
| `--brand-signal` | `#FFCF3D` | Hazard yellow: highlights, the gradient's warm stop, numerals |
| `--brand-rust` | `#AE460A` | Deep oxide: shadow under ember, pressed state, orange text on light |
| `--brand-gradient` | `linear-gradient(135deg, #FF651F, #FFCF3D)` | Primary buttons, send button, active pills, gradient-text accent word |
| `--accent` / `--accent-primary` | `#FF7700` | The accent fill |
| `--hazard` | `repeating-linear-gradient(45deg, #FF7700 0 8px, transparent 8px 16px)` | The signature stripe (§3.2) |

**Two contrast rules that are easy to get wrong — both are load-bearing:**

1. **Ink on ember is near-black, never white.** `#FF7700` + white is ~2.7:1 and
   fails AA; `#FF7700` + `#140D07` is ~7.2:1 — and black-on-orange *is* the correct
   industrial look (hazard signage). Primary buttons fill ember and set
   `color: #140D07`. Orange **text** on a dark surface is fine
   (`#FF8C24` on `#0A0B0C` ≈ 8.5:1); the rule only binds for text sitting **on**
   ember.
2. **Ember does not hold as text on white** (`#FF7700` on white ≈ 2.7:1). That's
   what **`--accent-text`** is for — it is the one brand token that flips:
   `#FF8C24` on dark, `#A04009` (deep oxide, ≈6.5:1) on light. Use `--accent-text` for
   every piece of orange **type**, link, and icon; use `--brand-ember` for
   **fills**, borders, and rings. Ember fills stay ember in both themes because
   they carry black ink.

### 1.3 Surfaces — dark is primary (app scope)

Cool gunmetal. Keep the relative steps; don't invent in-between shades.

| Token | Dark | Light | Role |
|---|---|---|---|
| `--bg-dark` | `#0A0B0C` | `#EFEEEC` | Asphalt / concrete — page ground |
| `--bg-pane` | `#0F1113` | `#FFFFFF` | IDE panes / topbar / status bar |
| `--bg-surface` | `#16181B` | `#FFFFFF` | Cards, raised surfaces |
| `--bg-surface-hover` | `#1E2125` | `#E9E8E6` | Card hover |
| `--bg-surface-active` | `#262A2F` | `#DEDCD9` | Pressed / selected fill |
| `--bg-elev` | `#1E2125` | `#FFFFFF` | Raised fields (inputs, textareas) |
| `--bg-base` | `#0A0B0C` | `#EFEEEC` | Modal / guest ground |
| `--bg-canvas` | `#0F1113` | `#FFFFFF` | Markdown / document canvas |
| `--bg-code` | `#08090A` | `#EDECEA` | Deepest: code / tool-output |
| `--bg-chat` | `#121417` | `#F7F6F4` | Chat column |

The light theme is **concrete, not paper** — a cool grey-white with faint
aggregate warmth. It is a real theme, not an inversion; keep it whole (§4).

### 1.4 Surfaces — marketing scope (`--mk-*`)

The marketing site runs on its own slightly crisper ramp and shares the brand
tokens. These names are referenced ~250× — retune values, never rename.

| Token | Value | Role |
|---|---|---|
| `--mk-bg` | `#08090A` | Marketing page base |
| `--mk-panel-solid` | `#121417` | Panel/card base (usually mixed translucent) |
| `--mk-panel` | `rgba(18,20,23,0.88)` | Translucent panel |
| `--mk-panel-2` | `#191C20` | Second panel step |
| `--mk-line` | `rgba(255,255,255,0.10)` | Hairline border |
| `--mk-line-strong` | `rgba(255,255,255,0.18)` | Emphasis border (hover/focus) |
| `--mk-text` | `#F2F0EC` | Primary text — painted-steel off-white |
| `--mk-muted` | `#A5A29C` | Secondary text |
| `--mk-dim` | `#6F6D68` | Eyebrows, captions |
| `--mk-amber` | `#FFCF3D` | Hazard yellow, decorative |
| `--mk-cyan` | `#7FA6C4` | **Cold steel — the one cool accent.** Used sparingly |
| `--mk-teal` | `#4E9E86` | Patina |
| `--mk-green` | `#64D29B` | Status-OK only (the "live" dot) |

The decorative accents never compete with ember. `--mk-cyan` is a muted steel
blue, not a neon cyan — do not brighten it back toward `#38bdf8`.

### 1.5 Text — painted-steel ramp

Neutral off-white, not cream, not cool grey.

| Token | Dark | Light | Use |
|---|---|---|---|
| `--text-primary` | `#EDEBE7` | `#17181A` | Body, headings |
| `--text-muted` | `#9A9793` | `#52555A` | Secondary copy |
| `--text-dim` | `#7C7A76` | `#6B6E73` | Hints, captions, criteria — **must stay ≥4.5:1** |
| `--text-xdim` | `#3C3A37` | `#B5B7BA` | Non-text decoration only — never small text |

### 1.6 Borders

Borders do the work; shadows stay restrained.

| Token | Dark | Light | Use |
|---|---|---|---|
| `--border-default` | `#2A2E33` | `#DDDCDA` | Default 1px hairline |
| `--border-light` | `#1E2125` | `#E8E7E5` | Faint dividers |
| `--border-strong` | `rgba(255,255,255,0.17)` | `rgba(23,24,26,0.22)` | Hover/focus emphasis — lift reads as a border change, not piled-on shadow |
| `--border-active` | `#FF7700` | `#AE460A` | Active outlines (ember dark, oxide light) |

### 1.7 Semantic (confidence/status)

Each foreground pairs with a ~10% translucent background fill.

| State | Fg (dark) | Fg (light) | Bg |
|---|---|---|---|
| High / live / success | `--conf-high` `#34D399` | `#0f9d6b` | `rgba(16,185,129,0.10)` |
| Medium / building / warn | `--conf-medium` `#FBBF24` | `#b27400` | `rgba(245,158,11,0.10)` |
| Low / failed / error | `--conf-low` `#F87171` | `#d23f3f` | `rgba(239,68,68,0.10)` |

⚠ `--conf-medium` is amber and `--brand-signal` is yellow. **Keep brand yellow
for brand/decoration only and semantic amber for status only.** They never sit
adjacent, and `--brand-signal` is never used as a warning colour.

### 1.8 Typography

- **Sans (`--font-sans`): `Archivo`** (variable) — an industrial grotesque from
  the signage lineage. It is doing identity work; do not swap it for a geometric
  or humanist sans.
- **Mono (`--font-mono`): `JetBrains Mono`** — eyebrows, micro-labels, metrics,
  code, crumbs. Reads as machine output.

Always end stacks with a system fallback; never let the fallback be the visible
identity.

**Uppercase signage is the signature.** Eyebrows, labels, stat keys, nav chips,
and buttons are **UPPERCASE, tracking `0.08em`–`0.12em`, weight 600.** This
treatment carries the industrial feel *more than the palette does* — it is the
first thing to reach for and the last thing to remove.

**Type scale — snap to these, no half-pixels** (half-pixel sizes render fuzzy
and signal ad-hoc sizing):

`--fs-2xs 10` · `--fs-xs 11` · `--fs-sm 12` · `--fs-base 13` · `--fs-md 14` ·
`--fs-lg 16` · `--fs-xl 20` · `--fs-2xl 24` · `--fs-3xl 32`. Body default 14px /
line-height 1.6.

| Surface | Size | Weight | Tracking |
|---|---|---|---|
| Marketing hero `h1` | `clamp(44px, 7vw, 86px)` | 700 | `-0.02em` |
| Marketing section `h2` | `clamp(32px, 4vw, 56px)` | 650 | `0`, `text-wrap: balance`, `max-width: 18ch` |
| CTA / bottom `h2` | `clamp(44px, 5.5vw, 74px)` | 760 | `0` |
| Dashboard `h1` | `clamp(34px, 4.4vw, 56px)` | 500 | `-0.025em` |
| Marquee words | `clamp(17px, 2vw, 28px)` | 750 | `0` |

- Get contrast *within* a headline by accenting one phrase (gradient text), not
  by making everything 800-weight. Reserve 700+ for headlines and small UI.
- Body 14–17px, line-height 1.5–1.7, measure ≤ ~60ch.
- **Numerals** (stat tiles, the "15", version numbers): mono or Archivo 700,
  `font-variant-numeric: tabular-nums`.
- Micro-labels / eyebrows: 10–11px **mono**, UPPERCASE, tracked, in
  `--text-dim` / `--mk-dim`.

### 1.9 Radii — machined, not pillowy

`--radius-sm 4` · `--radius-md 6` · `--radius-lg 8` · `--radius-xl 12` ·
`--radius-full 9999`. Cards land on `lg` (8). `--radius-full` stays for dots and
pills only.

These are deliberately **tight**. A soft 16px card corner undoes the whole form
language — if a surface feels pillowy, the radius is the first suspect.

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
  press `scale(0.95–0.97)`, ember focus ring.
- At most one signature motion moment per screen. Always honor
  `prefers-reduced-motion`. CSS-first.

### 1.11 Spacing

One scale, 4/8px steps. Section vertical rhythm on marketing is generous
(`~108px` band padding); the dashboard is calm-but-dense. Pick a density on
purpose per surface — never mix ad-hoc gaps.

---

## 2. Composition — the backbone

Hierarchy is mandatory; asymmetry is the expressive default, not a quota.
Equal-size repetition is **opt-in**, never the reflex, but is correct for true
collections, direct comparisons, stable operational rows, settings/forms, and
narrow mobile layouts where predictability or scanning matters more.

- Build on a 12-column grid, then place content **unevenly when hierarchy calls
  for it**. Prefer `0.74 / 1`, `0.78 / 1`, or `0.9 / 0.85` over a reflexive
  `6/6`; use `6/6` for a genuine equal comparison.
- On narrative pages, avoid giving adjacent sections the same width + alignment
  + structure. Product workflows, documentation, repeated records, and settings
  may keep a stable shell so users do not relearn the layout.
- **Breakout budget: zero or one per screen.** Use one when it reinforces the
  hierarchy/signature; use none on dense operational, form, checkout, or auth
  surfaces. Multiple breakouts require an explicit reason and a quiet result.
- Asymmetry is placed *on* the grid (a ratio you can name), not sloppy gaps.
- In the dashboard, asymmetry = hierarchy, not decoration: a centered hero
  composer given real estate, then a calm aligned grid below. Alignment stays
  perfect; rows stay calm (tabular numerals).
- Prefer **hairline-divided editorial rows/cells** over yet another card grid
  for steps/features (see §3.10).
- Plan responsive transformations at narrow/mobile, intermediate/tablet, and
  wide/desktop widths: name what stacks, collapses, scrolls, pins, hides, or
  changes order. Use bounded `clamp()`, never unbounded viewport-only sizing.

---

## 3. Signature moves & component patterns

These are the recognizable, reusable Gate 15 devices. Use them; don't reinvent.

### 3.1 Buttons

- **Primary** (`.btn-primary`): `--brand-gradient` fill, **near-black ink
  (`#140D07`)** — never white (§1.2) — `radius-md`, weight 600, 13px. Hover
  `opacity: 0.9` + `translateY(-1px)`. **Disabled is a flat gray**
  (`--bg-surface-active` / `--text-dim`), *not* a faded gradient — a faded
  gradient reads as "broken."
- **Secondary** (`.btn-secondary`): `--bg-surface` + `--border-default`; hover
  lifts border to `--text-muted` and bg to `--bg-surface-hover`.
- **Ghost** (`.btn-ghost`): transparent; hover `--bg-surface-hover`.

### 3.2 The hazard stripe (signature #1 — the brand's fingerprint)

A 45° repeating ember/transparent gradient, used as a **thin rule (3–4px)**,
never as a fill:

```css
--hazard: repeating-linear-gradient(45deg, #FF7700 0 8px, transparent 8px 16px);
```

Live use sites: a 4px rule across the top of the closing CTA band, and a 3px rule
under the active marketing nav item. **Budget: 2–3 per site, not per page.** It
is a signal, and a signal that is everywhere signals nothing.

### 3.3 The ember hero / CTA band (signature #2)

The marketing hero and the closing build band (`.bottom-build`) share **one**
full-bleed background — the brand's single boldest move. Use it to **open and
close** a page, never in the middle.

```css
background: linear-gradient(180deg,
  var(--bg-dark) 0%, #2b1c12 48%, var(--brand-rust) 100%);
```

The mid stop is a deep scorched oxide and the base is rust — it lands as heat at
the bottom of the frame, not as a candy gradient. The closing band also carries
the 4px hazard rule along its top edge (§3.2). Its headline is the page's largest
type (`clamp(44px, 5.5vw, 74px)`, weight 760).

The **contained** CTA panel (`.cta-band`) is a quieter, separate thing — a
diagonal ember corner wash over a translucent panel, with one cold-steel layer
raking the other way so the warm corner has something to read against:

```css
background:
  linear-gradient(135deg, color-mix(in srgb, var(--brand-ember) 18%, transparent),
                  transparent 62%),
  linear-gradient(90deg, color-mix(in srgb, var(--mk-cyan) 10%, transparent),
                  transparent 70%),
  color-mix(in srgb, var(--mk-panel-solid) 88%, transparent);
```

### 3.4 Ember radial glow (signature #3 — ambient light)

Behind the dashboard composer and the marketing hero copy, a soft low glow —
*ambient light, not a subject*. Two stops: ember, then signal yellow.

```css
background:
  radial-gradient(60% 60% at 50% 40%, rgba(255,119,0,0.16), transparent 70%),
  radial-gradient(70% 70% at 35% 55%, rgba(255,207,61,0.13), transparent 72%);
filter: blur(44px);
```

If the first thing a screenshot reads as is the glow, halve it.

### 3.5 Gradient-text accent word (signature #4) — ⚠ the light-theme trap

Accent exactly **one** word/phrase in a headline with `background-clip: text`
(the `.grad` span). The rest stays in the foreground neutral. Never gradient-text
a whole heading; never one per section.

**`--brand-gradient` ends on signal yellow `#FFCF3D`, which is ~1.5:1 on a
near-white page — illegible.** Every `background-clip: text` gradient MUST swap
to a darker ramp in the light theme so *every stop* clears 3:1:

```css
.grad {                                   /* dark: ember → amber → signal */
  background: linear-gradient(100deg, #ff8c24 0%, #ffba3a 48%, #ffcf3d 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
:root[data-theme="light"] .grad {         /* light: scorched → rust → deep ember */
  background: linear-gradient(100deg, #8a3908 0%, #ae460a 55%, #d25a0c 100%);
  -webkit-background-clip: text; background-clip: text;
}
```

If you add a new `.grad`-like span **anywhere**, add it to the light-theme
override selector list in the same edit. This is the single most repeated bug in
this palette.

### 3.6 Glassy prompt composer (signature #5)

The centerpiece "try it" affordance. Translucent panel + faint top sheen +
backdrop blur + deep shadow + `radius-xl`:

```css
background:
  linear-gradient(180deg, color-mix(in srgb, #fff 5%, transparent), transparent 58%),
  color-mix(in srgb, var(--mk-panel-solid) 88%, transparent);
backdrop-filter: blur(14px);
box-shadow: 0 30px 80px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04);
```

- Hover lifts (`translateY(-2px)`) and tints the border toward ember.
- `:focus-within` → ember ring: `0 0 0 3px rgba(255,119,0,0.20)`.
- The send control is a **gradient-filled circle** carrying a near-black glyph,
  with an ember glow shadow; press `scale(0.95)`.

### 3.7 Brushed-steel keyline

A 1px inner top highlight on raised panels — the sheen on brushed steel:

```css
box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
```

This is the house's one permitted depth flourish beyond the border. It composes
with a hairline; it does not stack with a drop shadow *and* a tinted fill (§5).

### 3.8 Mono eyebrow pill & micro-labels (signature #6)

- **Eyebrow pill** (`.eyebrow`): inline-flex, mono 11px, hairline border,
  `radius-full`, glassy bg, leading with a small **status dot** (green, with a
  soft halo ring).
- **Section eyebrow** (`.label-eyebrow`): block, mono 11px, UPPERCASE, tracked,
  `--mk-dim` — sits above each section `h2`.
- **`.label-micro`**: 10px, weight 600, UPPERCASE, tracked, `--text-dim`.

### 3.9 Full-bleed marquee band (signature #7)

A full-width strip of capability words at large weighted type
(`clamp(17px, 2vw, 28px)`, weight 750), alternating opacity, with **every third
word in ember** — `color-mix(in srgb, var(--brand-ember) 72%, var(--mk-text))`
on dark, `var(--accent-text)` on light (it must darken to rust, §1.2). Breaks up
the page between contained bands without another card grid.

### 3.10 Hairline-divided collection (signature #8)

Steps/features render as a grid with **1px gaps over an `--mk-line` background**,
each cell a panel — the gaps become hairline dividers. Big mono index numerals,
title, then muted body. Prefer this editorial structure to a row of identical
icon-title cards.

### 3.11 Asymmetric split band (signature #9)

`grid-template-columns: minmax(300px, 0.74fr) minmax(520px, 1fr)` — section head
on the narrow side, a **product visual** on the wide side (a model "console," a
workspace "rack," a grid-textured panel). Stack to one column under ~1180px.

### 3.12 Glassy panel cards — one depth technique (signature #10)

Cards (`.feature`, `.model-console`, `.trust-card`, stat cards) share:

```css
border: 1px solid var(--mk-line);
background:
  linear-gradient(180deg, color-mix(in srgb, #fff 4%, transparent), transparent),
  color-mix(in srgb, var(--mk-panel-solid) 82%, transparent);
border-radius: var(--radius-lg);   /* 8px — machined */
```

Hover: `translateY(-3px)` + `--border-strong` + a slightly denser panel. **One
depth technique only** — a hairline border plus a faint top sheen. Never stack
border *and* shadow *and* tinted fill on the same element.

### 3.13 Segmented pill control (signature #11)

A pill rail (`radius-full`, 2–4px padding) with the active segment **filled by
the brand gradient** (`.dash-tabs`, near-black ink) or lifted with an ember tint
(`.view-toggle`).

### 3.14 Deterministic duotone project cover (signature #12)

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

Per-project hue is intentional variety, **not** brand ember — these are the
user's projects, not Gate 15 surfaces (§0).

### 3.15 Stat / metric cards

Subtle top-sheen panel; the value in **mono, `font-variant-numeric: tabular-nums`**,
26px weight 650; the label in mono 10px UPPERCASE tracked. Hover lifts the border
to `--border-strong`.

### 3.16 Status dots — never color-only

A status dot **always** rides next to a text label (accessibility): live = green,
building = amber, failed = red, none/never = dim. Color alone never carries
meaning.

### 3.17 Active nav item

Not a solid fill — a quiet tint: `color-mix(in srgb, var(--brand-ember) 9%,
var(--bg-surface))` background + an ember-tinted border + the icon recolored to
`--accent-text`. On the marketing nav, the active item also carries the 3px
hazard rule (§3.2).

### 3.18 The logo plate & the corner notch

The mark ([components/BrandLockup.tsx](../apps/web/components/BrandLockup.tsx)) is
an **inline SVG**, never a PNG: a square steel plate with one machined 45°-notched
corner, filled with the ember→signal gradient, carrying a stencilled **15** in
near-black. The wordmark is `GATE` in `--text-primary` + `15` in `--accent-text`,
Archivo 700, uppercase, tracking `0.02em`. A `compact` prop renders the plate
alone for tight chrome.

The **corner notch** is allowed on the logo plate and the hero panel. Do not
apply it to every card — it stops reading as machined and starts reading as a
gimmick.

---

## 4. Finish — the last 10%

- **Real content** in the product's voice: plausible names, numbers, dates.
  Never lorem ipsum, "John Doe", or "$0.00" stat cards.
- **Focus** is always visible. The global `*:focus-visible` ring is
  `2px solid var(--accent-text)`, `outline-offset: 2px` — `--accent-text`, not raw
  ember, so it stays ≥3:1 on the light theme. Dense rows/tabs whose
  `overflow: hidden` parent would clip an offset ring inset it instead
  (`outline-offset: -2px`) and may sit on `--brand-ember`, since there it lands on
  a dark row fill rather than the light page.
- **Numerics**: tabular-nums, right-aligned, with units; metrics use the mono
  stack.
- **Every state gets craft**: skeletons that match the layout (`skeleton`
  pulse), empty states with one clear action (dashed border), explicit error
  styling (`--conf-low`).
- **Chrome**: custom 8px scrollbar (`--border-default` thumb), styled
  `::selection`, real `<title>`, favicon (the plate, as SVG), `theme-color`.
- **Theme parity**: the light theme flips surface/text/border/semantic tokens
  **and `--accent-text`** (brand fills/type/radii/motion are theme-agnostic), set
  before paint so there's no flash. A compact density flips type rhythm and
  paddings. **Don't half-build a theme** — if you touch one, keep both whole, and
  re-check every gradient-text span (§3.5).
- **Icons**: one set, one stroke weight. Never emoji as UI icons.

---

## 5. Banned — these out the work as generic

- Inter/Roboto/system-ui as the *visible* identity; heavy-weight-everything
  display type. Archivo is the identity — do not substitute it.
- **Warming the greys.** A brown/sepia base under orange goes muddy and kills the
  hi-vis read. The ground stays cool gunmetal.
- **White text on an ember fill** (fails AA) and **ember text on a white surface**
  (fails AA). See §1.2 — the fixes are `#140D07` ink and `--accent-text`.
- **`--brand-signal` as a status/warning colour.** Brand yellow is decoration;
  `--conf-medium` is status. They never sit adjacent.
- Purple/violet gradients — the canonical AI default, and now also simply
  off-brand.
- The template hero: centered heading + one paragraph + two buttons + a row of
  three identical icon-title-text cards.
- Any row of 3+ identical cards, or repeated `6/6` splits, used without a true
  collection, equal comparison, or stable operational reason.
- `border` AND `shadow` AND tinted background stacked on one element; soft
  `rounded-2xl + shadow-md` on everything (the radii are 4/6/8/12 for a reason).
- Gradient text on *every* heading; glow everywhere; **hazard stripes
  everywhere**; effect stacking (grain + cursor glow + aurora + outlined words +
  marquee all at once — at most **two** page-wide devices).
- Ember (or any accent) used everywhere — if everything is accented, nothing is.
- A faded-gradient disabled button; color-only status; placeholder boxes / TODO
  copy; a half-built second theme.

---

## 6. Self-check (after a screenshot pass)

Interrogate the screenshot **structurally first**, then stylistically:

1. **Silhouette** — squint. Is it a column of same-width boxes without a content
   reason? Do narrative sections repeat the same skeleton without helping
   orientation? Are equal cards hiding unequal importance? Does each breakout
   serve the UX brief? Structural failures need **recomposition** (change the
   section map), not re-skinning.
2. **Brand** — is there exactly **one** ember moment carrying the eye (or a
   deliberate hero+CTA pair), or has orange leaked into every section? Is the
   ground still *cold*, or has it drifted warm?
3. **Type** — does the display type commit (large, tight leading), and are the
   labels/eyebrows actually doing the UPPERCASE signage treatment? That treatment
   is most of the industrial feel; timid sentence-case labels flatten it.
4. **Contrast, both themes** — flip to light. Any gradient text still legible?
   Any orange type that should have darkened to rust? Body ≥4.5:1, large ≥3:1.
5. **Tell test** — "could this be mistaken for a template or an AI default?" If
   yes, diagnose *which* failure before touching code. A **flat** result needs
   *more* (braver type, one stronger signature); a **busy** result needs *less*
   (delete devices until one signature remains). Refinement is usually deletion.

Then screenshot again.
