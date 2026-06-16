import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { createHash, randomUUID, randomBytes } from "node:crypto";
import { FirecrackerClient, spawnFirecracker } from "./client.js";
import { pingAgent, pushFile, finalizeRestore, pingAt } from "./agentRpc.js";
import { removeServersForProject } from "../agent/sandbox.js";
import type { VmHandle } from "./types.js";

/**
 * Firecracker fleet manager (Plan §1).
 *
 * Owns the per-project VM lifecycle through four states:
 *   running     — firecracker process up, VM executing, agent reachable.
 *   paused      — firecracker process up, VM frozen via PATCH /vm Paused.
 *                 RAM held; resume is sub-millisecond.
 *   snapshotted — firecracker process gone, VM state + memory on disk.
 *                 RAM freed; resume costs one mmap of the memory file
 *                 (typically sub-second). Reached by escalation from
 *                 `paused` after FIRECRACKER_IDLE_SNAPSHOT_MS.
 *   stopped     — destroyed; on-disk artifacts (rootfs, sandbox image,
 *                 snapshot pair, tap device) cleaned up.
 *
 * Cross-process restore: the rootfs path, sandbox image path, and tap name
 * are all derived deterministically from projectId, so a snapshot taken in
 * one orchestrator process can be loaded by the next one (`tryRehydrateSnapshot`).
 * That's where the "sub-second cold start across restarts" promise from
 * Plan §4 comes from.
 *
 * Hetzner notes:
 *   - The per-host setup script in `infra/firecracker/host-setup.sh`
 *     creates the bridge and iptables masquerade once at boot.
 *   - Each VM gets a /16 host pair (a.b) from the 172.16.0.0/16 range,
 *     hashed off projectId for stability across restarts. Collisions are
 *     a Phase-3 problem (~256 projects/host birthday).
 */

const STATE_DIR =
  process.env.FIRECRACKER_STATE_DIR ?? "/var/lib/uniqus/firecracker";
const KERNEL_PATH =
  process.env.FIRECRACKER_KERNEL ?? "/var/lib/uniqus/firecracker/vmlinux";
const ROOTFS_BASE_PATH =
  process.env.FIRECRACKER_ROOTFS ?? "/var/lib/uniqus/firecracker/rootfs.ext4";
const VM_VCPUS = Number(process.env.FIRECRACKER_VCPUS ?? 2);
const VM_MEM_MIB = Number(process.env.FIRECRACKER_MEM_MIB ?? 1024);
const IDLE_PAUSE_MS = Number(process.env.FIRECRACKER_IDLE_PAUSE_MS ?? 5 * 60_000);
/**
 * After this much time *paused* (separate from total idle), escalate the VM
 * from in-memory pause to a full snapshot-and-kill so its RAM is returned to
 * the host. Default 30 min — balances "snapshots cost disk I/O equal to RAM
 * size" against "a single 1 GiB VM tying up RAM for hours has a real cost on
 * a 100-VM host".
 */
const IDLE_SNAPSHOT_AFTER_PAUSE_MS = Number(
  process.env.FIRECRACKER_IDLE_SNAPSHOT_MS ?? 30 * 60_000,
);
/**
 * Snapshot retention ceiling — after this much total inactivity we RECLAIM the
 * VM: free the firecracker process, the ~1 GiB memory/snapshot pair, and the
 * rootfs overlay, but KEEP the per-project sandbox.ext4 (which holds
 * node_modules and any uncommitted state). Reopening within this window does a
 * sub-second snapshot restore; reopening after it does a cold boot but still
 * reattaches the existing sandbox image — so it skips re-hydration and, more
 * importantly, a cold `npm install`. Bumped from 24 h to 72 h so a "next day"
 * reopen still hits the fast snapshot path.
 */
const VM_GC_MAX_IDLE_MS = Number(
  process.env.FIRECRACKER_GC_MAX_IDLE_MS ?? 72 * 60 * 60_000,
);
/**
 * Filesystem reap ceiling — only after this much inactivity do we finally
 * delete the sandbox.ext4 (losing node_modules) to reclaim disk for a project
 * nobody has touched in a long time. Much longer than the snapshot ceiling
 * because node_modules is the expensive thing to rebuild on reopen.
 */
const VM_FS_REAP_MAX_IDLE_MS = Number(
  process.env.FIRECRACKER_FS_REAP_MAX_IDLE_MS ?? 14 * 24 * 60 * 60_000,
);
const BRIDGE_NAME = process.env.FIRECRACKER_BRIDGE ?? "fcbr0";
const BRIDGE_GATEWAY = process.env.FIRECRACKER_GATEWAY ?? "172.16.0.1";
const BRIDGE_NETMASK = process.env.FIRECRACKER_NETMASK ?? "255.255.0.0";

// ── base ("golden") snapshot: sub-second FIRST boots for brand-new projects ──
// Opt-in (FIRECRACKER_BASE_SNAPSHOT=1). When enabled and a golden snapshot
// exists, ensureVm restores a clone from it (≈ an mmap of the memory file,
// sub-second) instead of a full ~15-20s Alpine+OpenRC cold boot. The golden is
// ONE VM booted to "agent ready" on a SHARED, read-only base rootfs; every clone
// reuses that same rootfs (no per-project 2 GiB copy) plus its own sandbox.ext4
// (resolved via the firecracker process cwd — Firecracker's "relative paths +
// per-sandbox cwd" clone pattern). On ANY failure we fall back to bootNew(), so
// the flag is safe to ship dark and flip on after validating on the host.
const BASE_SNAPSHOT_ENABLED = process.env.FIRECRACKER_BASE_SNAPSHOT === "1";

/**
 * Per-VM agent bearer token (F1). Derived DETERMINISTICALLY from the projectId
 * and a server secret, so any restore path (cross-process rehydrate, snapshot
 * restore) can reconstruct the exact token the agent baked into its cmdline at
 * the original boot — a random-per-boot token was unrecoverable after a restart,
 * 401-bricking every RPC when FIRECRACKER_AGENT_AUTH=1 (C-45/C-47). If no secret
 * is configured we fall back to a process-stable random key: still deterministic
 * within a single orchestrator lifetime (so in-process snapshot restore works),
 * just not across restarts — acceptable since auth ships dark by default.
 */
const AGENT_TOKEN_SECRET =
  process.env.FIRECRACKER_AGENT_TOKEN_SECRET ||
  process.env.WORKOS_COOKIE_PASSWORD ||
  randomBytes(32).toString("hex");
function deriveAgentToken(projectId: string): string {
  return createHash("sha256").update(`fc-agent:${AGENT_TOKEN_SECRET}:${projectId}`).digest("hex").slice(0, 48);
}
/**
 * Per-VM agent bearer auth is MANDATORY (P0.1). Hard-coded on rather than gated
 * behind an env var so a production deploy can never silently run with agents
 * that accept unauthenticated RPCs. Surfaced on /health (`agentAuthEnforced`)
 * so deploys can assert it. `FIRECRACKER_AGENT_AUTH` is now ignored.
 */
export const AGENT_AUTH_ENFORCED = true;
// Identity the golden image is frozen with — IDENTICAL on every clone until the
// orchestrator re-stamps it (agent /net/configure). Reserved out of the project
// IP range (allocateNetwork skips it) and the project MAC range (02:fc:<hash>).
const BOOTSTRAP_IP = process.env.FIRECRACKER_BOOTSTRAP_IP ?? "172.16.255.254";
const BOOTSTRAP_MAC = "02:fc:ff:ff:ff:fe";
const BOOTSTRAP_TAP = "tap-uniqus-base";
const BASE_DIR = path.join(STATE_DIR, "base");
const RUN_DIR = path.join(STATE_DIR, "run");

interface ManagedVm {
  handle: VmHandle;
  client: FirecrackerClient;
  /**
   * firecracker process pid + close fn. Both are replaced when a VM is
   * restored from a snapshot — the restored VM runs in a brand-new
   * firecracker process bound to a brand-new API socket.
   */
  fcPid: number;
  fcClose: () => void;
  /** Where we hydrated host files from at boot — needed for re-hydration on restore. */
  hostSandboxDir: string;
}

