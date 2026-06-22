import { chromium, type Page } from "playwright";
import { persistScreenshot, resolvePreviewUrl } from "./screenshot.js";

/**
 * `interact_preview` (P2.1/P2.2) — the agent operates the running preview like a
 * user: navigate / click / type / select / scroll / wait / assert, then capture
 * the resulting state + a screenshot. Reuses the headless-Chromium plumbing from
 * screenshot.ts (same launch + preview-URL resolution), and additionally
 * collects the evidence the screenshot path never did: console errors, failed
 * network requests, assertion outcomes, and a lightweight accessibility pass.
 *
 * The whole point is interaction-observation-repair: the agent doesn't just look
 * at a static frame, it drives a flow and gets back structured proof of what
 * happened so it can fix the app before claiming the work is done.
 */

const SHOT_DIR = "assets/screenshots";

export interface InteractAction {
  type:
    | "navigate"
    | "click"
    | "type"
    | "fill"
    | "select"
    | "press"
    | "scroll"
    | "wait_for_text"
    | "wait"
    | "assert_text"
    | "assert_url"
    | "assert_visible"
    | "screenshot";
  /** CSS selector for click/type/fill/select/press/assert_visible. */
  selector?: string;
  /** Text to type/select, key to press, text/url to assert or wait for. */
  value?: string;
  /** Absolute URL or sub-path for navigate. */
  url?: string;
  /** Scroll direction (default "down"). */
  direction?: "up" | "down";
  /** Scroll distance in px (default 600). */
  pixels?: number;
  /** Timeout for waits/asserts in ms (default 5000, capped 15000). */
  timeout_ms?: number;
}

/**
 * One streamed frame of a live interaction (P2 "Preview (Agent)"). The agent
 * captures a screenshot after each step and hands it to `onFrame` as it happens,
 * so the web can render the agent driving the browser in near-real-time instead
 * of a single opaque tool row. The orchestrator wraps this with a `call_id`
 * (and, on a saved-flow replay, the flow name) before broadcasting it as an
 * `agent_preview_frame` ServerEvent.
 */
export interface InteractFrame {
  /** 0-based frame index within this run. */
  seq: number;
  /** Human caption: "Opened /login", "click #submit", "Final state", … */
  label: string;
  ok: boolean;
  detail?: string;
  url: string;
  /** base64-encoded image (no `data:` prefix). */
  image: string;
  mime: string;
  title?: string;
  /** True on the last frame of the run. */
  done?: boolean;
}

export interface InteractOpts {
  sandboxRoot: string;
  serverId?: string;
  url?: string;
  pathSuffix?: string;
  viewport?: { width: number; height: number };
  actions: InteractAction[];
  /** Run the lightweight a11y pass on the final state (default true). */
  a11y?: boolean;
  /**
   * Run the deterministic layout/contrast pass on the final state (overflow,
   * off-screen elements, clipped text, low-contrast text). Default OFF — the
   * loop enables it ONLY for text-only models, as a model-free substitute for
   * "look at the screenshot and tell me if the UI is broken/legible". Vision
   * models see the screenshot natively, so they don't need it.
   */
  layoutChecks?: boolean;
  /**
   * P2 live streaming: invoked with a screenshot frame after the initial load
   * and after every action (plus a final `done` frame). When omitted (CLI /
   * tests) no per-step frames are captured, so there's zero added latency for
   * non-streamed runs — only the single final screenshot is taken, as before.
   */
  onFrame?: (frame: InteractFrame) => void;
}

interface InteractStep {
  index: number;
  action: string;
  ok: boolean;
  detail?: string;
  url: string;
}

export interface InteractResult {
  asset_path: string;
  resolved_url: string;
  final_url: string;
  page_title: string;
  steps: InteractStep[];
  console_errors: string[];
  failed_requests: string[];
  assertion_failures: string[];
  a11y_issues: { id: string; help: string; nodes: number }[];
  /** Deterministic layout/contrast findings (empty unless opts.layoutChecks). */
  layout_issues: { id: string; help: string; nodes: number }[];
  /** Console errors that should BLOCK a "passing" verdict (real errors/pageerrors;
   *  benign dev noise filtered out). Drives the RESULT: PASSED/FAILED verdict. */
  blocking_console_errors: string[];
  /** Subset that are React hydration mismatches — highest-priority, always blocking. */
  hydration_errors: string[];
}

const cap = (ms: number | undefined, def: number): number =>
  Math.min(Math.max(typeof ms === "number" ? ms : def, 0) || def, 15_000);

