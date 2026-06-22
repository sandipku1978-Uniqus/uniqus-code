#!/usr/bin/env bash
# Hetzner / generic-Linux host bootstrap for Uniqus Firecracker fleet.
#
# Run once on a fresh bare-metal box (root). Idempotent.
#
# What this does:
#   1. Verifies KVM is available.
#   2. Installs firecracker, mkfs.ext4, jq, iptables, bridge-utils.
#   3. Creates the bridge `fcbr0` and a /16 in 172.16.0.0/12 for VM private IPs.
#   4. Sets up iptables MASQUERADE so VM traffic egresses via the host NIC, plus
#      per-VM isolation so VMs on the shared bridge can't reach each other (P0.3).
#   5. Drops the kernel + base rootfs in /var/lib/uniqus/firecracker/.
#   6. Allows `uniqus` (or whichever uid runs the orchestrator) into /dev/kvm.
#
# Hetzner notes:
#   - You'll be on a CX/AX dedicated box with KVM enabled in BIOS — most are by
#     default. If `ls /dev/kvm` fails, request KVM enablement via the Hetzner
#     Robot console (no charge, takes a few minutes on most boxes).
#   - Set EXT_IFACE below to your public NIC (`eth0` on most Hetzner images,
#     `enp0s31f6` on some AX boxes). Run `ip route get 1.1.1.1` to find it.
set -euo pipefail

EXT_IFACE="${EXT_IFACE:-eth0}"
STATE_DIR="/var/lib/uniqus/firecracker"
KERNEL_URL="${KERNEL_URL:-}"
# Golden base snapshots restore with `network_overrides` on PUT /snapshot/load,
# which Firecracker only added in v1.12.0. On anything older (we shipped v1.10.1
# originally) every golden restore 400s and silently falls back to cold boot —
# so this MUST stay >= v1.12.0. v1.12.1 is the latest v1.12 patch.
FIRECRACKER_VERSION="${FIRECRACKER_VERSION:-v1.12.1}"
FIRECRACKER_URL="https://github.com/firecracker-microvm/firecracker/releases/download/${FIRECRACKER_VERSION}/firecracker-${FIRECRACKER_VERSION}-x86_64.tgz"

if [[ "$(id -u)" != "0" ]]; then
  echo "must run as root" >&2
  exit 1
fi

if [[ ! -e /dev/kvm ]]; then
  echo "KVM is not available. Enable virtualization in BIOS / request KVM from Hetzner Robot." >&2
  exit 1
fi

echo "[1/6] Installing packages…"
apt-get update -y
apt-get install -y --no-install-recommends \
  iproute2 iptables iptables-persistent bridge-utils \
  e2fsprogs xz-utils curl jq ca-certificates \
  socat netcat-openbsd

echo "[2/6] Installing Firecracker ${FIRECRACKER_VERSION}…"
# Re-install when missing OR when the installed version != the pinned one, so a
# version bump (e.g. the v1.10.1 → v1.12.1 network_overrides fix) actually takes
# on an already-provisioned host instead of being skipped.
installed_fc_version=""
if command -v firecracker >/dev/null 2>&1; then
  installed_fc_version="$(firecracker --version 2>/dev/null | head -1 | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' || true)"
fi
if [[ "${installed_fc_version}" != "${FIRECRACKER_VERSION}" ]]; then
  echo "  installing ${FIRECRACKER_VERSION} (current: ${installed_fc_version:-none})"
  tmp="$(mktemp -d)"
  curl -fSL "${FIRECRACKER_URL}" -o "${tmp}/firecracker.tgz"
  tar -xf "${tmp}/firecracker.tgz" -C "${tmp}"
  install -m 0755 "${tmp}"/release-*/firecracker-*-x86_64 /usr/local/bin/firecracker
  install -m 0755 "${tmp}"/release-*/jailer-*-x86_64    /usr/local/bin/jailer
  rm -rf "${tmp}"
else
  echo "  ${FIRECRACKER_VERSION} already installed"
fi
firecracker --version

