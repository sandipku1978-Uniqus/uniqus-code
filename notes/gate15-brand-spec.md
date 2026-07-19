# Gate 15 — brand + redesign spec (single source of truth)

The product is being rebranded from **Uniqus Code** to **Gate 15**. Gate 15 is an
independent brand. It is **NOT** a product of Uniqus Consultech. No mention of
"Uniqus", "uniqus", "Consultech", or uniqus.com may survive anywhere the user can
see, and no Uniqus logo asset may remain referenced.

## 1. Positioning + voice

### The industrial feel is carried by the DESIGN, not by the writing

The palette, textures and form language are industrial: steel, sodium-amber
signal, hazard stripe, machined edge, stencilled numeral. That is where the
identity lives, and it is enough. The copy stays plain product language about
building software with AI.

The name licenses the odd light touch — a stencilled numeral, an occasional
"cleared to ship", a hazard rule above the final CTA. That is fine and even good.
What is **not** fine is *living* in the metaphor: the reader must never feel they
have wandered into a themed experience. Concretely:

- **No tagline, hero headline, or page title built on the name.** Not "where your
  ideas take off", not "now boarding", not "your build has landed".
- **No section header puns.** Section heads describe the product feature.
- **At most one** transit/industrial flourish per page, in microcopy — an empty
  state, a button, a footer line. Never two. Never in the hero.
- Never explain the name. There is no "why Gate 15?" copy anywhere.

Litmus test: strip the CSS, read the page as plain text, and it should read as a
straight, serious AI development tool. If it instead reads as an extended airport
or freight bit, it has gone too far — cut back to zero flourishes and stop.

### The voice

Plain, load-bearing, unhyped. Short declaratives. Nouns over adjectives. Say what
the product does. Never "revolutionary", "unleash", "supercharge", "reimagine".

The product substance — multi-model AI routing, private VMs per project, live
preview, plan-before-edit — is unchanged, and it is what the copy is about. The
existing copy is already in the right register: **this is a rename and a
de-Uniqus-ing, not a rewrite of the pitch.** Keep the current headlines and body
copy wherever they don't name Uniqus. The rebrand is not a licence to re-theme
the prose.

## 2. Colour — orange/yellow signal on industrial steel

The whole identity is **one warm signal colour on cold grey infrastructure**.
The greys are deliberately COOL (gunmetal/graphite/steel). Cold ground is what
makes safety orange read as hi-vis. Do not warm the greys into brown — a warm
base plus orange goes muddy and monochrome.

### Brand ramp (the only warm hues in the system)

| token | hex | role |
|---|---|---|
| `--brand-ember`  | `#FF6A00` | **primary.** Safety orange. Buttons, active state, focus. |
| `--brand-ember-hi` | `#FF8124` | hover / lifted ember |
| `--brand-signal` | `#FFC53D` | hazard yellow. Highlights, gradient stop, numerals. |
| `--brand-rust`   | `#B23F0A` | deep oxide. Shadows under ember, pressed state. |
| `--brand-gradient` | `linear-gradient(135deg, #FF5A1F, #FFC53D)` | ember → signal |

`--accent` / `--accent-primary` = `#FF6A00`.

**Ink on ember is near-black, never white.** `#FF6A00` + white is ~2.9:1 (fails
AA); `#FF6A00` + `#140D07` is ~9:1 and is *also* the correct industrial look —
hazard signage is black-on-orange. Primary buttons therefore fill ember and set
`color: #140D07`. Orange **text** on a dark surface is fine (`#FF8124` on
`#0A0B0C` ≈ 7:1) — that constraint only applies to text sitting ON ember.

### Industrial neutrals — dark (default)

| token | hex | note |
|---|---|---|
| `--bg-dark` | `#0A0B0C` | asphalt. page ground |
| `--bg-pane` | `#0F1113` | IDE panes, topbar, status bar |
| `--bg-surface` | `#16181B` | cards |
| `--bg-surface-hover` | `#1E2125` | |
| `--bg-surface-active` | `#262A2F` | |
| `--bg-elev` | `#1E2125` | raised fields (inputs, textareas) |
| `--bg-base` | `#0A0B0C` | modal/guest ground |
| `--bg-canvas` | `#0F1113` | document canvas |
| `--bg-code` | `#08090A` | deepest: code / tool output |
| `--bg-chat` | `#121417` | marketing IDE chat column |

Text — painted-steel off-white, neutral, not cream:
`--text-primary #EDEBE7` · `--text-muted #9A9793` · `--text-dim #7C7A76` (must
stay ≥4.5:1) · `--text-xdim #3C3A37` (decoration only).

