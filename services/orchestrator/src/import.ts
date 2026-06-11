import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import AdmZip from "adm-zip";
import { safeChildEnv } from "./safeEnv.js";

// Cap on uncompressed extracted size (200 MB) to prevent zip-bomb DoS.
const MAX_TOTAL_SIZE = 200 * 1024 * 1024;
// Cap per-file size (50 MB).
const MAX_FILE_SIZE = 50 * 1024 * 1024;
// Cap on cloned repo size (500 MB). Without this, a malicious or accidental
// large repo (game assets, datasets, monorepos) can fill the sandbox disk and
// take down the orchestrator for everyone. Checked post-clone; we delete the
// directory and reject if exceeded.
const MAX_CLONE_SIZE = 500 * 1024 * 1024;

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

  const stripPrefix = detectSingleRoot(entries.map((e) => e.entryName));

  // True for an entry that extraction below will actually write — i.e. NOT a
  // skipped top dir (.git/node_modules/dist/…) and NOT a traversal escape.
  // The size pre-check must use the same filter, otherwise a normal project
  // zip that bundles node_modules/.git (which we silently skip) is wrongly
  // rejected as "too large" even though only the small source tree is written
  // (C-50). The real-bytes guard during extraction still enforces the cap.
  const willExtract = (e: AdmZip.IZipEntry): boolean => {
    if (e.isDirectory) return false;
    let rel = e.entryName.replaceAll("\\", "/");
    if (stripPrefix && rel.startsWith(stripPrefix)) rel = rel.slice(stripPrefix.length);
    if (!rel) return false;
    if (SKIP_TOP_DIRS.has(rel.split("/")[0])) return false;
    return true;
  };

  // Total size pre-check (uncompressed sizes from headers; cheap to read).
  let total = 0;
  for (const e of entries) {
    if (!willExtract(e)) continue;
    total += e.header.size;
    if (e.header.size > MAX_FILE_SIZE) {
      throw new Error(`zip entry too large: ${e.entryName} (${e.header.size} bytes)`);
    }
  }
  if (total > MAX_TOTAL_SIZE) {
    throw new Error(`zip too large: ${total} bytes uncompressed (max ${MAX_TOTAL_SIZE})`);
  }

  const root = path.resolve(destDir);
  let count = 0;
  // Running total of bytes actually written. The header-based pre-check above
  // can be defeated by an archive with lying uncompressed sizes, so we also
  // enforce MAX_TOTAL_SIZE against real decompressed bytes here (prevents the
  // zip-bomb cap from being bypassed).
  let writtenBytes = 0;

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
    // Decompress once and reuse for both the size check and the write so we
    // don't double-decompress (and so the cap reflects real bytes).
    const data = e.getData();
    writtenBytes += data.length;
    if (writtenBytes > MAX_TOTAL_SIZE) {
      throw new Error(
        `zip too large: exceeded ${MAX_TOTAL_SIZE} bytes during extraction (header sizes lied)`,
      );
    }
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
    count++;
  }

  // Every entry was skipped (e.g. an archive rooted entirely under .git/ or
  // node_modules/). Surface an actionable error instead of silently returning a
  // 201 "success" with an empty project — the route's catch rolls the project
  // back to a 400.
  if (count === 0) {
    throw new Error(
      "archive contained no importable files (only .git/node_modules/build artifacts, or all entries were skipped)",
    );
  }

  return { files_imported: count, total_bytes: writtenBytes, stripped_root: stripPrefix };
}

/**
 * Returns the common single-root prefix (with trailing `/`) if every entry
 * shares the same first path segment, else null.
 */
export function detectSingleRoot(names: string[]): string | null {
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
  // Never strip a root that's itself a skip-dir (e.g. `.git/`): stripping it
  // would then skip every entry, yielding a zero-file "import" with no error.
  if (common !== null && SKIP_TOP_DIRS.has(common.slice(0, -1))) return null;
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
  // `-c core.symlinks=false` makes git materialize any symlink in the repo as a
  // plain text file containing its target, instead of a real symlink. This is
  // defense-in-depth against symlink-following file reads: an attacker repo
  // can't plant `link -> /proc/self/environ` (or any host path) into the
  // sandbox to later exfiltrate orchestrator env/secrets. The read sinks also
  // realpath-guard, but stopping the symlink at the source is cheaper and total.
  const args = ["clone", "--depth", "1", "-c", "core.symlinks=false"];
  if (input.branch) args.push("--branch", input.branch);
  args.push(cloneUrl, destDir);

  await runGit(args);

  // Drop .git so the sandbox tree matches a clean export.
  await fs.rm(path.join(destDir, ".git"), { recursive: true, force: true });

  // Walk to count files + bytes for the response. Bail with a hard error if
  // the clone exceeds MAX_CLONE_SIZE so callers can roll back the project
  // instead of leaving a giant tree on disk.
  let count = 0;
  let bytes = 0;
  await walk(destDir, async (full) => {
    const stat = await fs.stat(full);
    if (stat.isFile()) {
      count++;
      bytes += stat.size;
    }
  });

  if (bytes > MAX_CLONE_SIZE) {
    throw new Error(
      `cloned repo is too large: ${(bytes / (1024 * 1024)).toFixed(1)} MB ` +
        `(limit ${MAX_CLONE_SIZE / (1024 * 1024)} MB). Try a smaller repo or import a subdirectory.`,
    );
  }

  return { files_imported: count, total_bytes: bytes, stripped_root: null };
}

/**
 * Scrub an injected PAT (`x-access-token:<pat>@`) from any text before it can
 * land in an error message or log. Pure so it can be unit-tested directly.
 */
export function scrubPat(text: string): string {
  return text.replace(/x-access-token:[^@]+@/g, "x-access-token:***@");
}

export function buildCloneUrl(repoUrl: string, pat?: string): string {
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
    const child = spawn("git", args, {
      env: safeChildEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
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
      const safe = scrubPat(stderr);
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
