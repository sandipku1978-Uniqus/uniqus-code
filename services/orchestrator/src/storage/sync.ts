import { promises as fs } from "node:fs";
import path from "node:path";
import * as storage from "./client.js";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  ".cache",
  "dist",
  "build",
  "out",
  "coverage",
  "__pycache__",
  ".pytest_cache",
  "target",
  "vendor",
  ".venv",
  "venv",
]);

const SKIP_FILES = new Set([".DS_Store", "Thumbs.db"]);
const SKIP_EXTENSIONS = new Set([".pyc", ".log"]);
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const DELETE_BATCH_SIZE = 100;
/**
 * Concurrency for {@link ProjectSync.hydrateFromStorage}. 8 is the sweet spot
 * we measured: above ~10 the Supabase Storage API starts returning 429s on
 * very chatty hydrations; below 8 we're paying the round-trip serially again.
 */
const HYDRATE_BATCH_SIZE = 8;

function shouldSync(relPath: string): boolean {
  const parts = relPath.split("/");
  for (const part of parts) {
    if (SKIP_DIRS.has(part)) return false;
  }
  const last = parts[parts.length - 1];
  if (SKIP_FILES.has(last)) return false;
  const ext = path.extname(last).toLowerCase();
  if (SKIP_EXTENSIONS.has(ext)) return false;
  return true;
}

