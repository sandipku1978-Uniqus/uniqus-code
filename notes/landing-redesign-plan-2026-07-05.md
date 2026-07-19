# Landing page redesign plan — LOUD edition

**Date:** 2026-07-05 (v2 — direction changed same day: "loud and impressive,
high contrast, impact fonts") · **Status:** PLAN ONLY, not implemented
**Scope:** `apps/web/app/page.tsx` + supporting components/CSS/assets. Vercel-only
deploy (no orchestrator changes).
**Mock:** interactive scrolling mock built as a Claude Artifact (source HTML in the
session scratchpad); generated imagery lives alongside it. A second Artifact — the
**image direction board** — holds the round-2 Nano Banana 2 candidates with
per-slot recommendations and their exact prompts.

---

## 1. Concept — "Turn the instrument up"

v1 of this plan kept the calm "precision instrument" register. v2 keeps the
brand's DNA — warm near-black, the purple→magenta gradient, mono micro-labels —
but turns the volume up hard:

- **Poster typography.** Condensed impact-style display type (Anton), uppercase,
  viewport-filling. The headline is the hero image as much as the image is.
- **Maximum contrast.** Page base drops to `#050508`, display type goes pure
  `#ffffff`, and one full band **inverts to near-white** — the loudest structural
  move on the page.
- **Cinematic imagery as subject, not texture.** The Nano Banana 2 art reads at
  full strength behind a legibility scrim, not at 10% opacity.
- **Motion with force.** Letter-staggered slams, verdict "stamps," a giant
  dual-lane marquee, scroll-velocity skew — still transform/opacity only, still
  reduced-motion safe.

The animations stay **product-true** (the router actually routes, the machine
actually boots) — loud ≠ decorative.

### 1.1 Deliberate departures from the house design language

`docs/design-language.md` says display type is "large and *light*, never
extrabold-everything" and prescribes calm ambient glows. This page **knowingly
opts out of those two rules** at the user's direction, scoped to the landing page
only (other marketing pages and the dashboard stay on the house spec). What we
KEEP from the house language, non-negotiably: magenta as the single accent, mono
eyebrows/micro-labels, asymmetric composition (no 6/6), one depth technique per
element, real content, status-never-color-only, reduced-motion + AA contrast, and
the gradient opening/closing the page. If this direction ships and sticks, add a
"loud variant" note to `docs/design-language.md` so the deviation is documented,
not drift.

---

## 2. Verified facts this plan is built on

- Landing page: `apps/web/app/page.tsx` (server component; auth-aware CTAs via
  WorkOS + guest session; `LandingPrompt` composer variants `hero`/`bottom`;
  anchors `#how #models #workspaces #trust` used by the nav).
- No animation library in `apps/web/package.json`; current "marquee" band is
  static (`globals.css:7145`). Only assets in `public/` are 3 logo PNGs + a font.
- IntersectionObserver pattern exists in `components/DocsToc.tsx` /
  `components/ChangelogNav.tsx` — reuse for reveals.
- **Nano Banana 2 pipeline VALIDATED 2026-07-05.** A script was run against
  `gemini-3.1-flash-image-preview` using the repo's `GOOGLE_API_KEY` (root
  `.env.local` line 54) and produced both hero assets on-palette at 1K (mock
  quality). REST shape confirmed live: `generateContent` +
  `generationConfig.responseModalities: ["TEXT","IMAGE"]` +
  `imageConfig: { aspectRatio, imageSize: 512|1K|2K|4K }`, image returned as
  base64 `inlineData`. (Nano Banana Pro = `gemini-3-pro-image-preview` remains
  the fallback for stubborn art direction.)

---

## 2b. Competitive scan — 10 sites (landing pages fetched 2026-07-05)

