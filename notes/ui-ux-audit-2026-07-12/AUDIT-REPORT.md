# Uniqus Code — Comprehensive UI / UX / Accessibility Audit

**Date:** 2026-07-12 · **Scope:** the full `apps/web` product — public marketing
site + WorkOS-gated dashboard, project workspace, settings, and org surfaces.
**Reference standards:** `docs/design-language.md`, `docs/behavioral-ux-guidance.md`,
and WCAG 2.1 AA.

## Method (two independent audits, cross-checked)

1. **Live browser audit** of the public surface at `app.uniqus-code.com` —
   Playwright (msedge) across all 17 public pages at desktop (1440) and mobile
   (390): full-page screenshots (`shots/`), an axe-core 4.10 accessibility scan,
   and custom probes for horizontal overflow, focus visibility, headings, labels,
   and accessible names. Raw data in `results.json`; distilled in
   `live-browser-findings.md`. WorkOS-gated surfaces can't be reached live, so
   those were audited by code only.
2. **Multi-agent code audit** — 18 surface clusters (every component, including
   the gated ones) reviewed against the combined design-language + behavioral-UX
   + WCAG rubric, then each cluster's findings **adversarially re-verified against
   the source** by a second agent (123 findings confirmed, over-claims dropped),
   then consolidated by lens. 41 agents total.
3. **Manual spot-verification** — the 2 CRITICAL findings plus the 5 most alarming
   HIGH/MEDIUM items were re-checked by hand against the exact source lines. All
   confirmed as described.

## Headline

**123 verified findings**, consolidated to **2 critical · 21 high · 33 medium ·
37 low**. The through-line: **the design language is sound and mostly honored —
the failures are discipline drift, where the same primitive is implemented
correctly in one file and violated a few lines away.** Most fixes are a token
swap, a single attribute, or reusing an existing correct component.

## Live-browser verification (production, dark theme)

The live run **independently corroborated the code audit's top items in the real
deployed app**, and adds a few things only visible at runtime:

**Contrast (WCAG 1.4.3 AA) — confirmed with computed ratios in production:**

| Element | Token / color | Size | Ratio | Page |
|---|---|---|---|---|
| `.console-head strong` "thinking: high" | magenta `#B21E7D` on `#07080d` | 11px | **3.21:1** | home |
| `.label-eyebrow` "Trust and control" | `--mk-dim` `#716d66` on `#07080d` | 11px | **3.88:1** | home |
| `.price-card .per` "forever" / "talk to us" | `--mk-dim` `#716d66` | 13px | **3.88:1** | pricing |
| `.footer` legal line | `--text-dim` `#7c7a72` on `#15161f` | 11px | **4.18:1** | login |

Note the CSS comment at `globals.css:38-40` claims `--text-dim` was already
lifted to "~4.6:1 on the dark surfaces" — but on the *raised* `#15161f` surface
it still computes 4.18, and `--mk-dim` was never lifted. This is the same HIGH
"low-contrast text tokens" theme below, verified live.

**Headings — confirmed live:** `models`, `changelog`, `blog` skip `h1→h3`;
**`/status` has no `<h1>`** (matches the code finding).

**Mobile nav — confirmed live:** at 390px the top-nav links are simply absent
with no hamburger (matches `globals.css:7685` — no menu-toggle exists). Phone
visitors can't reach Pricing/Docs/Models from the top.

**Additive live-only finding (not in the code report):**
- **Cloudflare Turnstile renders a bright white widget on the near-black sign-in
  card.** `Turnstile.tsx:93-100` calls `window.turnstile.render()` with no
  `theme` option, so Cloudflare defaults to `"auto"` (follows the OS
  `prefers-color-scheme`). The sign-in card is always dark, so a light-OS visitor
  sees a white box mid-page — a jarring seam on the primary auth surface, and
  low-contrast within the widget for that user. **Fix:** pass `theme: "dark"`
  (the sign-in surface is always dark). *Severity: medium (design + a11y).*

**Two probe signals were investigated and dropped as false positives** (recorded
for honesty): the "unlabeled `type=file` input" on every page is the correctly
`hidden` import input at `LandingPrompt.tsx:216` (removed from the a11y tree); and
the raw focus-visibility counts are an artifact of programmatic `focus()` not
triggering `:focus-visible` — the *real* focus gap is the specific composer
finding below, which the code audit pinpointed and I hand-verified.

**Verified strengths (live):** no horizontal overflow at 390px on any page; clean
mobile reflow; every page has `lang`, a real `<title>`, and `data-theme` set
before paint (no flash); the hero+CTA gradient pairing and the anchored
"Most popular" middle pricing tier (compromise + anchoring, not a decoy) are
executed exactly as the design + behavioral docs prescribe.

---