function isMissingPath(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

class ProjectSync {
  private manifest = new Map<string, number>(); // relPath → mtimeMs
  private syncInFlight: Promise<number> | null = null;
  /** At most one follow-up walk is needed no matter how many callers coalesce. */
  private syncAgain = false;

  constructor(
    private readonly sandboxDir: string,
    private readonly projectId: string,
  ) {}

  /** Walk local sandbox and snapshot mtimes. Call after WS connect. */
  async initialize(): Promise<void> {
    const next = new Map<string, number>();
    const complete = await this.walkLocal(this.sandboxDir, async (rel, mtimeMs) => {
      next.set(rel, mtimeMs);
    });
    if (!complete) throw new Error("project sync initialization walk was incomplete");
    this.manifest = next;
  }

  isLocalEmpty(): boolean {
    return this.manifest.size === 0;
  }

  /**
   * Pull every file from Storage into the local sandbox dir. Used when local
   * is empty (new device, accidental delete, OneDrive offload). Returns the
   * count of files restored.
   *
   * Files are downloaded in parallel batches — the Supabase Storage API is
   * round-trip-bound (~200 ms each) and the orchestrator was previously
   * paying that cost serially, which made opening a 34-file project take
   * ~60 s. Batches of 8 bring it down to ~5 s without overwhelming Storage's
   * per-project rate limits.
   */
  async hydrateFromStorage(): Promise<number> {
    let remoteFiles: string[];
    try {
      remoteFiles = await storage.listAll(this.projectId);
    } catch (err) {
      console.error(`hydrate ${this.projectId}: listAll failed:`, err);
      return 0;
    }
    const targets = remoteFiles.filter(shouldSync);
    let count = 0;
    const batchSize = HYDRATE_BATCH_SIZE;
    for (let i = 0; i < targets.length; i += batchSize) {
      const batch = targets.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (relPath) => {
          try {
            const buf = await storage.download(this.projectId, relPath);
            if (!buf) return false;
            const fullLocal = path.resolve(this.sandboxDir, relPath);
            await fs.mkdir(path.dirname(fullLocal), { recursive: true });
            await fs.writeFile(fullLocal, buf);
            const stat = await fs.stat(fullLocal);
            this.manifest.set(relPath, stat.mtimeMs);
            return true;
          } catch (err) {
            console.error(`hydrate ${this.projectId}: ${relPath} failed:`, err);
            return false;
          }
        }),
      );
      for (const ok of results) if (ok) count++;
    }
    return count;
  }

  /** Push a single file to Storage. Used after write_file/edit_file. */
  async syncFile(relPath: string): Promise<void> {
    if (!shouldSync(relPath)) return;
    const fullLocal = path.resolve(this.sandboxDir, relPath);
    let stat;
    try {
      stat = await fs.stat(fullLocal);
    } catch (error) {
      if (isMissingPath(error) && this.manifest.has(relPath)) {
        await storage.remove(this.projectId, [relPath]);
        this.manifest.delete(relPath);
        return;
      }
      if (isMissingPath(error)) return;
      throw error;
    }
    if (stat.size > MAX_FILE_SIZE) return;
    const content = await fs.readFile(fullLocal);
    await storage.upload(this.projectId, relPath, content);
    this.manifest.set(relPath, stat.mtimeMs);
  }

  /**
   * Walk local sandbox; push files with mtime newer than our manifest.
   * Used after run_command (which may have created/modified arbitrary files).
   * Concurrent callers share one pass sequence. A call arriving mid-walk asks
   * for one coalesced follow-up pass, which catches files created after the
   * first directory snapshot; every caller awaits that follow-up. Upload errors
   * are reported only after the walk finishes, while successful paths still
   * advance the manifest and failed paths remain dirty for a later retry.
   */
  syncChanges(): Promise<number> {
    if (this.syncInFlight) {
      this.syncAgain = true;
      return this.syncInFlight;
    }
    const run = this.runSyncPasses();
    this.syncInFlight = run;
    return run;
  }

  private async runSyncPasses(): Promise<number> {
    let total = 0;
    let lastFailure: unknown = null;
    try {
      do {
        this.syncAgain = false;
        try {
          total += await this.runSyncPass();
          lastFailure = null;
        } catch (error) {
          lastFailure = error;
        }
      } while (this.syncAgain);
      if (lastFailure) throw lastFailure;
      return total;
    } finally {
      this.syncInFlight = null;
    }
  }

  private async runSyncPass(): Promise<number> {
    let count = 0;
    const failures: Error[] = [];
    const seen = new Set<string>();
    const complete = await this.walkLocal(this.sandboxDir, async (rel, mtimeMs) => {
      const last = this.manifest.get(rel);
      if (last !== undefined && mtimeMs <= last) return;
      try {
        await this.syncFile(rel);
        count++;
      } catch (err) {
        console.error(`syncChanges ${rel} failed:`, err);
        const detail = err instanceof Error ? err.message : String(err);
        failures.push(new Error(`${rel}: ${detail}`, { cause: err }));
      }
    }, seen);
    if (!complete) {
      failures.push(
        new Error("local file walk was incomplete; remote deletion reconciliation was skipped"),
      );
    } else {
      const missing: string[] = [];
      for (const rel of this.manifest.keys()) {
        if (seen.has(rel)) continue;
        const full = path.resolve(this.sandboxDir, rel);
        try {
          const stat = await fs.stat(full);
          if (stat.isFile()) continue;
        } catch (error) {
          if (!isMissingPath(error)) {
            const detail = error instanceof Error ? error.message : String(error);
            failures.push(new Error(`${rel}: deletion check failed: ${detail}`, { cause: error }));
            continue;
          }
        }
        missing.push(rel);
      }
      for (let i = 0; i < missing.length; i += DELETE_BATCH_SIZE) {
        const batch = missing.slice(i, i + DELETE_BATCH_SIZE);
        try {
          await storage.remove(this.projectId, batch);
          for (const rel of batch) this.manifest.delete(rel);
          count += batch.length;
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          failures.push(
            new Error(`delete batch (${batch.length} files): ${detail}`, { cause: error }),
          );
        }
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `syncChanges failed for ${failures.length} file${failures.length === 1 ? "" : "s"}`,
      );
    }
    return count;
  }

  private async walkLocal(
    dir: string,
    visit: (relPath: string, mtimeMs: number) => Promise<void>,
    seen?: Set<string>,
  ): Promise<boolean> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    let complete = true;
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(this.sandboxDir, full).replaceAll(path.sep, "/");
      if (!shouldSync(rel)) continue;
      if (entry.isDirectory()) {
        if (!(await this.walkLocal(full, visit, seen))) complete = false;
      } else if (entry.isFile()) {
        try {
          const stat = await fs.stat(full);
          seen?.add(rel);
          if (stat.size <= MAX_FILE_SIZE) {
            await visit(rel, stat.mtimeMs);
          }
        } catch {
          complete = false;
        }
      }
    }
    return complete;
  }
}

const trackers = new Map<string, ProjectSync>();

export function getTracker(projectId: string, sandboxDir: string): ProjectSync {
  const existing = trackers.get(projectId);
  if (existing) return existing;
  const tracker = new ProjectSync(sandboxDir, projectId);
  trackers.set(projectId, tracker);
  return tracker;
}

export function clearTracker(projectId: string): void {
  trackers.delete(projectId);
}

export type { ProjectSync };