| Site | Positioning | Landing pattern worth knowing |
|---|---|---|
| **ploy.ai** | "Your website as a growth engine" — what happens **after** launch | The standout: an overnight **agent-activity feed** ("11:42PM @ads found a competitor positioning shift… 03:08AM @web fixed 3 technical SEO issues") — timestamped receipts with mini-metrics (+23% traffic, 18 SEO fixes, $1K pipeline). Evidence, not claims. |
| **lovable.dev** | "Build something Lovable" | Radical composer-first minimalism; proof = scale counters (projects built, new/week, visits/month) + logos + template gallery. Almost no marketing sections at all. |
| **v0.app** | "What do you want to create?" | Composer + tight feature bento ("Prompt. Build. Publish.", "Agentic by default", design mode). Short and confident. |
| **bolt.new** | "What will you build today?" | Composer + **design-system import** as proof (Porsche, Material, Shadcn, WaPo); *claims* auto model routing "balancing quality and cost"; "98% less errors" stat; role-based value sections (PM / founder / marketer / agency). |
| **replit.com** | "What will you build?" · Agent 4 | Composer + launch-moment framing, parallel agents, heavyweight testimonials (NVIDIA, Databricks, Stripe adjacency), pricing directly on the landing. |
| **base44.com** | "Turn your ideas into apps" | Composer + a **numbered 01/04→04/04 sequential story** (validates our act structure); FAQ on the landing (AEO play). |
| **emergent.sh** | "Build full-stack web & mobile apps in minutes" | Composer-first; heavily client-rendered lazy sections. |
| **create.xyz** ("Anything") | One-sentence agent pitch | Ultra-minimal composer, nothing else above the fold. |
| **cursor.com** | "Your coding agent for building ambitious software" | Quiet single-sentence hero + **real interactive product demos as the hero object**; giant-name quotes; distinctive painted-landscape art behind UI panels. |
| **framer.com** | Design-forward site builder | The scroll itself demos the product — sections are live components (AI wireframer, CMS, analytics, A/B testing). Also owns a post-launch story (analytics/SEO/A-B). |

