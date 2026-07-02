import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { safeChildEnv } from "./safeEnv.js";
import * as sb from "./agent/sandbox.js";
import type { Sandbox } from "./agent/sandbox.js";

/**
 * Whether the project's dependencies need to be installed before its dev
 * server can run. We sync sandbox files to Supabase Storage but skip
 * `node_modules` (way too big), so after every Railway redeploy we have a
 * package.json with no installed deps.
 *
 * Returns the package manager to use, or null if no install is needed.
 */
export async function needsInstall(
  sandboxDir: string,
): Promise<"npm" | "pnpm" | "yarn" | null> {
  const hasPackageJson = await exists(path.join(sandboxDir, "package.json"));
  if (!hasPackageJson) return null;

  // node_modules dir present + non-empty? Then we're set.
  try {
    const entries = await fs.readdir(path.join(sandboxDir, "node_modules"));
    if (entries.length > 0) return null;
  } catch {
    // doesn't exist — fall through
  }

  // Pick the manager based on which lockfile is present (mirrors npm's own
  // detection). Default to npm when nothing matches.
  if (await exists(path.join(sandboxDir, "pnpm-lock.yaml"))) return "pnpm";
  if (await exists(path.join(sandboxDir, "yarn.lock"))) return "yarn";
  return "npm";
}

export interface InstallResult {
  ok: boolean;
  stderr: string;
  durationMs: number;
}

/**
 * Run the install command. Single-shot, with stderr captured for surfacing
 * to the user. 5-minute hard cap so a runaway install doesn't pin the
 * orchestrator forever. Honors `signal` so a user clicking Stop while an
 * install is in flight kills it within ~10ms instead of waiting it out.
 */
export async function runInstall(
  sandboxDir: string,
  manager: "npm" | "pnpm" | "yarn",
  onStderr?: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<InstallResult> {
  const args =
    manager === "pnpm"
      ? ["install", "--prefer-offline"]
      : manager === "yarn"
      ? ["install", "--frozen-lockfile"]
      : ["install", "--no-audit", "--no-fund", "--prefer-offline"];

  const start = Date.now();
  return new Promise((resolve) => {
    const child = spawn(manager, args, {
      cwd: sandboxDir,
      env: safeChildEnv(),
      stdio: ["ignore", "ignore", "pipe"],
      // npm script PATH munging is irrelevant here — we're invoking the
      // package manager itself, which lives in the system PATH on Railway's
      // base image.
    });
    let stderr = "";
    let abortedByUser = false;
    child.stderr?.on("data", (d) => {
      const s = d.toString();
      stderr += s;
      onStderr?.(s);
    });
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
    }, 5 * 60 * 1000);
    const onAbort = (): void => {
      abortedByUser = true;
      try {
        child.kill("SIGKILL");
      } catch {}
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }
    child.once("error", (err) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve({
        ok: false,
        stderr: `[spawn ${manager}] ${err.message}\n${stderr}`,
        durationMs: Date.now() - start,
      });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      const trailer = abortedByUser ? "\n[killed: aborted by user]" : "";
      resolve({
        ok: code === 0 && !abortedByUser,
        stderr: stderr + trailer,
        durationMs: Date.now() - start,
      });
    });
  });
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// ── Unified, VM-aware, serialized installer ──────────────────────────────────

export interface EnsureDepsResult {
  /** Whether we actually ran an install (false = nothing to do / already present). */
  attempted: boolean;
  /** False only when an attempted install exited non-zero. */
  ok: boolean;
  manager: "npm" | "pnpm" | "yarn" | null;
  durationMs: number;
  stderr: string;
}

const installChains = new Map<string, Promise<unknown>>();

/**
 * Serialize installs per project. Concurrent `npm install` runs in the SAME
 * directory race each other — npm prunes "extraneous" packages mid-flight, so
 * two installs firing at once (e.g. the session-start auto-install and an
 * agent-issued `npm install`) can leave node_modules half-deleted. That's the
 * "node_modules disappeared" symptom. We funnel every install for a project
 * through one chain so they run back-to-back instead of stomping each other.
 */
function withInstallLock<T>(projectId: string | null, fn: () => Promise<T>): Promise<T> {
  if (!projectId) return fn();
  const prev = installChains.get(projectId) ?? Promise.resolve();
  // Run fn whether or not the previous link settled cleanly.
  const next = prev.then(fn, fn);
  // Store a non-rejecting tail so the next waiter never inherits a rejection.
  installChains.set(
    projectId,
    next.then(
      () => {},
      () => {},
    ),
  );
  return next;
}