*The detailed, code-grounded findings follow (from the multi-agent audit). The
live evidence above folds into the Contrast, Heading, and Mobile-nav items; the
Turnstile item is additive.*


## 1. Executive summary

**What's strong.** The app ships a real design system and mostly honors it: a documented `--fs-*` type ramp, a semantic `--conf-*` color scale, a disciplined palette rule (magenta = active/focus, purple = structure), and — crucially — *correct reference implementations* already in-repo for nearly every violation found. The shared `Modal.tsx` has role=dialog + focus trap + Esc + focus-restore; the global `*:focus-visible` magenta ring exists; `:focus-within` wrappers, `role=alert` banners, roving-focus menus (`ProjectActionsMenu`, `Workspace.tsx:164`), and layout-matched `.skeleton` styles all exist. The dashboard hero uses the brand gradient correctly. This means most fixes are cheap: swap a token, reuse an existing component, add one attribute.

**What most needs attention.** Discipline drift — the same primitive is correct in one file and violated nearby. Priorities:
1. **Two CRITICAL a11y failures.** The ungated marketing hero + bottom composer (the primary conversion surface) has **no visible keyboard focus ring**, and the **light theme is half-built** (marketing accent + several `--conf-*` tokens never flipped) → /status green at 1.69:1 and badges/tints below AA.
2. **Contrast (HIGH, pervasive).** `--text-dim` and `--mk-dim` fail AA as real body text in *both* themes; magenta-as-text fails across prose/CTA/changelog links.
3. **Missing accessible names + live regions (HIGH).** The streaming chat answer — the app's core output — is never announced to screen readers.
4. **House-rule breaks (HIGH).** Emoji/dingbats as UI icons app-wide; disabled primary CTAs painted as faded gradients ("broken"); purple used where magenta is reserved.
5. **Honesty gaps (HIGH, against the "compete on trust" wedge).** Marketing promises billing/proration and a "Manage plan & seats from Settings" that don't exist; a dead "coming soon" faux-button in the dashboard.
6. **One dangerous correctness inversion.** The Design Systems "Confirm delete" button renders **green** (success token); a failed prompt load can be **saved over** empty.

---

## 2. Findings by severity

### CRITICAL (2)