**What we take from this (and what we deliberately don't):**

1. **The composer-question hero is the genre uniform** — 7 of 10 open with
   "What will you build?" + a prompt box. We keep the composer (users now expect
   to type an idea into a hero), but *nobody* pairs it with poster type over
   cinematic imagery. The loud direction is confirmed as genuinely
   differentiating, not just taste.
2. **Steal from Ploy: receipts over claims.** Their overnight feed is the most
   persuasive trust device in the set. Adapted to our product truth as the new
   final beat of the pinned act (§4.6): after "go live," a timestamped session
   feed keeps ticking. It also extends the page past "publish" — every
   competitor except Ploy/Framer ends the story at launch; owning the
   after-you-ship beat differentiates us from the build-only crowd.
3. **Bolt, Base44, and v0 all *claim* model routing/choice in copy. Only we
   show it.** The RouterConsole demo (§4.3) is our version of Bolt's claim with
   evidence — add their honest framing ("balancing quality and cost") as the
   console's rationale line.
4. **Scale counters and testimonials (Lovable/Replit) are not available to us
   in private beta.** Use product-truth numbers only (0.4s restore, 4
   providers); no fabricated quotes or counts — banned by the design language
   anyway. Revisit once real numbers exist.
5. **Cursor/Framer validate real-UI-as-demo — but as contained panels, not
   backgrounds.** Matches the pinned-act feedback (the IDE window as a pinned
   background read as weird): product UI lives in bounded console frames
   (router, boot rack); the pinned background stays cinematic (§4.6).

---

## 3. Typography & contrast system (the "loud" foundation)

### 3.1 Type
| Role | Face | Spec |
|---|---|---|
| Display (hero, CTA, marquee) | **Anton** via `next/font/google` (fallback: `Impact`, `Arial Black`) | UPPERCASE, hero `clamp(64px, 11vw, 176px)`, CTA `clamp(72px, 12vw, 160px)`, line-height 0.9, tracking `0.01em` |
| Section H2 | Existing sans pushed to weight 800 | UPPERCASE, `clamp(40px, 6vw, 88px)`, line-height 0.95 |
| Outlined display | Anton + `-webkit-text-stroke: 1.5px` | Marquee lane B, hero ghost line — outline = loud without more ink |
| Body | Existing sans, unchanged | 16–18px, lh 1.6 — calm body makes the display hit harder |
| Micro | Existing mono, unchanged | Eyebrows, verdict stamps, boot logs, metrics |

- Load Anton with `display: "swap"` + fallback `size-adjust` metrics so the
  Impact/Arial Black fallback occupies identical space (**zero CLS** on the
  giant headline).
- Gradient-clip stays a scalpel: exactly one gradient phrase in the hero,
  one in the CTA.

### 3.2 Contrast
- Landing base darkens: `--mk-bg-loud: #050508`; display text `#ffffff`;
  secondary copy lifts to keep AA on the darker ground.
- **One inverted band** (Features, §4.5): near-white `#f4f2ee` ground, `#0a0b10`
  type, magenta accents (which read hotter on white). Exactly one inversion —
  two would zebra the page.
- Text over imagery always sits on a black gradient scrim (bottom-up
  `rgba(5,6,8,0.9) → transparent`); AA verified per band in the screenshot pass.

---

## 4. Section-by-section (v2)

Rhythm: full-bleed image hero → giant marquee → dark bands → **white features
band** → dark bands → gradient CTA. The inversion replaces "alternate contained/
full-bleed" as the page's mid-point structural break.

### 4.1 Hero — the prism (signature: letter-slam reveal + the beam's source)
- Backdrop: generated **`prism-fan`** (21:9 — a dark glass prism in the right
  third refracting a white beam into a purple→magenta fan; user pick
  2026-07-05). Hero type flips to **left-aligned** (the board's noted trade for
  this image); the prism owns the right side. Left-heavy scrim for legibility;
  slow parallax; CSS aurora stays **deleted**.
- The prism is not decoration — it is the **source of the page-wide light
  thread (§4.6)**: the beam that escorts the reader down the entire page
  originates at the prism's apex. The hero literally powers the rest of the
  page.
  (Lineage: round 1 `hero-monolith` retired — arbitrary sci-fi X; round 2
  `horizon-seam` superseded by the prism once the beam became page-wide.
  Alternates on the board: `horizon-seam`, `obsidian-wave`.)
- Headline in Anton, uppercase, ~3 lines filling the viewport width ("BUILD WITH
  / THE AI YOU TRUST / NOTHING LESS." — copy TBD): letters rise from
  `overflow:hidden` line masks with 18ms letter stagger + slight overshoot; the
  gradient phrase lands last with a background-position sweep.
- `LandingPrompt` unchanged functionally; placeholder typewriter cycles the four
  suggestions. Proof stats count up in mono tabular-nums.
- Eyebrow pill, auth-aware CTAs, GuestBanner preserved.

### 4.2 Marquee — the shout (page-wide device #2)
- Two full-bleed lanes moving in **opposite directions**, Anton uppercase
  `clamp(40px, 7vw, 96px)`: lane A solid white, lane B **outlined** (text-stroke),
  every third word magenta (kept from today's rule).
- Scroll-velocity skew: lanes shear ±3° with scroll speed (spring back to 0) —
  the single flashiest motion trick on the page.
- Pause on hover; reduced-motion/no-JS → static single row, no skew.

### 4.3 Models band — the router routes (signature: verdict stamp)
- 0.74/1 split kept; console on the wide side. `RouterConsole` loops three real
  scenarios (quick tweak → Gemini Flash, routine feature → GLM-5.2, hard debug →
  Claude Opus — mirrors `autoRouter.ts` tiers):
  1. mono prompt types in, 2. request chip travels a hairline path to the router
  node, 3. the tier verdict **stamps** (mono `HARD` slams in at scale 1.4 →
  1.0, blur → sharp), 4. the winning card ignites (magenta border + halo) while
  the rest dim, with a rationale line naming the trade ("routine build →
  cost-effective frontier coding: GLM-5.2"). Bolt *claims* exactly this
  capability in copy ("balancing quality and cost", §2b); we demonstrate it.
- Cards stay real DOM; the loud addition over v1 is the stamp + harder
  light/dim contrast between picked and passed-over models.

### 4.4 Workspaces band — the machine is alive
- Full-bleed band with generated **`chambers-close`** (3:2 — three dark glass
  chambers, only the center one glowing purple→magenta; round-2 pick ✔) as the
  background — the image literally is the pitch ("a private machine per project;
  yours is the lit one"). Round 1's rack row read as stock datacenter; the
  three-chamber close-up carries the same story with far less noise. Alternate
  on the board: `glass-machine` (a circuit city sealed in a glass cube).
- The boot rack floats over it as a single glass panel (one depth technique):
  rows power on in sequence, status dots pulse dim→green, a mono boot log types
  real numbers ("restoring snapshot… 0.4s · mounting /sandbox · preview live").
- Copy sits on the scrim side; stack under ~1180px.

### 4.5 Features — the white slab (the loudest move on the page)
- Full band **inverts to near-white**. Hairline-divided collection (1px gaps over
  a line ground), six cells, staggered reveals.
- **Giant ghost numerals** (mono, ~160px, 6–8% black) sit behind each cell's
  content — the impact-type language carried into the light section.
- Cell visuals: **real product screenshots** (dark-mode UI in browser chrome —
  dark shots pop hard on the white ground): plan card, chat+diff, live preview,
  web-search activity row, design packs, publish/rewind timeline. Captured from
  the dev server at 2×, stored `apps/web/public/landing/shots/`. No fabricated
  UI: a feature without a shippable screenshot keeps an animated line-draw SVG.

### 4.6 The beam — a thick ribbon of light drawn down the page (centerpiece)
Sixth iteration, user-settled (2026-07-06): the v4 *scroll-drawn line* concept
was right all along — the execution was just **far too thin**, and it sat as an
overlay. v6 = v4's concept at true beam width, on v5's background layer.

- **The path:** starts at the prism's apex in the hero and meanders down the
  whole document through every marked heading (`data-beam`) — authored
  quadratic curves with varied alternating swings (deterministic on every
  visit; the how-it-works cards alternate left/right so the beam genuinely
  zigzags between their numerals).
- **The render — a beam, not a line:** four stacked stroke passes, ~110px
  faint purple wash → 54px magenta glow → 22px hot magenta with heavy shadow
  blur → 7px white-hot core, with a ~110px radial flare riding the tip. It
  reads as a ribbon of light with real volume.
- **Scroll behavior:** the beam draws itself down to the reader's position
  (tip ≈ 45% of viewport height). Headings sit dimmed (~38%) until the tip
  reaches them, then switch on (full white + magenta text-shadow; step
  numerals fill with the gradient). Step 05 keeps the receipts feed.
- **Background, not overlay:** the canvas is viewport-fixed at `z-index: -1` —
  above the near-black ground, below every section background and panel. The
  machines band, the white slab, the CTA gradient, and all cards naturally
  occlude it, so the beam passes *behind* the page's furniture with zero
  special-casing. In the hero, the image's own painted fan is the beam; the
  canvas takes over below.
- **Implementation:** path built in document coordinates from `[data-beam]`
  elements (rebuilt on resize/load); redrawn per frame with viewport culling;
  `html` carries the ground color so the body is transparent above the canvas.
  Dimming scoped under `html.beam-on` — no-JS, mobile (≤1024px), and
  reduced-motion visitors get fully-lit headings and no canvas.
- Discipline: the beam is page-wide device #1, the marquee #2; router console
  runs once per viewport entry. Demonstrated in the mock.
- Lineage for the record: v1 pinned IDE window → v2 machine keyframes → v3
  sectional prism rig → v4 scroll-threaded thin line → v5 fixed searchlight
  cone → **v6 thick scroll-drawn beam on the background layer (current)**.

### 4.7 Trust — the quiet beat
- Unchanged from v1: deliberately still, standard reveals only. After the white
  slab and the marquee, this stillness is what keeps "loud" from becoming
  "noisy" — and trust copy should feel calm.

### 4.8 CTA — the biggest type on the page
- Full-bleed gradient close (kept); headline in Anton at `clamp(72px, 12vw,
  160px)` with the same letter-slam as the hero (opening and closing rhyme);
  gradient background-position drifts slowly.
- `LandingPrompt` bottom variant + pricing note preserved. Generated **OG image**
  (16:9 → 1200×630 crop) added to page metadata.

---

## 5. Motion system

- **Add `motion` (framer-motion v12 successor)** inside one client boundary
  (`LazyMotion` + `domAnimation`, `<MotionConfig reducedMotion="user">`) for: hero
  letter choreography, marquee velocity-skew, steps scrub, router console
  sequencing. Everything else is CSS + the `Reveal` IO component.
- Components (`apps/web/components/landing/`): `Reveal`, `HeroStage`, `Marquee`,
  `RouterConsole`, `BootRack`, `Beam` (the §4.6 background ribbon), `CountUp`, `CondensingNav` (nav
  gains glassy backdrop + shrinks past 24px; section spy reuses ChangelogNav's IO
  pattern).
- Guardrails (unchanged, non-negotiable): transform/opacity only; `will-change`
  only while animating; one consolidated `prefers-reduced-motion` block renders
  everything in final state; hero image is the LCP (`next/image` `priority`,
  explicit dims — letter animation must not gate its paint); no `backdrop-filter`
  on moving elements.
- Page-wide device budget (2): ① the beam (§4.6), ② the marquee.
  Grain/aurora/cursor-glow are **not** added on top.

---

## 6. Imagery pipeline (validated)

### 6.1 Script — build-time, committed output
`scripts/generate-landing-art.mjs` (port of the already-run Python validation):
reads `GOOGLE_API_KEY` from root `.env.local`, calls
`gemini-3.1-flash-image-preview:generateContent`, decodes `inlineData`, post-
processes with `sharp` (devDep): AVIF + WebP, 1×/2×, strip metadata → commits to
`apps/web/public/landing/`. Vercel builds never touch the key. Images carry
Google's invisible SynthID watermark — acceptable.

### 6.2 Assets — round 2 (production run at 2K; all prompts proven at 1K)

Round 1 (`hero-monolith`, `workspace-chambers`) was **retired** — user feedback:
"the images look weird." Diagnosis: dramatic objects performing in a void instead
of graphic compositions serving the type. Round 2 generated seven candidates
(all on the image direction board Artifact, with full prompts):

| Candidate | Aspect | Slot / verdict |
|---|---|---|
| `horizon-seam` | 21:9 | Hero alternate (was the round-2 pick; superseded by `prism-fan` when the beam went page-wide). Still the best canvas for centered type if the light-thread direction is dropped. |
| `obsidian-wave` | 21:9 | Strong hero/CTA alternate — glossy black wave, rim-lit, top half clean for type. |
| `prism-fan` | 21:9 | **★ Hero pick (user, 2026-07-05)** — anchors the hero right side (type left-aligned) and is the *source* of the page-wide light thread (§4.6). |
| `light-tunnel` | 21:9 | Loudest; too busy behind type. Candidate CTA backdrop only. |
| `dot-terrain` | 21:9 | Benched — ties to house dot-grid but reads synthwave-adjacent. |
| `chambers-close` | 3:2 | **★ Workspaces pick.** Three machines, only yours lit — the section copy as a photograph. |
| `glass-machine` | 3:2 | Workspaces alternate / future page hero — a circuit city sealed in a glass cube; most memorable single image. |
| `og-landing` | 16:9 → 1200×630 | To generate after hero pick is final: seam-banner variant, wordmark composited from `public/brand/`. |

Both picks are live in the mock. Iteration is cheap (~1 min/image at 1K), so
treat the board as a living document — regenerate freely before the 2K
production run.

Real web photos remain the non-preferred fallback (Unsplash/Pexels licenses,
brand duotone pass); feature cells use real screenshots, never stock.

---

## 7. File touchpoints

| File | Change |
|---|---|
| `apps/web/app/page.tsx` | Recompose sections; mount landing components; OG metadata |
| `apps/web/app/layout.tsx` or marketing layout | Load Anton via `next/font/google` (landing scope) |
| `apps/web/app/globals.css` | Loud landing styles (display type, inverted band, marquee lanes, stamps, scrims); consolidated reduced-motion block |
| `apps/web/components/landing/*` | 8 new components (§5) |
| `apps/web/package.json` | + `motion` (dep), + `sharp` (devDep) |
| `scripts/generate-landing-art.mjs` | New — Nano Banana 2 generator (validated shape) |
| `apps/web/public/landing/**` | Generated art + product screenshots (committed) |

Preserved invariants: auth-aware CTA logic, `LandingPrompt` behavior, nav anchor
ids, `GuestBanner`, `SiteFooter`, other marketing pages untouched (they stay on
the house spec until this direction is ratified).

---

## 8. Phases + verification

1. **Assets** — production 2K generation run, OG crop, product screenshots.
2. **Type foundation** — Anton via next/font (+ fallback metrics, CLS check),
   contrast tokens, inverted-band styles.
3. **Foundation** — `Reveal`, `motion` dep, reduced-motion consolidation.
4. **Hero + marquee** — HeroStage letter-slam, dual-lane marquee + skew,
   count-ups, condensing nav.
5. **Set pieces** — the Beam ribbon (motion centerpiece), RouterConsole
   (stamp, run-once), BootRack over the chambers image.
6. **Features slab + CTA + polish** — inverted collection, screenshots, ghost
   numerals, CTA close, OG image.
7. **Verify** — `npm run typecheck`; dev-server (4242) screenshot pass against
   §1.1's kept-rules list + the design-language self-check (adapted: *one*
   inversion, *two* page-wide devices, gradient opens/closes); AA contrast audit
   on every text-over-image/white-band pairing; reduced-motion OS-toggle pass;
   ≤1180px degradation; Lighthouse — LCP (hero image) and CLS (Anton fallback
   metrics) must not regress; no-JS render sanity.

Deploy: push `main` → Vercel production. Nothing on Hetzner.