/**
 * Ensure the project's dependencies are installed wherever its dev server will
 * actually run. In Firecracker mode that's INSIDE the VM (a separate
 * filesystem from the orchestrator host) — installing on the host there is the
 * "node_modules disappeared" footgun, since the host copy is invisible to the
 * VM. We dispatch through {@link sb.runCommand}, which routes to the VM when
 * `sandbox.vm` is set and to the host otherwise. All installs are serialized
 * per project via {@link withInstallLock}.
 */
export function ensureProjectDeps(
  sandbox: Sandbox,
  projectId: string | null,
  opts: {
    signal?: AbortSignal;
    onStderr?: (s: string) => void;
    /** Fired with the chosen manager right before the install command runs. */
    onStart?: (manager: "npm" | "pnpm" | "yarn") => void;
  } = {},
): Promise<EnsureDepsResult> {
  return withInstallLock(projectId, () => ensureDepsOnce(sandbox, opts));
}

async function ensureDepsOnce(
  sandbox: Sandbox,
  opts: {
    signal?: AbortSignal;
    onStderr?: (s: string) => void;
    onStart?: (manager: "npm" | "pnpm" | "yarn") => void;
  },
): Promise<EnsureDepsResult> {
  const start = Date.now();
  const none = (): EnsureDepsResult => ({
    attempted: false,
    ok: true,
    manager: null,
    durationMs: Date.now() - start,
    stderr: "",
  });

  if (sandbox.vm) {
    // Probe the VM filesystem: no package.json → nothing to do; a non-empty
    // node_modules → already installed; otherwise pick the manager from the
    // lockfile (mirrors needsInstall, but inside the guest).
    const probe = await sb.runCommand(
      sandbox,
      "if [ ! -f package.json ]; then echo none; " +
        'elif [ -d node_modules ] && [ -n "$(ls -A node_modules 2>/dev/null)" ]; then echo present; ' +
        "elif [ -f pnpm-lock.yaml ]; then echo pnpm; " +
        "elif [ -f yarn.lock ]; then echo yarn; else echo npm; fi",
      30_000,
      opts.signal,
    );
    const out = probe.stdout;
    const manager: "npm" | "pnpm" | "yarn" | null = out.includes("pnpm")
      ? "pnpm"
      : out.includes("yarn")
        ? "yarn"
        : out.includes("npm")
          ? "npm"
          : null;
    if (!manager) return none();
    opts.onStart?.(manager);
    const args =
      manager === "pnpm"
        ? "install --prefer-offline"
        : manager === "yarn"
          ? "install --frozen-lockfile"
          : "install --no-audit --no-fund --prefer-offline";
    // Inline cache override — belt-and-braces for VMs restored from snapshots
    // whose FROZEN agent predates the agent-env fix: on a golden clone the
    // rootfs is read-only, so the default cache at /root/.npm can't be created
    // and the install dies with "ENOENT/EROFS: mkdir '/root/.npm'". Newer
    // agents set this env themselves (agent.mjs / main.rs); repeating it here
    // is harmless. ".cache" is excluded from sync/pull, so it never leaves the VM.
    const cacheEnv =
      manager === "yarn"
        ? "YARN_CACHE_FOLDER=/sandbox/.cache/yarn"
        : manager === "pnpm"
          ? "npm_config_store_dir=/sandbox/.cache/pnpm-store npm_config_cache=/sandbox/.cache/npm"
          : "npm_config_cache=/sandbox/.cache/npm";
    const r = await sb.runCommand(sandbox, `${cacheEnv} ${manager} ${args}`, 5 * 60_000, opts.signal);
    return {
      attempted: true,
      ok: r.exitCode === 0,
      manager,
      durationMs: Date.now() - start,
      stderr: r.stderr || r.stdout,
    };
  }

  const manager = await needsInstall(sandbox.rootDir);
  if (!manager) return none();
  opts.onStart?.(manager);
  const result = await runInstall(sandbox.rootDir, manager, opts.onStderr, opts.signal);
  return {
    attempted: true,
    ok: result.ok,
    manager,
    durationMs: result.durationMs,
    stderr: result.stderr,
  };
}
