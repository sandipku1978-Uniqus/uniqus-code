import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { safeChildEnv } from "./safeEnv.js";
import * as sb from "./agent/sandbox.js";
import type { Sandbox } from "./agent/sandbox.js";

export type PackageManager = "npm" | "pnpm" | "yarn";

const DEPS_STATE_FILE = ".cache/uniqus/deps.sha256";
const DEPS_STATE_VERSION = "uniqus-deps-v2";
const DEPENDENCY_INPUT_FILES = [
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "yarn.lock",
  ".npmrc",
  ".yarnrc",
  ".yarnrc.yml",
] as const;

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
): Promise<PackageManager | null> {
  const hasPackageJson = await exists(path.join(sandboxDir, "package.json"));
  if (!hasPackageJson) return null;

  // Pick the manager based on which lockfile is present (mirrors npm's own
  // detection). Default to npm when nothing matches.
  const manager: PackageManager = await exists(path.join(sandboxDir, "pnpm-lock.yaml"))
    ? "pnpm"
    : await exists(path.join(sandboxDir, "yarn.lock"))
      ? "yarn"
      : "npm";

  // A populated node_modules directory is not proof that the CURRENT
  // manifest is installed. It may be a partial tree left by an interrupted
  // install, or package.json may have changed since the last successful run.
  // Only skip when the tree is populated AND its success marker matches the
  // current manifest/lockfiles/runtime fingerprint.
  if (!(await hasEntries(path.join(sandboxDir, "node_modules")))) return manager;
  const expected = await dependencyFingerprint(sandboxDir, manager);
  const recorded = await readTrimmed(path.join(sandboxDir, DEPS_STATE_FILE));
  return recorded === expected ? null : manager;
}

