#!/usr/bin/env bash
# Build the Uniqus base rootfs as an ext4 image.
#
# Output: /var/lib/uniqus/firecracker/rootfs.ext4
#
# Contents (Alpine-based for boot speed + small footprint):
#   - openrc (init)
#   - bash, coreutils, util-linux
#   - Node.js 22 LTS (user runtime — the in-VM agent itself is now Rust, not Node)
#   - python3 + pip
#   - go 1.22
#   - git, curl, ca-certificates
#   - the Uniqus in-VM agent (statically-linked Rust musl binary) at
#     /opt/sandbox-agent/uniqus-agent — Plan §1
#   - an /etc/init.d/uniqus-agent service that mounts /sandbox + boots the agent
#
# Run on the same host as host-setup.sh, after that script. Idempotent: re-run
# any time you update the agent.
set -euo pipefail
umask 0077

STATE_DIR="${STATE_DIR:-/var/lib/uniqus/firecracker}"
ROOTFS="${STATE_DIR}/rootfs.ext4"
ROOTFS_SIZE_MB="${ROOTFS_SIZE_MB:-2048}"
# Alpine 3.22 ships Node.js 22 LTS. Keep this at a branch whose nodejs package
# satisfies current Vite (20.19+ or 22.12+); Alpine 3.20 pinned production to
# Node 20.15, so npm accepted Vite 8 with EBADENGINE and it crashed at runtime.
ALPINE_VERSION="${ALPINE_VERSION:-3.22}"
ALPINE_PATCH_VERSION="${ALPINE_PATCH_VERSION:-3.22.3}"
ALPINE_MIRROR="${ALPINE_MIRROR:-https://dl-cdn.alpinelinux.org/alpine}"
ALPINE_MINIROOT_SHA256="${ALPINE_MINIROOT_SHA256:-3b82169293fd705eb709f56eaf23cc1da75ba1e6fdd00985cf5b1357c4af38b5}"

if [[ "$(id -u)" != "0" ]]; then echo "must run as root" >&2; exit 1; fi
if ! command -v debootstrap >/dev/null 2>&1; then
  apt-get install -y --no-install-recommends debootstrap
fi
if ! command -v mksquashfs >/dev/null 2>&1; then apt-get install -y squashfs-tools; fi

# Where the orchestrator monorepo lives. Adjust if you've cloned to a non-default path.
REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
AGENT_SRC="${REPO_ROOT}/services/sandbox-agent"

WORK="$(mktemp -d)"
MNT="${WORK}/mnt"
mkdir -p "${MNT}"

# Robust cleanup: lazy-unmount the bind mounts AND the loop mount before
# rm'ing the temp dir, otherwise the dir is "busy" and the rootfs.ext4.new
# image stays loop-mounted across runs.
cleanup() {
  for m in "${MNT}/dev/pts" "${MNT}/dev" "${MNT}/sys" "${MNT}/proc" "${MNT}"; do
    umount -lR "${m}" 2>/dev/null || true
  done
  rm -rf "${WORK}"
}
trap cleanup EXIT

echo "[1/5] Creating ext4 image (${ROOTFS_SIZE_MB} MB)…"
truncate -s "${ROOTFS_SIZE_MB}M" "${ROOTFS}.new"
mkfs.ext4 -F -q "${ROOTFS}.new"
mount -o loop "${ROOTFS}.new" "${MNT}"

echo "[2/5] Bootstrapping Alpine ${ALPINE_VERSION} miniroot…"
MINIROOT_URL="${ALPINE_MIRROR}/v${ALPINE_VERSION}/releases/x86_64/alpine-minirootfs-${ALPINE_PATCH_VERSION}-x86_64.tar.gz"
curl -fSL "${MINIROOT_URL}" -o "${WORK}/miniroot.tgz"
if [[ ! "${ALPINE_MINIROOT_SHA256}" =~ ^[0-9a-fA-F]{64}$ ]] \
  || ! echo "${ALPINE_MINIROOT_SHA256,,}  ${WORK}/miniroot.tgz" | sha256sum --check --status; then
  echo "Alpine minirootfs SHA-256 verification failed" >&2
  exit 1
fi
tar -xzf "${WORK}/miniroot.tgz" -C "${MNT}"

echo "[3/5] Adding packages…"
mkdir -p "${MNT}/etc/apk"
echo "${ALPINE_MIRROR}/v${ALPINE_VERSION}/main"      > "${MNT}/etc/apk/repositories"
echo "${ALPINE_MIRROR}/v${ALPINE_VERSION}/community" >> "${MNT}/etc/apk/repositories"

# Bind-mount kernel filesystems + provide DNS so the chroot can reach the
# Alpine mirrors. Without these, `apk update` fails with "temporary error"
# because the chroot has no resolver and no /proc.
mount --bind /proc   "${MNT}/proc"
mount --bind /sys    "${MNT}/sys"
mount --bind /dev    "${MNT}/dev"
mount --bind /dev/pts "${MNT}/dev/pts" 2>/dev/null || true
cp /etc/resolv.conf "${MNT}/etc/resolv.conf"

