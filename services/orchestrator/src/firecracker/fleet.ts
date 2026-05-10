import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { FirecrackerClient, spawnFirecracker } from "./client.js";
import { ping, pushFile } from "./agentRpc.js";
import type { VmHandle } from "./types.js";

/**
 * Firecracker fleet manager (Plan §1).
 *
 * Owns the per-project VM lifecycle:
 *   1. Boot a VM from a base rootfs + per-project overlay.
 *   2. Hand a `VmHandle` to the orchestrator's session (which threads it
 *      into the Sandbox).
 *   3. Pause idle VMs and resume them on demand (cheap warm pool).
 *   4. Destroy on project delete.
 *
 * Phase-2 substrate: minimal but real. Snapshot/restore for sub-second
 * cold-start (Plan §4) is plumbed into the API client but the fleet
 * manager wires up snapshots in a follow-up (Phase-3 polish).
 *
 * Hetzner notes:
 *   - We assume each VM gets its own TAP device (named `tap-<short-id>`).
 *     The per-host setup script in `infra/firecracker/host-setup.sh`
 *     creates the bridge and iptables masquerade once at boot.
 *   - Each VM gets a /29 from the 172.16.0.0/12 private range. The fleet
 *     allocates from a free-list; collisions across orchestrator restarts
 *     are avoided by keying off the project id.
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
const BRIDGE_NAME = process.env.FIRECRACKER_BRIDGE ?? "fcbr0";
const BRIDGE_GATEWAY = process.env.FIRECRACKER_GATEWAY ?? "172.16.0.1";
const BRIDGE_NETMASK = process.env.FIRECRACKER_NETMASK ?? "255.255.0.0";

interface ManagedVm {
  handle: VmHandle;
  client: FirecrackerClient;
  /** firecracker process pid so we can SIGTERM on shutdown. */
  fcPid: number;
  fcClose: () => void;
}

const vms = new Map<string, ManagedVm>();
let cidSeq = 100; // guest CIDs 0/1/2 are reserved by the kernel; pick a non-overlapping range

export interface BootOpts {
  projectId: string;
  /** Host path the VM should mount at /sandbox via virtio-blk overlay. */
  hostSandboxDir: string;
}

export async function ensureVm(opts: BootOpts): Promise<VmHandle> {
  const existing = vms.get(opts.projectId);
  if (existing) {
    if (existing.handle.state === "paused") {
      await resume(opts.projectId);
    }
    existing.handle.lastUsedAt = Date.now();
    return existing.handle;
  }
  return await bootNew(opts);
}

async function bootNew(opts: BootOpts): Promise<VmHandle> {
  await fs.mkdir(STATE_DIR, { recursive: true });

  const id = `vm_${opts.projectId.slice(0, 8)}_${randomUUID().slice(0, 4)}`;
  const apiSocket = path.join(STATE_DIR, `${id}.api.sock`);
  const vsockUds = path.join(STATE_DIR, `${id}.vsock`);
  const rootImagePath = path.join(STATE_DIR, `${id}.root.ext4`);

  // Per-project overlay rootfs: copy the base rootfs once. Fast on most
  // Linux filesystems thanks to copy-on-write (XFS reflink, btrfs CoW,
  // ZFS clone). Falls back to plain copy when CoW isn't available.
  await copyOnWrite(ROOTFS_BASE_PATH, rootImagePath);

  // Allocate per-VM networking. Hash projectId → /16 host octets so the
  // same project gets the same IP across orchestrator restarts. MAC is
  // a locally-administered prefix (02:fc:…) seeded from the same hash.
  const { ip, gatewayIp, mac, tapName } = allocateNetwork(opts.projectId, id);
  await ensureBridge();
  await ensureTapDevice(tapName);

  // Spawn firecracker bound to a fresh API socket.
  const fc = await spawnFirecracker({ socketPath: apiSocket });
  const client = new FirecrackerClient(apiSocket);

  const guestCid = ++cidSeq;
  const agentPort = 51_000;

  try {
    await client.putMachineConfig({ vcpu_count: VM_VCPUS, mem_size_mib: VM_MEM_MIB });
    // Pass the static IP via the kernel's `ip=` cmdline. Format:
    //   ip=<client>:<server>:<gw>:<netmask>:<host>:<dev>:<auto>:<dns>
    // We only need client/gw/netmask/dev. Linux configures eth0 in early
    // boot — no DHCP server needed on the bridge.
    const ipArg = `ip=${ip}::${gatewayIp}:${BRIDGE_NETMASK}::eth0:off:1.1.1.1`;
    await client.putBootSource({
      kernel_image_path: KERNEL_PATH,
      // Console, panic=1 so a kernel panic exits the firecracker process
      // (we restart cleanly instead of hanging). `random.trust_cpu=on`
      // shaves boot time. The ip= arg drives static config.
      boot_args:
        `console=ttyS0 reboot=k panic=1 pci=off random.trust_cpu=on ${ipArg} i8042.noaux i8042.nomux i8042.nopnp i8042.dumbkbd`,
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
    await client.startInstance();
  } catch (err) {
    fc.close();
    await teardownTap(tapName).catch(() => {});
    throw err;
  }

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
    state: "running",
    lastUsedAt: Date.now(),
  };

  // Wait until the in-VM agent answers /health. The rootfs's init script
  // launches the agent on boot; this loop usually takes <300ms once the
  // kernel + initrd are warm.
  const deadline = Date.now() + 10_000;
  let healthy = false;
  while (Date.now() < deadline) {
    if (await ping(handle)) {
      healthy = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!healthy) {
    fc.close();
    throw new Error(
      `[vm ${id}] agent did not answer /health within 10s — check the rootfs init script and that vsock is enabled in the kernel`,
    );
  }

  // Initial hydration: push host-side project files into the VM. Cheap on
  // small projects; the in-VM agent acks each file. Cap so a runaway
  // hydration doesn't pin the boot path forever.
  await hydrateInto(handle, opts.hostSandboxDir).catch((err) => {
    console.error(`[vm ${id}] initial hydration failed:`, err);
  });

  vms.set(opts.projectId, { handle, client, fcPid: fc.pid, fcClose: fc.close });
  return handle;
}

const HYDRATE_MAX_FILES = 5_000;
const HYDRATE_MAX_BYTES = 200 * 1024 * 1024;

async function hydrateInto(vm: VmHandle, hostDir: string): Promise<void> {
  const root = path.resolve(hostDir);
  let count = 0;
  let bytes = 0;
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!e.isFile()) continue;
      const rel = path.relative(root, full).replaceAll(path.sep, "/");
      const stat = await fs.stat(full);
      if (bytes + stat.size > HYDRATE_MAX_BYTES) return;
      if (count >= HYDRATE_MAX_FILES) return;
      const data = await fs.readFile(full);
      await pushFile(vm, rel, data);
      count++;
      bytes += stat.size;
    }
  }
  await walk(root);
}

