/**
 * Firecracker substrate — public surface.
 *
 * Re-exports the bits server.ts and sandbox.ts need. The fleet manager
 * is the entry point; client / agentRpc / types are internal but
 * surfaced here so a single import covers the full backend.
 */

export {
  ensureVm,
  pause,
  resume,
  destroy,
  listVms,
  startIdleSweeper,
  stopIdleSweeper,
  touch,
  shutdownAll,
  AGENT_AUTH_ENFORCED,
} from "./fleet.js";
export { FirecrackerClient, spawnFirecracker } from "./client.js";
export type { VmHandle } from "./types.js";

/** Whether the orchestrator should boot Firecracker VMs for project sandboxes. */
export function isFirecrackerEnabled(): boolean {
  const v = (process.env.UNIQUS_SANDBOX ?? "").toLowerCase().trim();
  return v === "firecracker" || v === "fc";
}
