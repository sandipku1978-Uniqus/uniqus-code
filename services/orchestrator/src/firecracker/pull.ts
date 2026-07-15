import { promises as fs } from "node:fs";
import path from "node:path";
import { getRunningVm } from "./fleet.js";
import * as agentRpc from "./agentRpc.js";
import type { VmHandle } from "./types.js";
import { isSensitiveProjectPath } from "../security/sensitivePaths.js";

/**
 * VM → host file pull (the fix for C-8/C-18).
 *
 * In Firecracker mode, run_command executes inside the VM while everything
 * durable — the file tree, Storage sync, checkpoints, export, deploy, and
 * reopen hydration — reads the HOST mirror. write_file/edit_file mirror
 * themselves to the host (sandbox.ts), but files a command creates (scaffolds,
 * generated assets, curl downloads) existed only on the VM disk and were lost
 * the moment the VM was rebuilt from durable state.
 *
 * `pullVmChanges` closes that gap: fetch the VM's file inventory
 * (GET /fs/manifest), figure out what's new/changed, and copy those files to
 * the host mirror. Callers then run the normal host-side Storage sync, which
 * now sees a complete tree.
 *
 * Change detection never compares guest mtimes to host mtimes (different
 * clocks, and hydration rewrites guest mtimes wholesale). Instead we keep the
 * last-confirmed manifest per VM id and diff VM-now against VM-before. A first
 * pull fetches every sync-eligible VM file: size equality is not content
 * equality, and assuming it was permanently losing same-length command edits.
 *
 * Old agents (VMs resumed from snapshots taken before /fs/manifest shipped)
 * are served by an exec-based fallback: `find | stat` for the inventory and a
 * chunked `dd | base64` for reads — both inside the agent's 16 KB exec-output
 * truncation budget.
 */

// Mirrors storage/sync.ts (SKIP_DIRS / SKIP_FILES / SKIP_EXTENSIONS /
// MAX_FILE_SIZE). The in-guest manifest already excludes the dirs; re-applying
// here keeps the exec fallback honest and guards against a stale agent.
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
const MAX_FILE_SIZE = 5 * 1024 * 1024; // matches storage sync's per-file cap

// Per-invocation bounds: a pull rides the post-run_command hook, so it must
// never balloon a turn. A scaffolder dumping more than this gets the rest on
// the next pull (baseline diff picks up where we left off).
const MAX_FILES_PER_PULL = 800;
const MAX_BYTES_PER_PULL = 64 * 1024 * 1024;
const MAX_DELETIONS_PER_PULL = 800;
const MAX_HOST_BASELINE_FILES = 20_000;
const MAX_STRICT_PULL_PASSES = 4;
const FETCH_BATCH = 8; // matches hydrate/storage batch sizing

// Exec-fallback chunking: the agent truncates exec stdout above 16 KB
// (HALF_MAX * 2), so each dd|base64 slice must stay under that. 8 KiB of
// binary → ~10.9 KB of base64, comfortably inside the budget.
const EXEC_CHUNK_BYTES = 8 * 1024;
// Exec-fallback manifests ride one capped stdout too — beyond this many files
// the listing would truncate mid-stream, so we skip pulling rather than pull
// from a silently incomplete inventory.
const EXEC_MANIFEST_MAX_FILES = 250;

function shouldPull(relPath: string): boolean {
  if (isSensitiveProjectPath(relPath)) return false;
  const parts = relPath.split("/");
  for (const part of parts) {
    if (SKIP_DIRS.has(part)) return false;
    // Reject traversal outright — the manifest comes from inside the VM, and
    // a compromised agent must not be able to write outside the mirror.
    if (part === "" || part === "." || part === "..") return false;
  }
  const last = parts[parts.length - 1];
  if (SKIP_FILES.has(last)) return false;
  if (SKIP_EXTENSIONS.has(path.extname(last).toLowerCase())) return false;
  return true;
}

/** Last-seen VM manifest, keyed by VM id (a new VM ⇒ a fresh baseline). */
interface BaselineEntry {
  size: number;
  mtime_ms: number;
  /** Dirty entries must be retried even when their metadata happens to match. */
  dirty: boolean;
}

const baselines = new Map<string, Map<string, BaselineEntry>>();

function pruneBaselines(keep: string): void {
  // VM ids churn (reclaim/reboot); don't let dead baselines accumulate.
  if (baselines.size <= 64) return;
  for (const key of baselines.keys()) {
    if (key !== keep) baselines.delete(key);
  }
}

export interface PullResult {
  /** Rel paths written to the host mirror this pull. */
  pulled: string[];
  /** Rel paths removed from the host mirror because the VM deleted them. */
  deleted: string[];
  /** Files we wanted but could not fetch intact (retried next pull). */
  skipped: number;
  /** Eligible changes left dirty because this pull reached its safety caps. */
  deferred: number;
}

