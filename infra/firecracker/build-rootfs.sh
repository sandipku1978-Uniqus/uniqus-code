#!/usr/bin/env bash
# Build the Uniqus base rootfs as an ext4 image.
#
# Output: /var/lib/uniqus/firecracker/rootfs.ext4
#
# Contents (Alpine-based for boot speed + small footprint):
#   - openrc (init)
#   - bash, coreutils, util-linux
#   - node 20 (the in-VM agent runs on it; doubles as the user runtime)
#   - python3 + pip
#   - go 1.22
#   - git, curl, ca-certificates
#   - the @uniqus/sandbox-agent code under /opt/sandbox-agent
#   - an /etc/init.d/uniqus-agent service that mounts /sandbox + boots the agent
#
# Run on the same host as host-setup.sh, after that script. Idempotent: re-run
# any time you update the agent.
set -euo pipefail

STATE_DIR="${STATE_DIR:-/var/lib/uniqus/firecracker}"
ROOTFS="${STATE_DIR}/rootfs.ext4"
ROOTFS_SIZE_MB="${ROOTFS_SIZE_MB:-2048}"
ALPINE_VERSION="${ALPINE_VERSION:-3.20}"
ALPINE_MIRROR="${ALPINE_MIRROR:-https://dl-cdn.alpinelinux.org/alpine}"

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
MINIROOT_URL="${ALPINE_MIRROR}/v${ALPINE_VERSION}/releases/x86_64/alpine-minirootfs-${ALPINE_VERSION}.0-x86_64.tar.gz"
curl -fSL "${MINIROOT_URL}" -o "${WORK}/miniroot.tgz"
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

echo "[4/5] Installing the in-VM agent + init service…"
mkdir -p "${MNT}/opt/sandbox-agent/src" "${MNT}/sandbox"
install -m 0644 "${AGENT_SRC}/package.json"   "${MNT}/opt/sandbox-agent/package.json"
install -m 0755 "${AGENT_SRC}/src/agent.mjs"  "${MNT}/opt/sandbox-agent/src/agent.mjs"

# Init: mount /sandbox from /dev/vdb (the per-project sandbox image), then
# launch the agent. Alpine init system is OpenRC.
cat > "${MNT}/etc/init.d/uniqus-agent" <<'EOF'
#!/sbin/openrc-run

description="Uniqus in-VM sandbox agent"
command="/usr/bin/node"
command_args="/opt/sandbox-agent/src/agent.mjs"
command_background=true
pidfile="/run/uniqus-agent.pid"
output_log="/var/log/uniqus-agent.log"
error_log="/var/log/uniqus-agent.log"

depend() {
  need net localmount
  after sandbox-mount
}
EOF
chmod 0755 "${MNT}/etc/init.d/uniqus-agent"

cat > "${MNT}/etc/init.d/sandbox-mount" <<'EOF'
#!/sbin/openrc-run

description="Mount the project's sandbox volume at /sandbox"

depend() {
  need localmount
  before uniqus-agent
}

start() {
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

# Network: DHCP on eth0. Most rootfs's already have this; force it for safety.
mkdir -p "${MNT}/etc/network"
cat > "${MNT}/etc/network/interfaces" <<'EOF'
auto lo
iface lo inet loopback

auto eth0
iface eth0 inet dhcp
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
chmod 0644 "${ROOTFS}"

echo "Done. Base rootfs at: ${ROOTFS}"
echo "Update the orchestrator's FIRECRACKER_ROOTFS to point here if it isn't already."