const vms = new Map<string, ManagedVm>();
/**
 * Single-flight the first-boot path per project (B-5). Two concurrent first
 * messages (two tabs, or an abort+reconnect) would both see `vms.get()===
 * undefined` and both run rehydrate/golden-restore/cold-boot, colliding on the
 * deterministic tap/IP/overlay and orphaning the first VM's process + tap. Like
 * `baseSnapshotBuild` below, concurrent callers share one in-flight boot; the
 * entry is deleted on settle (success AND failure) so a later open re-boots.
 */
const bootInFlight = new Map<string, Promise<VmHandle>>();
// Single-flight the resume/restore-of-EXISTING-entry transitions too (C-43/
// C-48/U-5). bootInFlight only covers the no-entry first boot; two concurrent
// ensureVm calls for a snapshotted/paused VM (two tabs, abort+reconnect, a
// Run-button POST racing a user_message) would otherwise both pass the state
// check and both spawnFirecracker on the SAME api socket / double-PATCH resume,
// orphaning a process or 400ing the loser. Keyed per project; cleared on settle.
const transitionInFlight = new Map<string, Promise<void>>();
let cidSeq = 100; // guest CIDs 0/1/2 are reserved by the kernel; pick a non-overlapping range

export interface BootOpts {
  projectId: string;
  /** Host path the VM should mount at /sandbox via virtio-blk overlay. */
  hostSandboxDir: string;
}

export async function ensureVm(opts: BootOpts): Promise<VmHandle> {
  const existing = vms.get(opts.projectId);
  if (existing) {
    // Serialize the paused→running / snapshotted→running transition so two
    // concurrent callers can't both spawn firecracker on the same socket or
    // double-resume (C-43/C-48/U-5). Re-check state INSIDE the single-flight.
    if (existing.handle.state === "snapshotted" || existing.handle.state === "paused") {
      const pending = transitionInFlight.get(opts.projectId);
      if (pending) {
        await pending;
      } else {
        const t = (async () => {
          // The handle's state may have changed while we awaited the lock.
          if (existing.handle.state === "snapshotted") {
            await restoreFromSnapshot(opts.projectId);
          } else if (existing.handle.state === "paused") {
            await resume(opts.projectId);
          }
        })().finally(() => transitionInFlight.delete(opts.projectId));
        transitionInFlight.set(opts.projectId, t);
        await t;
      }
    }
    existing.handle.lastUsedAt = Date.now();
    return existing.handle;
  }
  // No in-memory entry → the first-boot path (rehydrate / golden-restore /
  // cold-boot). Single-flight it per project (B-5): if a boot is already in
  // flight, await it instead of racing a second boot that would collide on the
  // deterministic tap/IP/overlay and orphan the first VM. The promise is stored
  // before any await and cleared on settle (success AND failure).
  const inFlight = bootInFlight.get(opts.projectId);
  if (inFlight) return await inFlight;
  const boot = bootFirstTime(opts).finally(() => {
    bootInFlight.delete(opts.projectId);
  });
  bootInFlight.set(opts.projectId, boot);
  return await boot;
}

/**
 * The first-boot path for a project with no in-memory VM, factored out of
 * `ensureVm` so it can be run under the per-project single-flight lock.
 */
