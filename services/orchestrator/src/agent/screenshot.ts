import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { getServer } from "./sandbox.js";
import { assertPublicHost } from "../connectors/ssrfGuard.js";
import {
  assertBrowserRequestAllowed,
  BROWSER_SSRF_PROXY_LAUNCH_ARGS,
  installBrowserSsrfGuard,
  startBrowserSsrfProxy,
  type BrowserSsrfProxy,
} from "./browserSsrfGuard.js";

/**
 * `screenshot_preview` (Plan §3.2 — "closes the perception loop").
 *
 * Spins up a headless Chromium via Playwright, navigates to either a running
 * preview server (`server_id`) or an arbitrary URL, takes a PNG, and saves it
 * under `<sandbox>/assets/screenshots/<uuid>.png`. The agent gets back the
 * sandbox-relative path; it can then `read_asset` it later if the user asks
 * (read_asset returns a marker for images today; the actual visual loop will
 * tighten in Phase 3 when we inject screenshots as multimodal blocks).
 */

const SHOT_DIR = "assets/screenshots";

/**
 * How many screenshots to keep in assets/screenshots/. The agent can take a LOT
 * (it screenshots after most UI work, sometimes many times a turn), and an
 * unbounded folder is what the user actually hit — 50+ files they couldn't sort
 * through. We keep the most recent N and prune the oldest on each new capture.
 * Override via SCREENSHOT_RETENTION; default 40 (generous, but bounded).
 */
const SHOT_RETENTION = (() => {
  const n = Number(process.env.SCREENSHOT_RETENTION);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 40;
})();

/**
 * A chronologically SORTABLE, human-readable screenshot filename:
 * `shot-YYYYMMDD-HHMMSS-mmm-<rand>.<ext>`. The old `<uuid8>.png` names were
 * random, so the file explorer couldn't order them and the user couldn't tell
 * which was the latest. A timestamp prefix sorts newest-last by name. (Older
 * random/`-N.jpg` files sort BEFORE the `shot-` prefix, so they're also the
 * first to be pruned — the legacy clutter clears itself over time.)
 */
