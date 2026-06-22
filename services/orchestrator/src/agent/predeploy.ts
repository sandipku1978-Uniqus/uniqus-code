import * as sb from "./sandbox.js";
import type { Sandbox } from "./sandbox.js";

/**
 * predeploy_check: the production-build + serverless-safety gate the agent
 * otherwise lacks (it only ever runs the dev server, which hides both build
 * failures and serverless-incompatible runtime patterns). Runs entirely in the
 * sandbox — NO external calls.
 *
 * Two phases:
 *  1. Production build (npm run build) when a build script exists — catches the
 *     TS/ESLint/static-generation errors `next dev` tolerates.
 *  2. A conservative static scan for serverless-incompatible patterns the build
 *     happily compiles: filesystem-as-database (the forensics ae492a23 bug),
 *     SQLite files, WebSocket servers, module-scope timers, localhost URLs.
 *
 * The per-line classifier and the server-reachability test are exported and pure
 * so they're unit-tested directly (see predeploy.test.ts), including the exact
 * forensics fs.writeFile store.
 */

export interface PredeployIssue {
  pattern: string;
  file: string;
  line: number;
  text: string;
}

export interface PredeployCheckResult {
  ok: boolean;
  buildRan: boolean;
  buildOk: boolean;
  buildErrorTail: string;
  /** Where the build ran: "" = root, "<name>" = subdir, null = no build script. */
  buildDir: string | null;
  blockers: PredeployIssue[];
  warnings: PredeployIssue[];
}

const SKIP_DIRS = new Set([
  "node_modules", ".next", ".git", "dist", "build", "out", "coverage", ".turbo", ".vercel", ".cache",
]);
const SOURCE_EXT = /\.(jsx?|tsx?|mjs|cjs)$/;
const MAX_FILES = 1500;
const MAX_ISSUES = 80;

/** Config / build-tool files where fs use is legitimate (build-time, not runtime). */
function isConfigOrScript(rel: string, name: string): boolean {
  return (
    /\.config\.(jsx?|tsx?|mjs|cjs)$/.test(name) ||
    /^(next|vite|astro|nuxt|svelte|tailwind|postcss|webpack|rollup|drizzle)\.config\./.test(name) ||
    rel.startsWith("scripts/") ||
    rel.includes("/scripts/")
  );
}

/**
 * Is fs/timer use in this file a RUNTIME (server) concern? True unless the file
 * is an explicit client component (`"use client"`) or a build-time config/script.
 * This is what makes a plain `lib/store.js` (no "use client", not config) count
 * as server-reachable — the gap that let the forensics fs.writeFile slip past
 * narrower "only /api/ files" checks. Pure.
 */
export function fileIsServerReachable(rel: string, name: string, head: string): boolean {
  const clientOnly = head.includes('"use client"') || head.includes("'use client'");
  return !clientOnly && !isConfigOrScript(rel, name);
}

/**
 * Classify ONE source line as a serverless blocker/warning (or null). Pure +
 * unit-tested. `line` is the trimmed line; `raw` is the original (for leading-
 * whitespace checks like module-scope timers).
 */