chroot "${MNT}" /sbin/apk update
chroot "${MNT}" /sbin/apk add --no-cache \
  bash coreutils util-linux openrc \
  nodejs npm python3 py3-pip \
  go git curl ca-certificates iproute2 \
  socat dropbear-ssh

# Fail the image build instead of shipping a runtime that npm merely warns is
# incompatible with current Vite/Rolldown. npm's default engine-strict=false
# otherwise turns this into a much later, misleading native-binding crash.
chroot "${MNT}" node -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (!((major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major > 22)) {
    console.error(`Node ${process.version} is too old; require Node 20.19+ (Node 22 LTS preferred)`);
    process.exit(1);
  }
'

echo "[4/5] Building + installing the in-VM agent (Rust, musl) + init service…"
mkdir -p "${MNT}/opt/sandbox-agent" "${MNT}/sandbox"

# The agent is a statically-linked musl binary so it runs on Alpine without a
# libc match. We compile on the host (faster than inside the chroot) targeting
# x86_64-unknown-linux-musl. host-setup.sh provisions the pinned compiler via
# install-rust-toolchain.sh. Production builds fail closed if it is unavailable;
# local/dev builds may explicitly opt into the legacy Node agent with
# ALLOW_NODE_AGENT_FALLBACK=1.
RUST_TARGET="x86_64-unknown-linux-musl"
if command -v cargo >/dev/null 2>&1; then
  echo "  → cargo build --release --target ${RUST_TARGET}"
  ( cd "${AGENT_SRC}" \
    && cargo fetch --locked --target "${RUST_TARGET}" \
    && cargo build --release --locked --offline --target "${RUST_TARGET}" )
  install -m 0755 \
    "${AGENT_SRC}/target/${RUST_TARGET}/release/uniqus-agent" \
    "${MNT}/opt/sandbox-agent/uniqus-agent"
  cat > "${MNT}/etc/init.d/uniqus-agent" <<'EOF'
#!/sbin/openrc-run

description="Uniqus in-VM sandbox agent (Rust)"
command="/opt/sandbox-agent/uniqus-agent"
command_background=true
pidfile="/run/uniqus-agent.pid"
output_log="/var/log/uniqus-agent.log"
error_log="/var/log/uniqus-agent.log"

depend() {
  # Deliberately NOT `need net`. The agent configures eth0 itself (from the
  # kernel cmdline on a cold boot, or via the orchestrator's /net/configure
  # RPC on a snapshot restore), so gating on OpenRC's `net` only serves to
  # block boot behind the doomed eth0 DHCP attempt (no DHCP server on fcbr0).
  need localmount
  after sandbox-mount
}
EOF
else
  if [[ "${ALLOW_NODE_AGENT_FALLBACK:-0}" != "1" ]]; then
    echo "cargo is required to build the production Rust sandbox agent." >&2
    echo "Run infra/firecracker/install-rust-toolchain.sh, then rebuild." >&2
    echo "For an explicit local/dev fallback only, set ALLOW_NODE_AGENT_FALLBACK=1." >&2
    exit 1
  fi
  echo "  ⚠ ALLOW_NODE_AGENT_FALLBACK=1 — installing the legacy Node agent."
  mkdir -p "${MNT}/opt/sandbox-agent/src"
  install -m 0644 "${AGENT_SRC}/package.json"  "${MNT}/opt/sandbox-agent/package.json"
  install -m 0755 "${AGENT_SRC}/src/agent.mjs" "${MNT}/opt/sandbox-agent/src/agent.mjs"
  cat > "${MNT}/etc/init.d/uniqus-agent" <<'EOF'
#!/sbin/openrc-run

description="Uniqus in-VM sandbox agent (Node fallback)"
command="/usr/bin/node"
command_args="/opt/sandbox-agent/src/agent.mjs"
command_background=true
pidfile="/run/uniqus-agent.pid"
output_log="/var/log/uniqus-agent.log"
error_log="/var/log/uniqus-agent.log"

depend() {
  # Deliberately NOT `need net`. The agent configures eth0 itself (from the
  # kernel cmdline on a cold boot, or via the orchestrator's /net/configure
  # RPC on a snapshot restore), so gating on OpenRC's `net` only serves to
  # block boot behind the doomed eth0 DHCP attempt (no DHCP server on fcbr0).
  need localmount
  after sandbox-mount
}
EOF
fi
chmod 0755 "${MNT}/etc/init.d/uniqus-agent"

cat > "${MNT}/etc/init.d/sandbox-mount" <<'EOF'
#!/sbin/openrc-run

description="Mount the project's sandbox volume at /sandbox"

depend() {
  need localmount
  before uniqus-agent
}

start() {
  # Golden base-snapshot build (FIRECRACKER_BASE_SNAPSHOT): leave /sandbox
  # UNMOUNTED so the snapshot captures no placeholder filesystem. Every restored
  # clone mounts its OWN per-project disk after resume (agent /net/configure with
  # mount_sandbox), which reads a fresh superblock with no stale page cache.
  if grep -q 'uniqus_golden=1' /proc/cmdline 2>/dev/null; then
    einfo "uniqus_golden=1 → skipping /sandbox mount (clone mounts its own disk)"
    return 0
  fi
  ebegin "Mounting /sandbox from /dev/vdb"
  mkdir -p /sandbox
  if blkid /dev/vdb >/dev/null 2>&1; then
    mount -t ext4 /dev/vdb /sandbox
  else
    # First boot — image was created sparse, no FS yet. Format then mount.
    mkfs.ext4 -F -q /dev/vdb
    mount -t ext4 /dev/vdb /sandbox
  fi
  eend $?
}
EOF
chmod 0755 "${MNT}/etc/init.d/sandbox-mount"

# Wire services into the default runlevel
chroot "${MNT}" /sbin/rc-update add devfs    sysinit
chroot "${MNT}" /sbin/rc-update add procfs   sysinit
chroot "${MNT}" /sbin/rc-update add sysfs    sysinit
chroot "${MNT}" /sbin/rc-update add networking default
chroot "${MNT}" /sbin/rc-update add sandbox-mount boot
chroot "${MNT}" /sbin/rc-update add uniqus-agent  default

# Resolver: in-VM DNS. The host's iptables MASQUERADE handles egress; the
# guest just needs a working resolver.
echo "nameserver 1.1.1.1" >  "${MNT}/etc/resolv.conf"
echo "nameserver 8.8.8.8" >> "${MNT}/etc/resolv.conf"

# Network: loopback only. eth0 is owned entirely by the in-VM agent, which
# assigns a static address (cold boot: from the kernel cmdline uniqus_ip/_gw;
# snapshot restore: from the orchestrator's /net/configure RPC). We do NOT put
# `iface eth0 inet dhcp` here: there is no DHCP server on the fcbr0 bridge, so
# udhcpc would block the `networking` service for ~10-15s (its discover
# timeout) on every cold boot — the single biggest chunk of the old ~18s
# cold-start. The agent no longer waits on `net`, but dropping eth0 here also
# stops `networking` itself from stalling.
mkdir -p "${MNT}/etc/network"
cat > "${MNT}/etc/network/interfaces" <<'EOF'
auto lo
iface lo inet loopback
EOF

# Keep all mutable runtime state off the root filesystem. With these on tmpfs,
# the base rootfs is never written after boot, so a single read-only base image
# can be SHARED by every snapshot-restored clone (FIRECRACKER_BASE_SNAPSHOT)
# instead of copied per project — and it's harmless in the plain read-write
# cold-boot path too. localmount mounts these before sandbox-mount + the agent.
#
# /root MUST be in this list: commands run as root with HOME=/root, and tools
# write there ($HOME/.npmrc, ~/.config, ~/.cache fallbacks). On a golden clone
# the rootfs is mounted READ-ONLY, so without a tmpfs here npm's first install
# dies creating its cache ("ENOENT/EROFS: mkdir '/root/.npm'") on every restored
# VM. The HEAVY caches (npm/yarn/pnpm) don't live here — the agent points them
# at the per-project /sandbox/.cache disk so they don't eat guest RAM — this
# tmpfs just covers the long tail of small $HOME writes.
mkdir -p "${MNT}/tmp" "${MNT}/run" "${MNT}/var/log" "${MNT}/root"
cat >> "${MNT}/etc/fstab" <<'EOF'
tmpfs /tmp     tmpfs nodev,nosuid,mode=1777 0 0
tmpfs /run     tmpfs nodev,nosuid,mode=0755 0 0
tmpfs /var/log tmpfs nodev,nosuid,mode=0755 0 0
tmpfs /root    tmpfs nodev,nosuid,mode=0700 0 0
EOF

# Tighten root: passwordless console for boot debugging only. SSH is disabled.
chroot "${MNT}" /bin/sh -c "passwd -d root || true"

echo "[5/5] Unmounting + finalizing…"
sync
# Unwind in reverse order: pts → dev → sys → proc → loop. Lazy umount in
# case a process inside the chroot is still holding something open.
umount -lR "${MNT}/dev/pts" 2>/dev/null || true
umount -lR "${MNT}/dev"     2>/dev/null || true
umount -lR "${MNT}/sys"     2>/dev/null || true
umount -lR "${MNT}/proc"    2>/dev/null || true
umount "${MNT}"
mv "${ROOTFS}.new" "${ROOTFS}"
chown root:root "${ROOTFS}"
chmod 0644 "${ROOTFS}"

echo "Done. Base rootfs at: ${ROOTFS}"
echo "Update the orchestrator's FIRECRACKER_ROOTFS to point here if it isn't already."