**Accessibility**
- **No keyboard focus ring on the ungated hero + bottom "try it" composer** — Marketing home hero + bottom build CTA — `globals.css:7172-7186, 8141-8156` (`.hp-input`/`.bp-input` at 7179/8148; no `:focus-within` on `.hero-prompt`/`.bottom-prompt`) — the primary conversion element gives a keyboard user zero visible focus indicator (WCAG 2.4.7). Fix: scope any suppression to `:focus:not(:focus-visible)` and add `:focus-visible{outline:2px solid var(--brand-magenta);outline-offset:2px}`, or add a `:focus-within` ring on the wrapper (mirror `.composer-field:focus-within` at `globals.css:2298`).
- **Light theme never flips marketing accent + `--conf-*` tokens → hard AA failures** — Marketing /status page + light-theme badges/tints — `globals.css:6721-6734` (`--mk-cyan/teal/green/amber` not re-declared), `129-134` (`--conf-high` #0f9d6b 3.47:1, `--conf-medium` #b27400 3.90:1 on white), `54/56/58` (`--conf-*-bg` tints never flipped); status green 1.69:1 on #f5f3ef (`status/page.tsx:9781,9785`) — light mode is a half-built theme with contrast failures on status signalling and tinted callouts. Fix: add `:root[data-theme="light"] .marketing-shell` overrides clearing 4.5:1 (green ≈ #157347), deepen light `--conf-high`≈#0a7f54 / `--conf-medium`≈#8f5e00, and add explicit light `--conf-*-bg` overrides.

### HIGH (21)

**Design-language**
- **Emoji / dingbat glyphs used as UI icons app-wide** — dashboard, Design Systems, Plan/Model picker, Agent Preview, Databases/Deploy, Chat, Preview toasts, shared Modal/Toaster — `ProjectPicker.tsx:57-60` (`ICON_CHOICES` 🚀✨📊) & `:2421` (ProjectAvatar identity), `DesignSystemsView.tsx:489,739` (✨), `ModelPicker.tsx:135,212,297,317` (⚡/⚠), `PlanDocument.tsx:265` (🔒), `AgentPreviewPanel.tsx:177,190,297` (🖱️/✓✗/▶), `Modal.tsx:168` (✕), `Toaster.tsx:44,66` (✓!i/✕) — breaks "one icon set, one stroke weight; never emoji"; renders in platform emoji font at inconsistent color/weight beside proper stroke-2 SVGs. Fix: replace each with the existing house single-stroke SVG set; keep aria-label/aria-hidden. If the colored project avatar is deliberate, isolate it as a labeled avatar affordance, not app iconography.
- **Off-scale half-pixel type sizes bypass the `--fs-*` ramp** — app-wide + inline component sizes — `globals.css` ~59 half-pixel rules (e.g. `.plan-deliverables` 14.5px:2015, `.error-card-title` 13.5px:2124, `.settings-row .v` 12.5px:5202, `.dash-tabs button` 12.5px:4482, `.status-state` 12.5px:9784), `ChatPanel.tsx:2030` (11.5), `PreviewPanel.tsx:1279,1322` (11.5) — sub-pixel-blurry text; the documented ramp is unusable as a source of truth and inline numbers won't track the density flip. Fix: snap each to the nearest `var(--fs-*)` token; migrate inline `fontSize` numbers to tokens/shared classes.
- **Purple used as the active/focus/attention cue where the rule reserves magenta** — first-run coachmarks, pending plan cards, resize handles, chat-session active row — `globals.css:2177,2198` (coachmark border/CTA `--brand-purple`), `1905-1908,1980-1986` (`.plan-card.pending` purple border+fill), `525-552` (`.resize-handle-*:focus-visible` purple + `outline:none` → 1.70:1), `ChatSessionDropdown.tsx:208` (indigo-500 active row) — the most attention-seeking elements render in the recede color; a near-invisible focus ring (also WCAG 2.4.7). Fix: move active/focus/attention to `var(--brand-magenta)`/`--brand-gradient`; drop `outline:none` on the handles; use a magenta color-mix tint for the active session row.
- **Disabled primary send buttons use a faded gradient (banned "broken" pattern)** — marketing hero + dashboard describe composer — `globals.css:7273,7284` (`.hp-send` gradient + `:disabled{opacity:0.5}`) — on first paint (empty textarea) the top conversion CTA shows a washed-out gradient circle reading as broken/half-loaded; the in-app `.send-btn:disabled` (2985-2989) does it correctly with flat fill. Fix: `.hp-send:disabled{background:var(--bg-surface-active);color:var(--text-dim);cursor:not-allowed;box-shadow:none}`.
- **Unsaved-file dirty dot renders magenta (accent leak) not amber warn** — workspace + file explorer — `EditorPreviewArea.tsx:312` (`var(--accent-primary, #fbbf24)`; `--accent-primary` is defined #B21E7D at `globals.css:18`, so the amber-intended fallback never renders) — every unsaved file shows magenta competing with the genuine magenta active-tab cue, mislabeling warn as "selected". Fix: use `var(--conf-medium)`; drop the misleading `--accent-primary` reference.

**Accessibility**
- **Low-contrast text tokens fail WCAG 1.4.3 as real body/meta text (both themes)** — in-app dark + all marketing pages + changelog + org/members + CTA links — `globals.css:38-41` (`--text-dim` #7c7a72 recomputes 3.85–4.48:1, 94 usages), `6708/6730` (`--mk-dim` 2.96–3.89:1, ~26 usages), magenta-as-text `390,4932,9616,9749` (2.89–3.16:1), `changelog/page.tsx:874-889` (commit-SHA links dragged to 3.60:1 by `opacity:0.62`), `globals.css:2821-2823` (`btn-danger` white-on-#f87171 = 2.77:1) — genuine small text below the 4.5:1 floor. Fix: lift `--text-dim`≈#8a887f, `--mk-dim` dark≈#8b877f/light≈#6f6c75; use a lightened magenta tint (or resting underline) for text links, reserving #B21E7D for fills/rings; remove the `opacity:0.62` on changelog links; darken `btn-danger` fill≈#c9433f. Delete the dead `#a78bfa` fallback at `globals.css:2227`.
- **Streaming / dynamic regions not announced to assistive tech** — chat panel, agent preview, guest login errors, convert-failure banner, org usage — `ChatPanel.tsx:842,1954-1972,2516-2529` (streaming answer + reasoning in bare divs, no `aria-live`/`role=log` — WCAG 4.1.3 blocker for the panel's core function), `AgentPreviewPanel.tsx:146-199`, `GuestLoginActions.tsx:246-257`, `ProjectPicker.tsx:874-886` (cf. correct `role=alert` at `1699` and `GuestBanner.tsx:151`) — screen-reader users never hear the primary output or failures. Fix: add `role="log"`+`aria-live="polite"` to the conversation container; wrap agent-preview status in `aria-live`; add `role="alert"` to the guest/convert-failure banners.
- **Controls lack accessible names (placeholder-only inputs, icon-only buttons)** — guest recovery-code form, Skills editor, FlowComposer, chat attachment/session controls, Appearance — `GuestLoginActions.tsx:210-218` (recovery-code input placeholder-only, account-recovery path), `SkillsView.tsx:666-703` (unpaired sibling labels), `AgentPreviewPanel.tsx:339-391`, `ChatPanel.tsx:1358-1365` (remove button announces bare "x"), `AppearanceCard.tsx:40-49` (radiogroup no name) — WCAG 1.3.1/1.1.1/4.1.2. Fix: add `aria-label`/`<label htmlFor>` per control (e.g. `Recovery code`, `Remove ${file.name}`); mirror the correct examples (`DesignSystemsView.tsx:869`, `ChatPanel.tsx:1336-1343`).
- **Heading-order skips (h1→h3 or no h1)** — /status, changelog, blog, workspace shell — `status/page.tsx:48` (no h1, starts at h2), `changelog/page.tsx:843→865` and `blog/page.tsx:20→46/65` (h1→h3), `EditorPreviewArea.tsx:467` (lone h3, shell has no heading) — breaks the programmatic outline (WCAG 1.3.1). Fix: give /status an `<h1>`; demote card titles to `<h2>` or add an sr-only section h2; use `<h2>`/visually-hidden h1 for the workspace empty state.
- **Delete-file confirm is a hand-rolled dialog with no role/trap/Esc/focus-return** — workspace file explorer — `FileExplorer.tsx:907-935` (`.proj-dialog` markup, no `role="dialog"`, aria-modal, Esc, focus trap, or restore, on an irreversible sandbox+Storage delete; shared `Modal.tsx` supplies all of these and is already used at `EditorPreviewArea.tsx:476`) — WCAG 4.1.2/2.4.3. Fix: replace the ad-hoc markup with the shared `<Modal>` (danger footer).
- **Tab close/save affordance is a non-focusable `<span onClick>` nested in the tab `<button>`** — workspace editor tabs — `EditorPreviewArea.tsx:299-330,357-369` (dirty-save • and close × are `<span onClick>` with `stopPropagation` inside a real `<button>`; `.tab .x` sets only size/color) — keyboard/SR users can't reach or activate close/save/stop-dev-server; invalid HTML (interactive nested in button). Fix: render each as its own `<button type="button">` with `aria-label` (`Close ${filename}`/`Save ${filename}`) as a sibling in a flex row.

**Behavioral-ux**
- **Marketing promises billing/tier mechanics the product can't fulfil** — Pricing, Support, Community — `pricing/page.tsx:33` (`Start a Team trial`→`/login`), `:98` (per-seat proration "on your next invoice"), `support/page.tsx:90-91` ("Manage your plan and seats from Settings" — `settings/page.tsx` has no billing UI), `community/page.tsx:120-128` ("See the schedule"→the same Discord invite as the forum card at `:90`) — honesty gaps directly against the "compete on trust" wedge; the Team CTA dead-ends at /login. Fix: relabel to "Join the Team waitlist"/"Talk to us", remove "prorate"/"next invoice"/"Manage plan & seats" until billing ships (then add one-click self-serve cancel); point "See the schedule" at a real events surface.
- **Stale/garbled product copy** — Templates, Login, Builder preview, Settings docblock — `templates.tsx:51,95,117,170,183` (double-encoded em-dash/arrow mojibake, bytes c3 a2… in user-visible blurbs), `login/page.tsx:30-32` ("Continue securely" — filler, hints no method), `Workspace.tsx:1297` (`Live preview :${p.port}` reintroduces the raw port the design hid), `settings/page.tsx:8-11` (docblock still says model/prompts/appearance are "coming soon" though all persist; dead `.soon` CSS at `globals.css:5203-5215`) — undercuts the "precision instrument" positioning. Fix: re-save `templates.tsx` as clean UTF-8 + CI grep for `c3a2`; reword login CTA ("Continue to sign in"); use a human ordinal for previews; update the docblock and delete dead `.soon` styles.
- **Top-nav links vanish on mobile with no hamburger replacement** — marketing home nav — `globals.css:7686` (`@media (max-width:820px){ .topnav .links{display:none} }`; no menu-toggle component exists; `<520px` also hides Sign in at `7731-7733`) — phone visitors can't reach Pricing/Docs/Models/Workspaces from the top; must scroll to the footer. Harms nav + conversion. Fix: add a hamburger menu below 820px opening the same link set (reuse `NavExploreMenu`/`FOOTER_COLUMNS`).

**Correctness-state**
- **"Confirm delete" button painted GREEN (success token), not red** — Design Systems editor delete — `DesignSystemsView.tsx:893` (`color:"var(--conf-high, #e5484d)"`; `globals.css:53` defines `--conf-high:#34d399` GREEN, so the token — not the red literal — renders; the warmup Delete step at `:907` uses amber, so escalation is inverted) — the most dangerous action reads as safe/positive green. Fix: use `var(--conf-low)` (red). Note: no `btn-danger` class exists in-repo, so the token fix stands alone.

### MEDIUM (33)

**Design-language**
- **Hardcoded hex/rgba duplicates semantic/brand tokens (won't flip in light)** — guest banner, recovery modal, annotator, offline dot, convert-fail, deploy status, destructive-SQL confirm, status down-dot, blog thumbs — `GuestBanner.tsx:63,64,74` (`rgba(240,180,41)/#f0b429` instead of `--conf-medium`; icon 1.68:1 in light where the "temporary guest" warning lives), `DeployButton.tsx:397-403` (`rgba(80,200,120)/rgba(220,90,90)` instead of `--conf-high-bg/--conf-low-bg`), `DatabasesView.tsx:506` (`rgba(239,68,68,0.10)` == `--conf-low-bg` exactly), `globals.css:9783` (`.status-dot.down #ff6b6b` while siblings tokenize), `9589-9592` (blog thumb stops == `--mk-*`). Fix: drive from `--conf-*`/`--mk-*` tokens (color-mix for tints).
- **var() fallbacks encode wrong-brand violet or stale hex** — chat, coachmark, checkpoints diff, todo, provider-keys — `ChatPanel.tsx:857,1134,1177` (`var(--accent, #a78bfa)` violet fallback; `1023-1052,2038` stale `--conf-*`/`--brand-magenta` hex), `globals.css:1851-1852,2227` (`--brand-purple, #7c3aed` / `.tasks-inline-active #a78bfa`, Tailwind violets), `CheckpointsModal.tsx:352`, `TodoList.tsx:69` — latent drift; a dropped cascade would flash banned violet. Fix: prefer bare `var(--token)`; if kept, mirror exact token hex; never seed `#a78bfa`/`#7c3aed`.
- **Undefined tokens make off-brand fallbacks actually render** — workspace/preview live dots + canvas — `EditorPreviewArea.tsx:389` (`var(--danger, #d9534f)`; `--danger` undefined so #d9534f paints), `AgentPreviewPanel.tsx:476,550,558` (`--bg-deep`/`--text-default`/`--danger` all undefined), `Workspace.tsx:1318` — off-brand error red + surfaces that never flip in light. Fix: `--danger`→`--conf-low`, `--bg-deep`→`--bg-code`, `--text-default`→`--text-primary`.
- **Semantic color misuse: amber (warn) for hard errors/deletions** — preview error badge/overlay, activity diff header, route-error icons — `PreviewPanel.tsx:973,1038,1227` (runtime-error count/kind/"Preview unavailable" use `--conf-medium` while `TerminalPanel` maps stderr→`--conf-low`), `ActivityMonitor.tsx:98-99` (removed-count amber while diff body is red at `globals.css:10031`), `globals.css:4183,4248` (error-fallback/route-error svg amber while the `<pre>` is red) — amber under-reads genuine errors as caution. Fix: use `--conf-low` for hard-error/deletion signals; keep amber only for transient states.
- **Off-brand gradient-text: pink→blue instead of purple→magenta; scalpel diluted** — marketing heroes + stat grids — `globals.css:8817` (`.mk-hero h1 .grad` pink→blue `#ff4d97→#5b8bff`, 14 pages) & `8993` (`.stat .num` same), `7108-7113` (dead duplicate rule), `workspaces/page.tsx:9-14` + `enterprise/page.tsx:162-167` (qualitative phrases like "Sub-second"/"WorkOS" fed through the numeric `.stat .num` gradient) — reintroduces a competing blue and dilutes the one-brand-moment discipline. Fix: point at `var(--brand-gradient)` (drop the blue stop); reserve the gradient for genuine numeric metrics; delete the dead rule.

**Accessibility**
- **Partial ARIA menu/tab widgets without the required keyboard pattern** — Explore nav, file-explorer context menu, model flyout, dashboard mode tabs, Design Systems tabs — `NavExploreMenu.tsx:55` (+`Popover.tsx:64-84` only Esc/outside-click), `FileExplorer.tsx:784-850` (no focus-in/arrows), `ModelPicker.tsx:205-218` (`role=menu` but `<button>` children lack `role=menuitem`), `ProjectPicker.tsx:1255-1272,1496-1531` and `DesignSystemsView.tsx:519-524` (`role=tablist` with no arrows/`aria-controls`/tabpanel) — the advertised ARIA contract is broken (operable via Tab, so conformance/polish). Fix: complete the pattern (roving tabindex + arrows + focus-in/return + tabpanel wiring, per `ProjectActionsMenu.tsx:2234-2260`/`Workspace.tsx:164-171`) OR downgrade to a disclosure/`aria-pressed` toggle group.
- **Status/meaning by color alone** — agent-preview filmstrip, guest errors, budget meter, DS preview dots — `AgentPreviewPanel.tsx:573-583` (pass/fail = thumbnail border color only, `ok` at `:211`), `GuestLoginActions.tsx:246-257` (error = red text only), `DesignSystemPreview.tsx:114-115` (decorative color-only spans), `OrgUsageView.tsx:113-116` (redundancy gap) — WCAG 1.4.1. Fix: add sr-only "passed"/"failed" + ✗ overlay on thumbnails, an alert icon/bold lead on guest errors, `aria-hidden` on the preview dots.
- **Settings page has no `<main>` landmark and no skip link** — Settings (all sections) — `SettingsView.tsx:229-244` (returns a fragment; layout renders children straight into `<body>`; no skip link anywhere in `apps/web`; other routes wrap in `<main>` at `page.tsx:50`, `login:18`, `ProjectPicker:1200`) — WCAG 1.3.1/2.4.1; SR/keyboard users must tab through the topnav every visit. Fix: wrap in `<main id="main">` + add a visually-hidden skip link in the layout.
- **Tooltip has no Escape-to-dismiss** — shared Tooltip primitive — `Tooltip.tsx:35-57` (opens on hover/focus, closes only on mouseleave/blur; renders via Popover without `onRequestClose`, so Popover's Esc path at `Popover.tsx:65,74-76` never fires) — WCAG 1.4.13 (dismissible) unmet for every tooltip. Fix: add an Escape keydown handler calling `setOpen(false)` (keep focus on trigger), or pass `onRequestClose`.

**Behavioral-ux**
- **"Coming soon" dead-stub upgrade affordance in the dashboard usage card** — sidebar usage card — `ProjectPicker.tsx:1194-1196` (button-shaped, tinted, non-interactive "More on Pro — coming soon", `.upgrade` is `cursor:default` at `globals.css:4587/4599`) over a bare "Plan: Free / Projects: N" quota readout (`:1185-1193`) — the "coming soon" band-aid CLAUDE.md forbids, plus raw-quota (not value) framing. Fix: remove the faux-button until Pro ships; when it exists, surface a value-framed nudge at the real gate ("this next build needs a second workspace").

**Correctness-state**
- **Load-failure errors collapse into empty/blank states with no error affordance or retry** — Tasks, Comments, Settings integrations, Custom prompts — `TasksView.tsx:79-82,283-295` and `CommentsView.tsx:53-56,205-217` (catch→toast then `setList([])`→renders true-empty copy; after the toast dismisses, data looks gone), `SettingsView.tsx:137,141,145` (failed status fetch coerced to a disconnected object → looks like "Not connected"), **`CustomPromptsCard.tsx:52,108-113,213-215`** (only `loading` branched; on `error` it falls through to a blank editable form — typing + Save sends the empty diff and **overwrites the real server-side prompt/skills that failed to load**, data-loss). Fix: track a distinct error state with a `--conf-low` block + Retry; for CustomPromptsCard add an `error` branch keeping editors hidden/disabled until load succeeds.
- **Org/project member removal is instant and irreversible, no confirm or in-flight guard** — Org/Project Members — `OrgMembersView.tsx:81-89,241-251` (`onClick={() => void remove(member)}` → `removeOrgMemberApi` directly, no confirm, no disabled guard; busy exists only for invite), `MembersView.tsx:255` (identical) — a misclick silently revokes a teammate's access, inconsistent with the two-step confirm the same feature uses for leave/delete (`OrgSettingsView.tsx:281-320`). Fix: add the inline two-step confirm (or confirm/undo toast) and disable the control while a mutation is in flight.
- **A $0 monthly cap renders self-contradictory budget controls** — Org Usage / Org Settings budget — `OrgUsageView.tsx:37-42,92,120-124` (`pct` gates on `budget_usd > 0` so `0`→pct=null→"∞ / No enforced ceiling" with meter hidden, while status/enforcement gate on `== null` so `0`≠null shows a $0.00 cap + "Runs pause at cap"; `saveBudget` at `OrgSettingsView.tsx:81` only rejects `<0`, so $0 is savable) — contradictory spend-control state, undermining trust. Fix: use `budget_usd == null` as the single "uncapped" test everywhere, OR reject 0 in `saveBudget`.

### LOW (37)

**Design-language**
- **Green "live" status-dot halo reused as a decorative bullet on static marketing eyebrows** — 5 marketing hero eyebrows — `globals.css:8855-8858` (`.mk-eyebrow .dot` `--mk-green` halo before Pricing/Models/Workspaces/etc., none "live"; always beside a text label so not an a11y issue) — dilutes the status-dot convention. Fix: use `--mk-dim`/a non-semantic marker; reserve the green halo for truly operational surfaces.
- *(Additional low-severity design-language items — remaining hardcoded-hex/dead-fallback/violet-fallback instances within the themes above, ~15 total — share the fix guidance in their parent MEDIUM themes: prefer bare `var(--token)`, mirror exact token hex, never seed violet.)*

**Accessibility**
- **Touch targets below the 24px AA minimum (WCAG 2.5.8)** — marketing/landing composer, chat attachments, recovery-code toggle, chat-session buttons — `globals.css:2452-2457` (attachment remove × = 18×18px, no coarse-pointer bump; shared by landing + chat), `GuestLoginActions.tsx:195-202` ("Have a recovery code?" ~15px, `.btn-ghost` absent from the coarse rule at `8422-8443`), `ChatSessionDropdown.tsx:235-250` (`.icon-btn-xs` ~14-16px, only 36px on coarse). Fix: enlarge each hit area to ≥24px (ideally 44px) via min-width/height + transparent inset padding; add `.attachment-chip button`/`.btn-ghost`/`.icon-btn-xs` to the `@media (pointer:coarse)` rule, bumping the coarse min to 44px.
- **Error toast double-announced** — Toaster — `Toaster.tsx:17,41` (`role=alert` nested inside `aria-live=polite`) — SRs announce twice. Fix: use one live mechanism (drop the wrapper `aria-live` OR the per-row roles).
- *(Remaining low-severity a11y items — additional heading/landmark/color-only nits within the MEDIUM themes above — follow the same fixes.)*

**Behavioral-ux**
- **Delete-database confirm leaves the primary action silently inert with no in-context reason** — Databases → Delete this database? — `DatabasesView.tsx:551-558` (`disabled={actionBusy || deleteText !== name}` type-to-match), input `577-582` has no live "names don't match" helper and no `aria-describedby` — a trailing-space/case slip leaves the button silently dead, reading as broken. Fix: add a field hint once typed and/or `aria-describedby`; trim whitespace before comparing. (Good anti-footgun gate otherwise — not a dark pattern.)

**Correctness-state**
- **Async loading states are bare text, not layout-matched skeletons** — Tasks, Comments, Settings integrations, Custom prompts — `TasksView.tsx:281-282`/`CommentsView.tsx:203-204` ("Loading…" then jump to a full row list → layout shift), `SettingsView.tsx:300,348,394` ("checking…"), `CustomPromptsCard.tsx:111` ("loading…") — the design's "skeletons that match the layout" gap. Fix: 2–3 hairline-divided `.skeleton` rows sized like the real row.
- **Dead hero-aurora markup renders nothing** — marketing home — `page.tsx:52-56` (`.hero-aurora`/`.glow-*` spans; 0 CSS matches in `globals.css`) — the documented ambient brand glow is wired into JSX but produces nothing (aria-hidden, so no a11y harm). Fix: add the CSS or remove the dead markup.
- **Preview `<iframe>` has no `sandbox` attribute** — Preview stage — `PreviewPanel.tsx:1180-1192` (no `sandbox` though comments at `613-617` treat the framed app as untrusted; content is cross-origin so same-origin DOM is already blocked) — defense-in-depth only. Fix: consider `sandbox="allow-scripts allow-forms allow-same-origin allow-popups"` tuned to the injected picker/nav script; verify the picker still works.
- **Templates category grids have no empty-state guard or line-clamp** — Templates gallery — `templates/page.tsx:43-78` (no zero-length fallback → bare heading over empty grid), `globals.css:9395-9396` (`.template-body h3/p` no `-webkit-line-clamp`) — low today (static curated catalog); risk only for a future emptied category/overlong copy. Fix: add an empty guard + line-clamp for resilience.
- *(Remaining low-severity correctness items covered by the two themes above.)*

---

## 3. Themes (recurring cross-surface issues)

1. **Correct primitive, violated nearby (the master theme).** Nearly every finding has a right-way example in the same repo. Modal (`Modal.tsx`) vs hand-rolled `FileExplorer` delete; `:focus-within` ring (`.composer-field`) vs the un-ringed hero; `role=alert` (`GuestBanner:151`) vs the un-announced convert banner; `.send-btn:disabled` flat fill vs `.hp-send` faded gradient; roving-focus menus vs partial-ARIA menus. **Systemic fix:** promote the correct implementations to the shared layer and route violators through them; add lint/CI guards (`c3a2` mojibake grep; a "no emoji in JSX/icon strings" check; a "no half-pixel in globals.css" check). Surfaces: nearly all.

2. **Token discipline breakdown.** Half-pixel sizes bypass `--fs-*` (~59 rules + inline); hardcoded hex/rgba duplicate `--conf-*`/`--mk-*`; `var()` fallbacks encode wrong-brand violet or stale hex; three tokens (`--danger`/`--bg-deep`/`--text-default`) are undefined so off-brand fallbacks paint. **Systemic fix:** bare `var(--token)`, migrate inline numbers to tokens, define or replace the three undefined tokens, and mirror exact hex where a fallback is kept. Surfaces: globals.css app-wide, chat, preview, workspace, marketing.

3. **Semantic color inversions.** Magenta leaks onto warn/dirty states; amber under-reads hard errors; green paints a destructive confirm; purple signals "act on me". **Systemic fix:** enforce the palette contract — magenta=active/focus, `--conf-low`=error/delete, `--conf-medium`=transient warn, purple=structure. Surfaces: editor tabs, preview, activity monitor, Design Systems delete, coachmarks/plan cards/resize handles.

4. **Contrast + light-theme parity.** `--text-dim`/`--mk-dim`/magenta-as-text fail AA in dark; the light theme never re-declares marketing accents or several `--conf-*`, dropping status/badges/tints below AA. **Systemic fix:** raise the token values on their lightest surface, add the missing `:root[data-theme="light"]` overrides, and audit the full token set for dark-only tokens consumed as light text. Surfaces: in-app dark, all marketing, /status, changelog.

5. **Assistive-tech invisibility.** Streaming output and errors aren't announced; controls lack names; ARIA roles are declared without their keyboard pattern; no `<main>`/skip link; tooltips aren't dismissible. **Systemic fix:** a live-region + accessible-name pass keyed off the existing correct patterns. Surfaces: chat, agent preview, guest login, settings, all tooltips/menus.

6. **Honesty gaps against the "trust" wedge.** Marketing sells billing/proration and a Settings billing surface that don't exist; the dashboard shows a "coming soon" faux-button; garbled/filler copy. **Systemic fix:** make copy match capability now (waitlist CTAs, remove billing claims), remove dead stubs, and add the self-serve cancel when billing lands. Surfaces: pricing, support, community, dashboard usage card, login, templates.

---

## 4. Quick wins (cheap, high-leverage)

- Give `.hp-send:disabled` a flat fill (`globals.css:7284`) — kills the "broken" gradient on the top conversion CTA. One rule.
- Fix the green "Confirm delete" → `var(--conf-low)` (`DesignSystemsView.tsx:893`) — one token, removes a genuinely dangerous inversion.
- Dirty-dot magenta → `var(--conf-medium)` (`EditorPreviewArea.tsx:312`) — restores the accent contract.
- Add `role="log"`+`aria-live="polite"` to the chat conversation container (`ChatPanel.tsx:842`) — unblocks the app's core output for screen readers.
- Remove the "More on Pro — coming soon" faux-button (`ProjectPicker.tsx:1194-1196`) — deletes a forbidden band-aid.
- Re-save `templates.tsx` as clean UTF-8 (replace `c3a2` mojibake) + add a CI grep — fixes visible garbled copy.
- Add `:focus-visible{outline:2px solid var(--brand-magenta)}` to the hero/bottom composer (`globals.css:7179,8148`) and `button:focus-visible` to `global-error.tsx` — closes a CRITICAL focus-ring gap.
- Wrap Settings in `<main id="main">` + add one visually-hidden skip link in the layout — landmark for the whole app.
- Delete the dead `#a78bfa` fallback (`globals.css:2227`), the dead duplicate `.grad` rule (`7108-7113`), and the dead `.soon` CSS (`5203-5215`).
- Add an `error` branch to `CustomPromptsCard` (`:108-113`) keeping editors disabled on failed load — prevents silently overwriting server prompts.
- Trim whitespace before the delete-database name compare (`DatabasesView.tsx:551`) — removes a "silently dead button" footgun.

---

## 5. What the app does well

Grounded in the findings' own positives:

- **A real, mostly-honored design system.** The `--fs-*` type ramp, `--conf-*` semantic scale, and the magenta-active / purple-structure palette rule exist and are documented — and the dashboard hero, `.send-btn:disabled`, `TerminalPanel` stderr mapping, and the activity-diff body all follow them correctly.
- **Correct accessibility patterns already shipped.** `Modal.tsx` implements the full dialog pattern (role, aria-modal, Esc, focus trap, initial focus, restore) and is reused for the stop-dev-server confirm; `:focus-within` rings exist (`.dash-hero .newproj-form`, `.composer-field`); `role=alert` is used on the guest banner and the in-form guest error; roving-focus menus are implemented in `ProjectActionsMenu` and `Workspace.tsx`. The violations are drift *away* from these, not their absence.
- **Deliberate anti-footgun destructive flows.** The delete-database type-to-match gate and the org leave/delete two-step confirm are genuine protective patterns (explicitly *not* dark patterns) — the gaps are consistency (other deletes should adopt them) and legibility, not intent.
- **Redundant status cues where they were added.** The over-cap budget alert renders an explanatory text status alongside the meter tone; the `budget_usd == null` "uncapped" checks are correct in most of the view — the auditor's broader "uncapped/monitoring-only" claims were verified FALSE, leaving only the narrow $0 edge case.
- **Correctly scoped decorative markup.** Dead/orphaned decorative elements (hero-aurora, DS preview dots) are `aria-hidden`, so they're craft/dead-code gaps rather than accessibility harms.
- **Curated, intentional content.** The templates gallery's repeated cards are a legitimate hand-curated collection, correctly distinguished from the banned identical-card row pattern.