export function classifyServerlessLine(
  line: string,
  raw: string,
  serverReachable: boolean,
): { kind: "blocker" | "warning"; pattern: string } | null {
  if (line.startsWith("//") || line.startsWith("*")) return null;

  // ── Blockers (fatal once deployed to serverless) ──
  if (
    serverReachable &&
    /\bfs(\.promises)?\.(writeFile|writeFileSync|appendFile|appendFileSync|mkdir|mkdirSync|rm|rmSync|unlink)\s*\(/.test(line) &&
    // /tmp is the one writable serverless path (ephemeral, per-invocation) — not a blocker.
    !/\/tmp\b|tmpdir\s*\(/.test(line)
  ) {
    return { kind: "blocker", pattern: "filesystem write in server-reachable code — Vercel's FS is read-only (only /tmp is writable, and per-request), so this data is lost; use a database" };
  }
  if (/["']file:[^"']*\.(db|sqlite|sqlite3)["']|DATABASE_URL\s*=\s*["']?file:/.test(line)) {
    return { kind: "blocker", pattern: "file-based SQLite — not durable on serverless (read-only/ephemeral disk)" };
  }
  if (/from\s+["']better-sqlite3["']|require\(\s*["']better-sqlite3["']\s*\)/.test(line)) {
    return { kind: "blocker", pattern: "better-sqlite3 — a local SQLite file, not serverless-compatible" };
  }
  if (/\bnew\s+(WebSocketServer|WebSocket\.Server)\s*\(/.test(line) || /from\s+["']socket\.io["']|require\(\s*["']socket\.io["']\s*\)/.test(line)) {
    return { kind: "blocker", pattern: "WebSocket / socket.io server — Vercel serverless has no WebSocket support; use a hosted relay" };
  }

  // ── Warnings (likely to break live; advisory) ──
  if (serverReachable && /^\s*(?:(?:export\s+)?(?:const|let|var)\s+[\w$]+\s*=\s*)?(setInterval|setTimeout)\s*\(/.test(raw)) {
    return { kind: "warning", pattern: "module-scope timer in server code — won't run on serverless (functions exit after the response)" };
  }
  if (/https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(line)) {
    return { kind: "warning", pattern: "hard-coded localhost URL — won't resolve after deploy; use a relative path or env var" };
  }
  if (serverReachable && /\bfs\.(readFile|readFileSync)\s*\(/.test(line) && !/assets|public|process\.env|import\.meta/.test(line)) {
    return { kind: "warning", pattern: "reading a project file at runtime — it may not be in the serverless bundle; embed it or use a DB/env" };
  }
  return null;
}

/** True when the package.json at `relPath` declares a non-empty `build` script. */
async function pkgHasBuildScript(sandbox: Sandbox, relPath: string): Promise<boolean> {
  try {
    const pkg = JSON.parse(await sb.readFile(sandbox, relPath)) as {
      scripts?: Record<string, string>;
    };
    return typeof pkg.scripts?.build === "string" && pkg.scripts.build.trim().length > 0;
  } catch {
    return false; // no/unreadable package.json — not a Node build
  }
}

/**
 * Locate the directory whose package.json has a runnable `build` script. A
 * project may live at the sandbox ROOT or in a single SUBDIRECTORY (e.g.
 * `create-next-app my-app` → `my-app/`) — start_server and the system prompt
 * explicitly support the subdir layout, so the build phase must too. Without
 * this, a subdir app has no root build script, the build is silently skipped,
 * and predeploy_check returns PASSED having never run the production build — a
 * false PASS for exactly the build-time errors it exists to catch.
 *
 * Returns "" for root, the child-dir name for a subdir, or null when no
 * package.json with a build script exists in the root or any immediate child
 * (an honest "no build script"). Only the first level is scanned — the
 * supported layout is one app, at root or one dir down.
 */
export async function findAppDir(sandbox: Sandbox): Promise<string | null> {
  if (await pkgHasBuildScript(sandbox, "package.json")) return "";
  let entries: string[];
  try {
    entries = await sb.listDir(sandbox);
  } catch {
    return null;
  }
  const childDirs = entries
    .filter((e) => e.endsWith("/"))
    .map((e) => e.slice(0, -1))
    // Skip build artifacts/vendored dirs, dotdirs, and any name we can't safely
    // single-quote into the shell `cd` below.
    .filter((name) => !SKIP_DIRS.has(name) && !name.startsWith(".") && !name.includes("'"))
    .sort();
  for (const dir of childDirs) {
    if (await pkgHasBuildScript(sandbox, `${dir}/package.json`)) return dir;
  }
  return null;
}

async function runBuild(
  sandbox: Sandbox,
  signal?: AbortSignal,
): Promise<{ ok: boolean; errorTail: string; dir: string } | null> {
  const appDir = await findAppDir(sandbox);
  if (appDir === null) return null;
  // Root deps are installed by the caller's ensureProjectDeps (root-only); a
  // subdir app's deps are NOT, so install them (manager-aware, mirroring
  // ensureDeps) before building — else the build FAILS on missing modules (a
  // false fail) instead of surfacing real build errors. `npm run build` just
  // runs the package script, so it is correct regardless of which installer ran.
  const timeoutMs = appDir === "" ? 180_000 : 360_000;
  const cmd =
    appDir === ""
      ? "npm run build"
      : `cd '${appDir}' && ` +
        `if [ -d node_modules ] && [ -n "$(ls -A node_modules 2>/dev/null)" ]; then :; ` +
        `elif [ -f pnpm-lock.yaml ]; then pnpm install --prefer-offline; ` +
        `elif [ -f yarn.lock ]; then yarn install --frozen-lockfile; ` +
        `else npm install --no-audit --no-fund --prefer-offline; fi && npm run build`;
  const res = await sb.runCommand(sandbox, cmd, timeoutMs, signal);
  let tail = `${res.stdout}\n${res.stderr}`.trimEnd().split("\n").slice(-25).join("\n");
  // exitCode null = killed by signal / timed out before a clean exit — not a pass.
  if (res.exitCode === null) {
    tail = `[build did not complete — timed out (${Math.round(timeoutMs / 1000)}s) or was interrupted]\n${tail}`;
  }
  return { ok: res.exitCode === 0, errorTail: tail, dir: appDir };
}

async function scanServerlessSafety(
  sandbox: Sandbox,
): Promise<{ blockers: PredeployIssue[]; warnings: PredeployIssue[] }> {
  const blockers: PredeployIssue[] = [];
  const warnings: PredeployIssue[] = [];
  let filesScanned = 0;

  async function walk(relDir: string): Promise<void> {
    if (filesScanned >= MAX_FILES || blockers.length + warnings.length >= MAX_ISSUES) return;
    let entries: string[];
    try {
      entries = await sb.listDir(sandbox, relDir || undefined);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (filesScanned >= MAX_FILES) return;
      const isDir = entry.endsWith("/");
      const name = isDir ? entry.slice(0, -1) : entry;
      const rel = relDir ? `${relDir}/${name}` : name;
      if (isDir) {
        if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
        await walk(rel);
        continue;
      }
      if (!SOURCE_EXT.test(name) || /\.(test|spec)\.[jt]sx?$/.test(name)) continue;
      filesScanned++;
      let content: string;
      try {
        content = await sb.readFile(sandbox, rel);
      } catch {
        continue;
      }
      const serverReachable = fileIsServerReachable(rel, name, content.slice(0, 800));
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (blockers.length + warnings.length >= MAX_ISSUES) return;
        const raw = lines[i];
        const c = classifyServerlessLine(raw.trim(), raw, serverReachable);
        if (!c) continue;
        const issue: PredeployIssue = { pattern: c.pattern, file: rel, line: i + 1, text: raw.trim().slice(0, 200) };
        if (c.kind === "blocker") blockers.push(issue);
        else warnings.push(issue);
      }
    }
  }

  await walk("");
  return { blockers, warnings };
}

export async function runPredeployCheck(
  sandbox: Sandbox,
  opts?: { signal?: AbortSignal },
): Promise<PredeployCheckResult> {
  const build = await runBuild(sandbox, opts?.signal);
  const buildRan = build !== null;
  const buildOk = build === null ? true : build.ok;
  const buildErrorTail = build?.errorTail ?? "";
  const buildDir = build?.dir ?? null;
  // Always run the scan too, so the agent sees build + serverless issues together.
  const { blockers, warnings } = await scanServerlessSafety(sandbox);
  const ok = buildOk && blockers.length === 0;
  return { ok, buildRan, buildOk, buildErrorTail, buildDir, blockers, warnings };
}