/** Fingerprint everything that can materially change an installed JS tree. */
export async function dependencyFingerprint(
  sandboxDir: string,
  manager: PackageManager,
): Promise<string> {
  const hash = createHash("sha256");
  hash.update(`${DEPS_STATE_VERSION}\n${manager}\n`);
  hash.update(
    `node=${process.version}|platform=${process.platform}|arch=${process.arch}|abi=${process.versions.modules}\n`,
  );
  for (const name of DEPENDENCY_INPUT_FILES) {
    hash.update(`file=${name}\n`);
    try {
      hash.update(await fs.readFile(path.join(sandboxDir, name)));
    } catch {
      hash.update("<missing>");
    }
    hash.update("\n");
  }
  return hash.digest("hex");
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
  manager: PackageManager,
  onStderr?: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<InstallResult> {
  const args =
    manager === "pnpm"
      ? ["install", "--prefer-offline"]
      : manager === "yarn"
      ? ["install", "--frozen-lockfile"]
      : ["install", "--no-audit", "--no-fund", "--prefer-offline", "--engine-strict"];

  const start = Date.now();
  return new Promise((resolve) => {
    const executable = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : manager;
    const executableArgs =
      process.platform === "win32"
        ? ["/d", "/s", "/c", `${manager} ${args.join(" ")}`]
        : args;
    const child = spawn(executable, executableArgs, {
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

async function hasEntries(dir: string): Promise<boolean> {
  try {
    return (await fs.readdir(dir)).length > 0;
  } catch {
    return false;
  }
}

async function readTrimmed(file: string): Promise<string | null> {
  try {
    return (await fs.readFile(file, "utf8")).trim();
  } catch {
    return null;
  }
}

async function recordDependencyState(
  sandboxDir: string,
  manager: PackageManager,
): Promise<void> {
  const statePath = path.join(sandboxDir, DEPS_STATE_FILE);
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, `${await dependencyFingerprint(sandboxDir, manager)}\n`, "utf8");
}

// ── Unified, VM-aware, serialized installer ──────────────────────────────────

/**
 * The subdirectory a run command targets, parsed from a leading `cd <dir> &&`
 * prefix (`cd my-app && npm run dev`) — the documented convention for projects
 * that live below the sandbox root. This is exactly the case the root-only
 * dependency probe used to miss: for a subdirectory project the probe saw no
 * package.json at the root, silently skipped the install, and the dev server
 * then started dep-less and crashed at first compile ("Cannot find module
 * 'react'") — surfacing to the user as 2 minutes of preview "warming up"
 * flashes ending in a 502 ECONNREFUSED. Returns null for root commands,
 * absolute paths, or anything traversal-shaped — callers then probe the root
 * exactly as before.
 */
export function runCommandSubdir(command: string): string | null {
  const m = command.match(/^\s*cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))\s*&&/);
  if (!m) return null;
  const dir = (m[1] ?? m[2] ?? m[3] ?? "").trim();
  if (!dir || dir === "." || dir.startsWith("/") || dir.startsWith("~") || /^[A-Za-z]:/.test(dir)) {
    return null;
  }
  if (dir.split(/[\\/]/).some((p) => p === "..")) return null;
  return dir;
}

/** POSIX-quote a path for the in-VM /bin/sh (single-quote, escape embedded quotes). */
function shq(p: string): string {
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

export interface EnsureDepsResult {
  /** Whether we actually ran an install (false = nothing to do / already present). */
  attempted: boolean;
  /** False only when an attempted install exited non-zero. */
  ok: boolean;
  manager: PackageManager | null;
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
    onStart?: (manager: PackageManager) => void;
    /**
     * Sandbox-relative subdirectory to probe + install in, for projects that
     * live below the sandbox root (derive it from the run command with
     * {@link runCommandSubdir}). Null/undefined ⇒ the sandbox root, as before.
     */
    dir?: string | null;
  } = {},
): Promise<EnsureDepsResult> {
  return withInstallLock(projectId, () => ensureDepsOnce(sandbox, opts));
}

async function ensureDepsOnce(
  sandbox: Sandbox,
  opts: {
    signal?: AbortSignal;
    onStderr?: (s: string) => void;
    onStart?: (manager: PackageManager) => void;
    dir?: string | null;
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

  // Subdirectory projects (`cd my-app && npm run dev`): probe + install INSIDE
  // that directory. A failed `cd` (dir missing) makes the probe print nothing →
  // manager null → clean no-op, same as "no package.json".
  const cdPrefix = opts.dir ? `cd ${shq(opts.dir)} && ` : "";

  if (sandbox.vm) {
    // Probe the VM filesystem. A non-empty node_modules tree is only current
    // when the marker from the last successful install matches today's inputs.
    const probe = await sb.runCommand(
      sandbox,
      cdPrefix + vmDependencyProbeCommand(),
      30_000,
      opts.signal,
    );
    if (probe.exitCode !== 0) {
      throw new Error(
        `dependency probe failed${opts.dir ? ` in ${opts.dir}` : ""}: ${
          probe.stderr || probe.stdout || `exit ${probe.exitCode}`
        }`,
      );
    }
    const installMatch = probe.stdout.match(/^install:(npm|pnpm|yarn)$/m);
    const manager = (installMatch?.[1] as PackageManager | undefined) ?? null;
    if (!manager) {
      if (/^(?:none|present:(?:npm|pnpm|yarn))$/m.test(probe.stdout)) return none();
      throw new Error(`dependency probe returned an unexpected response: ${probe.stdout.trim()}`);
    }
    opts.onStart?.(manager);
    const args =
      manager === "pnpm"
        ? "install --prefer-offline"
        : manager === "yarn"
          ? "install --frozen-lockfile"
          : "install --no-audit --no-fund --prefer-offline --engine-strict";
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
    const r = await sb.runCommand(
      sandbox,
      `${cdPrefix}${cacheEnv} ${manager} ${args}`,
      5 * 60_000,
      opts.signal,
    );
    let stateError = "";
    if (r.exitCode === 0) {
      const state = await sb.runCommand(
        sandbox,
        `${cdPrefix}${vmRecordDependencyStateCommand(manager)}`,
        30_000,
        opts.signal,
      );
      if (state.exitCode !== 0) stateError = state.stderr || state.stdout;
    }
    return {
      attempted: true,
      ok: r.exitCode === 0 && !stateError,
      manager,
      durationMs: Date.now() - start,
      stderr: stateError || r.stderr || r.stdout,
    };
  }

  // Host path: same subdirectory awareness, with a containment guard so a
  // hostile `cd` prefix can never walk the install out of the sandbox mirror.
  let hostDir = sandbox.rootDir;
  if (opts.dir) {
    const resolved = path.resolve(sandbox.rootDir, opts.dir);
    if (resolved.startsWith(path.resolve(sandbox.rootDir) + path.sep)) hostDir = resolved;
  }
  const manager = await needsInstall(hostDir);
  if (!manager) return none();
  opts.onStart?.(manager);
  const result = await runInstall(hostDir, manager, opts.onStderr, opts.signal);
  let stateError = "";
  if (result.ok) {
    try {
      // Compute this after the install because npm may have created or updated
      // package-lock.json, which is itself part of the desired-state hash.
      await recordDependencyState(hostDir, manager);
    } catch (err) {
      stateError = `installed dependencies but could not record dependency state: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  }
  return {
    attempted: true,
    ok: result.ok && !stateError,
    manager,
    durationMs: result.durationMs,
    stderr: stateError || result.stderr,
  };
}

/** Shell fragment shared by the VM probe and post-install marker write. */
function vmFingerprintCommand(): string {
  const files = DEPENDENCY_INPUT_FILES.map(shq).join(" ");
  return (
    "fingerprint=$({ " +
    `printf '%s\\n' ${shq(DEPS_STATE_VERSION)} \"$manager\"; ` +
    "node -e 'process.stdout.write(`node=${process.version}|platform=${process.platform}|arch=${process.arch}|abi=${process.versions.modules}\\n`)'; " +
    `for file in ${files}; do printf 'file=%s\\n' \"$file\"; ` +
    "if [ -f \"$file\" ]; then cat \"$file\"; else printf '<missing>'; fi; printf '\\n'; done; " +
    "} | sha256sum | awk '{print $1}')"
  );
}

function vmDependencyProbeCommand(): string {
  return (
    "if [ ! -f package.json ]; then echo none; exit 0; fi; " +
    "if [ -f pnpm-lock.yaml ]; then manager=pnpm; " +
    "elif [ -f yarn.lock ]; then manager=yarn; else manager=npm; fi; " +
    `${vmFingerprintCommand()}; ` +
    `state=${shq(DEPS_STATE_FILE)}; ` +
    'if [ -d node_modules ] && [ -n "$(ls -A node_modules 2>/dev/null)" ] && ' +
    '[ -f "$state" ] && [ "$(cat "$state" 2>/dev/null)" = "$fingerprint" ]; ' +
    'then echo "present:$manager"; else echo "install:$manager"; fi'
  );
}

function vmRecordDependencyStateCommand(manager: PackageManager): string {
  return (
    `manager=${manager}; ${vmFingerprintCommand()}; ` +
    `state=${shq(DEPS_STATE_FILE)}; mkdir -p \"$(dirname \"$state\")\" && ` +
    'printf "%s\\n" "$fingerprint" > "$state"'
  );
}
