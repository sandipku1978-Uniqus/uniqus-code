// Live UI/UX + a11y audit of the public marketing surface at app.uniqus-code.com
// Playwright (msedge channel per CLAUDE.md) + axe-core (injected from CDN).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('notes/ui-ux-audit-2026-07-12');
const SHOTS = path.join(OUT, 'shots');
const BASE = 'https://app.uniqus-code.com';
const AXE_URL = 'https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js';

const PAGES = [
  ['home', '/'],
  ['pricing', '/pricing'],
  ['models', '/models'],
  ['workspaces', '/workspaces'],
  ['templates', '/templates'],
  ['changelog', '/changelog'],
  ['about', '/about'],
  ['enterprise', '/enterprise'],
  ['careers', '/careers'],
  ['blog', '/blog'],
  ['contact', '/contact'],
  ['docs', '/docs'],
  ['security', '/security'],
  ['support', '/support'],
  ['community', '/community'],
  ['status', '/status'],
  ['login', '/login'],
];

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

async function launch() {
  try {
    return await chromium.launch({ channel: 'msedge', headless: true });
  } catch (e) {
    console.error('msedge unavailable, falling back to bundled chromium:', e.message);
    return await chromium.launch({ headless: true });
  }
}

async function runAxe(page) {
  try {
    await page.addScriptTag({ url: AXE_URL });
    // wait for axe global
    await page.waitForFunction(() => typeof window.axe !== 'undefined', { timeout: 15000 });
    const res = await page.evaluate(async () => {
      const r = await window.axe.run(document, {
        resultTypes: ['violations'],
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
      });
      return r.violations.map(v => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        helpUrl: v.helpUrl,
        count: v.nodes.length,
        samples: v.nodes.slice(0, 4).map(n => ({
          target: n.target,
          html: (n.html || '').slice(0, 240),
          failureSummary: (n.failureSummary || '').slice(0, 400),
        })),
      }));
    });
    return res;
  } catch (e) {
    return [{ id: 'axe-error', impact: 'n/a', help: e.message, count: 0, samples: [] }];
  }
}

async function probe(page) {
  return await page.evaluate(() => {
    const out = {};
    const doc = document.scrollingElement || document.documentElement;
    out.scrollWidth = doc.scrollWidth;
    out.clientWidth = doc.clientWidth;
    out.innerWidth = window.innerWidth;
    out.horizontalOverflow = doc.scrollWidth - window.innerWidth;

    // elements overflowing viewport width
    const overflowers = [];
    document.querySelectorAll('*').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > window.innerWidth + 2) {
        overflowers.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className && el.className.toString ? el.className.toString() : '').slice(0, 80),
          right: Math.round(r.right),
          width: Math.round(r.width),
        });
      }
    });
    out.overflowers = overflowers.slice(0, 8);

    // images without alt
    out.imgsNoAlt = [...document.querySelectorAll('img')]
      .filter(i => !i.hasAttribute('alt'))
      .map(i => (i.getAttribute('src') || '').slice(0, 100)).slice(0, 10);
    out.imgCount = document.querySelectorAll('img').length;

    // buttons/links with no accessible text
    const noName = [];
    document.querySelectorAll('button, a').forEach(el => {
      const txt = (el.textContent || '').trim();
      const aria = el.getAttribute('aria-label') || el.getAttribute('title');
      const hasImgAlt = [...el.querySelectorAll('img')].some(i => (i.getAttribute('alt') || '').trim());
      const hasSvgTitle = !!el.querySelector('svg title, svg[aria-label]');
      if (!txt && !aria && !hasImgAlt && !hasSvgTitle) {
        noName.push({ tag: el.tagName.toLowerCase(), cls: (el.className && el.className.toString ? el.className.toString() : '').slice(0, 60), html: el.outerHTML.slice(0, 120) });
      }
    });
    out.controlsNoAccessibleName = noName.slice(0, 12);

    // heading outline
    out.headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
      .map(h => ({ level: +h.tagName[1], text: (h.textContent || '').trim().slice(0, 60) }));
    out.h1Count = document.querySelectorAll('h1').length;

    // form fields without associated label
    const unlabeled = [];
    document.querySelectorAll('input, textarea, select').forEach(el => {
      if (el.type === 'hidden') return;
      const id = el.id;
      const hasLabel = id && document.querySelector(`label[for="${CSS.escape(id)}"]`);
      const aria = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
      const ph = el.getAttribute('placeholder');
      const wrappedLabel = el.closest('label');
      if (!hasLabel && !aria && !wrappedLabel) {
        unlabeled.push({ type: el.type || el.tagName.toLowerCase(), placeholder: ph, name: el.getAttribute('name') });
      }
    });
    out.unlabeledFields = unlabeled.slice(0, 10);

    // lang attribute
    out.htmlLang = document.documentElement.getAttribute('lang');
    // page title
    out.title = document.title;
    return out;
  });
}

async function focusProbe(page) {
  // Tab through and record whether a visible focus indicator exists.
  return await page.evaluate(async () => {
    const results = [];
    const focusables = [...document.querySelectorAll(
      'a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])'
    )].filter(el => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
    }).slice(0, 24);
    for (const el of focusables) {
      el.focus();
      const st = getComputedStyle(el);
      const outlineW = parseFloat(st.outlineWidth) || 0;
      const hasOutline = outlineW > 0 && st.outlineStyle !== 'none';
      const hasBoxShadow = st.boxShadow && st.boxShadow !== 'none';
      results.push({
        tag: el.tagName.toLowerCase(),
        label: ((el.textContent || el.getAttribute('aria-label') || '').trim()).slice(0, 40),
        outline: hasOutline ? `${st.outlineWidth} ${st.outlineStyle} ${st.outlineColor}` : 'none',
        boxShadow: hasBoxShadow ? st.boxShadow.slice(0, 60) : 'none',
        visibleFocus: hasOutline || hasBoxShadow,
      });
    }
    const noFocus = results.filter(r => !r.visibleFocus);
    return { total: results.length, noVisibleFocus: noFocus.length, samples: noFocus.slice(0, 10) };
  });
}

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const results = {};

  for (const [name, route] of PAGES) {
    const url = BASE + route;
    const rec = { url };
    console.log('AUDIT', name, url);
    try {
      await page.setViewportSize(DESKTOP);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch(async () => {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(SHOTS, `${name}-desktop.png`), fullPage: true }).catch(e => rec.shotErr = e.message);
      rec.probe = await probe(page);
      rec.focus = await focusProbe(page);
      rec.axe = await runAxe(page);

      // mobile
      await page.setViewportSize(MOBILE);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(900);
      await page.screenshot({ path: path.join(SHOTS, `${name}-mobile.png`), fullPage: true }).catch(e => rec.shotErrM = e.message);
      rec.mobileProbe = await page.evaluate(() => {
        const doc = document.scrollingElement || document.documentElement;
        const overflowers = [];
        document.querySelectorAll('*').forEach(el => {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.right > window.innerWidth + 2) {
            overflowers.push({ tag: el.tagName.toLowerCase(), cls: (el.className && el.className.toString ? el.className.toString() : '').slice(0, 70), right: Math.round(r.right) });
          }
        });
        return { horizontalOverflow: doc.scrollWidth - window.innerWidth, overflowers: overflowers.slice(0, 6) };
      });
    } catch (e) {
      rec.error = e.message;
    }
    results[name] = rec;
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  }

  await browser.close();
  console.log('DONE. Pages audited:', Object.keys(results).length);
})();
