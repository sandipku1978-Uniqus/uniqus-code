# WorkOS AuthKit branding — Gate 15 split view

Paste-ready config for the AuthKit branding editor (Dashboard → Branding).
Matches the Gate 15 tokens in `apps/web/app/globals.css` and the local mock in
`notes/auth-split-view.html`.

Doc-verified 2026-07-13 against workos.com/docs/authkit/branding.

## Why this is not code in the repo

The app uses **hosted AuthKit** — `app/login/page.tsx` calls `getSignInUrl()` and
redirects to WorkOS's own origin. The sign-in form is served by WorkOS, so it is not
restyleable from this codebase. The only levers are the dashboard settings and the
custom HTML/CSS below. (`app/login/page.tsx` — our interstitial card with the guest
option — *is* ours, and is styled by `globals.css` like any other page.)

## ⚠ Ordering — do this first

The custom HTML references the logo by **absolute URL** on the production origin. The
sanitizer's allowed-tag list is undocumented beyond what it blocks, and inline `<svg>`
and `data:` URIs are **not** documented as supported — so do not rely on either. That
means:

1. **Deploy `main` to Vercel first**, so `https://app.gate15.dev/brand/gate15-mark.png`
   actually resolves. Confirm by opening that URL in a browser.
2. *Then* paste the HTML below into the branding editor.

Backwards, and you leave a broken image on the live sign-in page.

**Check the existing config now, too.** The previous version of this note pointed the
logo at `https://app.uniqus-code.com/brand/uniqus-small-logo-color.png`, and production
has since migrated to `gate15.dev` (commit `1c359b2`). If the dashboard still holds that
old URL, the logo on the hosted sign-in page is **already broken today** —
independently of this rebrand. `apps/web/public/brand/uniqus-small-logo-color.png` is
deliberately kept on disk for that reason; don't delete it until the dashboard is
repointed.

## Sanitizer rules (from the docs)

Blocked: `<script>`, `<iframe>`, `<form>`, `<object>`, `<style>`, and inline event
handlers. Plain markup only. Custom CSS is auto-scoped by WorkOS via CSS nesting — it
wraps your selectors in `:where([data-hak-custom-html])` — so unprefixed class selectors
are safe and cannot leak into the form panel.

## 1) Dashboard checklist (no code)

