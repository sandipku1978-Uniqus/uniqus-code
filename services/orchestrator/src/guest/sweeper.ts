/**
 * Guest account inactivity sweeper.
 *
 * There is no hard calendar expiry on a guest account. Instead, an account
 * untouched for GUEST_INACTIVE_DAYS enters a grace window; if it's still
 * untouched and unconverted GUEST_GRACE_DAYS later, it's hard-deleted along
 * with all its projects, files and VMs. A guest who returns at any point is
 * pulled back out of the grace window by touchUserActivity() in authenticate().
 *
 * Runs once shortly after startup and then daily. Modeled on the Firecracker
 * idle sweeper (startIdleSweeper / stopIdleSweeper in firecracker/fleet.ts).
 */

import { promises as fs } from "node:fs";
import {
  markStaleGuestsForGrace,
  listGuestsToDelete,
  deleteUser,
  getUserById,
} from "../db/users.js";
import { listProjects } from "../db/projects.js";
import {
  listAll as storageListAll,
  remove as storageRemove,
} from "../storage/client.js";
import { clearTracker } from "../storage/sync.js";
import { destroy as destroyVm } from "../firecracker/index.js";

const GUEST_INACTIVE_DAYS = Number(process.env.GUEST_INACTIVE_DAYS ?? 60);
const GUEST_GRACE_DAYS = Number(process.env.GUEST_GRACE_DAYS ?? 30);
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily

let sweeperTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Tear down one guest project: best-effort Storage + VM + sandbox-dir cleanup.
 * Mirrors the non-DB half of handleProjectDelete in server.ts — the DB rows
 * themselves are deleted by deleteUser before the user row is removed.
 */
async function teardownGuestProject(
  projectId: string,
  sandboxDir: string,
): Promise<void> {
  try {
    const remoteFiles = await storageListAll(projectId);
    if (remoteFiles.length > 0) await storageRemove(projectId, remoteFiles);
  } catch (err) {
    console.error(`[guest-sweeper] storage cleanup for ${projectId} failed:`, err);
  }
  try {
    // No-op when Firecracker is disabled or the VM was never booted.
    await destroyVm(projectId);
  } catch (err) {
    console.error(`[guest-sweeper] VM destroy for ${projectId} failed:`, err);
  }
  try {
    await fs.rm(sandboxDir, { recursive: true, force: true });
  } catch (err) {
    console.error(`[guest-sweeper] sandbox cleanup for ${projectId} failed:`, err);
  }
  clearTracker(projectId);
}

async function runSweep(
  sandboxDirFor: (projectId: string) => string,
): Promise<void> {
  try {
    const graced = await markStaleGuestsForGrace(GUEST_INACTIVE_DAYS);
    if (graced > 0) {
      console.log(`[guest-sweeper] ${graced} guest account(s) entered grace`);
    }
  } catch (err) {
    console.error(`[guest-sweeper] grace pass failed:`, err);
  }

  let toDelete: string[];
  try {
    toDelete = await listGuestsToDelete(GUEST_GRACE_DAYS);
  } catch (err) {
    console.error(`[guest-sweeper] delete-list query failed:`, err);
    return;
  }

  // listGuestsToDelete is a single up-front snapshot, but teardown below is slow
  // (per-project Storage listing/removal + VM destroy). A guest who returns
  // (touchUserActivity nulls grace_started_at) or converts via merge during that
  // window must NOT be torn down — destroying their files while the projects'
  // rows survive under a new owner is permanent data loss (C-49). Re-check
  // eligibility immediately before the irreversible teardown.
  const graceCutoff = Date.now() - GUEST_GRACE_DAYS * 86_400_000;
  const stillDeletable = async (guestId: string): Promise<boolean> => {
    const u = await getUserById(guestId);
    if (!u) return false; // already gone
    const rec = u as unknown as {
      account_type?: string;
      converted_at?: string | null;
      grace_started_at?: string | null;
    };
    if (rec.account_type !== "guest") return false;
    if (rec.converted_at) return false; // converted mid-sweep
    if (!rec.grace_started_at) return false; // returned (grace cleared)
    return new Date(rec.grace_started_at).getTime() < graceCutoff;
  };

  for (const guestId of toDelete) {
    try {
      if (!(await stillDeletable(guestId))) {
        console.log(`[guest-sweeper] skipping ${guestId} — no longer eligible (returned/converted)`);
        continue;
      }
      // Enumerate the projects BEFORE deleting the user — deleteUser removes
      // personal project rows first, so they cannot be listed afterward.
      const projects = await listProjects(guestId);
      for (const project of projects) {
        await teardownGuestProject(project.id, sandboxDirFor(project.id));
      }
      // Final re-check after the slow teardown, right before the irreversible
      // row delete, to shrink the race window as far as possible.
      if (!(await stillDeletable(guestId))) {
        console.log(`[guest-sweeper] ${guestId} became active during teardown — keeping row`);
        continue;
      }
      // deleteUser removes personal projects first; their dependent rows cascade.
      await deleteUser(guestId);
      console.log(
        `[guest-sweeper] deleted guest ${guestId} (${projects.length} project(s))`,
      );
    } catch (err) {
      console.error(`[guest-sweeper] delete of guest ${guestId} failed:`, err);
    }
  }
}

/**
 * Start the daily guest sweep. Idempotent. `sandboxDirFor` is injected so the
 * sweeper doesn't have to import server.ts (which would be a require cycle).
 */
export function startGuestSweeper(
  sandboxDirFor: (projectId: string) => string,
): void {
  if (sweeperTimer) return;
  // First sweep shortly after boot — fire-and-forget so a slow DB doesn't
  // delay the orchestrator coming up.
  void runSweep(sandboxDirFor).catch((err) =>
    console.error(`[guest-sweeper] initial sweep failed:`, err),
  );
  sweeperTimer = setInterval(() => {
    void runSweep(sandboxDirFor).catch((err) =>
      console.error(`[guest-sweeper] sweep failed:`, err),
    );
  }, SWEEP_INTERVAL_MS);
  // .unref() so the timer doesn't keep the process alive past a clean exit.
  sweeperTimer.unref();
  console.log(
    `[guest-sweeper] enabled — inactive ${GUEST_INACTIVE_DAYS}d → grace ${GUEST_GRACE_DAYS}d → delete`,
  );
}

/** Stop the sweeper so SIGTERM can exit cleanly. Idempotent. */
export function stopGuestSweeper(): void {
  if (sweeperTimer) {
    clearInterval(sweeperTimer);
    sweeperTimer = null;
  }
}