async function gotoWithFallback(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "load", timeout: 30_000 }).catch(async (err: unknown) => {
    // Dev servers with HMR often never fire `load` cleanly — fall back to
    // domcontentloaded so we still land on a rendered page (mirrors screenshot.ts).
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {
      throw err;
    });
  });
}

/** Benign console noise that must never block a preview verdict (dev-only chatter). */
const BENIGN_CONSOLE = [
  /favicon\.ico/i,
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  /\[HMR\]/i,
  /\[vite\]\s+(?:connect|hmr)/i,
  /\[webpack(?:-dev-server)?\]/i,
  // Only dev-tooling source-map chatter, not a real "SourceMap…error" in app code.
  /(?:failed to (?:load|parse)|404).{0,40}(?:source[- ]?map|\.map\b)/i,
  /Lighthouse/i,
];

/**
 * React hydration mismatch — the exact error class that shipped a "verified"
 * but broken app (the UI renders, then silently desyncs / loses interactivity).
 * Deliberately specific so it doesn't fire on unrelated phrases like "cookie did
 * not match policy" or "server rendered page in 250ms".
 */
export function isHydrationError(e: string): boolean {
  return (
    /\bhydrat(?:e|ed|es|ing|ion)\b/i.test(e) ||
    /(?:text )?content (?:did|does) not match/i.test(e) ||
    /did not match (?:the )?server[- ]?rendered/i.test(e)
  );
}

/**
 * Console messages that should BLOCK an "it works" verdict: real `[error]` /
 * `[pageerror]` entries (warnings stay advisory), minus benign dev noise.
 * Hydration errors always count, even if they arrived as a warning.
 */
export function blockingConsoleErrors(errors: string[]): string[] {
  return errors.filter((e) => {
    if (isHydrationError(e)) return true;
    // Exact bracketed level marker, so "[errorinfo] …" can't match "[error]".
    if (!/^\[(?:error|pageerror)\]/.test(e)) return false;
    return !BENIGN_CONSOLE.some((rx) => rx.test(e));
  });
}

