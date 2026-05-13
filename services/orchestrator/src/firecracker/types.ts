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
  /**
   * VM state. Lifecycle:
   *   running   ─(idle FIRECRACKER_IDLE_PAUSE_MS)→        paused
   *   paused    ─(idle FIRECRACKER_IDLE_SNAPSHOT_MS)→     snapshotted
   *   any-live  ─(destroy)→                               stopped
   *
   * `paused` keeps the firecracker process alive — RAM is held, resume is
   * sub-millisecond. `snapshotted` writes the VM state + memory to disk
   * and kills the firecracker process — RAM is freed, resume is sub-second
   * via `loadSnapshot`. The two-tier policy means a project tabbed away
   * for a few minutes resumes instantly; one tabbed away for hours stops
   * paying for RAM but still skips the ~15 s cold boot.
   */
  state: "running" | "paused" | "snapshotted" | "stopped";
  /** Last activity (ms since epoch). Drives the idle-pause sweeper. */
  lastUsedAt: number;
  /** When the VM was last paused. Drives the snapshot-after-pause escalation. */
  pausedAt?: number;
  /**
   * Which in-VM agent implementation answered /health when this VM came up.
   * "rust" is the canonical agent (Plan §1); "node" is the legacy fallback
   * build-rootfs.sh selects when the host lacks a Rust toolchain. We track
   * it here so /health on the orchestrator can surface the per-VM breakdown
   * — operationally important because a silent Rust→Node fallback regresses
   * VM cold-start time without any obvious symptom.
   */
  agentKind?: "rust" | "node" | "unknown";
}
