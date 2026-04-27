import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

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
 * orchestrator forever.
 */
export async function runInstall(
  sandboxDir: string,
  manager: "npm" | "pnpm" | "yarn",
  onStderr?: (chunk: string) => void,
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
      stdio: ["ignore", "ignore", "pipe"],
      // npm script PATH munging is irrelevant here — we're invoking the
      // package manager itself, which lives in the system PATH on Railway's
      // base image.
    });
    let stderr = "";
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
    child.once("error", (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        stderr: `[spawn ${manager}] ${err.message}\n${stderr}`,
        durationMs: Date.now() - start,
      });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, stderr, durationMs: Date.now() - start });
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