export async function runInteractPreview(opts: InteractOpts): Promise<InteractResult> {
  const targetUrl = await resolvePreviewUrl({
    url: opts.url,
    serverId: opts.serverId,
    pathSuffix: opts.pathSuffix,
  });
  if (!targetUrl) {
    throw new Error("interact_preview requires either server_id (a running start_server id) or url");
  }

  const viewport = opts.viewport ?? { width: 1280, height: 800 };
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const assertionFailures: string[] = [];
  const steps: InteractStep[] = [];

  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();

    // Evidence collection (P2.2): console errors, JS page errors, and any
    // failed/4xx-5xx network response — the side effects screenshot_preview
    // dropped on the floor. Each list is capped so a render loop can't balloon
    // the agent's context.
    page.on("console", (msg) => {
      if ((msg.type() === "error" || msg.type() === "warning") && consoleErrors.length < 50) {
        consoleErrors.push(`[${msg.type()}] ${msg.text().slice(0, 500)}`);
      }
    });
    page.on("pageerror", (err) => {
      if (consoleErrors.length < 50) consoleErrors.push(`[pageerror] ${String(err).slice(0, 500)}`);
    });
    page.on("requestfailed", (req) => {
      if (failedRequests.length < 50) {
        failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText ?? "failed"}`);
      }
    });
    page.on("response", (resp) => {
      const status = resp.status();
      if (status >= 400 && failedRequests.length < 50) {
        failedRequests.push(`HTTP ${status} ${resp.request().method()} ${resp.url()}`);
      }
    });

    // Per-step frame capture for the live "Preview (Agent)" view. Each frame is
    // a small JPEG streamed via onFrame as base64 — NOT written to disk. We used
    // to persist every frame to assets/screenshots/ too, but nothing ever read
    // those files back, and a multi-step run dumped a dozen throwaway `.jpg`s per
    // call; that pile (across many interact runs) is what buried the screenshots
    // folder. Only runs when a listener is attached, so non-streamed callers pay
    // nothing. `frameSeq` is shared with the final done-frame.
    let frameSeq = 0;
    const captureFrame = async (
      label: string,
      ok: boolean,
      detail?: string,
    ): Promise<void> => {
      if (!opts.onFrame) return;
      try {
        const buf = await page.screenshot({ type: "jpeg", quality: 55 });
        opts.onFrame({
          seq: frameSeq,
          label,
          ok,
          detail,
          url: page.url(),
          image: buf.toString("base64"),
          mime: "image/jpeg",
          title: (await page.title().catch(() => "")) || undefined,
        });
        frameSeq++;
      } catch {
        // best-effort — a dropped live frame just isn't shown; the run continues
      }
    };

    await gotoWithFallback(page, targetUrl);
    await captureFrame("Opened the app", true);

    for (let i = 0; i < opts.actions.length; i++) {
      const a = opts.actions[i];
      const label = describeAction(a);
      let ok = true;
      let detail: string | undefined;
      try {
        await runAction(page, a, targetUrl, assertionFailures, i);
      } catch (err) {
        ok = false;
        detail = err instanceof Error ? err.message.slice(0, 300) : String(err);
      }
      await captureFrame(label, ok, detail);
      steps.push({ index: i, action: label, ok, detail, url: page.url() });
    }

    const a11yIssues = opts.a11y === false ? [] : await runA11yPass(page).catch(() => []);
    const layoutIssues = opts.layoutChecks ? await runLayoutPass(page).catch(() => []) : [];

    // The final-state screenshot IS persisted (it's the asset_path the agent and
    // tool result reference) — named + retention-capped like every other shot.
    const finalBuf = await page.screenshot().catch(() => null);
    const finalAssetPath = finalBuf
      ? await persistScreenshot(opts.sandboxRoot, finalBuf, "png").catch(() => `${SHOT_DIR}/missing.png`)
      : `${SHOT_DIR}/missing.png`;

    const pageTitle = await page.title().catch(() => "");
    // Console errors that should BLOCK an "it works" verdict (real errors minus
    // benign dev noise); hydration mismatches are called out specially.
    const blockingErrors = blockingConsoleErrors(consoleErrors);
    const hydrationErrors = consoleErrors.filter(isHydrationError);
    // Final done-frame: settles the live view on the end state and clears the
    // "LIVE" indicator. Reuses the PNG just captured (no extra screenshot).
    if (opts.onFrame) {
      opts.onFrame({
        seq: frameSeq,
        label: "Final state",
        ok: assertionFailures.length === 0 && blockingErrors.length === 0,
        url: page.url(),
        image: finalBuf ? finalBuf.toString("base64") : "",
        mime: "image/png",
        title: pageTitle || undefined,
        done: true,
      });
    }
    return {
      asset_path: finalAssetPath,
      resolved_url: targetUrl,
      final_url: page.url(),
      page_title: pageTitle,
      steps,
      console_errors: consoleErrors,
      failed_requests: failedRequests,
      assertion_failures: assertionFailures,
      a11y_issues: a11yIssues,
      layout_issues: layoutIssues,
      blocking_console_errors: blockingErrors,
      hydration_errors: hydrationErrors,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

function describeAction(a: InteractAction): string {
  switch (a.type) {
    case "navigate":
      return `navigate ${a.url ?? a.selector ?? ""}`.trim();
    case "click":
    case "assert_visible":
      return `${a.type} ${a.selector ?? ""}`.trim();
    case "type":
    case "fill":
    case "select":
      return `${a.type} ${a.selector ?? ""} = ${truncate(a.value)}`;
    case "press":
      return `press ${a.value ?? ""}`;
    case "scroll":
      return `scroll ${a.direction ?? "down"} ${a.pixels ?? 600}px`;
    case "wait_for_text":
    case "assert_text":
      return `${a.type} ${truncate(a.value)}`;
    case "assert_url":
      return `assert_url ${truncate(a.value)}`;
    case "wait":
      return `wait ${a.timeout_ms ?? 1000}ms`;
    case "screenshot":
      return "screenshot";
    default:
      return a.type;
  }
}

const truncate = (s: string | undefined): string => (s ? (s.length > 60 ? s.slice(0, 60) + "…" : s) : "");

async function runAction(
  page: Page,
  a: InteractAction,
  baseUrl: string,
  assertionFailures: string[],
  index: number,
): Promise<void> {
  const t = cap(a.timeout_ms, 5000);
  switch (a.type) {
    case "navigate": {
      let dest: string;
      if (a.url) {
        if (a.url.startsWith("http")) {
          // Absolute URL: validated by resolvePreviewUrl → assertPublicHost.
          dest = (await resolvePreviewUrl({ url: a.url })) ?? a.url;
        } else {
          // Relative/path navigation: resolve against baseUrl but confine it to
          // the same origin. A scheme-relative `//host/...` does NOT start with
          // "http", so without this it would resolve to an absolute host (cloud
          // metadata / loopback / a peer VM) and bypass the SSRF guard the
          // http(s) branch applies. baseUrl is itself a (legitimately) private
          // preview host, so origin-equality — not assertPublicHost — is the
          // correct guard here.
          dest = new URL(a.url, baseUrl).toString();
          if (new URL(dest).origin !== new URL(baseUrl).origin) {
            throw new Error(
              `navigate target "${a.url}" escapes the preview origin; use an absolute http(s) URL or a same-origin path`,
            );
          }
        }
      } else {
        dest = baseUrl;
      }
      await gotoWithFallback(page, dest);
      return;
    }
    case "click":
      requireSelector(a);
      await page.click(a.selector!, { timeout: t });
      return;
    case "type":
    case "fill":
      requireSelector(a);
      await page.fill(a.selector!, a.value ?? "", { timeout: t });
      return;
    case "select":
      requireSelector(a);
      await page.selectOption(a.selector!, a.value ?? "", { timeout: t });
      return;
    case "press":
      await page.press(a.selector ?? "body", a.value ?? "Enter", { timeout: t });
      return;
    case "scroll": {
      const delta = (a.direction === "up" ? -1 : 1) * (a.pixels ?? 600);
      await page.mouse.wheel(0, delta);
      await page.waitForTimeout(150);
      return;
    }
    case "wait":
      await page.waitForTimeout(cap(a.timeout_ms, 1000));
      return;
    case "wait_for_text": {
      await page
        .getByText(a.value ?? "", { exact: false })
        .first()
        .waitFor({ state: "visible", timeout: t });
      return;
    }
    case "assert_text": {
      const needle = a.value ?? "";
      const body = (await page.innerText("body").catch(() => "")) || "";
      if (!body.includes(needle)) {
        assertionFailures.push(`step ${index} assert_text: page does not contain "${truncate(needle)}"`);
      }
      return;
    }
    case "assert_url": {
      const needle = a.value ?? "";
      if (!page.url().includes(needle)) {
        assertionFailures.push(
          `step ${index} assert_url: "${page.url()}" does not contain "${truncate(needle)}"`,
        );
      }
      return;
    }
    case "assert_visible": {
      requireSelector(a);
      const visible = await page
        .locator(a.selector!)
        .first()
        .isVisible()
        .catch(() => false);
      if (!visible) {
        assertionFailures.push(`step ${index} assert_visible: "${a.selector}" is not visible`);
      }
      return;
    }
    case "screenshot":
      // No-op: a final screenshot is always captured after the action loop.
      return;
    default:
      throw new Error(`unknown action type "${(a as InteractAction).type}"`);
  }
}

