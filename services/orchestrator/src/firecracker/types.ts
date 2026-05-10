/**
 * Public types for the Firecracker fleet (Plan §1).
 *
 * Kept in a separate file so sandbox.ts can reference the VmHandle type
 * without pulling in the fleet manager (which transitively imports the
 * Firecracker client + Node http). Cheaper builds + no circular deps.
 */

export interface VmHandle {
  /** Stable id we use across logs / snapshots. */
  id: string;
  /** Project this VM belongs to. */
  projectId: string;
  /** Path on the host to the per-project rootfs we mounted into the VM. */
  rootImagePath: string;
  /** vsock guest CID — orchestrator dials `(cid, port)` to reach the in-VM agent. */
  guestCid: number;
  /** vsock port the in-VM agent listens on. */
  agentPort: number;
  /** Path to firecracker's API unix socket. */
  apiSocket: string;
  /** Path to host-side AF_UNIX socket that connects to the guest agent over vsock. */
  vsockUds: string;
  /** Per-VM TAP device name on the host (`tap-<short-id>`). Plumbed into fcbr0. */
  tapDevice: string;
  /** IPv4 address assigned to the VM's eth0 (e.g. "172.16.5.10"). */
  ip: string;
  /** Host-side gateway IP the VM should default-route through. */
  gatewayIp: string;
  /** MAC address handed to the guest interface. Stable per-project. */
  guestMac: string;
  /** Status; pause/resume mutate this. */
  state: "running" | "paused" | "stopped";
  /** Last activity (ms since epoch). Drives the idle-pause sweeper. */
  lastUsedAt: number;
}
