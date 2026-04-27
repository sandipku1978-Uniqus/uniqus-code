import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import AdmZip from "adm-zip";

// Cap on uncompressed extracted size (200 MB) to prevent zip-bomb DoS.
const MAX_TOTAL_SIZE = 200 * 1024 * 1024;
// Cap per-file size (50 MB).
const MAX_FILE_SIZE = 50 * 1024 * 1024;

const SKIP_TOP_DIRS = new Set([".git", "node_modules", ".next", "dist", "build"]);

export interface ImportResult {
  files_imported: number;
  total_bytes: number;
  /** True when the archive had a single root dir we stripped (e.g. `repo-main/`). */
  stripped_root: string | null;
}

/**
 * Extract a zip Buffer into the destination directory.
 *
 * Behavior:
 * - Refuses to extract if the destination is non-empty (caller must use a fresh dir).
 * - Skips entries that escape the destination via `..`.
 * - Skips `.git`, `node_modules`, etc.
 * - Detects the GitHub-style "single root folder" pattern (`my-repo-main/...`)
 *   and strips it so files land directly in the destination.
 * - Rejects archives larger than MAX_TOTAL_SIZE uncompressed.
 */
export async function importZip(
  zipBuffer: Buffer,
  destDir: string,
): Promise<ImportResult> {
  await ensureEmpty(destDir);

  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();

  // Total size pre-check (uncompressed sizes from headers; cheap to read).
  let total = 0;
  for (const e of entries) {
    if (e.isDirectory) continue;
    total += e.header.size;
    if (e.header.size > MAX_FILE_SIZE) {
      throw new Error(`zip entry too large: ${e.entryName} (${e.header.size} bytes)`);
    }
  }
  if (total > MAX_TOTAL_SIZE) {
    throw new Error(`zip too large: ${total} bytes uncompressed (max ${MAX_TOTAL_SIZE})`);
  }

  const stripPrefix = detectSingleRoot(entries.map((e) => e.entryName));
  const root = path.resolve(destDir);
  let count = 0;

  for (const e of entries) {
    if (e.isDirectory) continue;
    let rel = e.entryName.replaceAll("\\", "/");
    if (stripPrefix && rel.startsWith(stripPrefix)) {
      rel = rel.slice(stripPrefix.length);
    }
    if (!rel) continue;
    const top = rel.split("/")[0];
    if (SKIP_TOP_DIRS.has(top)) continue;

    const full = path.resolve(root, rel);
    if (full !== root && !full.startsWith(root + path.sep)) {
      // path traversal attempt; skip.
      continue;
    }
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, e.getData());
    count++;
  }

  return { files_imported: count, total_bytes: total, stripped_root: stripPrefix };
}

/**
 * Returns the common single-root prefix (with trailing `/`) if every entry
 * shares the same first path segment, else null.
 */
function detectSingleRoot(names: string[]): string | null {
  if (names.length === 0) return null;
  let common: string | null = null;
  for (const n of names) {
    const norm = n.replaceAll("\\", "/");
    const slash = norm.indexOf("/");
    if (slash <= 0) return null; // top-level file → no common root
    const head = norm.slice(0, slash + 1);
    if (common === null) common = head;
    else if (common !== head) return null;
  }
  return common;
}

async function ensureEmpty(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const list = await fs.readdir(dir);
  if (list.length > 0) {
    throw new Error(
      `import target is not empty (${list.length} entries). Create a fresh project for imports.`,
    );
  }
}

export interface GithubImportInput {
  repo_url: string;
  branch?: string;
  pat?: string;
}

/**
 * Clone a GitHub repository into the destination directory.
 *
 * The PAT, if provided, is injected into the URL as `https://x-access-token:{pat}@github.com/...`
 * so we don't have to set up a credential helper. PAT is never logged.
 *
 * After clone, `.git/` is removed — the user gets the source tree, not the history.
 * We can re-introduce git tracking later (Phase 3 GitHub bidirectional sync).
 */
export async function importGithub(
  input: GithubImportInput,
  destDir: string,
): Promise<ImportResult> {
  await ensureEmpty(destDir);

  const cloneUrl = buildCloneUrl(input.repo_url, input.pat);
  const args = ["clone", "--depth", "1"];
  if (input.branch) args.push("--branch", input.branch);
  args.push(cloneUrl, destDir);

  await runGit(args);

  // Drop .git so the sandbox tree matches a clean export.
  await fs.rm(path.join(destDir, ".git"), { recursive: true, force: true });

  // Walk to count files + bytes for the response.
  let count = 0;
  let bytes = 0;
  await walk(destDir, async (full) => {
    const stat = await fs.stat(full);
    if (stat.isFile()) {
      count++;
      bytes += stat.size;
    }
  });

  return { files_imported: count, total_bytes: bytes, stripped_root: null };
}

function buildCloneUrl(repoUrl: string, pat?: string): string {
  const trimmed = repoUrl.trim();
  if (!pat) return trimmed;
  // Only inject for https URLs; ssh URLs (git@github.com:...) ignore PAT.
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return trimmed;
  }
  if (parsed.protocol !== "https:") return trimmed;
  parsed.username = "x-access-token";
  parsed.password = pat;
  return parsed.toString();
}

function runGit(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      // ENOENT means git isn't installed on the orchestrator host. Without
      // a clear message users see "spawn git ENOENT" which doesn't tell
      // them what to do — the fix is on the build side (nixpacks.toml /
      // Dockerfile aptPkgs), not in the request.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new Error(
            "git is not installed on the orchestrator host. Add it to the build image (nixpacks.toml: aptPkgs = [\"git\", ...]) and redeploy.",
          ),
        );
      } else {
        reject(err);
      }
    });
    child.on("close", (code) => {
      if (code === 0) return resolve();
      // Scrub PAT from any error surface, just in case.
      const safe = stderr.replace(/x-access-token:[^@]+@/g, "x-access-token:***@");
      reject(new Error(`git clone failed (exit ${code}): ${safe.slice(-2000)}`));
    });
  });
}

async function walk(
  dir: string,
  visit: (fullPath: string) => Promise<void>,
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_TOP_DIRS.has(e.name)) continue;
      await walk(full, visit);
    } else {
      await visit(full);
    }
  }
}
