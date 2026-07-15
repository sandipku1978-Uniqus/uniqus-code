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
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  markStaleGuestsForGrace,
  listGuestsToDelete,
  deleteUser,
  claimGuestForDeletion,
} from "../db/users.js";
import { listProjects } from "../db/projects.js";
import {
  listAll as storageListAll,
  remove as storageRemove,
} from "../storage/client.js";
import { clearTracker } from "../storage/sync.js";
import { destroyForDeletion, releaseNetworkAllocation } from "../firecracker/index.js";
import { clearCheckpoints } from "../agent/checkpoints.js";

const GUEST_INACTIVE_DAYS = Number(process.env.GUEST_INACTIVE_DAYS ?? 60);
const GUEST_GRACE_DAYS = Number(process.env.GUEST_GRACE_DAYS ?? 30);
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily

let sweeperTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Strictly erase one guest project before its metadata is deleted.
 * Mirrors the non-DB half of handleProjectDelete in server.ts — the DB rows
 * themselves are deleted by deleteUser before the user row is removed.
 */
async function teardownGuestProject(
  projectId: string,
  sandboxDir: string,
): Promise<void> {
  const remoteFiles = await storageListAll(projectId);
  if (remoteFiles.length > 0) await storageRemove(projectId, remoteFiles);
  const remainingRemote = await storageListAll(projectId);
  if (remainingRemote.length > 0) {
    throw new Error(`${remainingRemote.length} Storage objects remain for ${projectId}`);
  }
  await destroyForDeletion(projectId);
  await fs.rm(sandboxDir, { recursive: true, force: true });
  await clearCheckpoints(sandboxDir, projectId);
  const checkpointDir = path.join(path.dirname(sandboxDir), `${projectId}.checkpoints`);
  for (const candidate of [sandboxDir, checkpointDir]) {
    const remains = await fs.access(candidate).then(() => true, () => false);
    if (remains) throw new Error(`local guest project data remains at ${candidate}`);
  }
  clearTracker(projectId);
  releaseNetworkAllocation(projectId);
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

  for (const guestId of toDelete) {
    try {
      const lifecycleClaim = randomUUID();
      if (!(await claimGuestForDeletion(guestId, GUEST_GRACE_DAYS, lifecycleClaim))) {
        console.log(`[guest-sweeper] skipping ${guestId} — no longer eligible (returned/converted)`);
        continue;
      }
      // Enumerate the projects BEFORE deleting the user — deleteUser removes
      // personal project rows first, so they cannot be listed afterward.
      const projects = await listProjects(guestId);
      for (const project of projects) {
        await teardownGuestProject(project.id, sandboxDirFor(project.id));
      }
      // deleteUser removes personal projects first; their dependent rows cascade.
      await deleteUser(guestId, lifecycleClaim);
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