Borders: `--border-default #2A2E33` · `--border-light #1E2125` ·
`--border-strong rgba(255,255,255,0.17)` · `--border-active #FF6A00`.

### Industrial neutrals — light theme

Concrete, not paper. Cool grey-white, faint aggregate warmth:
`--bg-dark #EFEEEC` · `--bg-pane #FFFFFF` · `--bg-surface #FFFFFF` ·
`--bg-surface-hover #E9E8E6` · `--bg-surface-active #DEDCD9` ·
`--bg-elev #FFFFFF` · `--bg-base #EFEEEC` · `--bg-canvas #FFFFFF` ·
`--bg-code #EDECEA` · `--bg-chat #F7F6F4`.
Text `#17181A / #52555A / #6B6E73 / #B5B7BA`.
Borders `#DDDCDA / #E8E7E5 / rgba(23,24,26,0.22)`, active stays ember.
Ember does NOT hold on white (`#FF6A00` on white ≈ 2.9:1) — so on light, orange
TEXT must darken to `--brand-rust #B23F0A` (≈ 5.2:1). Ember *fills* are fine (they
carry black ink). Guard this with a `--accent-text` token that flips per theme.

⚠ **GRADIENT TEXT IS THE TRAP.** `--brand-gradient` ends on signal yellow
`#FFC53D`, which is **~1.7:1 on a near-white page — illegible**. Any
`background-clip: text` gradient (the hero's `.grad` span, and anything like it)
MUST swap to a darker ramp in the light theme so *every stop* clears 3:1:

```css
.grad {
  background: var(--brand-gradient);              /* dark: ember → signal */
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
:root[data-theme="light"] .grad {
  background: linear-gradient(135deg, #B23F0A, #D4560A);   /* rust → deep ember */
  -webkit-background-clip: text; background-clip: text;
}
```
This was caught for real on the WorkOS auth panel (see
`notes/workos-authkit-branding.md`); the same bug will exist anywhere the hero
gradient is applied to type. Check every one.

### Semantic (unchanged in meaning, retuned)

`--conf-high #34D399` · `--conf-medium #FBBF24` · `--conf-low #F87171`.
Note `--conf-medium` is yellow and brand `--brand-signal` is yellow. Keep brand
yellow for **brand/decoration only** and semantic amber for **status only**; they
never sit adjacent. Do not use `--brand-signal` as a warning colour.

### Marketing tokens (`.marketing-shell --mk-*`)

Retune in place — the names are referenced ~250× and must keep working:
`--mk-bg #08090A` · `--mk-panel-solid #121417` · `--mk-panel-2 #191C20` ·
`--mk-panel rgba(18,20,23,0.88)` · `--mk-line rgba(255,255,255,0.10)` ·
`--mk-line-strong rgba(255,255,255,0.18)` · `--mk-text #F2F0EC` ·
`--mk-muted #A5A29C` · `--mk-dim #6F6D68`.
Decorative accents get industrial values: `--mk-amber #FFC53D` (hazard) ·
`--mk-cyan #7FA6C4` (cold steel — the one cool accent, used sparingly) ·
`--mk-teal #4E9E86` (patina) · `--mk-green #64D29B` (status OK only).
The magenta page-top wash becomes an ember wash.

## 3. Type

- **Sans: `Archivo`** (variable) — an industrial grotesque from the signage
  lineage. Replaces DM Sans, whose soft geometry is the opposite of this brand.
- **Mono: `JetBrains Mono`** — unchanged; already reads as machine output.
- Eyebrows, labels, stat keys, nav chips, buttons: **UPPERCASE, tracking
  `0.08em`–`0.12em`**, weight 600. This uppercase-signage treatment is what
  carries the industrial feel — more than the palette does.
- Headlines: weight 700, tight tracking (`-0.02em`), no gradient text except the
  single hero phrase.
- Numerals (stat tiles, the "15", version numbers): mono or Archivo 700, tabular.

## 4. Form language

- **Radii drop.** `--radius-sm 4px` · `--radius-md 6px` · `--radius-lg 8px` ·
  `--radius-xl 12px`. Machined, not pillowy. `--radius-full` stays for dots/pills.
- **Hazard stripes** as the signature motif: a 45° repeating-linear-gradient of
  ember/transparent, used as a thin (3–4px) rule — top of the CTA band, under the
  active nav item, edge of the hero. Use it 2–3 times on the site, not everywhere.
  ```css
  --hazard: repeating-linear-gradient(45deg,
    #FF6A00 0 8px, transparent 8px 16px);
  ```
- Borders do the work, shadows are restrained. Hover = border lifts to
  `--border-strong`, not a bigger shadow.
- Keyline detail: 1px inner top highlight (`inset 0 1px 0 rgba(255,255,255,0.04)`)
  on raised panels = the sheen on brushed steel.
- Corner notch (a 45° clipped corner) is allowed on the logo plate and the
  hero panel. Do not apply it to every card.

## 5. Logo + wordmark

Build as an **inline SVG React component** (`components/BrandLockup.tsx`) — crisp
at every size, theme-aware, no PNG. Delete the three Uniqus PNGs from
`public/brand/`.

- **Mark:** a square steel plate with one machined (45°-notched) corner, filled
  with the ember→signal gradient, carrying a stencilled **15** in near-black.
- **Wordmark:** `GATE` in `--text-primary` + `15` in ember, Archivo 700,
  uppercase, tracking `0.02em`. The old `uniqus / code` slash divider goes away.
- `compact` prop renders the plate alone (used in tight chrome).
- Favicon: the plate, as SVG.

## 6. Generated imagery — strict scope

Use `node scripts/gen-image.mjs --out <path> --aspect <r> --prompt "..."`
(Gemini `gemini-3-pro-image`, key from `.env.local`).

**Only** for things CSS genuinely cannot fake: volumetric haze, atmospheric light
falloff, film grain, complex multi-stop luminous gradients. Everything flat — the
logo, icons, hazard stripes, rules, cards, UI mock-ups — stays in code.

Every prompt must specify: abstract, **no text, no lettering, no logos, no
people, no recognisable objects**; deep graphite/steel darkness; a single warm
amber/sodium light source; heavy negative space in the region where copy will
sit; fine film grain. Images are **backdrops** — they sit at low opacity behind
content and must never compete with it. Verify by reading the PNG back before
accepting it.

## 7. Copy rename map

| old | new |
|---|---|
| Uniqus Code | Gate 15 |
| Uniqus (as the company) | Gate 15 |
| "from Uniqus" | (drop, or "from Gate 15") |
| © 2026 Uniqus Consultech | © 2026 Gate 15 |
| "Ask Uniqus to…" | "Ask Gate 15 to…" |
| hi@uniqus.com / any @uniqus.com | @gate15.dev |
| https://uniqus.com (legal links) | `/privacy`-style internal or `https://gate15.dev` |
| linkedin.com/company/uniqus | generic linkedin.com |

Nothing in the marketing copy may claim Gate 15 is part of, backed by, or built
by Uniqus Consultech. Rewrite the About/Careers/Blog narrative accordingly — it
currently tells a Uniqus Consultech company story and must become a Gate 15 one.
Do not invent verifiable-sounding facts (funding, headcount, customer names,
awards). Keep claims to what the product actually does.

## 8. Rename scope — what to touch, what to leave

Decision: rename **everything user-visible, everything browser-local, AND the
cross-service wire contracts**. The one exception is the sandbox skills path.

### 8a. Wire contracts — MUST be changed on BOTH sides in the same commit

These literals are hardcoded independently in the web app and the orchestrator.
Changing one side alone breaks production. Change both, together:

| literal | web | orchestrator |
|---|---|---|
| `uniqus-guest` (cookie) | `lib/guest-session.ts:20` `GUEST_COOKIE_NAME` | `src/auth/guest.ts:44` `GUEST_COOKIE` |
| `uniqus:picker` | `components/PreviewPanel.tsx` `PICKER_CONTROL_TYPE` | `src/proxy.ts:919` (also accepts `uniqus:pick-mode`, `uniqus:select-mode`) |
| `uniqus:element` | `components/PreviewPanel.tsx` `ELEMENT_MESSAGE_TYPE` | `src/proxy.ts:754,861`; `src/agent/selectedElement.ts:7` + both test files |
| `uniqus:preview-nav` | `components/PreviewPanel.tsx:33,42` | `src/proxy.ts:704,726` |
| `uniqus:runtime-error` | `components/PreviewPanel.tsx:236,242` | `src/proxy.ts:937,959` + `proxy.test.ts` |
| `X-Uniqus-Warming` | *(not read by web)* | `src/proxy.ts:470` + injected reader `:1083` + `proxy.test.ts:121` |
| `UNIQUS-GUEST-` (code prefix) | display only: `GuestLoginActions.tsx:104,213` | `src/auth/guest.ts:73,79` (generator) |

→ new values: cookie `gate15-guest`; postMessage `gate15:picker` / `gate15:element`
/ `gate15:preview-nav` / `gate15:runtime-error` (keep accepting the legacy
`uniqus:*` aliases on the orchestrator's inbound switch so an in-flight preview
iframe from an older deploy doesn't break); header `X-Gate15-Warming`; prefix
`GATE15-`. Old recovery codes are stored verbatim in the DB and still resolve, so
the prefix change only affects newly-issued codes.

Also rename the workspace package `@uniqus/api-types` → `@gate15/api-types`
(build-time only): `packages/api-types/package.json`, `apps/web/package.json`
(`name` → `@gate15/web`, dep), `apps/web/next.config.mjs` `transpilePackages`,
`services/orchestrator/package.json`, and all ~40 import sites across both.

Orchestrator user-facing copy also needs it: `src/collabRoutes.ts:95,398`
→ "no Uniqus account with that email".

### 8b. LEAVE ALONE — `.uniqus/skills.md`

`services/orchestrator/src/agent/skills.ts:28` `SKILLS_PATH = ".uniqus/skills.md"`
is a real directory already written into every existing project sandbox and
referenced in `db/schema.sql`. Renaming it needs a data migration and is
explicitly **out of scope**. Leave the backend path AND the places the web app
displays it (`SkillsModal.tsx:183`, `SkillsView.tsx:444`, `CustomPromptsCard.tsx:151`)
exactly as they are — the displayed path must keep matching reality.

### 8c. Browser-local — rename freely (no contract)

localStorage `uniqus.*` → `gate15.*` (9 keys in `lib/store.ts`, plus
`PlanDocument.tsx` `seenPlanIntro`, `LandingPrompt.tsx` `pendingBrief` +
`draft.${id}`, mirrored in `ChatPanel.tsx`). **The two inline anti-FOUC bootstrap
scripts read `uniqus.theme` / `uniqus.density` as raw strings and must be updated
in lockstep** (`app/layout.tsx` `APPEARANCE_BOOTSTRAP`, `app/global-error.tsx`
`THEME_BOOTSTRAP`) or the theme flashes/resets.
Also: sessionStorage `uniqus:run-capability:*` (`lib/run-capability-storage.ts`),
panel autosave IDs `uniqus-h-*` / `uniqus-v-*` (`Workspace.tsx`, incl. the sweep
predicate at `:103`), Monaco theme `uniqus-dark` + `defineUniqusTheme`
(`CodeEditor.tsx`), drag MIME `text/uniqus-path` (`FileExplorer.tsx`), datalist id
`uniqus-secret-env-options` (`SecretsModal.tsx`), CSS keyframes
`uniqus-skeleton-pulse` (`globals.css`, 4 use sites), download filename
`uniqus-recovery-code.txt` (`GuestLoginActions.tsx`).
Renaming the localStorage keys resets each user's theme/density/panel prefs once.
That is accepted.

### 8d. Assets

`public/brand/Logo_Color.png` and `Logo_White_Color.png` are unreferenced — delete.
**KEEP `public/brand/uniqus-small-logo-color.png` on disk** even though nothing in
the app will reference it any more: the WorkOS *hosted* sign-in page fetches it by
that exact URL from the production origin (configured in the WorkOS dashboard, not
this repo), so deleting it 404s the logo on the hosted login screen. Add the new
Gate 15 mark alongside it as a PNG at `public/brand/gate15-mark.png` so the WorkOS
dashboard can later be repointed. Note this in the summary as a manual follow-up.

### 8e. Contact/links

`hello@uniqus.com`, `security@uniqus.com`, `careers@uniqus.com`,
`status@uniqus.com` → `@gate15.dev`. `https://uniqus.com` legal links,
`linkedin.com/company/uniqus`, `discord.gg/uniqus-code`,
`github.com/uniqus-code/…`, `x.com/uniquscode` → Gate 15 equivalents
(`gate15.dev`, `x.com/gate15`, `discord.gg/gate15`, `github.com/gate15`).
`changelog/page.tsx:19` `COMMIT_URL` points at the real repo
`github.com/sandipku1978-Uniqus/uniqus-code` — leave the URL working (it's a live
link to real commits) but it must not be rendered as brand text anywhere.

## 9. Non-negotiables

- **Do not disable, stub, or "coming soon"** anything to make the reskin easier.
  Every page keeps its current information architecture and functionality.
- Token-first: change values in the `:root` / `[data-theme=light]` /
  `.marketing-shell` blocks. Only touch a component when it hardcodes a hex or
  needs the new form language. Hunt down every hardcoded `#B21E7D` / `#482879` /
  `#5a32a0` and the `rgba(178, 30, 125, …)` magenta washes.
- Contrast: body text ≥4.5:1, large text ≥3:1, in **both** themes.
- `npm run typecheck` must pass.
