# Live-browser findings — public marketing surface (app.uniqus-code.com)

Method: Playwright (msedge), 17 public pages × {desktop 1440, mobile 390},
full-page screenshots in `shots/`, axe-core 4.10 (wcag2a/aa + best-practice),
plus custom probes (overflow, focus, labels, headings). Raw data: `results.json`.

## Verified issues

### A. Color contrast below WCAG 1.4.3 AA (computed ratios) — RECURRING, highest-value
Small mono eyebrows/captions and magenta text fall under 4.5:1 on the deep backgrounds:
- home `.console-head > strong` "thinking: high" — **#B21E7D magenta on #07080d, 11px → 3.21:1**
- home `.label-eyebrow` "Trust and control" — **#716d66 (--mk-dim) on #07080d, 11px → 3.88:1**
- pricing `.price-card .per` "forever" / "talk to us" — **#716d66 on #07080d, 13px → 3.88:1**
- login `.footer` legal line — **#7c7a72 (--text-dim) on #15161f, 11px → 4.18:1**
Note: globals.css comments claim --text-dim was lifted to "~4.6:1 on the dark
surfaces", but on the *raised* #15161f surface it computes 4.18, and --mk-dim
(#716d66) eyebrows were never lifted. Magenta as small TEXT (vs. as a fill/border)
is only ~3.2:1 on near-black. Fix: lift --mk-dim + guarantee --text-dim clears
4.5:1 on the lightest surface it's used on; don't use magenta for <18px text.

### B. Heading order / structure (WCAG 1.3.1, moderate)
- models, changelog, blog: an `<h3>` follows the `<h1>` with no `<h2>` (level skip).
- status: **no `<h1>` on the page at all** (page-has-heading-one).

### C. Turnstile widget renders light on the dark sign-in card (verified in code)
Turnstile.tsx:93-100 calls `window.turnstile.render()` with sitekey/action/callbacks
but **no `theme`** → Cloudflare defaults to "auto" (OS prefers-color-scheme). The
sign-in card is always dark, so a light-OS visitor sees a bright white widget box.
Fix: pass `theme: "dark"`.

## Inconclusive / dropped (honesty)
- Focus-visibility probe is UNRELIABLE: programmatic `el.focus()` does not trigger
  `:focus-visible` in Chromium, so "N/24 without visible focus" (0 on templates/
  changelog/docs, up to 7 on contact) mostly reflects correct `:focus-visible` use,
  not a violation. Real keyboard-focus verdict deferred to the CSS code audit.
- "Unlabeled type=file input" on every page is a FALSE POSITIVE: LandingPrompt.tsx:216
  is `<input type="file" multiple hidden>` — the `hidden` attribute removes it from
  the a11y tree/tab order; it's the standard hidden-input-triggered-by-labeled-button
  pattern. Dropped.

## Positives observed live
- No horizontal overflow at 390px on any page; mobile reflow is clean.
- Every page has lang="en", a real <title>, data-theme set before paint (no flash).
- Home/pricing follow the house language well: purple→magenta hero+CTA pair, glassy
  composer, asymmetric sections, one gradient moment; pricing uses an anchored
  "Most popular" middle tier (compromise + anchoring, not a decoy) per the behavioral doc.
