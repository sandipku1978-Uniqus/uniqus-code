# Firecracker — trust boundary & isolation model

How the Uniqus sandbox isolates user/agent-controlled code, and where the
current gaps are. Code-grounded in
[`services/orchestrator/src/firecracker/fleet.ts`](../../services/orchestrator/src/firecracker/fleet.ts),
[`host-setup.sh`](./host-setup.sh), and [`build-rootfs.sh`](./build-rootfs.sh).
Operational/latency details live in [`README.md`](./README.md); this file is
specifically the security story.

## The trust boundary

User code and the in-VM agent run **inside** a Firecracker microVM. The
orchestrator (which holds API keys, OAuth tokens, and the secret-encryption
key) runs on the **host**, outside the VM. The boundary between them is a
hardware-virtualization boundary (KVM), not a container namespace.

- **Per-project microVM.** Each project gets its own Firecracker VM with its
  own kernel, RAM, and root filesystem (`bootNew()` in `fleet.ts`). Two
  projects never share a kernel or address space.
- **What crosses the boundary.** The orchestrator talks to the in-VM agent
  over the VM's private IP (`agentPort` = 51000) and a vsock UDS. It pushes
  project files in (`hydrateInto`) and issues agent RPCs. Secret *values*,
  provider API keys, and OAuth tokens stay on the host — see
  [`docs/secret-handling.md`](../../docs/secret-handling.md) and
  [`docs/connector-security.md`](../../docs/connector-security.md).
- **VCPU/RAM caps.** `FIRECRACKER_VCPUS` (default 2) and
  `FIRECRACKER_MEM_MIB` (default 1024) bound each VM. There is **no per-VM
  cgroup** for disk/CPU IO weighting yet (see Gaps).

## Network setup (tap + bridge + NAT)

`host-setup.sh` creates a single Linux bridge `fcbr0` at `172.16.0.1/16` and an
iptables MASQUERADE so VM egress NATs out the host's external NIC
(`EXT_IFACE`). Per-VM, `fleet.ts`:

- `allocateNetwork(projectId)` hashes the projectId (SHA-256) into a static
  `172.16.a.b/16` address, a locally-administered MAC (`02:fc:<hash>`), and a
  tap name (`tap-<hash>`, ≤15 chars). These are **deterministic per project**
  so a snapshot taken by one orchestrator process reattaches to the same tap.
- `ensureTapDevice` creates the tap, enslaves it to `fcbr0`, brings it up.
- There is **no DHCP** on the bridge. The in-VM agent stamps eth0 from the
  kernel cmdline (`uniqus_ip`/`uniqus_gw`) on cold boot, or via the
  orchestrator's `POST /net/configure` RPC on a snapshot restore.

### Known limit: /16 IP collision (not yet mitigated)

`allocateNetwork` derives the host octets from `h[0]` and `h[1]` of the
project-id hash (with `.0`/`.1`/`.255` and the bootstrap IP reserved). That is
effectively a 16-bit space, so by the birthday bound **two projects collide at
~256 projects on one host**. There is currently **no collision detection or
retry** — `fleet.ts` comments call this a "Phase-3 problem." On a host expected
to exceed ~100–200 concurrent VMs this must be addressed (collision retry, a
wider allocation space, or netns-per-VM) before it is safe.

## What is and isn't firewalled

From `host-setup.sh` (iptables, persisted via `netfilter-persistent`):

- **Allowed:** `fcbr0 → EXT_IFACE` FORWARD (egress) and the
  RELATED,ESTABLISHED return path. VMs reach the public internet, NAT'd.
- **Blocked:** `fcbr0 → 169.254.169.254` is DROP'd — the cloud metadata
  endpoint, the classic SSRF credential-theft target.