function screenshotName(ext: string): string {
  const d = new Date();
  const p = (n: number, w = 2): string => String(n).padStart(w, "0");
  const ts =
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`;
  return `shot-${ts}-${randomUUID().slice(0, 4)}.${ext}`;
}

/** Prune assets/screenshots/ down to the most recent SHOT_RETENTION images. Best-effort. */
async function pruneScreenshots(dir: string): Promise<void> {
  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  // Sortable names ⇒ lexical sort is chronological; oldest first.
  const shots = entries.filter((f) => /\.(png|jpe?g)$/i.test(f)).sort();
  const excess = shots.length - SHOT_RETENTION;
  if (excess <= 0) return;
  await Promise.all(
    shots.slice(0, excess).map((f) => fs.unlink(path.join(dir, f)).catch(() => {})),
  );
}

/**
 * Write a screenshot buffer to assets/screenshots/ under a sortable name, then
 * prune the folder to SHOT_RETENTION. Returns the sandbox-relative asset path.
 * Shared by screenshot_preview (here) and interact_preview's FINAL frame so all
 * persisted screenshots are named + capped the same way. Per-step interaction
 * frames are NOT persisted (they stream to the live view as base64 and nothing
 * reads them back) — that was the main source of the folder bloat.
 */
export async function persistScreenshot(
  sandboxRoot: string,
  buf: Buffer,
  ext: "png" | "jpg" = "png",
): Promise<string> {
  const dir = path.resolve(sandboxRoot, SHOT_DIR);
  await fs.mkdir(dir, { recursive: true });
  const file = screenshotName(ext);
  await fs.writeFile(path.join(dir, file), buf);
  await pruneScreenshots(dir).catch(() => {});
  return `${SHOT_DIR}/${file}`;
}

interface ShotOpts {
  sandboxRoot: string;
  projectId?: string;
  serverId?: string;
  url?: string;
  pathSuffix?: string; // path appended to the server's base URL when serverId is used
  viewport?: { width: number; height: number };
  full_page?: boolean;
  wait_ms?: number;
}

export interface ShotResult {
  asset_path: string;
  resolved_url: string;
  width: number;
  height: number;
  /** Set when the page returned an HTTP error (4xx/5xx). Includes status + body excerpt. */
  http_error?: string;
}

export async function takeScreenshot(opts: ShotOpts): Promise<ShotResult> {
  const targetUrl = await resolveUrl(opts);
  if (!targetUrl) {
    throw new Error(
      "screenshot_preview requires either server_id (a running start_server id) or url",
    );
  }

  const viewport = opts.viewport ?? { width: 1280, height: 800 };
  const allowedPrivateOrigin = opts.serverId ? new URL(targetUrl).origin : undefined;
  const browser = await chromium.launch({
    headless: true,
    args: BROWSER_SSRF_PROXY_LAUNCH_ARGS,
  });
  let ssrfProxy: BrowserSsrfProxy | null = null;
  try {
    ssrfProxy = await startBrowserSsrfProxy(allowedPrivateOrigin);
    const ctx = await browser.newContext({
      viewport,
      proxy: { server: ssrfProxy.url },
    });
    await installBrowserSsrfGuard(ctx, allowedPrivateOrigin);
    const page = await ctx.newPage();

    // Track HTTP errors so we can surface them to the agent.
    let httpError = "";
    page.on("response", (resp) => {
      if (resp.url() === targetUrl || resp.url() === targetUrl + "/") {
        const status = resp.status();
        if (status >= 400) {
          httpError = `HTTP ${status} ${resp.statusText()}`;
        }
      }
    });

    await page.goto(targetUrl, { waitUntil: "load", timeout: 30_000 }).catch(async (err: unknown) => {
      // Many dev servers don't fire `load` cleanly with HMR. Fall back to
      // domcontentloaded so we at least capture something rendered.
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {
        throw err;
      });
    });
    await assertBrowserRequestAllowed(page.url(), allowedPrivateOrigin);

    // If the page returned an error HTTP status, try to capture the body text.
    if (httpError) {
      try {
        const bodyText = await page.textContent("body").catch(() => null);
        if (bodyText) httpError += `: ${bodyText.slice(0, 500).trim()}`;
      } catch {}
    }

    if (opts.wait_ms && opts.wait_ms > 0) {
      await page.waitForTimeout(Math.min(opts.wait_ms, 10_000));
    }
    // Limit full-page screenshots to 8000px height (Claude API limit).
    const clip = opts.full_page
      ? { x: 0, y: 0, width: viewport.width, height: Math.min(await page.evaluate("document.body.scrollHeight") as number, 7800) }
      : undefined;
    const buf = await page.screenshot({ fullPage: !clip && !!opts.full_page, clip });
    const asset_path = await persistScreenshot(opts.sandboxRoot, buf, "png");
    return {
      asset_path,
      resolved_url: targetUrl,
      width: viewport.width,
      height: clip ? clip.height : viewport.height,
      http_error: httpError || undefined,
    };
  } finally {
    await browser.close().catch(() => {});
    await ssrfProxy?.close().catch(() => {});
  }
}

async function resolveUrl(opts: ShotOpts): Promise<string | null> {
  return resolvePreviewUrl(opts);
}

/**
 * Resolve a preview target to a concrete URL, shared by `screenshot_preview` and
 * `interact_preview`. A free-form `url` is validated against the SSRF guard (an
 * agent could otherwise drive Playwright to cloud metadata, a loopback admin
 * panel, or a peer VM and exfil the rendered body). The `serverId` path is
 * exempt — it intentionally targets the per-VM internal IP of a server the user
 * already started, via the same host field proxy.ts uses to route the iframe.
 */
export async function resolvePreviewUrl(opts: {
  url?: string;
  serverId?: string;
  projectId?: string;
  pathSuffix?: string;
}): Promise<string | null> {
  if (opts.url) {
    let parsed: URL;
    try {
      parsed = new URL(opts.url);
    } catch {
      throw new Error("url must be an absolute http(s) URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("url must be http(s)://");
    }
    await assertPublicHost(parsed.hostname);
    return parsed.toString();
  }
  if (opts.serverId) {
    if (!opts.projectId) throw new Error("project id is required for a preview server");
    const s = getServer(opts.projectId, opts.serverId);
    if (!s) {
      throw new Error(`No running server with id ${opts.serverId}`);
    }
    const base = `http://${s.host}:${s.port}`;
    return opts.pathSuffix ? `${base}${opts.pathSuffix.startsWith("/") ? "" : "/"}${opts.pathSuffix}` : base;
  }
  return null;
}