function requireSelector(a: InteractAction): void {
  if (typeof a.selector !== "string" || !a.selector.trim()) {
    throw new Error(`action "${a.type}" requires a selector`);
  }
}

/**
 * Dependency-free accessibility pass. Catches the highest-frequency, highest-
 * confidence failures (missing alt text, unlabeled form controls, nameless
 * buttons/links, missing html lang) without pulling in axe-core / a CDN. Runs in
 * the page so it sees the live, post-interaction DOM.
 */
async function runA11yPass(page: Page): Promise<{ id: string; help: string; nodes: number }[]> {
  // Passed as a string so TS doesn't typecheck DOM globals (the orchestrator
  // tsconfig has no "dom" lib) — same approach screenshot.ts uses for
  // document.body.scrollHeight. Runs in the page against the live DOM.
  const script = `(() => {
    var issues = [];
    var imgs = Array.prototype.slice.call(document.querySelectorAll("img")).filter(function (i) {
      return !i.hasAttribute("alt") && i.getAttribute("aria-hidden") !== "true" && i.getAttribute("role") !== "presentation";
    });
    if (imgs.length) issues.push({ id: "image-alt", help: "image(s) missing alt text", nodes: imgs.length });
    var controls = Array.prototype.slice.call(
      document.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea")
    ).filter(function (el) {
      var id = el.getAttribute("id");
      var esc = (window.CSS && CSS.escape) ? CSS.escape : function (s) { return s.replace(/[^a-zA-Z0-9_-]/g, "\\\\$&"); };
      var hasFor = id && document.querySelector('label[for="' + esc(id) + '"]');
      return !hasFor && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby") && !el.getAttribute("title") && !el.closest("label");
    });
    if (controls.length) issues.push({ id: "label", help: "form control(s) without an accessible label", nodes: controls.length });
    var nameless = Array.prototype.slice.call(document.querySelectorAll("button, a[href]")).filter(function (el) {
      var text = (el.textContent || "").trim();
      var hasImgAlt = !!el.querySelector("img[alt]:not([alt=''])");
      return !text && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby") && !el.getAttribute("title") && !hasImgAlt;
    });
    if (nameless.length) issues.push({ id: "control-name", help: "button(s)/link(s) without accessible text", nodes: nameless.length });
    if (!document.documentElement.getAttribute("lang")) issues.push({ id: "html-lang", help: "<html> has no lang attribute", nodes: 1 });
    return issues;
  })()`;
  const result = await page.evaluate(script);
  return Array.isArray(result) ? (result as { id: string; help: string; nodes: number }[]) : [];
}