async function bootFirstTime(opts: BootOpts): Promise<VmHandle> {
  // Maybe a previous orchestrator process left a snapshot for this project on
  // disk — rehydrate from it before paying a fresh ~15 s cold boot.
  const rehydrated = await tryRehydrateSnapshot(opts);
  if (rehydrated) return rehydrated;
  // Brand-new (or GC'd) project: no per-project snapshot exists. If the golden
  // base snapshot is enabled, restore a sub-second clone from it instead of a
  // full OpenRC cold boot. Any failure falls through to the cold path.
  if (BASE_SNAPSHOT_ENABLED) {
    try {
      return await restoreFromGolden(opts);
    } catch (err) {
      console.error(
        `[fleet] base-snapshot restore failed for ${opts.projectId.slice(0, 8)}; ` +
          `falling back to cold boot:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return await bootNew(opts);
}

/**
 * Per-phase boot stopwatch. `phase(label)` logs the elapsed time since the
 * previous `phase`/`total` call (the duration of the phase just completed) and
 * `total(label)` logs the cumulative time since the stopwatch was created.
 * Uses the monotonic perf_hooks clock so the deltas aren't perturbed by wall-
 * clock adjustments. Logs are additive — the existing `step X/8` lines stay.
 */
function bootStopwatch(id: string): {
  phase: (label: string) => void;
  total: (label: string) => void;
} {
  const start = performance.now();
  let last = start;
  const ms = (n: number): string => `${Math.round(n)}ms`;
  return {
    phase(label: string): void {
      const now = performance.now();
      console.log(`[fleet ${id}] timing: ${label} took ${ms(now - last)}`);
      last = now;
    },
    total(label: string): void {
      console.log(`[fleet ${id}] timing: ${label} total ${ms(performance.now() - start)}`);
    },
  };
}

async function bootNew(opts: BootOpts): Promise<VmHandle> {
  await fs.mkdir(STATE_DIR, { recursive: true });

  const id = `vm_${opts.projectId.slice(0, 8)}_${randomUUID().slice(0, 4)}`;
  const sw = bootStopwatch(id);
  const apiSocket = path.join(STATE_DIR, `${id}.api.sock`);
  const vsockUds = path.join(STATE_DIR, `${id}.vsock`);
  // Rootfs path is stable per-project (not per-vm-id) so a snapshot taken
  // from one orchestrator process can find its drive when the next process
  // rehydrates it. Same reason the tap name is project-deterministic.
  const rootImagePath = projectRootImagePath(opts.projectId);

  console.log(`[fleet ${id}] step 1/8: copy-on-write rootfs from ${ROOTFS_BASE_PATH}`);
  // Per-project overlay rootfs: copy the base rootfs once. Fast on most
  // Linux filesystems thanks to copy-on-write (XFS reflink, btrfs CoW,
  // ZFS clone). Falls back to plain copy when CoW isn't available.
  // Skip if the overlay already exists (e.g. left over from a snapshot
  // that we couldn't rehydrate but whose drives are still on disk).
  if (!(await pathExists(rootImagePath))) {
    await copyOnWrite(ROOTFS_BASE_PATH, rootImagePath);
  }
  sw.phase("copy-on-write rootfs overlay");

  // Allocate per-VM networking. Hash projectId → /16 host octets so the
  // same project gets the same IP across orchestrator restarts. MAC is
  // a locally-administered prefix (02:fc:…) seeded from the same hash.
  const { ip, gatewayIp, mac, tapName } = allocateNetwork(opts.projectId);
  console.log(`[fleet ${id}] step 2/8: allocated ip=${ip} mac=${mac} tap=${tapName}`);
  await ensureBridge();
  console.log(`[fleet ${id}] step 3/8: bridge ${BRIDGE_NAME} verified`);
  await ensureTapDevice(tapName);
  console.log(`[fleet ${id}] step 4/8: tap ${tapName} attached to bridge`);
  sw.phase("network/tap setup");

  // Spawn firecracker bound to a fresh API socket.
  console.log(`[fleet ${id}] step 5/8: spawning firecracker (socket=${apiSocket})`);
  const fc = await spawnFirecracker({ socketPath: apiSocket });
  console.log(`[fleet ${id}] step 6/8: firecracker spawned (pid=${fc.pid})`);
  sw.phase("firecracker spawn");
  const client = new FirecrackerClient(apiSocket);

  const guestCid = ++cidSeq;
  const agentPort = 51_000;

  // Per-VM bearer token (F1). Declared OUTSIDE the try so it's in scope for the
  // VmHandle below. Injected on the cmdline so the in-VM agent requires it on
  // every request, closing the unauth-RCE where a peer VM on the shared bridge
  // could drive another project's agent. Enforcement is now MANDATORY — every
  // freshly-booted VM gets `uniqus_auth=1` (P0.1). The legacy dark-launch gate
  // (FIRECRACKER_AGENT_AUTH) is gone: agent auth is hard-coded on so a
  // misconfigured deploy can't silently ship unauthenticated agents. (Golden
  // snapshot clones are re-provisioned + enforced separately on restore — see
  // restoreFromGolden / agent /net/configure, P0.2.)
  const authToken = deriveAgentToken(opts.projectId);
  const authEnforced = AGENT_AUTH_ENFORCED;

  try {
    await client.putMachineConfig({ vcpu_count: VM_VCPUS, mem_size_mib: VM_MEM_MIB });
    // Pass our IP + gw as custom cmdline tokens. The in-VM agent reads
    // /proc/cmdline at boot and applies them via iproute2. (We deliberately
    // don't use the kernel's IP_PNP `ip=` because most Firecracker CI
    // kernels are built without CONFIG_IP_PNP — that arg is silently
    // ignored and eth0 ends up unconfigured.)
    const ipArg = `uniqus_ip=${ip}/16 uniqus_gw=${gatewayIp}`;
    const authArg = `uniqus_token=${authToken}${authEnforced ? " uniqus_auth=1" : ""}`;
    await client.putBootSource({
      kernel_image_path: KERNEL_PATH,
      // Console, panic=1 so a kernel panic exits the firecracker process
      // (we restart cleanly instead of hanging). `random.trust_cpu=on`
      // shaves boot time. uniqus_ip/uniqus_gw drive in-VM static config;
      // uniqus_token/uniqus_auth drive the in-VM agent's request auth (F1).
      boot_args:
        `console=ttyS0 reboot=k panic=1 pci=off random.trust_cpu=on ${ipArg} ${authArg} i8042.noaux i8042.nomux i8042.nopnp i8042.dumbkbd`,
    });
    await client.putDrive({
      drive_id: "rootfs",
      path_on_host: rootImagePath,
      is_root_device: true,
      is_read_only: false,
    });
    // Project files share. Mounted by the in-VM agent at /sandbox/.
    // For Phase-2 the share is implemented as a second virtio-blk device
    // pointing at a per-project ext4 image we maintain on the host.
    const sandboxImage = await ensureSandboxImage(opts.projectId, opts.hostSandboxDir);
    await client.putDrive({
      drive_id: "sandbox",
      path_on_host: sandboxImage,
      is_root_device: false,
      is_read_only: false,
    });
    await client.putNetworkInterface({
      iface_id: "eth0",
      host_dev_name: tapName,
      guest_mac: mac,
    });
    await client.putVsock({ guest_cid: guestCid, uds_path: vsockUds, vsock_id: "agent" });
    console.log(`[fleet ${id}] step 7/8: VM configured, calling InstanceStart`);
    await client.startInstance();
    console.log(`[fleet ${id}] step 8/8: VM started, waiting for in-VM agent…`);
  } catch (err) {
    console.error(`[fleet ${id}] config failed:`, err instanceof Error ? err.message : err);
    fc.close();
    await teardownTap(tapName).catch(() => {});
    throw err;
  }
  // Covers putMachineConfig/putBootSource/putDrive(s) + ensureSandboxImage +
  // putNetworkInterface/putVsock + InstanceStart.
  sw.phase("VM config + ensureSandboxImage + InstanceStart");

  const handle: VmHandle = {
    id,
    projectId: opts.projectId,
    rootImagePath,
    guestCid,
    agentPort,
    apiSocket,
    vsockUds,
    tapDevice: tapName,
    ip,
    gatewayIp,
    guestMac: mac,
    authToken,
    state: "running",
    lastUsedAt: Date.now(),
  };

  // Wait until the in-VM agent answers /health. With the boot-blocking DHCP
  // stall removed (the agent no longer `need net`s, and eth0 has no DHCP
  // stanza), a cold Alpine+OpenRC boot to agent-ready is now ~3-8s; 60s stays
  // as a generous failure ceiling. Poll tightly so we detect readiness within
  // ~150ms of the agent binding instead of overshooting by a quarter second.
  const deadline = Date.now() + 60_000;
  let healthy = false;
  let pingAttempts = 0;
  while (Date.now() < deadline) {
    pingAttempts++;
    const kind = await pingAgent(handle);
    if (kind !== null) {
      handle.agentKind = kind;
      healthy = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  if (!healthy) {
    console.error(`[fleet ${id}] agent /health unreachable after ${pingAttempts} attempts in 60s`);
    // Keep the VM alive briefly so the operator can debug from the host:
    //   ping ${ip}
    //   curl http://${ip}:${agentPort}/health
    // Set FIRECRACKER_KEEP_FAILED_VMS=1 to leave failed VMs running
    // indefinitely (you'll have to clean them up by hand). Default: tear
    // down after 30s so we don't leak processes.
    const keepIndefinitely = process.env.FIRECRACKER_KEEP_FAILED_VMS === "1";
    if (keepIndefinitely) {
      console.error(
        `[fleet ${id}] FIRECRACKER_KEEP_FAILED_VMS=1 — VM left running. ` +
          `Probe with: ping ${ip} ; curl http://${ip}:${agentPort}/health . ` +
          `Stop with: kill ${fc.pid}`,
      );
    } else {
      // Mirror the config-failure cleanup: kill firecracker NOW and reclaim the
      // tap + sockets. The old deferred `setTimeout(fc.close, 30s)` left the TAP
      // device and api/vsock sockets behind forever, leaking one of each per
      // distinct failing project (B-8).
      fc.close();
      await teardownTap(tapName).catch(() => {});
      await fs.rm(apiSocket, { force: true }).catch(() => {});
      await fs.rm(vsockUds, { force: true }).catch(() => {});
    }
    throw new Error(
      `[vm ${id}] agent did not answer /health within 60s at ${ip}:${agentPort} — ` +
        `try: ping ${ip} (kernel network up?) and curl http://${ip}:${agentPort}/health (in-VM agent running?)`,
    );
  }
  console.log(
    `[fleet ${id}] in-VM agent healthy after ${pingAttempts} ping attempts (kind=${handle.agentKind ?? "unknown"})`,
  );
  sw.phase(`health-wait (${pingAttempts} ping attempts)`);
  if (handle.agentKind === "node") {
    // The Rust agent is meant to be canonical. A silent fallback to Node
    // (e.g. build host without rustup) regresses cold-start time without
    // any visible symptom. Warn so the operator sees it in logs even
    // without scraping /health.
    console.warn(
      `[fleet ${id}] booted with Node fallback agent — install cargo + ` +
        `musl-tools on the rootfs build host to switch to the Rust agent.`,
    );
  }

  // Initial hydration: push host-side project files into the VM. Cheap on
  // small projects; the in-VM agent acks each file. Cap so a runaway
  // hydration doesn't pin the boot path forever.
  await hydrateInto(handle, opts.hostSandboxDir).catch((err) => {
    console.error(`[vm ${id}] initial hydration failed:`, err);
  });
  sw.phase("hydration");
  sw.total("cold boot");

  vms.set(opts.projectId, {
    handle,
    client,
    fcPid: fc.pid,
    fcClose: fc.close,
    hostSandboxDir: opts.hostSandboxDir,
  });
  return handle;
}

// ── base ("golden") snapshot build + restore ────────────────────────────────

function baseSnapshotPaths(): { snapshot: string; memory: string; sandbox: string } {
  return {
    snapshot: path.join(BASE_DIR, "base.snapshot"),
    memory: path.join(BASE_DIR, "base.memory"),
    sandbox: path.join(BASE_DIR, "sandbox.ext4"),
  };
}

/**
 * The bootstrap identity (IP + MAC) is shared by every just-resumed clone, so
 * only ONE clone may wear it at a time — from `resume` until it has re-stamped
 * its real per-project identity and become reachable there. This promise chain
 * serializes that window across all concurrent restores. The window is ~0.3-1s,
 * so it bounds new-VM creation throughput; if that ever bites, the upgrade is a
 * netns-per-clone scheme (then no shared identity, no lock).
 */
let bootstrapChain: Promise<void> = Promise.resolve();
function withBootstrapLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = bootstrapChain.then(fn, fn);
  bootstrapChain = run.then(
    () => {},
    () => {},
  );
  return run;
}

let baseSnapshotBuild: Promise<void> | null = null;
/**
 * Build the golden snapshot once. Idempotent and de-duped: concurrent callers
 * share one in-flight build, and a completed build short-circuits on the files.
 * Safe to call eagerly (sweeper start) or lazily (first restore).
 */
export async function ensureBaseSnapshot(): Promise<void> {
  const p = baseSnapshotPaths();
  if ((await pathExists(p.snapshot)) && (await pathExists(p.memory))) return;
  if (!baseSnapshotBuild) {
    baseSnapshotBuild = buildBaseSnapshot().finally(() => {
      baseSnapshotBuild = null;
    });
  }
  return baseSnapshotBuild;
}

