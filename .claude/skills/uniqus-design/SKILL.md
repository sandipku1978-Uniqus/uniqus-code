---
name: uniqus-design
description: >-
  Uniqus Code's house visual design language — the brand palette, typography,
  composition, and component patterns drawn from the public marketing site and
  the project dashboard, on the craft backbone the coding agent already uses.
  Invoke when building or restyling any Uniqus-branded surface (marketing pages,
  the dashboard, in-app UI) so new work matches the existing product. NOT for
  arbitrary user app projects built inside the product — those follow their own
  per-project art direction and should avoid defaulting to the house purple.
---

# Uniqus Code — house design language

You are designing a **Uniqus-branded surface**. Make it read as one product with
the marketing site and the dashboard, not a generic template.

## Scope — confirm this applies first

This is the Uniqus **house pack**. The agent-loop craft rules
([services/orchestrator/src/agent/designGuidance.ts](../../../services/orchestrator/src/agent/designGuidance.ts))
warn that purple/violet gradients are the most overused AI default — but also
that an applied design system *overrides the default aesthetic while the craft
rules still apply.* This pack is that override.

- **Apply** when the work *is* a Uniqus surface (marketing, dashboard, in-app
  UI) or someone explicitly asks for "the Uniqus look." Here the purple→magenta
  gradient is deliberate brand identity.
- **Do NOT apply** to arbitrary user projects built inside the product — give
  those a fresh per-project direction and avoid defaulting to purple. Forcing
  the house palette onto every project is itself a failure.

If it's ambiguous which kind of surface you're building, ask before committing.

## The direction (one sentence)

A **precision instrument in warm near-black** — calm tinted dark surfaces and
disciplined type, lit by a single purple→magenta brand gradient used as a
scalpel, never a paint roller.

## How to use this skill

1. **Read the full spec before implementing:**
   [docs/design-language.md](../../../docs/design-language.md) — it has every
   token value, the type scale, and copy-pasteable recipes for each signature
   move. This file is the operating summary; that file is canonical.
2. **Use CSS variables, never raw hex.** Tokens live in `:root` of
   [apps/web/app/globals.css](../../../apps/web/app/globals.css) and flip for
   light/compact. Hardcoding a hex is how the app and site drift apart.
3. **Follow the existing structures.** Marketing composition lives in
   [apps/web/app/page.tsx](../../../apps/web/app/page.tsx); the dashboard home in
   [apps/web/components/ProjectPicker.tsx](../../../apps/web/components/ProjectPicker.tsx).
   Reuse their patterns rather than inventing parallel ones.
4. **Screenshot and run the self-check** (bottom of this file) before declaring done.

## Non-negotiables (the short version)

**Color**
- Dark is the primary mode (warm near-black, faint blue-violet cast).
- **Magenta `#B21E7D` is the accent, not purple.** Purple `#482879` is nearly
  invisible as an active cue on near-black, so magenta carries every
  selected/active/focus signal; purple is for brand structure and ambient glow.
- One accent earns attention per view. If everything is magenta, nothing is.
- `--brand-gradient` = `linear-gradient(135deg, #482879, #B21E7D)`.

**Type**
- Two families: a real sans for body/headings, **mono for eyebrows, micro-labels,
  metrics, code, crumbs.** Snap sizes to the scale (10/11/12/13/14/16/20/24/32) —
  no half-pixels.
- Display type is **large and light** (weight ~500–650, tight leading, negative
  tracking), never extrabold-everything. Get headline contrast by accenting *one*
  word with gradient text (`.grad`), not by bumping weight.

**Composition**
- Asymmetry is the default. Splits are `0.74/1` or `0.78/1` — **never `6/6`**.
  Equal repetition only for true collections (project grid, model cards).
- No two adjacent sections share width + alignment + structure: alternate
  full-bleed ↔ contained. One breakout per screen.
- One depth technique per element (hairline border + faint top sheen). Never
  border + shadow + tinted fill stacked.

**Finish**
- Real content in the product's voice — no lorem, "John Doe", or "$0.00" cards.
- Magenta focus rings (`2px`, inset on dense rows). Tabular-nums for numerics.
- Status is **never color-only** — a dot always rides next to a text label.
- Every state gets craft (skeletons that match layout; empty states with one
  action). Don't half-build the light theme.

## Signature moves (reach for these)

1. **Purple→magenta gradient hero & CTA** — `linear-gradient(180deg,
   var(--bg-dark) 0%, var(--brand-purple) 48%, var(--brand-magenta) 100%)`. Use it
   to open and close a page, not in the middle.
2. **Brand radial glow** behind the composer/hero — layered magenta + purple
   radials, `blur(40px)`, low opacity. Ambient light, not a subject; if a
   screenshot reads as the glow, halve it.
3. **Gradient-text accent word** — exactly one word per headline via
   `background-clip: text`.
4. **Glassy prompt composer** — translucent panel + faint top sheen +
   `backdrop-blur(14px)` + deep shadow + `radius-xl`; `:focus-within` magenta ring
   `0 0 0 3px rgba(178,30,125,0.20)`; gradient-circle send button.
5. **Mono eyebrow pill** with a small haloed status dot; UPPERCASE tracked mono
   section eyebrows.
6. **Full-bleed marquee** of capability words at large weight (750), every third
   word magenta.
7. **Asymmetric split band** — section head on the narrow side, a product visual
   (console/rack/grid panel) on the wide side.
8. **Glassy panel cards** — 1px line border + top sheen; hover `translateY(-3px)`
   + `--border-strong`.
9. **Hairline-divided collection** — grid with 1px gaps over a line-colored
   background, big mono index numerals; prefer over a row of identical cards.
10. **Segmented pill control** — active segment filled by the brand gradient.
11. **Deterministic duotone project covers** — hue from id, diagonal gradient +
    radial bloom + dot-grid texture; avatar straddles the bottom edge. No stored
    artwork.

## Banned (each alone outs the work as generic)

- The template hero (centered heading + paragraph + two buttons + three identical
  icon-title cards). Re-skinning that skeleton with the brand palette is still slop.
- Inter/system-ui as the visible identity; heavy-weight-everything type.
- 3+ identical cards or repeated `6/6` splits outside true collections.
- Effect stacking (grain + glow + aurora + outlined words + marquee) — at most
  two page-wide devices.
- Faded-gradient disabled buttons (use a flat gray); color-only status;
  placeholder boxes; a half-built second theme.

## Self-check (after a screenshot)

1. **Structure first** — squint: column of same-width boxes? Adjacent sections
   sharing a skeleton? Every grid card the same size? Structural failures need
   recomposition, not re-skinning.
2. **Brand** — exactly one gradient moment carrying the eye (or a deliberate
   hero+CTA pair), or has magenta leaked into every section?
3. **Type** — does the display type commit, or is it timid?
4. **Tell test** — "could this pass as a template or AI default?" A *flat* result
   needs *more* (braver type, one stronger signature); a *busy* result needs
   *less* (delete devices until one signature remains). Then screenshot again.