/** Coalesce concurrent pulls per project, including one fresh follow-up pass. */
interface PullFlight {
  hostDir: string;
  again: boolean;
  drain: boolean;
  promise: Promise<PullResult | null>;
}

const inFlight = new Map<string, PullFlight>();

/** Schedule a raw pull sequence. Callers arriving mid-pass request a fresh pass. */
function scheduledPull(
  projectId: string,
  hostDir: string,
  drainDeferred = false,
): Promise<PullResult | null> {
  const resolvedHost = path.resolve(hostDir);
  const existing = inFlight.get(projectId);
  if (existing) {
    if (existing.hostDir !== resolvedHost) {
      return Promise.reject(
        new Error(`concurrent VM pulls disagreed on the host mirror for project ${projectId}`),
      );
    }
    if (drainDeferred) existing.drain = true;
    existing.again = true;
    return existing.promise;
  }

  const flight: PullFlight = {
    hostDir: resolvedHost,
    again: false,
    drain: drainDeferred,
    promise: Promise.resolve(null),
  };
  const run = runPullPasses(projectId, flight).finally(() => {
    if (inFlight.get(projectId) === flight) inFlight.delete(projectId);
  });
  flight.promise = run;
  inFlight.set(projectId, flight);
  return run;
}

async function runPullPasses(
  projectId: string,
  flight: PullFlight,
): Promise<PullResult | null> {
  const pulled = new Set<string>();
  const deleted = new Set<string>();
  let last: PullResult | null = null;
  let lastError: unknown = null;
  let passCount = 0;

  do {
    flight.again = false;
    passCount++;
    try {
      const pass = await doPull(projectId, flight.hostDir);
      lastError = null;
      if (pass) {
        last = pass;
        for (const rel of pass.pulled) pulled.add(rel);
        for (const rel of pass.deleted) deleted.add(rel);
        if (
          flight.drain &&
          pass.deferred > 0 &&
          passCount < MAX_STRICT_PULL_PASSES
        ) {
          flight.again = true;
        }
      }
    } catch (error) {
      lastError = error;
    }
  } while (flight.again);

  if (lastError) throw lastError;
  if (!last) return null;
  return {
    pulled: [...pulled],
    deleted: [...deleted],
    skipped: last.skipped,
    deferred: last.deferred,
  };
}

export function pullVmChanges(projectId: string, hostDir: string): Promise<PullResult | null> {
  return scheduledPull(projectId, hostDir).catch((err) => {
    console.error(`[pull ${projectId}] failed:`, err);
    return null;
  });
}

/** Await a complete VM-to-host reconciliation or reject instead of claiming durability. */
export async function pullVmChangesStrict(
  projectId: string,
  hostDir: string,
): Promise<PullResult | null> {
  const result = await scheduledPull(projectId, hostDir, true);
  if (result && (result.skipped > 0 || result.deferred > 0)) {
    throw new Error(
      `VM pull incomplete: ${result.skipped} failed, ${result.deferred} deferred`,
    );
  }
  return result;
}

async function snapshotHostBaseline(hostDir: string): Promise<Map<string, BaselineEntry>> {
  const root = path.resolve(hostDir);
  const snapshot = new Map<string, BaselineEntry>();

  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).replaceAll(path.sep, "/");
      if (!shouldPull(rel)) continue;
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = await fs.stat(full);
      if (stat.size > MAX_FILE_SIZE) continue;
      snapshot.set(rel, {
        size: stat.size,
        mtime_ms: stat.mtimeMs,
        dirty: true,
      });
      if (snapshot.size > MAX_HOST_BASELINE_FILES) {
        throw new Error(
          `host mirror exceeds the ${MAX_HOST_BASELINE_FILES}-file safe baseline cap`,
        );
      }
    }
  };

  try {
    await walk(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return snapshot;
    throw error;
  }
  return snapshot;
}

interface HostFileState {
  size: number;
  mtime_ms: number;
}