echo "[3/6] State dir + kernel…"
mkdir -p "${STATE_DIR}"
if [[ ! -f "${STATE_DIR}/vmlinux" ]]; then
  if [[ -z "${KERNEL_URL}" ]]; then
    # The Firecracker CI bucket prunes old kernels, so we resolve the
    # latest 5.10.x available at run time instead of hardcoding a patch
    # level that may have aged out.
    KERNEL_URL="$(curl -s 'https://s3.amazonaws.com/spec.ccfc.min/?list-type=2&prefix=firecracker-ci/v1.10/x86_64/' \
      | grep -oE 'firecracker-ci/v1\.10/x86_64/vmlinux-5\.10\.[0-9]+' \
      | sort -t. -k3,3n \
      | tail -1 \
      | sed 's|^|https://s3.amazonaws.com/spec.ccfc.min/|')"
    if [[ -z "${KERNEL_URL}" ]]; then
      echo "Could not auto-discover a kernel from the Firecracker CI bucket." >&2
      echo "Set KERNEL_URL=... manually and re-run." >&2
      exit 1
    fi
    echo "  resolved kernel: ${KERNEL_URL}"
  fi
  curl -fSL "${KERNEL_URL}" -o "${STATE_DIR}/vmlinux"
fi
chmod 0644 "${STATE_DIR}/vmlinux"

echo "[4/6] Bridge fcbr0 + masquerade on ${EXT_IFACE}…"
if ! ip link show fcbr0 >/dev/null 2>&1; then
  ip link add name fcbr0 type bridge
  ip addr add 172.16.0.1/16 dev fcbr0
  ip link set fcbr0 up
fi
echo 1 > /proc/sys/net/ipv4/ip_forward
sysctl -w net.ipv4.ip_forward=1
# Persist
grep -q '^net.ipv4.ip_forward=1' /etc/sysctl.conf || echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf

iptables -t nat -C POSTROUTING -o "${EXT_IFACE}" -s 172.16.0.0/16 -j MASQUERADE 2>/dev/null \
  || iptables -t nat -A POSTROUTING -o "${EXT_IFACE}" -s 172.16.0.0/16 -j MASQUERADE
iptables -C FORWARD -i fcbr0 -o "${EXT_IFACE}" -j ACCEPT 2>/dev/null \
  || iptables -A FORWARD -i fcbr0 -o "${EXT_IFACE}" -j ACCEPT
iptables -C FORWARD -o fcbr0 -i "${EXT_IFACE}" -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null \
  || iptables -A FORWARD -o fcbr0 -i "${EXT_IFACE}" -m state --state RELATED,ESTABLISHED -j ACCEPT
# Block VM → host private services. Adjust as needed.
iptables -C FORWARD -i fcbr0 -d 169.254.169.254 -j DROP 2>/dev/null \
  || iptables -I FORWARD -i fcbr0 -d 169.254.169.254 -j DROP

# Per-VM network isolation (P0.3). Every project VM shares the fcbr0 bridge, so
# without this a compromised VM could reach a peer VM's 172.16.x.y directly at
# L2 (the bridge forwards those frames without ever consulting iptables). Two
# steps fix it: (a) make bridged IP traffic traverse the iptables FORWARD chain
# (br_netfilter + bridge-nf-call-iptables), then (b) DROP any VM→VM hop
# (fcbr0→fcbr0). VM→gateway (the host, delivered locally — not FORWARD) and
# VM→internet (fcbr0→${EXT_IFACE}) are unaffected, so egress + the metadata
# block above keep working; only peer-to-peer traffic is severed.
modprobe br_netfilter 2>/dev/null || true
grep -qx 'br_netfilter' /etc/modules 2>/dev/null || echo 'br_netfilter' >> /etc/modules
sysctl -w net.bridge.bridge-nf-call-iptables=1 2>/dev/null || true
grep -q '^net.bridge.bridge-nf-call-iptables=1' /etc/sysctl.conf \
  || echo 'net.bridge.bridge-nf-call-iptables=1' >> /etc/sysctl.conf
iptables -C FORWARD -i fcbr0 -o fcbr0 -j DROP 2>/dev/null \
  || iptables -I FORWARD -i fcbr0 -o fcbr0 -j DROP

netfilter-persistent save || iptables-save > /etc/iptables/rules.v4

echo "[5/6] /dev/kvm group access…"
if ! getent group kvm >/dev/null; then groupadd kvm; fi
chown root:kvm /dev/kvm
chmod 0660 /dev/kvm
# Add the orchestrator's runtime user. Default 'uniqus' — change to the real
# system user if you run the orchestrator under a different name.
if id uniqus >/dev/null 2>&1; then
  usermod -aG kvm uniqus
  echo "Added 'uniqus' to kvm group. Re-login (or `newgrp kvm`) for it to take effect."
fi

echo "[6/6] Done. Next: build the rootfs with infra/firecracker/build-rootfs.sh"
echo "State dir: ${STATE_DIR}"
echo "Kernel:    ${STATE_DIR}/vmlinux"