export async function pause(projectId: string): Promise<void> {
  const vm = vms.get(projectId);
  if (!vm || vm.handle.state !== "running") return;
  await vm.client.pauseInstance();
  vm.handle.state = "paused";
}

export async function resume(projectId: string): Promise<void> {
  const vm = vms.get(projectId);
  if (!vm || vm.handle.state !== "paused") return;
  await vm.client.resumeInstance();
  vm.handle.state = "running";
  vm.handle.lastUsedAt = Date.now();
}

export async function destroy(projectId: string): Promise<void> {
  const vm = vms.get(projectId);
  if (!vm) return;
  try {
    await vm.client.ctrlAltDel();
  } catch {}
  vm.fcClose();
  await fs.rm(vm.handle.apiSocket, { force: true }).catch(() => {});
  await fs.rm(vm.handle.vsockUds, { force: true }).catch(() => {});
  await fs.rm(vm.handle.rootImagePath, { force: true }).catch(() => {});
  await teardownTap(vm.handle.tapDevice).catch(() => {});
  vm.handle.state = "stopped";
  vms.delete(projectId);
}

export function listVms(): VmHandle[] {
  return Array.from(vms.values()).map((v) => v.handle);
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

// Background sweep: pause VMs idle longer than IDLE_PAUSE_MS so a 100-VM
// host doesn't pay full RAM for projects no one is touching. Cheap to
// resume — Firecracker's pause is in-memory, sub-millisecond.
let sweeperStarted = false;
export function startIdleSweeper(): void {
  if (sweeperStarted) return;
  sweeperStarted = true;
  setInterval(() => {
    const now = Date.now();
    for (const [, vm] of vms) {
      if (vm.handle.state === "running" && now - vm.handle.lastUsedAt > IDLE_PAUSE_MS) {
        pause(vm.handle.projectId).catch(() => {});
      }
    }
  }, 30_000).unref();
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
 */
function allocateNetwork(projectId: string, vmId: string): NetAlloc {
  const h = createHash("sha256").update(projectId).digest();
  // Reserve .0 (network), .1 (gateway), .255 (broadcast). Skip 1..2.
  const a = h[0];
  const bRaw = h[1];
  const b = bRaw <= 1 ? 2 : bRaw === 255 ? 254 : bRaw;
  const ip = `172.16.${a}.${b}`;
  // Locally-administered MAC: 02:FC:<projectHash[2..6]>
  const hex = (n: number): string => n.toString(16).padStart(2, "0");
  const mac = `02:fc:${hex(h[2])}:${hex(h[3])}:${hex(h[4])}:${hex(h[5])}`;
  // TAP names cap at 15 chars on Linux; keep our prefix short.
  const tapName = `tap-${vmId.slice(-9)}`;
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
  bridgeChecked = true;
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
