import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { getServer } from "./sandbox.js";
import { assertPublicHost } from "../connectors/ssrfGuard.js";

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

interface ShotOpts {
  sandboxRoot: string;
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
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ viewport });
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
    const dir = path.resolve(opts.sandboxRoot, SHOT_DIR);
    await fs.mkdir(dir, { recursive: true });
    const file = `${randomUUID().slice(0, 8)}.png`;
    const full = path.join(dir, file);
    // Limit full-page screenshots to 8000px height (Claude API limit).
    const clip = opts.full_page
      ? { x: 0, y: 0, width: viewport.width, height: Math.min(await page.evaluate("document.body.scrollHeight") as number, 7800) }
      : undefined;
    await page.screenshot({ path: full, fullPage: !clip && !!opts.full_page, clip });
    return {
      asset_path: `${SHOT_DIR}/${file}`,
      resolved_url: targetUrl,
      width: viewport.width,
      height: clip ? clip.height : viewport.height,
      http_error: httpError || undefined,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function resolveUrl(opts: ShotOpts): Promise<string | null> {
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
    // A free-form url runs Playwright on the orchestrator host, so an agent
    // (or prompt injection) could otherwise navigate to cloud metadata
    // (169.254.169.254), loopback admin panels, or a peer VM and exfil the
    // rendered/error body. Reject private/loopback/metadata/fleet-bridge
    // targets. The serverId path below is exempt — it intentionally targets
    // the per-VM internal IP for a server the user already started.
    await assertPublicHost(parsed.hostname);
    return parsed.toString();
  }
  if (opts.serverId) {
    const s = getServer(opts.serverId);
    if (!s) {
      throw new Error(`No running server with id ${opts.serverId}`);
    }
    // Use the server's host — "127.0.0.1" for process-backed, the per-VM
    // IP (e.g. 172.16.x.y) for Firecracker-backed. proxy.ts uses the
    // same field to route preview iframes; without this, Playwright hits
    // the orchestrator's loopback and finds nothing because the dev
    // server lives inside the VM.
    const base = `http://${s.host}:${s.port}`;
    return opts.pathSuffix ? `${base}${opts.pathSuffix.startsWith("/") ? "" : "/"}${opts.pathSuffix}` : base;
  }
  return null;
}