async function buildBaseSnapshot(): Promise<void> {
  await fs.mkdir(BASE_DIR, { recursive: true });
  const p = baseSnapshotPaths();
  const apiSocket = path.join(BASE_DIR, "builder.api.sock");
  console.log(`[fleet base] building golden base snapshot (shared rootfs=${ROOTFS_BASE_PATH})`);
  // Placeholder sandbox at a RELATIVE drive path ("sandbox.ext4"), so at restore
  // each clone's firecracker resolves it against its own cwd → its own disk.
  // Never mounted in the golden (uniqus_golden=1 makes the in-guest sandbox-mount
  // service skip it), so a clone mounting its real disk after restore reads a
  // fresh superblock with no stale page-cache from this placeholder.
  await runCmd("truncate", ["-s", "1G", p.sandbox]);
  await runCmd("mkfs.ext4", ["-F", "-q", p.sandbox]);
  await ensureBridge();
  await ensureTapDevice(BOOTSTRAP_TAP);
  const fc = await spawnFirecracker({ socketPath: apiSocket, cwd: BASE_DIR });
  const client = new FirecrackerClient(apiSocket);
  try {
    // track_dirty_pages keeps the door open for future diff snapshots.
    await client.putMachineConfig({
      vcpu_count: VM_VCPUS,
      mem_size_mib: VM_MEM_MIB,
      track_dirty_pages: true,
    });
    await client.putBootSource({
      kernel_image_path: KERNEL_PATH,
      // `ro`: the shared base rootfs is mounted read-only (mutable dirs are
      // tmpfs — see build-rootfs.sh) so one image safely backs every clone.
      // uniqus_golden=1: skip the sandbox mount + come up on the bootstrap IP.
      boot_args:
        `console=ttyS0 reboot=k panic=1 pci=off random.trust_cpu=on ro ` +
        `uniqus_ip=${BOOTSTRAP_IP}/16 uniqus_gw=${BRIDGE_GATEWAY} uniqus_golden=1 ` +
        `i8042.noaux i8042.nomux i8042.nopnp i8042.dumbkbd`,
    });
    await client.putDrive({
      drive_id: "rootfs",
      path_on_host: ROOTFS_BASE_PATH,
      is_root_device: true,
      is_read_only: true,
    });
    await client.putDrive({
      drive_id: "sandbox",
      path_on_host: "sandbox.ext4",
      is_root_device: false,
      is_read_only: false,
    });
    await client.putNetworkInterface({
      iface_id: "eth0",
      host_dev_name: BOOTSTRAP_TAP,
      guest_mac: BOOTSTRAP_MAC,
    });
    await client.startInstance();
    const deadline = Date.now() + 60_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (await pingAt(BOOTSTRAP_IP, 51_000)) {
        ready = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!ready) {
      throw new Error(
        `golden base builder agent never answered /health at ${BOOTSTRAP_IP}:51000 within 60s ` +
          `(check the rootfs boots read-only with the tmpfs mounts from build-rootfs.sh)`,
      );
    }
    // Snapshots can only be taken on a Paused VM.
    await client.pauseInstance();
    await client.createSnapshot({
      snapshot_path: p.snapshot,
      mem_file_path: p.memory,
      snapshot_type: "Full",
    });
    console.log(`[fleet base] golden snapshot written → ${p.snapshot} (+ ${p.memory})`);
  } finally {
    fc.close();
    await fs.rm(apiSocket, { force: true }).catch(() => {});
    await teardownTap(BOOTSTRAP_TAP).catch(() => {});
  }
}

/**
 * Restore a brand-new project's VM from the golden snapshot instead of a full
 * cold boot. Spawns a firecracker whose cwd holds this project's sandbox.ext4
 * (under the relative name the snapshot froze), loads the golden memory + state
 * with the project's TAP swapped in (network_overrides), then — holding the
 * bootstrap lock — resumes and re-stamps the clone onto its own IP/MAC and
 * mounts its disk. Sub-second versus ~15-20s.
 */
