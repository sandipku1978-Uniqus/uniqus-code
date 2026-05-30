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
- Static-IP VM with a 172.16/16 private IP, NAT'd egress through the host NIC.
  There is **no DHCP** on the bridge: the agent configures eth0 itself from the
  kernel cmdline (`uniqus_ip`/`uniqus_gw`). A stray `iface eth0 inet dhcp` in the
  guest used to make `udhcpc` block OpenRC ~10-15s waiting for a lease that never
  comes — the single biggest chunk of the old ~18s cold start, now removed.
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

## New-project cold start: the two paths

The retention tiers above all speed REOPENING a project that already booted once.
A brand-NEW project has no per-project VM or snapshot, so it hits `bootNew()` —
the only path that governs new-project latency. Two changes attack it:

1. **Boot fixes (always on).** No DHCP stall (see "What this gives you"); the
   agent owns eth0; `/tmp`, `/run`, `/var/log` are tmpfs so the base rootfs is
   never written after boot. A cold boot drops from ~15-20s to ~3-8s.
2. **Golden base snapshot (opt-in: `FIRECRACKER_BASE_SNAPSHOT=1`).** On startup
   the fleet boots ONE VM to "agent ready" on the **read-only, shared** base
   rootfs and snapshots it. Every new project then restores a clone from that
   snapshot (≈ mmap of the memory file — **sub-second**) instead of booting.
   Clones share the read-only rootfs (no per-project 2 GiB copy) and each get
   their own `sandbox.ext4`, resolved via the per-VM firecracker working dir
   (Firecracker's "relative paths + per-sandbox cwd" clone pattern).

   The golden is frozen with a shared **bootstrap identity** (`uniqus_ip`
   = `172.16.255.254`, MAC `02:fc:ff:ff:ff:fe`, cmdline `uniqus_golden=1` so the
   sandbox is left unmounted). On restore the orchestrator loads the snapshot
   with `network_overrides` pointing eth0 at the project's TAP, resumes, then —
   holding a global lock so only one clone wears the bootstrap identity at a time
   — calls the agent's **`POST /net/configure`** over the bootstrap IP to mount
   the project disk, reseed RNG, fix the clock, and re-stamp eth0 to the
   project's own MAC/IP. The agent acks first and re-stamps ~250ms later (it
   can't reconfigure the link it's answering over). On ANY failure the fleet
   falls back to the cold-boot path, so the flag is safe to ship dark.

### Enabling + validating the golden snapshot

```sh
# 1. Rebuild the rootfs (adds tmpfs mounts + the no-DHCP / golden changes).
sudo REPO_ROOT=/path/to/uniqus-code ./build-rootfs.sh

# 2. Turn the flag on PERSISTENTLY via a systemd drop-in (an env prefix on
#    `systemctl restart` does NOT reach the service — that env goes to systemctl,
#    not the unit), then restart and watch the one-time golden build.
#    If this hangs / never reports "golden snapshot written", the rootfs likely
#    can't boot READ-ONLY — add more tmpfs lines to build-rootfs.sh for whatever
#    dir a service wants to write, rebuild, retry. (Until then, new projects just
#    cold-boot — nothing breaks.)
sudo mkdir -p /etc/systemd/system/uniqus-orchestrator.service.d
printf '[Service]\nEnvironment=FIRECRACKER_BASE_SNAPSHOT=1\n' \
  | sudo tee /etc/systemd/system/uniqus-orchestrator.service.d/golden.conf
sudo systemctl daemon-reload && sudo systemctl restart uniqus-orchestrator
journalctl -u uniqus-orchestrator -f | grep '\[fleet base\]'
#    → expect: "golden snapshot written → .../base/base.snapshot"

# 3. Create a brand-new project in the UI and watch:
journalctl -u uniqus-orchestrator -f | grep '\[fleet'
#    → expect: "restored from golden snapshot → 172.16.x.y" in well under 1s.
#      A "falling back to cold boot" line means investigate before relying on it.
```

Tunable: `FIRECRACKER_BOOTSTRAP_IP` (default `172.16.255.254`, reserved out of
the project IP range). Delete `…/firecracker/base/` to force a golden rebuild
after a rootfs change.

## What's deliberately not here yet

- **ZFS** for the host filesystem. Plan §1 specifies it for snapshot
  density. Phase-2 uses ext4 + reflink (XFS-friendly) — adequate at
  10–100 VMs/host, not at 1000+. (The base-snapshot path sidesteps the
  per-project rootfs copy entirely by sharing one read-only base image, so
  reflink only matters for the cold-boot fallback now.)
- **netns-per-clone networking.** The base-snapshot restore serializes the
  ~0.3-1s bootstrap re-stamp window. If new-VM throughput ever needs to exceed
  that, move each clone into its own network namespace (same frozen guest IP,
  no shared identity, no lock) — Firecracker's documented clone model.
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
