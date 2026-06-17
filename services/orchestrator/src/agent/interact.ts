import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chromium, type Page } from "playwright";
import { resolvePreviewUrl } from "./screenshot.js";

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
  /** Per-step screenshot path (relative to sandbox root), when frames captured. */
  shot?: string;
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
    // a small JPEG (fast + light over the wire) written to disk AND streamed via
    // onFrame. Only runs when a listener is attached so non-streamed callers pay
    // no extra screenshot cost. `frameSeq` is shared with the final done-frame.
    const dir = path.resolve(opts.sandboxRoot, SHOT_DIR);
    let dirReady = false;
    const ensureDir = async (): Promise<void> => {
      if (!dirReady) {
        await fs.mkdir(dir, { recursive: true });
        dirReady = true;
      }
    };
    const runPrefix = randomUUID().slice(0, 8);
    let frameSeq = 0;
    const captureFrame = async (
      label: string,
      ok: boolean,
      detail?: string,
    ): Promise<string | undefined> => {
      if (!opts.onFrame) return undefined;
      try {
        const buf = await page.screenshot({ type: "jpeg", quality: 55 });
        await ensureDir();
        const file = `${runPrefix}-${frameSeq}.jpg`;
        await fs.writeFile(path.join(dir, file), buf).catch(() => {});
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
        return `${SHOT_DIR}/${file}`;
      } catch {
        return undefined;
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
      const shot = await captureFrame(label, ok, detail);
      steps.push({ index: i, action: label, ok, detail, url: page.url(), shot });
    }

    const a11yIssues = opts.a11y === false ? [] : await runA11yPass(page).catch(() => []);

    await ensureDir();
    const file = `${randomUUID().slice(0, 8)}.png`;
    const finalBuf = await page.screenshot().catch(() => null);
    if (finalBuf) await fs.writeFile(path.join(dir, file), finalBuf).catch(() => {});

    const pageTitle = await page.title().catch(() => "");
    // Final done-frame: settles the live view on the end state and clears the
    // "LIVE" indicator. Reuses the PNG just captured (no extra screenshot).
    if (opts.onFrame) {
      opts.onFrame({
        seq: frameSeq,
        label: "Final state",
        ok: assertionFailures.length === 0,
        url: page.url(),
        image: finalBuf ? finalBuf.toString("base64") : "",
        mime: "image/png",
        title: pageTitle || undefined,
        done: true,
      });
    }
    return {
      asset_path: `${SHOT_DIR}/${file}`,
      resolved_url: targetUrl,
      final_url: page.url(),
      page_title: pageTitle,
      steps,
      console_errors: consoleErrors,
      failed_requests: failedRequests,
      assertion_failures: assertionFailures,
      a11y_issues: a11yIssues,
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