async function restoreFromGolden(opts: BootOpts): Promise<VmHandle> {
  const id = `vm_${opts.projectId.slice(0, 8)}_${randomUUID().slice(0, 4)}`;
  const sw = bootStopwatch(id);
  await ensureBaseSnapshot();
  sw.phase("ensureBaseSnapshot");
  const p = baseSnapshotPaths();
  const runDir = path.join(RUN_DIR, id);
  await fs.mkdir(runDir, { recursive: true });
  const apiSocket = path.join(runDir, "api.sock");
  const { ip, gatewayIp, mac, tapName } = allocateNetwork(opts.projectId);

  // Per-project sandbox image (created + formatted on first use), exposed to
  // this firecracker under the relative name the snapshot expects.
  const sandboxImage = await ensureSandboxImage(opts.projectId, opts.hostSandboxDir);
  const linkPath = path.join(runDir, "sandbox.ext4");
  await fs.rm(linkPath, { force: true }).catch(() => {});
  await fs.symlink(path.resolve(sandboxImage), linkPath);
  sw.phase("ensureSandboxImage");

  await ensureBridge();
  await ensureTapDevice(tapName);
  sw.phase("network/tap setup");
  const fc = await spawnFirecracker({ socketPath: apiSocket, cwd: runDir });
  sw.phase("firecracker spawn");
  const client = new FirecrackerClient(apiSocket);
  const handle: VmHandle = {
    id,
    projectId: opts.projectId,
    rootImagePath: ROOTFS_BASE_PATH, // shared read-only base; nothing to clean up per-project
    guestCid: ++cidSeq,
    agentPort: 51_000,
    apiSocket,
    vsockUds: path.join(runDir, "vsock"),
    tapDevice: tapName,
    ip,
    gatewayIp,
    guestMac: mac,
    // Stamp the deterministic token so RPCs carry a Bearer consistent with the
    // cold/rehydrate paths. The golden snapshot's frozen cmdline omits
    // uniqus_auth, so the clone RESUMES unauthenticated — but finalizeRestore
    // below re-provisions this exact token to the agent (auth_token +
    // uniqus_auth) over /net/configure, after which the clone enforces it just
    // like a cold-booted VM. (Closes the old C-13 caveat — P0.2.)
    authToken: deriveAgentToken(opts.projectId),
    state: "running",
    lastUsedAt: Date.now(),
  };

  try {
    // Load paused (resume_vm:false) so the clone has no bridge presence until we
    // resume it inside the bootstrap lock. network_overrides points eth0 at this
    // project's tap; the guest IP/MAC are still the frozen bootstrap pair.
    await client.loadSnapshot({
      snapshot_path: p.snapshot,
      mem_backend: { backend_type: "File", backend_path: p.memory },
      network_overrides: [{ iface_id: "eth0", host_dev_name: tapName }],
      resume_vm: false,
    });
    sw.phase("loadSnapshot (paused)");

    await withBootstrapLock(async () => {
      await client.resumeInstance();
      // Re-stamp + mount over the bootstrap IP. Packet loss right after resume is
      // expected, so retry briefly. The agent acks immediately and re-stamps
      // ~250ms later (it can't change its own MAC/IP while answering us).
      const seed = randomBytes(32).toString("base64");
      let finalized = false;
      let lastErr: unknown = null;
      const fdl = Date.now() + 8_000;
      while (Date.now() < fdl) {
        try {
          await finalizeRestore(BOOTSTRAP_IP, 51_000, {
            ip: `${ip}/16`,
            gw: gatewayIp,
            mac,
            mount_sandbox: true,
            seed,
            time_ms: Date.now(),
            // P0.2: hand the clone its per-project token + turn enforcement on,
            // so a golden-restored VM is as locked-down as a cold-booted one.
            auth_token: handle.authToken,
            uniqus_auth: AGENT_AUTH_ENFORCED,
          });
          finalized = true;
          break;
        } catch (err) {
          lastErr = err;
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      if (!finalized) {
        throw new Error(
          `finalizeRestore never succeeded over bootstrap ${BOOTSTRAP_IP}: ` +
            `${lastErr instanceof Error ? lastErr.message : lastErr}`,
        );
      }
      // Hold the lock until the clone has actually LEFT the bootstrap identity
      // (reachable on its own project IP), so the next clone can safely reuse it.
      let healthy = false;
      const hdl = Date.now() + 8_000;
      while (Date.now() < hdl) {
        if ((await pingAgent(handle)) !== null) {
          healthy = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!healthy) {
        throw new Error(`restored clone unreachable on project IP ${ip} after re-stamp`);
      }
    });
    sw.phase("resume + finalizeRestore + health (bootstrap lock)");

    handle.agentKind = "rust";
    // Seed project files (cheap/empty for a brand-new project; the per-project
    // sandbox.ext4 persists node_modules across reopens just like the cold path).
    await hydrateInto(handle, opts.hostSandboxDir).catch((err) => {
      console.error(`[vm ${id}] hydration after restore failed:`, err);
    });
    sw.phase("hydration");
    sw.total("golden restore");
    vms.set(opts.projectId, {
      handle,
      client,
      fcPid: fc.pid,
      fcClose: fc.close,
      hostSandboxDir: opts.hostSandboxDir,
    });
    console.log(
      `[fleet ${id}] restored from golden snapshot → ${ip} (project ${opts.projectId.slice(0, 8)})`,
    );
    return handle;
  } catch (err) {
    fc.close();
    await teardownTap(tapName).catch(() => {});
    await fs.rm(runDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

const HYDRATE_MAX_FILES = 5_000;
const HYDRATE_MAX_BYTES = 200 * 1024 * 1024;
// Push files to the in-VM agent in parallel batches rather than one
// round-trip at a time. Mirrors HYDRATE_BATCH_SIZE in storage/sync.ts: the
// per-file RPC (agentRpc.pushFile) is round-trip-bound, so serial pushes made
// hydration scale linearly with file count. Batches of 8 cut that without
// overwhelming the agent. The per-file RPC contract is unchanged.
const HYDRATE_PUSH_BATCH_SIZE = 8;

async function hydrateInto(vm: VmHandle, hostDir: string): Promise<void> {
  const root = path.resolve(hostDir);
  // First walk the tree to collect the files to push (cheap, host-local stat
  // reads), applying the same count/byte caps as before. Then push them in
  // bounded-concurrency batches.
  const files: { rel: string; full: string }[] = [];
  let count = 0;
  let bytes = 0;
  let capped = false;
  async function walk(dir: string): Promise<void> {
    if (capped) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (capped) return;
      if (e.name === "node_modules" || e.name === ".git") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!e.isFile()) continue;
      const rel = path.relative(root, full).replaceAll(path.sep, "/");
      const stat = await fs.stat(full);
      // Preserve original cap semantics: a file that would overflow the byte
      // ceiling, or the file-count ceiling, halts collection entirely.
      if (bytes + stat.size > HYDRATE_MAX_BYTES || count >= HYDRATE_MAX_FILES) {
        capped = true;
        return;
      }
      files.push({ rel, full });
      count++;
      bytes += stat.size;
    }
  }
  await walk(root);

  for (let i = 0; i < files.length; i += HYDRATE_PUSH_BATCH_SIZE) {
    const batch = files.slice(i, i + HYDRATE_PUSH_BATCH_SIZE);
    await Promise.all(
      batch.map(async ({ rel, full }) => {
        const data = await fs.readFile(full);
        await pushFile(vm, rel, data);
      }),
    );
  }
}

export async function pause(projectId: string): Promise<void> {
  const vm = vms.get(projectId);
  if (!vm || vm.handle.state !== "running") return;
  await vm.client.pauseInstance();
  vm.handle.state = "paused";
  vm.handle.pausedAt = Date.now();
  console.log(
    `[fleet ${vm.handle.id}] paused — will snapshot if idle ` +
      `${Math.round(IDLE_SNAPSHOT_AFTER_PAUSE_MS / 60_000)}m more`,
  );
}

export async function resume(projectId: string): Promise<void> {
  const vm = vms.get(projectId);
  if (!vm || vm.handle.state !== "paused") return;
  await vm.client.resumeInstance();
  vm.handle.state = "running";
  vm.handle.pausedAt = undefined;
  vm.handle.lastUsedAt = Date.now();
}

/**
 * Tier-2 idle escalation. The VM must already be `paused` — we ask
 * firecracker to write its full state + memory to disk, then kill the
 * firecracker process so the host gets that RAM back. The TAP device and
 * drives stay in place so a subsequent `restoreFromSnapshot` can reattach
 * without redoing host-side networking.
 */
async function snapshotPaused(projectId: string): Promise<void> {
  const vm = vms.get(projectId);
  if (!vm || vm.handle.state !== "paused") return;
  const paths = snapshotPaths(vm.handle.projectId);
  try {
    // Snapshots can only be taken on a Paused VM. We're already there.
    await vm.client.createSnapshot({
      snapshot_path: paths.snapshot,
      mem_file_path: paths.memory,
      snapshot_type: "Full",
    });
  } catch (err) {
    console.error(
      `[fleet ${vm.handle.id}] snapshot failed; leaving VM paused:`,
      err instanceof Error ? err.message : err,
    );
    return;
  }
  // createSnapshot took seconds of I/O. If a user's ensureVm→resume() landed in
  // that window, the VM is now 'running' and a turn is about to RPC against it —
  // killing the process here would fail every tool call (C-48). Bail; the freshly
  // resumed VM stays alive and the sweeper will retry once it's idle again.
  if (vm.handle.state !== "paused") {
    console.log(
      `[fleet ${vm.handle.id}] resume raced snapshot; discarding snapshot, keeping live VM`,
    );
    return;
  }
  vm.fcClose();
  // Drop the per-process artifacts. Drives + tap survive — the tap is reused
  // when we spawn a fresh firecracker for the restore.
  await fs.rm(vm.handle.apiSocket, { force: true }).catch(() => {});
  await fs.rm(vm.handle.vsockUds, { force: true }).catch(() => {});
  vm.handle.state = "snapshotted";
  console.log(
    `[fleet ${vm.handle.id}] snapshotted to ${paths.snapshot}; firecracker terminated, RAM freed`,
  );
}

/**
 * Resume a snapshotted VM in the same orchestrator process. Spawns a fresh
 * firecracker, points it at the on-disk snapshot, and asks Firecracker to
 * resume execution as part of the load. Cold path is bounded by the size of
 * the memory dump (~mem_size_mib of mmap-backed I/O) — typically sub-second.
 */
async function restoreFromSnapshot(projectId: string): Promise<void> {
  const vm = vms.get(projectId);
  if (!vm || vm.handle.state !== "snapshotted") return;
  const paths = snapshotPaths(vm.handle.projectId);
  await fs.access(paths.snapshot);
  await fs.access(paths.memory);
  // Re-ensure the host-side bits the snapshot expects.
  await ensureBridge();
  await ensureTapDevice(vm.handle.tapDevice);
  // Fresh API socket — the old one was unlinked when we snapshotted.
  // Spawn with cwd=runDir so a RELATIVE sandbox drive path (golden clones use
  // "sandbox.ext4") resolves against the per-VM run dir, not the orchestrator's
  // cwd — otherwise /dev/vdb is missing on restore and loadSnapshot ENOENTs for
  // every golden-origin project (C-44). runDir is the api socket's directory.
  // Wrap spawn + loadSnapshot so a corrupt/incompatible snapshot can't leak the
  // firecracker process and wedge the VM in 'snapshotted' (re-spawning a fresh
  // leaked process on every retry). Mirror tryRehydrateSnapshot's cleanup:
  // discard the bad snapshot so the next ensureVm cold-boots instead of looping.
  const fc = await spawnFirecracker({
    socketPath: vm.handle.apiSocket,
    cwd: path.dirname(vm.handle.apiSocket),
  });
  const client = new FirecrackerClient(vm.handle.apiSocket);
  try {
    await client.loadSnapshot({
      snapshot_path: paths.snapshot,
      mem_backend: { backend_type: "File", backend_path: paths.memory },
      resume_vm: true,
    });
  } catch (err) {
    console.error(
      `[fleet ${vm.handle.id}] snapshot restore failed (${err instanceof Error ? err.message : err}); ` +
        `discarding snapshot and dropping the VM so the next open cold-boots`,
    );
    fc.close();
    await fs.rm(vm.handle.apiSocket, { force: true }).catch(() => {});
    await fs.rm(vm.handle.vsockUds, { force: true }).catch(() => {});
    // Trash the corrupt snapshot so we don't loop on it.
    await fs.rm(paths.snapshot, { force: true }).catch(() => {});
    await fs.rm(paths.memory, { force: true }).catch(() => {});
    await teardownTap(vm.handle.tapDevice).catch(() => {});
    // Drop the in-memory record so the next ensureVm falls through to a fresh
    // boot rather than re-entering this path against the (now-deleted) snapshot.
    vm.handle.state = "stopped";
    vms.delete(projectId);
    throw err;
  }
  vm.client = client;
  vm.fcPid = fc.pid;
  vm.fcClose = fc.close;
  vm.handle.state = "running";
  vm.handle.pausedAt = undefined;
  vm.handle.lastUsedAt = Date.now();
  console.log(`[fleet ${vm.handle.id}] restored from snapshot`);
}

/**
 * Cross-process restore. Called when ensureVm is invoked for a project that
 * has no in-memory entry, but a snapshot exists on disk from a prior
 * orchestrator process. Reconstructs a `ManagedVm` from convention
 * (deterministic IP/MAC/tap/rootfs paths) and loads the snapshot.
 *
 * Returns null (and the caller falls through to a fresh boot) if either
 * snapshot artifact is missing or the load fails — we don't want a single
 * corrupt snapshot to wedge the project forever.
 */
async function tryRehydrateSnapshot(opts: BootOpts): Promise<VmHandle | null> {
  const paths = snapshotPaths(opts.projectId);
  if (!(await pathExists(paths.snapshot)) || !(await pathExists(paths.memory))) {
    return null;
  }
  const id = `vm_${opts.projectId.slice(0, 8)}_rehyd`;
  // Spawn from a per-project run dir that contains the relative "sandbox.ext4"
  // the snapshot froze (golden clones use a RELATIVE drive path). After an
  // orchestrator restart the original golden runDir — with its random suffix —
  // is gone, so without re-materializing the relative drive here loadSnapshot
  // ENOENTs on /dev/vdb for golden-origin projects (C-44). The symlink target
  // is the deterministic per-project sandbox image.
  const runDir = path.join(RUN_DIR, id);
  await fs.mkdir(runDir, { recursive: true });
  const apiSocket = path.join(runDir, "api.sock");
  const vsockUds = path.join(runDir, "vsock");
  const { ip, gatewayIp, mac, tapName } = allocateNetwork(opts.projectId);
  const rootImagePath = projectRootImagePath(opts.projectId);
  try {
    const sandboxImage = await ensureSandboxImage(opts.projectId, opts.hostSandboxDir);
    const linkPath = path.join(runDir, "sandbox.ext4");
    await fs.rm(linkPath, { force: true }).catch(() => {});
    await fs.symlink(path.resolve(sandboxImage), linkPath);
  } catch (err) {
    console.error(`[fleet ${id}] could not stage sandbox.ext4 for rehydrate:`, err);
  }

  console.log(`[fleet ${id}] rehydrating from on-disk snapshot for ${opts.projectId.slice(0, 8)}`);
  const t0 = Date.now();
  // Declared outside the try so the catch can reclaim the firecracker process +
  // sockets if loadSnapshot throws on a corrupt/incompatible snapshot — mirrors
  // restoreFromSnapshot's cleanup. Without this, a failed rehydrate leaked one
  // firecracker process + its api.sock/vsock on every orchestrator restart with
  // a bad snapshot (B-8 on the rehydrate path).
  let fc: Awaited<ReturnType<typeof spawnFirecracker>> | undefined;
  try {
    await ensureBridge();
    await ensureTapDevice(tapName);
    fc = await spawnFirecracker({ socketPath: apiSocket, cwd: runDir });
    const client = new FirecrackerClient(apiSocket);
    await client.loadSnapshot({
      snapshot_path: paths.snapshot,
      mem_backend: { backend_type: "File", backend_path: paths.memory },
      resume_vm: true,
    });
    const handle: VmHandle = {
      id,
      projectId: opts.projectId,
      rootImagePath,
      guestCid: ++cidSeq,
      agentPort: 51_000,
      apiSocket,
      vsockUds,
      tapDevice: tapName,
      ip,
      gatewayIp,
      guestMac: mac,
      // Re-derive the deterministic token the agent froze into its cmdline at
      // the original boot, so RPCs authenticate after a cross-process restart
      // instead of 401-bricking the VM (C-45/C-47).
      authToken: deriveAgentToken(opts.projectId),
      state: "running",
      lastUsedAt: Date.now(),
    };
    vms.set(opts.projectId, {
      handle,
      client,
      fcPid: fc.pid,
      fcClose: fc.close,
      hostSandboxDir: opts.hostSandboxDir,
    });
    console.log(`[fleet ${id}] rehydrated in ${Date.now() - t0}ms — skipped cold boot`);
    return handle;
  } catch (err) {
    console.error(
      `[fleet ${id}] rehydrate failed (${err instanceof Error ? err.message : err}); ` +
        `discarding snapshot and falling back to cold boot`,
    );
    // Kill the spawned firecracker process and reclaim its sockets — the `fc?.`
    // guard also covers spawnFirecracker itself having thrown (process never
    // created). Close before unlinking, matching the restore path.
    fc?.close();
    await fs.rm(apiSocket, { force: true }).catch(() => {});
    await fs.rm(vsockUds, { force: true }).catch(() => {});
    // Trash the snapshot so we don't loop on a corrupt one.
    await fs.rm(paths.snapshot, { force: true }).catch(() => {});
    await fs.rm(paths.memory, { force: true }).catch(() => {});
    await teardownTap(tapName).catch(() => {});
    return null;
  }
}

export async function destroy(projectId: string): Promise<void> {
  const vm = vms.get(projectId);
  if (!vm) {
    // No in-memory record but we may still own on-disk snapshot/rootfs/sandbox
    // artifacts (orphan from a previous orchestrator process). Sweep them.
    await destroyOnDiskArtifacts(projectId).catch(() => {});
    return;
  }
  // Only ctrl-alt-del if the firecracker process is alive — for a snapshotted
  // VM the process is already gone.
  if (vm.handle.state === "running" || vm.handle.state === "paused") {
    try {
      await vm.client.ctrlAltDel();
    } catch {}
    vm.fcClose();
  }
  await fs.rm(vm.handle.apiSocket, { force: true }).catch(() => {});
  await fs.rm(vm.handle.vsockUds, { force: true }).catch(() => {});
  // A base-snapshot clone shares the read-only base rootfs (rootImagePath ===
  // ROOTFS_BASE_PATH) — never delete that. Only per-project cold-boot overlays
  // are removed. The clone's per-VM run dir (tap symlink + sockets) goes too.
  if (vm.handle.rootImagePath !== ROOTFS_BASE_PATH) {
    await fs.rm(vm.handle.rootImagePath, { force: true }).catch(() => {});
  }
  await fs.rm(path.join(RUN_DIR, vm.handle.id), { recursive: true, force: true }).catch(() => {});
  const paths = snapshotPaths(vm.handle.projectId);
  await fs.rm(paths.snapshot, { force: true }).catch(() => {});
  await fs.rm(paths.memory, { force: true }).catch(() => {});
  await fs
    .rm(path.join(STATE_DIR, `${projectId}.sandbox.ext4`), { force: true })
    .catch(() => {});
  await teardownTap(vm.handle.tapDevice).catch(() => {});
  vm.handle.state = "stopped";
  vms.delete(projectId);
  // The in-VM server processes died with the firecracker process — drop their
  // stale host-side ManagedServer entries (B-10: VM-backed servers had no
  // exit hook, so they leaked into list_servers / the preview proxy).
  removeServersForProject(projectId);
}

/**
 * Soft idle reclaim: free the firecracker process + the ~1 GiB snapshot/memory
 * pair + the rootfs overlay (regenerable) + tap, and drop the in-memory record,
 * but KEEP the sandbox.ext4 so the next reopen reattaches node_modules instead
 * of cold-installing. This is what the idle sweeper runs at the GC ceiling.
 */
export async function reclaimVm(projectId: string): Promise<void> {
  const vm = vms.get(projectId);
  if (!vm) {
    await reclaimOnDiskArtifacts(projectId).catch(() => {});
    return;
  }
  if (vm.handle.state === "running" || vm.handle.state === "paused") {
    try {
      await vm.client.ctrlAltDel();
    } catch {}
    vm.fcClose();
  }
  await fs.rm(vm.handle.apiSocket, { force: true }).catch(() => {});
  await fs.rm(vm.handle.vsockUds, { force: true }).catch(() => {});
  // A base-snapshot clone shares the read-only base rootfs (rootImagePath ===
  // ROOTFS_BASE_PATH) — never delete that. Only per-project cold-boot overlays
  // are removed. The clone's per-VM run dir (tap symlink + sockets) goes too.
  if (vm.handle.rootImagePath !== ROOTFS_BASE_PATH) {
    await fs.rm(vm.handle.rootImagePath, { force: true }).catch(() => {});
  }
  await fs.rm(path.join(RUN_DIR, vm.handle.id), { recursive: true, force: true }).catch(() => {});
  const paths = snapshotPaths(vm.handle.projectId);
  await fs.rm(paths.snapshot, { force: true }).catch(() => {});
  await fs.rm(paths.memory, { force: true }).catch(() => {});
  // NOTE: deliberately keep <projectId>.sandbox.ext4 (node_modules + state).
  await teardownTap(vm.handle.tapDevice).catch(() => {});
  vm.handle.state = "stopped";
  vms.delete(projectId);
  // Reclaim kills the firecracker process, so its in-VM servers are gone too —
  // prune their stale host-side entries (B-10).
  removeServersForProject(projectId);
}

/** Reclaim disk for an orphan project (no in-memory record) but KEEP its ext4. */
async function reclaimOnDiskArtifacts(projectId: string): Promise<void> {
  const paths = snapshotPaths(projectId);
  await fs.rm(paths.snapshot, { force: true }).catch(() => {});
  await fs.rm(paths.memory, { force: true }).catch(() => {});
  await fs.rm(projectRootImagePath(projectId), { force: true }).catch(() => {});
  const { tapName } = allocateNetwork(projectId);
  await teardownTap(tapName).catch(() => {});
}

/** Wipe everything we can name from a projectId without an in-memory record. */
async function destroyOnDiskArtifacts(projectId: string): Promise<void> {
  const paths = snapshotPaths(projectId);
  await fs.rm(paths.snapshot, { force: true }).catch(() => {});
  await fs.rm(paths.memory, { force: true }).catch(() => {});
  await fs.rm(projectRootImagePath(projectId), { force: true }).catch(() => {});
  await fs
    .rm(path.join(STATE_DIR, `${projectId}.sandbox.ext4`), { force: true })
    .catch(() => {});
  // Tap device — we know its name by convention.
  const { tapName } = allocateNetwork(projectId);
  await teardownTap(tapName).catch(() => {});
}

export function listVms(): VmHandle[] {
  return Array.from(vms.values()).map((v) => v.handle);
}

/**
 * The project's VM handle iff it is currently RUNNING (i.e. RPC-able right
 * now). Paused/snapshotted VMs return null on purpose: their disk state is
 * frozen, RPCs would hang, and resuming a VM just to sync files would defeat
 * the idle policy. Used by the VM→host pull (pull.ts).
 */
export function getRunningVm(projectId: string): VmHandle | null {
  const entry = vms.get(projectId);
  return entry && entry.handle.state === "running" ? entry.handle : null;
}

/**
 * Per-project sandbox image. Each VM mounts this as `/sandbox`; the
 * in-VM agent's filesystem ops happen inside it. Created on first boot
 * with `mkfs.ext4 -F` against a sparse file.
 */
async function ensureSandboxImage(projectId: string, hostSandboxDir: string): Promise<string> {
  const imagePath = path.join(STATE_DIR, `${projectId}.sandbox.ext4`);
  try {
    await fs.access(imagePath);
    return imagePath;
  } catch {
    // Create a 1 GiB sparse ext4 image. Resize is on the user — Phase-3
    // adds an automatic grow path when the in-VM agent reports >80% full.
    await runCmd("truncate", ["-s", "1G", imagePath]);
    await runCmd("mkfs.ext4", ["-F", "-q", imagePath]);
  }
  // hostSandboxDir is what we hydrate from at boot — mention it for the
  // typechecker; consumed in hydrateInto via the VmHandle path resolution.
  void hostSandboxDir;
  return imagePath;
}

async function copyOnWrite(src: string, dst: string): Promise<void> {
  // Try reflink first (XFS, btrfs, modern ext4 with reflink=on).
  // Fall back to plain copy on failure.
  try {
    await runCmd("cp", ["--reflink=auto", src, dst]);
  } catch {
    await fs.copyFile(src, dst);
  }
}

function runCmd(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    p.stderr?.on("data", (c: Buffer) => (stderr += c.toString()));
    p.once("error", reject);
    p.once("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${cmd} ${args.join(" ")} exited ${code}: ${stderr.slice(-500)}`)),
    );
  });
}

/**
 * Background sweep — three escalating actions per tick:
 *   1. running   → paused        if idle > IDLE_PAUSE_MS
 *   2. paused    → snapshotted   if paused > IDLE_SNAPSHOT_AFTER_PAUSE_MS
 *      (frees RAM but keeps the cheap restore path)
 *   3. snapshotted/paused → destroyed if total idle > VM_GC_MAX_IDLE_MS
 *      (frees disk too — paid back on the next access via cold boot)
 *
 * Plus an opportunistic disk GC for orphan artifacts left behind by a
 * previous orchestrator process whose project has since been deleted.
 */
let sweeperStarted = false;
let sweeperTimer: ReturnType<typeof setInterval> | null = null;
let sweepTicks = 0;
// Sweeper ticks every 30s; re-run the orphan sweep every ~30 min.
const ORPHAN_GC_EVERY_TICKS = 60;
export function startIdleSweeper(): void {
  if (sweeperStarted) return;
  sweeperStarted = true;
  // First tick: clean up any orphan snapshot/sandbox files older than the GC
  // ceiling. Cheap and bounded by directory size.
  void gcOrphanedSnapshots().catch((err) =>
    console.error(`[fleet] orphan GC failed:`, err instanceof Error ? err.message : err),
  );
  // Build the golden base snapshot ahead of demand so the first new project of
  // the process restores instantly instead of paying the one-time build.
  if (BASE_SNAPSHOT_ENABLED) {
    void ensureBaseSnapshot().catch((err) =>
      console.error(
        `[fleet] golden base snapshot build failed (new projects will cold-boot):`,
        err instanceof Error ? err.message : err,
      ),
    );
  }
  sweeperTimer = setInterval(() => {
    const now = Date.now();
    // Periodically re-run the orphan sweep (not just at startup) so a
    // long-running process still reaps reclaimed projects' ext4 images.
    sweepTicks += 1;
    if (sweepTicks % ORPHAN_GC_EVERY_TICKS === 0) {
      void gcOrphanedSnapshots().catch(() => {});
    }
    for (const [, vm] of vms) {
      const idleMs = now - vm.handle.lastUsedAt;
      if (idleMs > VM_GC_MAX_IDLE_MS && vm.handle.state !== "running") {
        console.log(
          `[fleet ${vm.handle.id}] idle ${Math.round(idleMs / 60_000)}m > snapshot ceiling, ` +
            `reclaiming (freeing RAM/snapshot disk, keeping node_modules)`,
        );
        reclaimVm(vm.handle.projectId).catch(() => {});
        continue;
      }
      if (vm.handle.state === "running" && idleMs > IDLE_PAUSE_MS) {
        pause(vm.handle.projectId).catch(() => {});
        continue;
      }
      if (
        vm.handle.state === "paused" &&
        vm.handle.pausedAt !== undefined &&
        now - vm.handle.pausedAt > IDLE_SNAPSHOT_AFTER_PAUSE_MS
      ) {
        snapshotPaused(vm.handle.projectId).catch(() => {});
      }
    }
  }, 30_000);
  // .unref() so a still-running sweeper doesn't keep the process alive past
  // normal exit. Shutdown handlers call stopIdleSweeper() to clear cleanly.
  sweeperTimer.unref();
}

/**
 * Stop the idle sweeper so the orchestrator can finish a SIGTERM cleanly
 * instead of waiting up to 30s for the next tick. Idempotent.
 */
export function stopIdleSweeper(): void {
  if (sweeperTimer) {
    clearInterval(sweeperTimer);
    sweeperTimer = null;
  }
  sweeperStarted = false;
}

/**
 * Walk STATE_DIR for `<projectId>.snapshot` files that aren't referenced by
 * any in-memory VM and whose mtime is older than the GC ceiling. Delete the
 * snapshot pair + the matching rootfs/sandbox images.
 *
 * This is the only path that frees disk for projects nobody is touching
 * across orchestrator restarts. Without it, every paused-then-snapshotted
 * VM accumulates ~mem-size of disk forever.
 */
async function gcOrphanedSnapshots(): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(STATE_DIR);
  } catch {
    return;
  }
  const live = new Set<string>(Array.from(vms.keys()));
  const snapCutoff = Date.now() - VM_GC_MAX_IDLE_MS;
  const fsCutoff = Date.now() - VM_FS_REAP_MAX_IDLE_MS;
  for (const f of entries) {
    const fullPath = path.join(STATE_DIR, f);
    // Snapshot/memory pairs older than the snapshot ceiling: reclaim the big
    // disk (and rootfs overlay) but KEEP the sandbox.ext4 so node_modules
    // survives an idle period or an orchestrator restart.
    if (f.endsWith(".snapshot")) {
      const projectId = f.slice(0, -".snapshot".length);
      if (live.has(projectId)) continue;
      try {
        const stat = await fs.stat(fullPath);
        if (stat.mtimeMs > snapCutoff) continue;
        await reclaimOnDiskArtifacts(projectId);
        console.log(`[fleet] GC reclaimed orphan snapshot for ${projectId.slice(0, 8)} (kept node_modules)`);
      } catch {}
      continue;
    }
    // Sandbox images untouched past the (much longer) FS reap ceiling: finally
    // delete to reclaim disk for a project nobody has opened in a long time.
    if (f.endsWith(".sandbox.ext4")) {
      const projectId = f.slice(0, -".sandbox.ext4".length);
      if (live.has(projectId)) continue;
      try {
        const stat = await fs.stat(fullPath);
        if (stat.mtimeMs > fsCutoff) continue;
        await fs.rm(fullPath, { force: true }).catch(() => {});
        console.log(`[fleet] GC reaped stale sandbox image for ${projectId.slice(0, 8)}`);
      } catch {}
    }
  }
}

