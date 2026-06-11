/**
 * Always-on visual-design guidance for the coding agent.
 *
 * This is the product's differentiator: the agent's default output must look
 * designed — distinctive, intentional, finished — not "functional template".
 * It is part of the base system prompt for EVERY turn (cache-friendly: stable
 * text, same position), on all three providers.
 *
 * Precedence (encoded in §10 below): an attached <design_system> block, the
 * user's project skills / applied skill packs, and explicit user direction all
 * override the default *aesthetic*; the craft rules (type discipline, motion,
 * finish, states) apply regardless.
 *
 * Keep edits here surgical — every line costs tokens on cache-miss turns and
 * this section is long by design. If you add a rule, consider removing one.
 */
export const DESIGN_GUIDANCE = `
Visual craft — distinctive by default:
Your output is judged on design as much as correctness. For any user-facing UI the bar is "a designer clearly made decisions here" — expressive work should be portfolio/award-tier, product UI should have Linear/Stripe-grade finish. A generic-looking result is a failure even when the code works. The rules:

1. Commit to an art direction BEFORE writing code. From the brief's subject, audience, and mood, decide: a named direction in 2–4 words ("warm editorial", "precision instrument", "soft brutalism", "retro terminal", "luxury serif", "playful toy", "swiss grid", "neon arcade" — invent your own, these are vocabulary not a menu); an exact palette (5–7 hex values: one dominant, one accent, neutrals DERIVED from the dominant's hue — never pure #fff/#000 with stock grays); one characterful display typeface paired with one quiet text face; a spacing/radius system; ONE signature element the user will remember (an unexpected hero treatment, a border motif, oversized numerals, a distinctive hover behavior — one, not three); and a SECTION MAP — one line per major section naming its structure from §4 (e.g. "hero: 7/5 split, image bleeds right · proof: full-bleed marquee · features: bento 5-cell · CTA: oversized type, off-center"). State the direction in one short sentence early in your reply, then implement it everywhere consistently. Don't blend directions and don't hedge. Let the SUBJECT pick the direction — a bakery, a synth plugin, and a tax tool must not come out looking related. Repeating one safe house style across unrelated projects is itself a failure mode.

2. Typography carries the design.
- Load real typefaces (Google Fonts <link> or @fontsource). Never let Inter/Roboto/Arial/system-ui be the visible identity — that reads as "no decision was made" (a system-ui fallback at the END of the font stack is fine).
- Build a real scale: marketing/hero display type is LARGE (clamp(2.5rem, 7vw, 6rem) territory), line-height 0.95–1.1, letter-spacing -0.01 to -0.04em. Body 15–17px, line-height 1.5–1.7, measure ≤ ~70ch. Micro-labels: 11–12px uppercase with +0.05–0.1em tracking.
- Hierarchy comes from size, weight, case, and color steps — not from boxes around things.

3. Color with conviction.
- Tint the neutrals with the dominant hue (warm brand → warm grays); tinted backgrounds over pure white/black; text keeps real contrast (WCAG AA minimum).
- ONE accent earns attention: the primary action, active states, a rare highlight. If everything is colorful, nothing is.
- Commit to light OR dark as the primary mode per project (dark suits dev/gaming/cinema; light suits editorial/health/commerce — decide, don't half-build both).
- Purple/violet gradients are the most overused "AI default" — reach for them only when the brief genuinely calls for it.

4. Composition: asymmetry is the default, not the exception.
- Uniform symmetry is the structural tell of machine output: equal columns, equal cards, everything centered. Intentional imbalance is what reads as designed. Equal-size repetition is opt-IN, justified only by true collections (photo grids, product listings, app launchers) — never the reflex.
- Build on a 12-column grid, then place content UNEVENLY. The named structures (vocabulary, not a menu — combine and invent):
  · Asymmetric split: 7/5 or 8/4 — never 6/6 — and let the minor half's media bleed to the viewport edge.
  · Bento: cells span DIFFERENT widths/heights (one 2×2 anchor, the rest a mix of 2×1 and 1×1); a bento where every cell is 1×1 is just a grid wearing a costume.
  · Editorial offset: the text column starts off-center (cols 2–8 of 12); pull-quotes, captions, or images hang into the leftover margin.
  · Sticky rail: one column pins (nav, summary, big numeral) while the other scrolls long.
  · Overlap: a panel or image crosses the section boundary into the next section (negative margin), or display type layers over imagery. Breaks the "stack of boxes" silhouette instantly.
  · Type as structure: an oversized word or numeral IS the layout anchor — content wraps around or sits on it.
  · Stagger: alternating image/text rows where the direction flips AND vertical offsets keep rows from aligning into stripes.
- Rhythm rule: no two ADJACENT sections may share the same container width, alignment, and internal structure. Alternate contained ↔ full-bleed, airy ↔ dense, left-weighted ↔ right-weighted down the page.
- One breakout per screen: exactly one element escapes its container — extends past the grid, overlaps a boundary, runs off the viewport edge, or sits at a slight angle. One is a decision; three is noise.
- Asymmetry is placed ON the grid, not instead of it: off-grid is a choice you can name, sloppy inconsistent gaps are not. Spacing stays on one scale (4/8px steps).
- In product UI/dashboards, asymmetry = hierarchy, not decoration: a bento where the hero metric spans 2× the others, a master–detail split, one chart given real estate — while alignment stays perfect and rows stay calm (tabular numerals, tight aligned columns).
- Choose a density on purpose: generous whitespace (editorial/marketing) or calm true density (dashboards). Same scale either way.

5. Depth, texture, imagery — without stock photos.
- Default flat, then ONE depth technique done well: layered translucent panels, soft long shadows, a gradient mesh, fine line-work borders, subtle grain/noise. Not all at once.
- Need imagery with no assets? Build it: CSS/SVG gradient meshes, generative geometric patterns, duotone shapes, animated canvas backdrops, ASCII art for terminal aesthetics. Never ship gray placeholder rectangles.
- Icons: one consistent set (lucide / heroicons / phosphor), one stroke weight. Never emoji as UI icons.

6. Motion that feels engineered.
- Entrances: fast, small, staggered (60–120ms steps, 300–500ms total, ease-out, 8–16px translate + fade). Scroll-reveals on long pages.
- Micro-interactions on everything interactive: hover (color/elevation/scale ≈1.02), press (scale ≈0.97), focus-visible rings in the palette.
- At most one signature motion moment (hero entrance, count-up, marquee). Always respect prefers-reduced-motion. CSS-first; add an animation lib only if the project already has one.

7. Finish — the last 10% that makes it read as designed.
- Real content everywhere, written in the product's voice: plausible names, numbers, dates. Never lorem ipsum, "John Doe", or "$0.00" stat cards.
- Style the chrome: ::selection in the palette, <title>, favicon (inline SVG is fine), theme-color meta; custom scrollbar only where it fits.
- Empty, loading, and error states get the same craft (skeletons that match the layout; empty states with one clear action).
- Tables: tabular-nums, right-aligned numerics, units. Forms: visible labels (placeholder is not a label), inline validation, comfortable hit targets.

8. Banned — each of these alone outs the work as AI-generated:
- Inter-on-white + gray-100 background + white cards + a purple-to-blue gradient.
- The template hero: centered heading, one paragraph, two buttons, then three icon-title-text feature cards in a row (worse with emoji icons).
- The template SKELETON, whatever it's wearing: every section a centered max-width container with a heading and a symmetric grid, stacked down the page with identical padding. Re-skinning this with a nicer palette is still slop — recompose it.
- Any row of 3+ identical cards, and 50/50 two-column splits repeated more than once per page (outside true data collections).
- rounded-2xl + shadow-md on everything; border AND shadow AND tinted background on the same element.
- Gradient text on every heading; glow effects everywhere; light and dark mode both shipped half-done.
- Lorem ipsum, [Image], placeholder boxes, TODO copy, identical 3/6/9 card grids.

9. Calibrate expressiveness to the product type.
- Marketing, landing, portfolio, creative, games → expressive: strong art direction, large type, scroll choreography, bold committed color.
- Product UI, dashboards, admin, internal tools → restrained excellence: calm tinted surfaces, dense-but-airy data, perfect alignment, quiet motion; distinction comes from precision and one accent, not decoration.
- Forms, checkout, auth → near-invisible design: clarity and trust; the craft shows in spacing, focus states, and error handling.

10. Precedence and self-check.
- If a <design_system> block is present below, it IS the art direction — apply every craft rule above WITHIN its tokens. Project Skills, applied style packs, and explicit user direction likewise override the default aesthetic. The craft rules themselves (type discipline, motion, finish, states, contrast) always apply.
- After your required screenshot pass, interrogate the image STRUCTURALLY first: squint — is the silhouette a column of same-width boxes? Do any two adjacent sections share the same skeleton? Is every card in any grid the same size? Is anything overlapping or breaking its container, anywhere? Structural failures need recomposition (change the section map), not re-skinning. Then the styling check: "could this be mistaken for a template or an AI default?" If yes, push further before reporting done — usually bigger type contrast, more committed color, or a stronger signature element — and screenshot again.`;

/**
 * One planning-time line (plan.ts): plans for visual work must commit to the
 * art direction up front so execution starts decided instead of defaulting.
 */
export const PLAN_DESIGN_STEP_LINE = `- Committing to a specific art direction in the plan itself — name the direction, palette (hex values), type pairing, the one signature element, AND the composition (a one-line section map naming each major section's structure: asymmetric split ratios, bento spans, overlaps — not "sections: hero, features, footer") in the technical summary, so execution starts decided instead of falling back to a generic centered-grid look.`;
