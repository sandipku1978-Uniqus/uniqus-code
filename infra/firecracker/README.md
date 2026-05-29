# Firecracker fleet — host setup

Phase-2 substrate per Plan §1. The orchestrator runs the agent loop;
Firecracker runs the user's project in a microVM. This folder has the
scripts to bring up a Hetzner / generic-Linux host that the orchestrator
can use as a sandbox fleet.

## Files

- `host-setup.sh` — installs Firecracker + builds the bridge / NAT / KVM
  permissions. **Run once on a fresh box.**
- `build-rootfs.sh` — produces `/var/lib/uniqus/firecracker/rootfs.ext4`
  (Alpine + Node + Python + Go + the in-VM agent). Re-run any time you
  update [`services/sandbox-agent/`](../../services/sandbox-agent/).

## One-shot bring-up (Hetzner CX/AX, Ubuntu 22.04+)

```sh
# 1. Run as root once.
sudo EXT_IFACE=eth0 ./host-setup.sh

# 2. Build the rootfs (also as root).
sudo REPO_ROOT=/path/to/uniqus-code ./build-rootfs.sh

# 3. Verify Firecracker can boot a VM.
firecracker --version
ls -lh /var/lib/uniqus/firecracker/{vmlinux,rootfs.ext4}
```

After that, point the orchestrator at this host:

```env
UNIQUS_SANDBOX=firecracker
FIRECRACKER_STATE_DIR=/var/lib/uniqus/firecracker
FIRECRACKER_KERNEL=/var/lib/uniqus/firecracker/vmlinux
FIRECRACKER_ROOTFS=/var/lib/uniqus/firecracker/rootfs.ext4
FIRECRACKER_VCPUS=2
FIRECRACKER_MEM_MIB=1024
FIRECRACKER_IDLE_PAUSE_MS=300000
```

## What this gives you

- Per-project Alpine microVM, ~125 ms boot cold, ~5 ms resume from pause.
- Per-VM `/sandbox` ext4 image at `/var/lib/uniqus/firecracker/<projectId>.sandbox.ext4`.
- DHCP'd VM with a 172.16/16 private IP, NAT'd egress through the host NIC.
- Idle VMs auto-pause after `FIRECRACKER_IDLE_PAUSE_MS` (default 5 min).
- KVM access scoped to the `kvm` group; orchestrator runs as a non-root
  user added to that group by `host-setup.sh`.

## Idle lifecycle & retention

The fleet manager (`services/orchestrator/src/firecracker/fleet.ts`) escalates
idle VMs in tiers, all env-tunable:

- `FIRECRACKER_IDLE_PAUSE_MS` (default 5 min) — running → paused.
- `FIRECRACKER_IDLE_SNAPSHOT_MS` (default 30 min paused) — paused → snapshotted:
  takes a full snapshot, kills firecracker, frees the VM's RAM. Reopening does a
  sub-second restore from the snapshot pair.
- `FIRECRACKER_GC_MAX_IDLE_MS` (default **72 h**) — snapshot-retention ceiling.
  Past this we *reclaim* the VM: free the ~1 GiB snapshot/memory pair + rootfs
  overlay, but **keep** the per-project `sandbox.ext4` (so `node_modules` and
  uncommitted state survive). Reopening then cold-boots but reattaches that
  image — skipping re-hydration and a cold `npm install`.
- `FIRECRACKER_FS_REAP_MAX_IDLE_MS` (default **14 days**) — only after this do
  we finally delete `sandbox.ext4` to reclaim disk for a long-untouched project.

This keeps "reopen after a day or two" fast (snapshot restore) and "reopen after
a couple weeks" merely a cold boot rather than a full reinstall.

## What's deliberately not here yet

- **ZFS** for the host filesystem. Plan §1 specifies it for snapshot
  density. Phase-2 uses ext4 + reflink (XFS-friendly) — adequate at
  10–100 VMs/host, not at 1000+.
- **Falco / per-VM cgroups / egress allowlist** beyond a basic
  link-local-blocking rule. Plan §6 (Risk #2) — Phase-3.
- **Public preview routing**. The dev server starts inside the VM; the
  orchestrator's preview proxy still talks to `127.0.0.1:port`. Bridging
  the proxy to per-VM IPs is a small follow-up but not in this commit.
- **WireGuard** between the orchestrator host and the VM host. Today the
  setup assumes orchestrator + Firecracker run on the same box; for a
  separated topology you'll want to wrap the AF_UNIX vsock socket in a
  WireGuard tunnel.

## Troubleshooting

- `KVM is not available` from `host-setup.sh`: open the Hetzner Robot
  console → request KVM enablement on the box. Most CX/AX models ship
  with it on; AX models occasionally have it disabled in BIOS.
- VM hangs after `firecracker InstanceStart`: check
  `/var/log/uniqus-agent.log` inside the VM (boot the rootfs as a chroot
  with `mount -o loop` and tail the file). Usually a missing package or
  the agent crashed at boot.
- "agent did not answer /health within 10s": vsock is not enabled in the
  kernel, OR the agent crashed. The shipped kernel
  (`vmlinux-5.10.225` from the Firecracker CI bucket) has vsock built-in;
  if you swap kernels, make sure `CONFIG_VHOST_VSOCK=y`.