function snapshotPaths(projectId: string): { snapshot: string; memory: string } {
  return {
    snapshot: path.join(STATE_DIR, `${projectId}.snapshot`),
    memory: path.join(STATE_DIR, `${projectId}.memory`),
  };
}

function projectRootImagePath(projectId: string): string {
  return path.join(STATE_DIR, `${projectId}.root.ext4`);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Mark a VM as recently active (called on every sandbox op via fleet middleware). */
export function touch(projectId: string): void {
  const vm = vms.get(projectId);
  if (vm) vm.handle.lastUsedAt = Date.now();
}

/** Stop every VM at orchestrator shutdown. */
export async function shutdownAll(): Promise<void> {
  await Promise.all([...vms.keys()].map((pid) => destroy(pid)));
}

// ── networking ────────────────────────────────────────────────────────────────

interface NetAlloc {
  ip: string;
  gatewayIp: string;
  mac: string;
  tapName: string;
}

/**
 * Hash projectId → /16 host octets so the same project lands on the same IP
 * across restarts. Two projects collide once per ~256k pairs (birthday at
 * ~256 projects on a single host); collision retry would only matter at
 * thousands of VMs/host. Phase-3 problem if it shows up.
 *
 * The tap name is also derived from projectId (not the per-boot VM id), so
 * a snapshot taken in one orchestrator process can be reattached to the
 * same tap by the next process. Linux caps tap names at 15 chars — we use
 * `tap-` (4) + 11 hex chars (44 bits of the project hash) to stay under it.
 */
function allocateNetwork(projectId: string): NetAlloc {
  const h = createHash("sha256").update(projectId).digest();
  // Reserve .0 (network), .1 (gateway), .255 (broadcast). Skip 1..2.
  const a = h[0];
  const bRaw = h[1];
  let b = bRaw <= 1 ? 2 : bRaw === 255 ? 254 : bRaw;
  // Reserve BOOTSTRAP_IP (default 172.16.255.254) so no project can be handed
  // the address the golden snapshot is frozen with.
  if (a === 255 && b === 254) b = 253;
  const ip = `172.16.${a}.${b}`;
  // Locally-administered MAC: 02:FC:<projectHash[2..6]>
  const hex = (n: number): string => n.toString(16).padStart(2, "0");
  const mac = `02:fc:${hex(h[2])}:${hex(h[3])}:${hex(h[4])}:${hex(h[5])}`;
  // Deterministic, ≤15 chars: "tap-" + 11 hex chars of project hash.
  const tapName = `tap-${h.subarray(7, 13).toString("hex").slice(0, 11)}`;
  return { ip, gatewayIp: BRIDGE_GATEWAY, mac, tapName };
}

let bridgeChecked = false;
async function ensureBridge(): Promise<void> {
  if (bridgeChecked) return;
  // We only verify the bridge exists; host-setup.sh creates it. If it's
  // missing we surface a clear error rather than try to create it on the
  // fly (creating it requires CAP_NET_ADMIN and reordering iptables).
  const probe = await runCmdResult("ip", ["link", "show", BRIDGE_NAME]);
  if (probe.code !== 0) {
    throw new Error(
      `Firecracker bridge '${BRIDGE_NAME}' is missing. Run infra/firecracker/host-setup.sh on this host.`,
    );
  }
  await ensureVmIsolation();
  bridgeChecked = true;
}

let isolationChecked = false;
/**
 * P0.3: sever VM↔VM traffic on the shared bridge. host-setup.sh installs this
 * once at provisioning time, but we re-assert it (best-effort) at runtime so a
 * host that predates P0.3 — or whose rules were flushed — still gets isolation
 * without a manual re-run. The bridge forwards peer frames at L2 without
 * consulting iptables, so we (a) make bridged IP traffic traverse FORWARD via
 * br_netfilter, then (b) DROP any fcbr0→fcbr0 hop. Uses the same CAP_NET_ADMIN
 * the orchestrator already relies on for `ip tuntap`; logs + continues if it's
 * unavailable rather than failing the boot.
 */
async function ensureVmIsolation(): Promise<void> {
  if (isolationChecked) return;
  isolationChecked = true;
  try {
    await runCmdResult("modprobe", ["br_netfilter"]);
    await runCmdResult("sysctl", ["-w", "net.bridge.bridge-nf-call-iptables=1"]);
    const present = await runCmdResult(
      "iptables",
      ["-C", "FORWARD", "-i", BRIDGE_NAME, "-o", BRIDGE_NAME, "-j", "DROP"],
    );
    if (present.code !== 0) {
      const added = await runCmdResult(
        "iptables",
        ["-I", "FORWARD", "-i", BRIDGE_NAME, "-o", BRIDGE_NAME, "-j", "DROP"],
      );
      if (added.code !== 0) {
        console.warn(
          `[fleet] could not install VM↔VM isolation rule (peer isolation may be missing): ${added.stderr.trim()}`,
        );
      } else {
        console.log(`[fleet] installed VM↔VM isolation rule on ${BRIDGE_NAME} (P0.3)`);
      }
    }
  } catch (err) {
    console.warn(
      `[fleet] VM isolation setup failed (best-effort): ${err instanceof Error ? err.message : err}`,
    );
  }
}

async function ensureTapDevice(tapName: string): Promise<void> {
  // Idempotent: if tap already exists, just bring it up + attach to bridge.
  const existing = await runCmdResult("ip", ["link", "show", tapName]);
  if (existing.code !== 0) {
    await runCmd("ip", ["tuntap", "add", tapName, "mode", "tap"]);
  }
  await runCmd("ip", ["link", "set", tapName, "master", BRIDGE_NAME]);
  await runCmd("ip", ["link", "set", tapName, "up"]);
}

async function teardownTap(tapName: string): Promise<void> {
  await runCmdResult("ip", ["link", "del", tapName]);
}

async function runCmdResult(
  cmd: string,
  args: string[],
): Promise<{ code: number | null; stderr: string }> {
  return await new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    p.stderr?.on("data", (c: Buffer) => (stderr += c.toString()));
    p.once("error", () => resolve({ code: 1, stderr }));
    p.once("close", (code) => resolve({ code, stderr }));
  });
}
