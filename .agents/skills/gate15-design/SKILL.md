---
name: gate15-design
description: >-
  Apply Gate 15's house visual design language: the ember-and-signal palette,
  Archivo and JetBrains Mono typography, cold industrial surfaces, composition,
  components, motion, accessibility, and visual QA. Use when building or
  restyling Gate 15 marketing pages, the dashboard, or in-app product UI so the
  result matches the existing brand. Do not apply this house style to arbitrary
  customer apps built inside Gate 15; those require project-specific art
  direction.
---

# Gate 15 house design language

Design a precision instrument on cold industrial steel: disciplined uppercase
type and machined surfaces, lit by safety orange and hazard yellow used as
signals rather than decoration.

Apply this pack only to Gate 15 chrome. Give customer projects their own visual
direction.

## Workflow

1. Read the complete canonical specification before implementing:
   [docs/design-language.md](../../../docs/design-language.md).
2. Read the live tokens in
   [apps/web/app/globals.css](../../../apps/web/app/globals.css). Use CSS
   variables in components; do not introduce parallel raw-color definitions.
3. Follow the existing composition in
   [apps/web/app/page.tsx](../../../apps/web/app/page.tsx) and
   [apps/web/components/ProjectPicker.tsx](../../../apps/web/components/ProjectPicker.tsx).
4. Preserve dark and light theme parity, compact density, responsive behavior,
   focus states, empty/loading/error states, and reduced-motion behavior.
5. Render the result at desktop and mobile widths. Inspect structure first,
   then brand, typography, contrast, and interaction states.

## Brand essentials

- Keep the ground cold: asphalt, graphite, gunmetal, and painted-steel text.
  Never warm the neutral ramp toward brown.
- Use `--brand-ember: #FF7700` for primary fills, active borders, and rings.
- Use `--brand-ember-hi: #FF8C24` for lifted/hovered orange.
- Use `--brand-signal: #FFCF3D` for brand highlights and decoration only.
  Never reuse it as a warning color; `--conf-medium` owns semantic warnings.
- Use `--brand-rust: #AE460A` for the deep oxide step.
- Use `--brand-gradient: linear-gradient(135deg, #FF651F, #FFCF3D)` for the
  small number of controls that earn the primary gradient.
- Put near-black ink `#140D07` on ember or gradient fills. Never put white text
  on ember.
- Use `--accent-text` for orange text, links, and icons. It resolves to
  `#FF8C24` on dark and `#A04009` on light.
- Keep the hazard stripe a 3–4px rule used sparingly, never a large fill.

## Typography and shape

- Use Archivo for body and display type; use JetBrains Mono for eyebrows,
  micro-labels, metrics, code, and breadcrumbs.
- Set labels, eyebrows, nav chips, and buttons in uppercase with disciplined
  tracking. Keep body copy readable rather than forcing all text into caps.
- Make display type large, tight, and confident. Accent one phrase rather than
  making every word extra-bold.
- Snap UI text to the existing type scale. Avoid half-pixel sizes.
- Use machined radii: 4, 6, 8, and 12px. Reserve pills for controls, tags, and
  dots rather than cards.
- Use tabular numerals for metrics.

## Composition

- Start from USER, JOB, HIERARCHY, FLOW, and RISK. The house style serves the
  task.
- Use a 12-column grid and intentional asymmetry when hierarchy calls for it.
  Equal repetition is valid for true collections, comparisons, settings, and
  operational rows.
- Vary adjacent narrative section structures. Keep stable product workflows
  predictable.
- Use zero or one breakout per screen.
- Prefer hairline-divided collections over another row of generic cards.
- Use one depth technique per element: a hairline plus a faint top sheen. Do not
  stack border, shadow, and tinted fill.

## Signature moves

Use only the moves the screen earns:

1. Ember-to-oxide hero or closing band.
2. Thin hazard rule.
3. Low-opacity ember and signal radial glow.
4. One gradient-text phrase.
5. Glassy prompt composer with an ember focus ring.
6. Mono eyebrow pill or uppercase micro-label.
7. Hairline-divided indexed collection.
8. Asymmetric product split.
9. Deterministic project covers derived from project id.
10. Segmented control with one gradient-filled active segment.

For gradient text, preserve the light-theme override. The dark ramp is
`#FF8C24 → #FFBA3A → #FFCF3D`; the light ramp is
`#8A3908 → #AE460A → #D25A0C`. Every new gradient-text selector must join the
light-theme override list.

## Interaction and accessibility

- Keep focus visible with the theme-aware `--accent-text` ring. Inset it when
  an overflow boundary would clip it.
- Pair every status color with text; never communicate status through color
  alone.
- Keep disabled primary actions flat gray rather than fading the gradient.
- Give interactive elements hover, press, and focus feedback using the existing
  motion tokens.
- Keep one signature motion moment per screen and honor
  `prefers-reduced-motion`.
- Use real product copy and realistic states. Do not ship placeholders or
  half-built light-theme states.

## Avoid

- Purple or violet brand gradients.
- Warm brown or sepia neutral surfaces.
- White text on ember, or raw ember text on light surfaces.
- Generic centered hero plus three identical cards.
- Repeated equal cards without a collection or comparison reason.
- Soft oversized radii and stacked depth effects.
- Gradient text on every heading, glow everywhere, or hazard stripes everywhere.
- Color-only statuses, emoji UI icons, and faded-gradient disabled buttons.

## Visual self-check

1. Squint at the silhouette. Fix repeated same-width boxes or weak hierarchy
   through composition, not recoloring.
2. Confirm one primary ember moment carries the eye.
3. Confirm Archivo and the uppercase signage treatment provide the identity.
4. Check dark and light contrast, especially orange text and gradient text.
5. Ask whether the result could be mistaken for a generic template. Add one
   stronger signature if it is flat; remove effects if it is busy.