/**
 * Dependency-free layout + contrast pass — the model-free substitute for "look
 * at the screenshot and tell me if it's broken/illegible", run for text-only
 * models that can't see the screenshot. All geometry is computed from the live,
 * post-interaction DOM (getBoundingClientRect / scrollWidth / getComputedStyle),
 * so the findings are exact, not eyeballed. Deliberately conservative
 * (high-confidence, low false-positive): page-level horizontal overflow,
 * elements off the right edge, text clipped by an overflow box, and text below
 * WCAG AA contrast. Returns the same {id,help,nodes} shape as the a11y pass.
 */
async function runLayoutPass(page: Page): Promise<{ id: string; help: string; nodes: number }[]> {
  // Passed as a string (no DOM lib in the orchestrator tsconfig); runs in the
  // page. Uses `+` concatenation, never ${…}, so the template literal doesn't
  // interpolate. Regex parens are double-escaped to survive the literal.
  const script = `(() => {
    var issues = [];
    var de = document.documentElement;
    if (de && de.scrollWidth > de.clientWidth + 1) {
      issues.push({ id: "page-overflow-x", help: "page scrolls horizontally — content wider than the viewport (" + de.scrollWidth + "px > " + de.clientWidth + "px); usually a fixed width or an unwrapped row", nodes: 1 });
    }
    var vw = de ? de.clientWidth : 0;
    var nodes = document.body ? Array.prototype.slice.call(document.body.querySelectorAll("*")) : [];
    if (nodes.length > 1200) nodes = nodes.slice(0, 1200);
    function parseColor(c) {
      var m = c && c.match(/rgba?\\(([^)]+)\\)/);
      if (!m) return null;
      var p = m[1].split(",").map(function (x) { return parseFloat(x); });
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    }
    function lum(c) {
      var ch = [c.r, c.g, c.b].map(function (v) {
        v = v / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
    }
    function bgOf(el) {
      var n = el;
      while (n && n.nodeType === 1) {
        var bg = parseColor(getComputedStyle(n).backgroundColor);
        if (bg && bg.a > 0) return bg;
        n = n.parentElement;
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    }
    var offscreen = 0, clipped = 0, lowContrast = 0;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      var st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden" || parseFloat(st.opacity) === 0) continue;
      if (r.left > vw + 2) offscreen++;
      if ((st.overflow === "hidden" || st.overflowX === "hidden" || st.textOverflow === "ellipsis") &&
          el.scrollWidth > el.clientWidth + 2 && (el.textContent || "").trim().length > 0) {
        clipped++;
      }
      var hasText = false;
      for (var k = 0; k < el.childNodes.length; k++) {
        var cn = el.childNodes[k];
        if (cn.nodeType === 3 && cn.textContent && cn.textContent.trim()) { hasText = true; break; }
      }
      if (hasText) {
        var fg = parseColor(st.color);
        if (fg && fg.a > 0) {
          var bg = bgOf(el);
          var L1 = lum(fg) + 0.05, L2 = lum(bg) + 0.05;
          var ratio = L1 > L2 ? L1 / L2 : L2 / L1;
          var size = parseFloat(st.fontSize) || 16;
          var bold = (parseInt(st.fontWeight, 10) || 400) >= 700;
          var large = size >= 24 || (size >= 18.66 && bold);
          if (ratio < (large ? 3 : 4.5)) lowContrast++;
        }
      }
    }
    if (offscreen > 0) issues.push({ id: "offscreen-x", help: "element(s) positioned beyond the right edge of the viewport (possible horizontal overflow / off-screen content)", nodes: offscreen });
    if (clipped > 0) issues.push({ id: "clipped-text", help: "element(s) whose text is clipped/truncated by an overflow box", nodes: clipped });
    if (lowContrast > 0) issues.push({ id: "low-contrast", help: "text element(s) below WCAG AA contrast (4.5:1 normal, 3:1 large) — may be hard to read", nodes: lowContrast });
    return issues;
  })()`;
  const result = await page.evaluate(script);
  return Array.isArray(result) ? (result as { id: string; help: string; nodes: number }[]) : [];
}
