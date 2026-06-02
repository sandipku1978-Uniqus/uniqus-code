import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { safeChildEnv } from "../safeEnv.js";

/**
 * Per-tool-call checkpoints (Plan §3.5).
 *
 * After every successful write_file / edit_file / run_command, we commit
 * the entire sandbox tree into a shadow git repo SIBLING to the sandbox
 * (not inside it — we don't want our shadow .git to fight the user's
 * real .git, which often comes with imported repos). The shadow lives at
 * `<sandboxParent>/<projectId>.checkpoints/.git` and uses `git --git-dir
 * --work-tree` to point at the sandbox without touching user-visible files.
 *
 * GC policy: keep the last 20 commits + every 10th + everything tagged
 * (named restore points). Run lazily in the background — never blocking
 * the agent loop.
 *
 * Restore is a non-destructive action from the user's POV: we run
 * `git checkout <sha> -- .` against the work-tree, which overwrites
 * matching paths but doesn't delete files added after that commit. Phase-3
 * adds a "hard restore" mode that mirrors the commit exactly.
 */

const KEEP_RECENT = 20;
const KEEP_EVERY = 10;
const CHECKPOINT_EXCLUDES = [
  "node_modules/",
  ".next/",
  ".turbo/",
  "dist/",
  "build/",
  ".venv/",
  "venv/",
  "__pycache__/",
  ".env",
  ".env.*",
  "*.log",
];

function shadowDir(sandboxDir: string, projectId: string): string {
  // Place sibling-to-sandbox so the shadow .git never appears in the
  // file tree. SANDBOX_ROOT/<id>/ → SANDBOX_ROOT/<id>.checkpoints/.git
  const parent = path.dirname(sandboxDir);
  return path.join(parent, `${projectId}.checkpoints`);
}

async function exec(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      cwd,
      env: safeChildEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d) => (stdout += d.toString()));
    proc.stderr?.on("data", (d) => (stderr += d.toString()));
    proc.once("error", (err) => resolve({ ok: false, stdout, stderr: err.message, code: 1 }));
    proc.once("close", (code) => resolve({ ok: code === 0, stdout, stderr, code }));
  });
}

async function ensureShadow(sandboxDir: string, projectId: string): Promise<{ shadow: string; gitDir: string } | null> {
  if (!existsSync(sandboxDir)) return null;
  const shadow = shadowDir(sandboxDir, projectId);
  const gitDir = path.join(shadow, ".git");
  if (!existsSync(gitDir)) {
    await fs.mkdir(shadow, { recursive: true });
    const init = await exec("git", ["init", "--quiet", "--initial-branch=checkpoints"], shadow);
    if (!init.ok) {
      // Maybe `git` isn't installed. Bail; the rest of the system still works.
      console.error(`[checkpoints] git init failed: ${init.stderr}`);
      return null;
    }
    // Configure a stable identity so commits don't fail under no-config envs.
    await exec("git", ["--git-dir", gitDir, "config", "user.email", "agent@uniqus.local"], shadow);
    await exec("git", ["--git-dir", gitDir, "config", "user.name", "Uniqus Agent"], shadow);
    // Bypass any global pre-commit hooks the user happened to install.
    await exec("git", ["--git-dir", gitDir, "config", "core.hooksPath", "/dev/null"], shadow);
  }
  await writeCheckpointExcludes(gitDir);
  return { shadow, gitDir };
}

async function writeCheckpointExcludes(gitDir: string): Promise<void> {
  const infoDir = path.join(gitDir, "info");
  await fs.mkdir(infoDir, { recursive: true });
  const excludeFile = path.join(infoDir, "exclude");
  let existing = "";
  try {
    existing = await fs.readFile(excludeFile, "utf-8");
  } catch {}
  const lines = new Set(existing.split(/\r?\n/).filter(Boolean));
  let changed = false;
  for (const pattern of CHECKPOINT_EXCLUDES) {
    if (!lines.has(pattern)) {
      lines.add(pattern);
      changed = true;
    }
  }
  if (changed || !existing) {
    await fs.writeFile(excludeFile, `${Array.from(lines).join("\n")}\n`, "utf-8");
  }
}

export interface CheckpointMeta {
  sha: string;
  short_sha: string;
  message: string;
  created_at: string;
}

/**
 * Per-project commit queue. Multiple parallel tool calls all want to
 * checkpoint at once, and `git commit` takes an exclusive lock on
 * `index.lock`. Without serialization they race and one of every two or
 * three commits fails with "Unable to create '...index.lock': File exists".
 *
 * Chain commits per project on a Promise so they execute in order. A
 * failure in one doesn't poison the queue.
 */
const commitQueues = new Map<string, Promise<unknown>>();

export async function commitCheckpoint(
  sandboxDir: string,
  projectId: string,
  message: string,
): Promise<CheckpointMeta | null> {
  const prev = commitQueues.get(projectId) ?? Promise.resolve();
  const next = prev.then(() => doCommit(sandboxDir, projectId, message)).catch((err) => {
    console.error(`[checkpoints] commit queue entry crashed:`, err);
    return null;
  });
  commitQueues.set(projectId, next);
  return next as Promise<CheckpointMeta | null>;
}

