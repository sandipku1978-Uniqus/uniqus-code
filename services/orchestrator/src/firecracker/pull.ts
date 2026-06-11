import { promises as fs } from "node:fs";
import path from "node:path";
import { getRunningVm } from "./fleet.js";
import * as agentRpc from "./agentRpc.js";
import type { VmHandle } from "./types.js";

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
 * last-seen manifest per VM id and diff VM-now against VM-before. With no
 * baseline (first pull after a boot or an orchestrator restart) we fall back
 * to host comparison: pull anything missing on the host or differing in size.
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
const baselines = new Map<string, Map<string, { size: number; mtime_ms: number }>>();

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
  /** Files we wanted but could not fetch intact (retried next pull). */
  skipped: number;
}

/** Coalesce concurrent pulls per project — one walk at a time, like syncChanges. */
const inFlight = new Map<string, Promise<PullResult | null>>();

/**
 * Pull new/changed files from the project's running VM into the host mirror.
 * Returns null when there is nothing to do (no VM backend, VM not running, or
 * the inventory was unavailable). Never throws — this rides hot paths.
 */
export function pullVmChanges(projectId: string, hostDir: string): Promise<PullResult | null> {
  const existing = inFlight.get(projectId);
  if (existing) return existing;
  const run = doPull(projectId, hostDir)
    .catch((err) => {
      console.error(`[pull ${projectId}] failed:`, err);
      return null;
    })
    .finally(() => {
      inFlight.delete(projectId);
    });
  inFlight.set(projectId, run);
  return run;
}

async function doPull(projectId: string, hostDir: string): Promise<PullResult | null> {
  const vm = getRunningVm(projectId);
  if (!vm) return null;

  // 1. Inventory. Primary: the manifest endpoint. Fallback (pre-manifest
  //    agents): find|stat over exec.
  let entries: agentRpc.VmFileEntry[];
  let oldAgent = false;
  try {
    entries = await agentRpc.manifest(vm);
  } catch {
    const fallback = await manifestViaExec(vm);
    if (fallback === null) return null;
    entries = fallback;
    oldAgent = true;
  }
  entries = entries.filter(
    (e) =>
      typeof e.path === "string" &&
      shouldPull(e.path) &&
      Number.isFinite(e.size) &&
      e.size >= 0 &&
      e.size <= MAX_FILE_SIZE,
  );

  // 2. Diff. Baseline (VM-now vs VM-before) when we have one; host comparison
  //    (missing or size-mismatch) otherwise.
  const baseline = baselines.get(vm.id);
  const candidates: agentRpc.VmFileEntry[] = [];
  for (const e of entries) {
    if (baseline) {
      const prev = baseline.get(e.path);
      if (prev && prev.size === e.size && prev.mtime_ms === e.mtime_ms) continue;
      candidates.push(e);
    } else {
      try {
        const st = await fs.stat(path.resolve(hostDir, e.path));
        if (st.size === e.size) continue; // same size ⇒ assume unchanged (heals on next baseline diff)
      } catch {
        // missing on host → pull
      }
      candidates.push(e);
    }
  }

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

  // 4. Fetch + write, integrity-checked against the manifest size so a
  //    truncated/raced read never lands as silent corruption.
  const hostRoot = path.resolve(hostDir);
  const pulled: string[] = [];
  const failed = new Set<string>();
  for (let i = 0; i < toFetch.length; i += FETCH_BATCH) {
    const batch = toFetch.slice(i, i + FETCH_BATCH);
    await Promise.all(
      batch.map(async (e) => {
        try {
          let buf = oldAgent ? null : await agentRpc.readFileBinary(vm, e.path).catch(() => null);
          if (buf === null) buf = await readViaExec(vm, e.path, e.size);
          if (buf === null || buf.length !== e.size) {
            failed.add(e.path);
            return;
          }
          const full = path.resolve(hostRoot, e.path);
          if (full !== hostRoot && !full.startsWith(hostRoot + path.sep)) {
            failed.add(e.path);
            return;
          }
          await fs.mkdir(path.dirname(full), { recursive: true });
          await fs.writeFile(full, buf);
          pulled.push(e.path);
        } catch (err) {
          failed.add(e.path);
          console.error(`[pull ${projectId}] ${e.path} failed:`, err);
        }
      }),
    );
  }

  // 5. New baseline = everything we saw, minus failures (so they retry).
  const next = new Map<string, { size: number; mtime_ms: number }>();
  for (const e of entries) {
    if (!failed.has(e.path)) next.set(e.path, { size: e.size, mtime_ms: e.mtime_ms });
  }
  baselines.set(vm.id, next);
  pruneBaselines(vm.id);

  if (pulled.length > 0 || failed.size > 0) {
    console.log(`[pull ${projectId}] ${pulled.length} pulled, ${failed.size} skipped`);
  }
  return { pulled, skipped: failed.size };
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