1. **Page settings → Layout: Split**, secondary panel on the **left**, "hide on mobile"
   ON (the panel copy isn't localized, and phones should land straight on the form).
2. **Font family:** `Archivo` (Google Fonts picker). This is the single biggest thing
   that makes the hosted page feel like the app — don't leave it on DM Sans.
3. **Corner radius:** `6` — machined; matches `--radius-md`.
4. **Colors — dark:**

   | field | value |
   |---|---|
   | page background | `#0A0B0C` |
   | button background | `#FF6A00` |
   | button text | `#140D07` |
   | links | `#FF8124` |

5. **Colors — light:**

   | field | value |
   |---|---|
   | page background | `#EFEEEC` |
   | button background | `#FF6A00` |
   | button text | `#140D07` |
   | links | `#B23F0A` |

   **Button text is near-black, not white — that is deliberate.** White on ember
   `#FF6A00` is ~2.9:1 and fails WCAG AA. Near-black on ember is ~9:1, and
   black-on-orange is also the correct industrial read. Likewise links darken to rust on
   the light theme, because raw ember on a near-white page fails AA.
6. **Assets:** upload `apps/web/public/brand/gate15-mark.png` as both the logo icon and
   the favicon (logo ≥160×160, favicon ≥32×32).
7. **Terms / privacy links** in Page settings → `https://gate15.dev`.

## 2) Secondary panel — custom HTML

Plain markup only (see sanitizer rules above).

```html
<div class="g15-brand">
  <p class="g15-lockup">
    <img class="g15-mark" src="https://app.gate15.dev/brand/gate15-mark.png" alt="" />
    <span class="g15-name">GATE</span><span class="g15-num">15</span>
  </p>

  <div class="g15-copy">
    <p class="g15-eyebrow"><span class="g15-dot"></span> Private beta for serious builders</p>
    <h1 class="g15-headline">Build with <span class="g15-grad">the AI you trust</span>.</h1>
    <p class="g15-lede">
      Describe what you want, pick the AI for each step — Claude, GPT, or Gemini —
      and watch your app come to life with a live preview.
    </p>
    <ul class="g15-points">
      <li><span class="g15-tick">✓</span> <strong>Private, isolated VMs</strong> — every project in its own secure space</li>
      <li><span class="g15-tick">✓</span> <strong>Your choice of model</strong> — Claude, GPT, and Gemini, per turn</li>
      <li><span class="g15-tick">✓</span> <strong>Real apps, live preview</strong> — deploy when you're ready</li>
    </ul>
  </div>

  <p class="g15-foot">SOC 2-aligned · Private VMs · You own the code</p>
</div>
```

## 3) Secondary panel — custom CSS

Use `light-dark()` only for color values. It does not portably accept whole gradients,
which makes the declaration invalid in some Chromium-family browsers. WorkOS does not
support `prefers-color-scheme` media queries in this editor, so gradients use its
`.light-theme` and `.dark-theme` selectors instead. The hazard rule along the top edge
is the one brand flourish; everything else is type and space.

```css
.g15-brand {
  --g15-ember: #FF7700;
  --g15-signal: #FFCF3D;
  --g15-ink: light-dark(#17181A, #EDEBE7);
  --g15-muted: light-dark(#52555A, #9A9793);
  --g15-dim: light-dark(#6B6E73, #7C7A76);
  --g15-line: light-dark(rgba(23, 24, 26, 0.12), rgba(255, 255, 255, 0.10));
  /* orange TEXT must darken to rust on a light page to clear WCAG AA */
  --g15-accent-text: light-dark(#A04009, #FF8C24);

  position: relative;
  display: flex;
  flex-direction: column;
  gap: 40px;
  min-height: 100%;
  padding: 56px 48px;
  box-sizing: border-box;
  font-family: Archivo, ui-sans-serif, system-ui, sans-serif;
  color: var(--g15-ink);

  .light-theme & {
    background:
      radial-gradient(120% 90% at 12% 100%, rgba(255, 119, 0, 0.10), transparent 62%),
      linear-gradient(160deg, #F5F4F2 0%, #E7E5E2 100%);
  }

  .dark-theme & {
    background:
      radial-gradient(120% 90% at 12% 100%, rgba(255, 119, 0, 0.14), transparent 62%),
      linear-gradient(160deg, #16181B 0%, #0F1113 100%);
  }
}

/* Hazard rule — the one flourish. Keep it to this single edge. */
.g15-brand::before {
  content: "";
  position: absolute;
  inset: 0 0 auto 0;
  height: 3px;
  background: repeating-linear-gradient(45deg,
    var(--g15-ember) 0 8px, transparent 8px 16px);
  opacity: 0.9;
}

/* ── Lockup ─────────────────────────────────────────────────────────────── */
.g15-lockup {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.g15-mark { width: 26px; height: 26px; border-radius: 5px; display: block; }
.g15-name { color: var(--g15-ink); }
/* rust on light — raw ember at 19px/700 is only ~2.9:1 on the concrete panel */
.g15-num { color: var(--g15-accent-text); }

/* ── Copy ───────────────────────────────────────────────────────────────── */
.g15-copy { display: flex; flex-direction: column; gap: 18px; }

.g15-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  align-self: flex-start;
  margin: 0;
  padding: 5px 11px;
  border: 1px solid var(--g15-line);
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--g15-muted);
}
.g15-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--g15-ember);
  box-shadow: 0 0 0 3px rgba(255, 119, 0, 0.18);
}

.g15-headline {
  margin: 0;
  font-size: 40px;
  line-height: 1.1;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.g15-grad {
  /* The signal-yellow stop is ~1.7:1 on the light panel — illegible. On light,
     run the gradient rust → deep-ember instead so every stop clears 3:1. */
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;

  .light-theme & {
    background-image: linear-gradient(135deg, #A04009, #D25A0C);
  }

  .dark-theme & {
    background-image: linear-gradient(135deg, #FF651F, #FFCF3D);
  }
}

.g15-lede {
  margin: 0;
  max-width: 42ch;
  font-size: 15px;
  line-height: 1.6;
  color: var(--g15-muted);
}

.g15-points {
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 14px;
  line-height: 1.5;
  color: var(--g15-muted);
}
.g15-points li { display: flex; gap: 10px; align-items: baseline; }
.g15-points strong { color: var(--g15-ink); font-weight: 600; }
.g15-tick { color: var(--g15-accent-text); font-weight: 700; }

/* ── Foot ───────────────────────────────────────────────────────────────── */
.g15-foot {
  margin: auto 0 0;
  padding-top: 20px;
  border-top: 1px solid var(--g15-line);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--g15-dim);
}

@media (max-height: 720px) {
  .g15-brand { gap: 26px; padding: 36px 40px; }
  .g15-headline { font-size: 32px; }
  .g15-points { gap: 9px; }
}
```

## 4) Optional — photographic atmosphere

The repo generates `apps/web/public/brand/atmos-auth.png` (an abstract 3:4 plate: cold
steel haze, one sodium light source). To use it as the panel background instead of the
CSS gradient, add this **after** the `.g15-brand` rule:

```css
.g15-brand {
  background:
    linear-gradient(160deg, rgba(8, 9, 10, 0.82), rgba(8, 9, 10, 0.62)),
    url("https://app.gate15.dev/brand/atmos-auth.png") center / cover no-repeat,
    #08090A;
}
```

Two caveats. It is **dark-only** — over the light theme's near-white page it will fight
the form panel, so only do this if you also pin the panel text to the dark ramp. And it
depends on WorkOS's CSP allowing an external image in custom CSS, which the docs don't
state; the `<img>` logo suggests external images are fine, but **verify on staging
before shipping**. The pure-CSS gradient in §3 is the safe default.

## 5) Verify

Open the hosted sign-in page in both OS colour schemes and check:

- the logo renders (not a broken-image icon) — this is the #1 failure mode;
- the primary button reads **near-black on orange**, not white on orange;
- links are legible in light mode (rust, not raw ember);
- the font is Archivo, not a fallback.