async function doCommit(
  sandboxDir: string,
  projectId: string,
  message: string,
): Promise<CheckpointMeta | null> {
  const ctx = await ensureShadow(sandboxDir, projectId);
  if (!ctx) return null;
  const gitArgs = (...rest: string[]) => [
    "--git-dir",
    ctx.gitDir,
    "--work-tree",
    sandboxDir,
    ...rest,
  ];
  // Defensive: clear a stale index.lock left behind by a previous crash.
  // (Normally serialization prevents conflicts, but a crashed prior
  // orchestrator can leave one.)
  try {
    await fs.rm(path.join(ctx.gitDir, "index.lock"), { force: true });
  } catch {}
  const add = await exec("git", gitArgs("add", "-A"), sandboxDir);
  if (!add.ok) {
    console.error(`[checkpoints] git add failed: ${add.stderr}`);
    return null;
  }
  // Allow empty in case nothing actually changed (e.g. an edit_file no-op).
  const commit = await exec(
    "git",
    gitArgs("commit", "--allow-empty", "-m", message.slice(0, 200)),
    sandboxDir,
  );
  if (!commit.ok) {
    console.error(`[checkpoints] git commit failed: ${commit.stderr}`);
    return null;
  }
  const rev = await exec("git", gitArgs("rev-parse", "HEAD"), sandboxDir);
  const sha = rev.stdout.trim();
  // Background GC; never blocks the agent loop.
  void runGc(ctx.gitDir, sandboxDir).catch(() => {});
  return {
    sha,
    short_sha: sha.slice(0, 8),
    message,
    created_at: new Date().toISOString(),
  };
}

async function runGc(gitDir: string, sandboxDir: string): Promise<void> {
  // List all commits oldest-last, keep the last KEEP_RECENT, keep every
  // KEEP_EVERY-th of the rest. The simplest "keep" strategy is a graft:
  // we just call `git gc --prune=now` after deleting orphan refs. For
  // Phase-2 we leave history intact and rely on git's own GC; agressive
  // pruning lands when storage cost shows up in dogfood.
  // Stub: just call git gc which trims unreachable objects.
  await exec("git", ["--git-dir", gitDir, "--work-tree", sandboxDir, "gc", "--quiet"], sandboxDir);
}

export async function listCheckpoints(
  sandboxDir: string,
  projectId: string,
  limit = 50,
): Promise<CheckpointMeta[]> {
  const ctx = await ensureShadow(sandboxDir, projectId);
  if (!ctx) return [];
  const log = await exec(
    "git",
    [
      "--git-dir",
      ctx.gitDir,
      "--work-tree",
      sandboxDir,
      "log",
      `-n`,
      String(Math.min(limit, KEEP_RECENT * 5)),
      "--format=%H%x09%ct%x09%s",
    ],
    sandboxDir,
  );
  if (!log.ok) return [];
  return log.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, ct, ...rest] = line.split("\t");
      const created = new Date(Number(ct) * 1000).toISOString();
      return {
        sha,
        short_sha: sha.slice(0, 8),
        message: rest.join("\t"),
        created_at: created,
      };
    });
}

export async function restoreCheckpoint(
  sandboxDir: string,
  projectId: string,
  sha: string,
): Promise<{ ok: true; restored_to: string } | { ok: false; error: string }> {
  if (!/^[0-9a-f]{6,40}$/.test(sha)) {
    return { ok: false, error: "invalid sha" };
  }
  const ctx = await ensureShadow(sandboxDir, projectId);
  if (!ctx) return { ok: false, error: "checkpoints unavailable (git not installed?)" };
  // Stash a "pre-restore" checkpoint so the user can rewind the rewind.
  // (This already goes through the per-project commit queue.)
  await commitCheckpoint(sandboxDir, projectId, `pre-restore: rolling back to ${sha.slice(0, 8)}`);
  // Run the checkout through the SAME per-project queue commitCheckpoint uses
  // so it can't race an in-flight checkpoint commit on the shadow repo and hit
  // index.lock contention / a failed restore (B-14).
  const prev = commitQueues.get(projectId) ?? Promise.resolve();
  const checkoutP = prev.then(() =>
    exec(
      "git",
      [
        "--git-dir",
        ctx.gitDir,
        "--work-tree",
        sandboxDir,
        "checkout",
        sha,
        "--",
        ".",
      ],
      sandboxDir,
    ),
  );
  // Keep the queue tail intact even if this checkout rejects, so a failure
  // here doesn't poison later checkpoint commits.
  commitQueues.set(projectId, checkoutP.catch(() => null));
  const checkout = await checkoutP;
  if (!checkout.ok) {
    return { ok: false, error: checkout.stderr || "checkout failed" };
  }
  return { ok: true, restored_to: sha };
}

export async function clearCheckpoints(sandboxDir: string, projectId: string): Promise<void> {
  const shadow = shadowDir(sandboxDir, projectId);
  await fs.rm(shadow, { recursive: true, force: true }).catch(() => {});
}