async function hostFileState(fullPath: string): Promise<HostFileState | null> {
  try {
    const stat = await fs.stat(fullPath);
    return { size: stat.size, mtime_ms: stat.mtimeMs };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function sameHostState(a: HostFileState | null, b: HostFileState | null): boolean {
  return a?.size === b?.size && a?.mtime_ms === b?.mtime_ms;
}

async function doPull(projectId: string, hostDir: string): Promise<PullResult | null> {
  const vm = getRunningVm(projectId);
  if (!vm) return null;

  // Snapshot the host before the first VM inventory. This gives us a safe set
  // of paths that existed before the command result, including deletions. Files
  // created after this snapshot cannot be mistaken for a VM-side deletion.
  let baseline = baselines.get(vm.id);
  if (!baseline) baseline = await snapshotHostBaseline(hostDir);

  // 1. Inventory. Primary: the manifest endpoint. Fallback (pre-manifest
  //    agents): find|stat over exec.
  let entries: agentRpc.VmFileEntry[];
  let oldAgent = false;
  try {
    entries = await agentRpc.manifest(vm);
  } catch {
    const fallback = await manifestViaExec(vm);
    if (fallback === null) throw new Error(`VM inventory unavailable for ${vm.id}`);
    entries = fallback;
    oldAgent = true;
  }
  const current = new Map<string, agentRpc.VmFileEntry>();
  let oversized = 0;
  for (const entry of entries) {
    if (
      typeof entry.path !== "string" ||
      !shouldPull(entry.path) ||
      !Number.isFinite(entry.size) ||
      entry.size < 0 ||
      !Number.isFinite(entry.mtime_ms)
    ) {
      continue;
    }
    current.set(entry.path, entry);
    if (entry.size > MAX_FILE_SIZE) oversized++;
  }
  const eligible = [...current.values()].filter((entry) => entry.size <= MAX_FILE_SIZE);

  // 2. Diff against only confirmed baseline rows. Dirty rows represent a prior
  // failed/deferred fetch and retry even when their metadata happens to match.
  const candidates: agentRpc.VmFileEntry[] = [];
  for (const e of eligible) {
    const prev = baseline.get(e.path);
    if (prev && !prev.dirty && prev.size === e.size && prev.mtime_ms === e.mtime_ms) continue;
    candidates.push(e);
  }
  const deletionCandidates = [...baseline.keys()].filter((rel) => !current.has(rel));

  // 3. Bound the batch.
  let budget = MAX_BYTES_PER_PULL;
  const toFetch: agentRpc.VmFileEntry[] = [];
  for (const e of candidates) {
    if (toFetch.length >= MAX_FILES_PER_PULL || e.size > budget) continue;
    budget -= e.size;
    toFetch.push(e);
  }
  if (candidates.length > toFetch.length) {
    console.warn(
      `[pull ${projectId}] deferring ${candidates.length - toFetch.length} files past the per-pull cap`,
    );
  }
  const toDelete = deletionCandidates.slice(0, MAX_DELETIONS_PER_PULL);
  if (deletionCandidates.length > toDelete.length) {
    console.warn(
      `[pull ${projectId}] deferring ${deletionCandidates.length - toDelete.length} deletions past the per-pull cap`,
    );
  }

  // 4. Fetch + write, integrity-checked against the manifest size so a
  //    truncated/raced read never lands as silent corruption.
  const hostRoot = path.resolve(hostDir);
  const pulled: string[] = [];
  const deleted: string[] = [];
  const failedFetches = new Set<string>();
  const deletionHostStart = new Map<string, HostFileState | null>();
  for (const rel of toDelete) {
    const full = path.resolve(hostRoot, rel);
    if (full !== hostRoot && full.startsWith(hostRoot + path.sep)) {
      deletionHostStart.set(rel, await hostFileState(full));
    }
  }
  for (let i = 0; i < toFetch.length; i += FETCH_BATCH) {
    const batch = toFetch.slice(i, i + FETCH_BATCH);
    await Promise.all(
      batch.map(async (e) => {
        try {
          const full = path.resolve(hostRoot, e.path);
          if (full !== hostRoot && !full.startsWith(hostRoot + path.sep)) {
            failedFetches.add(e.path);
            return;
          }
          const hostBefore = await hostFileState(full);
          let buf = oldAgent ? null : await agentRpc.readFileBinary(vm, e.path).catch(() => null);
          if (buf === null) buf = await readViaExec(vm, e.path, e.size);
          if (buf === null || buf.length !== e.size) {
            failedFetches.add(e.path);
            return;
          }
          const hostAfter = await hostFileState(full);
          if (!sameHostState(hostBefore, hostAfter)) {
            // A newer editor/upload write landed while the VM bytes were in
            // flight. Never overwrite it with the older inventory snapshot.
            failedFetches.add(e.path);
            return;
          }
          await fs.mkdir(path.dirname(full), { recursive: true });
          await fs.writeFile(full, buf);
          pulled.push(e.path);
        } catch (err) {
          failedFetches.add(e.path);
          console.error(`[pull ${projectId}] ${e.path} failed:`, err);
        }
      }),
    );
  }

  const failedDeletes = new Set<string>();
  for (const rel of toDelete) {
    try {
      const full = path.resolve(hostRoot, rel);
      if (full === hostRoot || !full.startsWith(hostRoot + path.sep)) {
        failedDeletes.add(rel);
        continue;
      }
      const currentHost = await hostFileState(full);
      if (!sameHostState(deletionHostStart.get(rel) ?? null, currentHost)) {
        // A concurrent host/VM write changed this path after the inventory
        // snapshot. Leave it intact and force the follow-up pull to reconcile.
        failedDeletes.add(rel);
        continue;
      }
      await fs.rm(full, { force: true });
      deleted.push(rel);
    } catch (error) {
      failedDeletes.add(rel);
      console.error(`[pull ${projectId}] delete ${rel} failed:`, error);
    }
  }

  // Advance only confirmed paths. Deferred/failed rows stay dirty so the next
  // pull retries them; successful deletions disappear from the baseline.
  const selected = new Set(toFetch.map((entry) => entry.path));
  const candidatePaths = new Set(candidates.map((entry) => entry.path));
  const next = new Map(baseline);
  for (const entry of eligible) {
    if (selected.has(entry.path) && !failedFetches.has(entry.path)) {
      next.set(entry.path, {
        size: entry.size,
        mtime_ms: entry.mtime_ms,
        dirty: false,
      });
    } else if (candidatePaths.has(entry.path)) {
      const prev = next.get(entry.path);
      next.set(entry.path, {
        ...prev,
        size: entry.size,
        mtime_ms: entry.mtime_ms,
        dirty: true,
      });
    }
  }
  for (const entry of current.values()) {
    if (entry.size > MAX_FILE_SIZE) {
      const prev = next.get(entry.path);
      next.set(entry.path, {
        ...prev,
        size: entry.size,
        mtime_ms: entry.mtime_ms,
        dirty: true,
      });
    }
  }
  for (const rel of toDelete) {
    if (failedDeletes.has(rel)) {
      const prev = next.get(rel);
      if (prev) next.set(rel, { ...prev, dirty: true });
    } else {
      next.delete(rel);
    }
  }
  baselines.set(vm.id, next);
  pruneBaselines(vm.id);

  const deferred =
    candidates.length - toFetch.length + deletionCandidates.length - toDelete.length;
  const skipped = failedFetches.size + failedDeletes.size + oversized;
  if (pulled.length > 0 || deleted.length > 0 || skipped > 0 || deferred > 0) {
    console.log(
      `[pull ${projectId}] ${pulled.length} pulled, ${deleted.length} deleted, ${skipped} skipped, ${deferred} deferred`,
    );
  }
  return { pulled, deleted, skipped, deferred };
}

// ── exec fallback (agents that predate /fs/manifest) ─────────────────────────

async function manifestViaExec(vm: VmHandle): Promise<agentRpc.VmFileEntry[] | null> {
  const prune = [...SKIP_DIRS].map((d) => `-name ${d}`).join(" -o ");
  // BusyBox-safe: find -printf isn't guaranteed, stat -c is. %s size, %Y mtime
  // seconds, %n the ./rel path. NUL-separated args survive any filename.
  const cmd = `find . \\( ${prune} \\) -prune -o -type f -print0 | xargs -0 -r stat -c '%s %Y %n'`;
  const r = await agentRpc.runCommand(vm, cmd, 30_000).catch(() => null);
  if (!r || r.stdout.includes("[... truncated")) {
    // A truncated listing is a silently incomplete inventory — refuse it.
    if (r) console.warn(`[pull] exec manifest truncated for vm ${vm.id}; skipping pull`);
    return null;
  }
  const out: agentRpc.VmFileEntry[] = [];
  for (const line of r.stdout.split("\n")) {
    const m = line.match(/^(\d+) (\d+) \.\/(.+)$/);
    if (!m) continue;
    out.push({ path: m[3], size: Number(m[1]), mtime_ms: Number(m[2]) * 1000 });
    if (out.length > EXEC_MANIFEST_MAX_FILES) {
      console.warn(`[pull] exec manifest too large for vm ${vm.id}; skipping pull`);
      return null;
    }
  }
  return out;
}

/**
 * Chunked binary read over exec for old agents: each `dd | base64` slice stays
 * under the agent's 16 KB stdout truncation budget; chunks are reassembled and
 * length-verified by the caller.
 */
async function readViaExec(
  vm: VmHandle,
  relPath: string,
  size: number,
): Promise<Buffer | null> {
  const quoted = `'${relPath.replace(/'/g, `'\\''`)}'`;
  const chunks: Buffer[] = [];
  const total = Math.ceil(size / EXEC_CHUNK_BYTES);
  if (size === 0) return Buffer.alloc(0);
  for (let i = 0; i < total; i++) {
    const cmd = `dd if=${quoted} bs=${EXEC_CHUNK_BYTES} skip=${i} count=1 2>/dev/null | base64`;
    const r = await agentRpc.runCommand(vm, cmd, 20_000).catch(() => null);
    if (!r || r.exitCode !== 0 || r.stdout.includes("[... truncated")) return null;
    chunks.push(Buffer.from(r.stdout.replace(/\s+/g, ""), "base64"));
  }
  return Buffer.concat(chunks);
}