- **NOT firewalled (current gaps):**
  - **No egress allowlist.** A VM can reach any public host (and any service
    the host NIC can route to that isn't explicitly dropped). The README calls
    out that only "a basic link-local-blocking rule" exists; a real egress
    allowlist is Phase-3 (Plan §6, Risk #2).
  - **VM ↔ VM on the bridge.** All VMs share `fcbr0`. There is no rule
    isolating one project's `172.16.x.y` from another's, so cross-VM traffic on
    the bridge is **not blocked today**. (Single-tenant-per-host or
    netns-per-VM would close this.)
  - **VM → host services** beyond the metadata-endpoint DROP are not broadly
    restricted. Adjust the FORWARD rules per deployment if the host runs other
    private services.

## Rootfs, golden snapshot, and read-only sharing

- **Base rootfs** (`build-rootfs.sh`) is an Alpine ext4 image: OpenRC, Node 20,
  Python 3, Go 1.22, git, plus the in-VM agent (statically-linked Rust musl
  binary, or a Node fallback if cargo is absent at build time). SSH is
  disabled; root has its password cleared **only** for passwordless serial
  console boot-debugging — there is no network login path.
- **Mutable dirs are tmpfs** (`/tmp`, `/run`, `/var/log`) so the base rootfs is
  never written after boot. This is what lets a single base image be shared
  **read-only** across clones.
- **Cold-boot path** copies the base rootfs to a per-project overlay
  (`copyOnWrite`, reflink when available) — that overlay is writable and
  per-project, cleaned up on `destroy`/`reclaim`.
- **Golden base snapshot** (`FIRECRACKER_BASE_SNAPSHOT=1`, default OFF) boots
  ONE VM read-only (`ro`, `uniqus_golden=1`) and snapshots it; every new
  project restores a clone that **shares the read-only base rootfs**
  (`rootImagePath === ROOTFS_BASE_PATH`). The shared read-only image cannot be
  mutated by a clone, so one project cannot poison another's root via it.
  - Clones boot wearing a **shared bootstrap identity**
    (`BOOTSTRAP_IP=172.16.255.254`, MAC `02:fc:ff:ff:ff:fe`). A global
    `withBootstrapLock` serializes the ~0.3–1s window in which exactly one
    clone wears that identity, until it re-stamps its own per-project IP/MAC
    via `POST /net/configure`. This is a correctness/throughput lock, not an
    isolation primitive — see the netns-per-clone follow-up in the README.

## Per-project disk

Each VM mounts its own `/sandbox` ext4 image
(`<projectId>.sandbox.ext4`, 1 GiB sparse, `mkfs.ext4` on first boot — see
`ensureSandboxImage`). It is a **separate virtio-blk device** from the rootfs
and is per-project, so one project's files never live in another's disk. There
is **no automatic grow path** yet (a >80%-full grow is noted as Phase-3); a
project that fills 1 GiB will hit ENOSPC inside the VM.

## GC / retention (what gets freed, when)

The idle sweeper (`startIdleSweeper`, ticks every 30s) escalates idle VMs; all
thresholds are env-tunable:

| Tier | Env var (default) | Action |
| --- | --- | --- |
| running → paused | `FIRECRACKER_IDLE_PAUSE_MS` (5 min) | freeze VM, RAM held |
| paused → snapshotted | `FIRECRACKER_IDLE_SNAPSHOT_MS` (30 min paused) | full snapshot, kill firecracker, **free RAM** |
| reclaim | `FIRECRACKER_GC_MAX_IDLE_MS` (72 h) | free snapshot/memory pair + rootfs overlay + tap; **keep** `sandbox.ext4` |
| FS reap | `FIRECRACKER_FS_REAP_MAX_IDLE_MS` (14 days) | finally delete `sandbox.ext4` |

- `destroy(projectId)` (project deletion) tears down the firecracker process,
  removes the API socket, vsock, per-project rootfs overlay (never the shared
  base), snapshot pair, sandbox image, and tap.
- `gcOrphanedSnapshots` sweeps artifacts left by a prior orchestrator process
  whose project was deleted, on a ~30-min cadence.
- **Security note:** the per-project `sandbox.ext4` survives reclaim and
  orchestrator restarts (intentional — it holds `node_modules` and uncommitted
  state). It is only deleted at the much longer FS-reap ceiling or on explicit
  `destroy`. There is no cryptographic wipe of the image on delete — it is a
  plain `fs.rm`, so deleted-but-not-yet-overwritten disk blocks are subject to
  the host filesystem's normal behavior.

## Honest summary of current gaps

- **/16 IP collision** at ~256 projects/host, no retry (above).
- **No egress allowlist**; only the metadata endpoint is DROP'd.
- **No VM↔VM bridge isolation** — all VMs share `fcbr0`.
- **No per-VM cgroups** (CPU/disk IO weighting) and **no Falco / runtime
  syscall monitoring** — Plan §6 Risk #2, Phase-3.
- **No automatic sandbox-disk grow** (1 GiB fixed today).
- The host setup **assumes orchestrator and Firecracker run on the same box**.
  A split topology needs the vsock/AF_UNIX path wrapped in WireGuard (README).
