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

class ProjectSync {
  private manifest = new Map<string, number>(); // relPath → mtimeMs
  private syncInFlight = false;

  constructor(
    private readonly sandboxDir: string,
    private readonly projectId: string,
  ) {}

  /** Walk local sandbox and snapshot mtimes. Call after WS connect. */
  async initialize(): Promise<void> {
    this.manifest.clear();
    await this.walkLocal(this.sandboxDir, async (rel, mtimeMs) => {
      this.manifest.set(rel, mtimeMs);
    });
  }

  isLocalEmpty(): boolean {
    return this.manifest.size === 0;
  }

  /**
   * Pull every file from Storage into the local sandbox dir. Used when local
   * is empty (new device, accidental delete, OneDrive offload). Returns the
   * count of files restored.
   */
  async hydrateFromStorage(): Promise<number> {
    let count = 0;
    let remoteFiles: string[];
    try {
      remoteFiles = await storage.listAll(this.projectId);
    } catch (err) {
      console.error(`hydrate ${this.projectId}: listAll failed:`, err);
      return 0;
    }
    for (const relPath of remoteFiles) {
      if (!shouldSync(relPath)) continue;
      try {
        const buf = await storage.download(this.projectId, relPath);
        if (!buf) continue;
        const fullLocal = path.resolve(this.sandboxDir, relPath);
        await fs.mkdir(path.dirname(fullLocal), { recursive: true });
        await fs.writeFile(fullLocal, buf);
        const stat = await fs.stat(fullLocal);
        this.manifest.set(relPath, stat.mtimeMs);
        count++;
      } catch (err) {
        console.error(`hydrate ${this.projectId}: ${relPath} failed:`, err);
      }
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
    } catch {
      return; // file doesn't exist (deleted between write and sync)
    }
    if (stat.size > MAX_FILE_SIZE) return;
    const content = await fs.readFile(fullLocal);
    await storage.upload(this.projectId, relPath, content);
    this.manifest.set(relPath, stat.mtimeMs);
  }

  /**
   * Walk local sandbox; push files with mtime newer than our manifest.
   * Used after run_command (which may have created/modified arbitrary files).
   * Coalesces concurrent calls — only one walk runs at a time per project.
   */
  async syncChanges(): Promise<number> {
    if (this.syncInFlight) return 0;
    this.syncInFlight = true;
    let count = 0;
    try {
      await this.walkLocal(this.sandboxDir, async (rel, mtimeMs) => {
        const last = this.manifest.get(rel);
        if (last !== undefined && mtimeMs <= last) return;
        try {
          await this.syncFile(rel);
          count++;
        } catch (err) {
          console.error(`syncChanges ${rel} failed:`, err);
        }
      });
    } finally {
      this.syncInFlight = false;
    }
    return count;
  }

  private async walkLocal(
    dir: string,
    visit: (relPath: string, mtimeMs: number) => Promise<void>,
  ): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(this.sandboxDir, full).replaceAll(path.sep, "/");
      if (!shouldSync(rel)) continue;
      if (entry.isDirectory()) {
        await this.walkLocal(full, visit);
      } else if (entry.isFile()) {
        try {
          const stat = await fs.stat(full);
          if (stat.size <= MAX_FILE_SIZE) {
            await visit(rel, stat.mtimeMs);
          }
        } catch {}
      }
    }
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
