#!/usr/bin/env bash
# Idempotent Firecracker host networking.
#
# This establishes the RUNTIME network state the orchestrator needs before it
# can boot a microVM: the `fcbr0` bridge + its gateway IP, IP forwarding, bridge
# netfilter, and the masquerade / forward / isolation iptables rules.
#
# Why this exists as its own script (split out of host-setup.sh):
#   The bridge device is created with `ip link add` and is NOT persistent across
#   reboots. iptables (netfilter-persistent) and sysctls (/etc/sysctl.conf) DO
#   survive a reboot, but the bridge does not — so after every reboot the
#   orchestrator throws "Firecracker bridge 'fcbr0' is missing" and no project
#   can start a sandbox. This script recreates it.
#
# It runs in two places:
#   - host-setup.sh, on first provision.
#   - the uniqus-firecracker-net.service systemd unit, on EVERY boot, ordered
#     before uniqus-orchestrator.service — so a reboot self-heals.
#
# Idempotent: safe to run repeatedly. Every rule is guarded with `iptables -C`.
set -euo pipefail

# Public NIC. Auto-detected from the default route (eth0 on some images,
# enp8s0 / enp0s31f6 on others) so we don't hardcode the wrong one — override
# with EXT_IFACE=... if the box has an unusual routing setup.
EXT_IFACE="${EXT_IFACE:-$(ip -o -4 route show default | awk '{print $5; exit}')}"
BRIDGE="${FIRECRACKER_BRIDGE:-fcbr0}"
BRIDGE_CIDR="${FIRECRACKER_BRIDGE_CIDR:-172.16.0.1/16}"
SUBNET="${FIRECRACKER_SUBNET:-172.16.0.0/16}"

if [[ "$(id -u)" != "0" ]]; then
  echo "host-net: must run as root" >&2
  exit 1
fi
if [[ -z "${EXT_IFACE}" ]]; then
  echo "host-net: could not determine external interface — set EXT_IFACE=..." >&2
  exit 1
fi

# 1. Bridge + gateway IP (the part that does not survive a reboot).
if ! ip link show "${BRIDGE}" >/dev/null 2>&1; then
  ip link add name "${BRIDGE}" type bridge
fi
# (Re-)assert the gateway IP and bring the link up. An empty bridge stays
# operationally DOWN / NO-CARRIER until a VM's TAP is attached — that's normal.
ip addr show dev "${BRIDGE}" | grep -qw "${BRIDGE_CIDR%/*}" \
  || ip addr add "${BRIDGE_CIDR}" dev "${BRIDGE}"
ip link set "${BRIDGE}" up

# 2. IP forwarding + bridge netfilter (so bridged frames hit the FORWARD chain,
#    which is what makes the per-VM isolation DROP below actually apply).
sysctl -qw net.ipv4.ip_forward=1
modprobe br_netfilter 2>/dev/null || true
sysctl -qw net.bridge.bridge-nf-call-iptables=1 2>/dev/null || true

# 3. iptables: MASQUERADE egress via the host NIC, allow forward both ways,
#    block the cloud metadata endpoint, and sever VM↔VM traffic on the shared
#    bridge (P0.3). All guarded so a re-run (or netfilter-persistent having
#    already restored them) is a no-op.
iptables -t nat -C POSTROUTING -o "${EXT_IFACE}" -s "${SUBNET}" -j MASQUERADE 2>/dev/null \
  || iptables -t nat -A POSTROUTING -o "${EXT_IFACE}" -s "${SUBNET}" -j MASQUERADE
iptables -C FORWARD -i "${BRIDGE}" -o "${EXT_IFACE}" -j ACCEPT 2>/dev/null \
  || iptables -A FORWARD -i "${BRIDGE}" -o "${EXT_IFACE}" -j ACCEPT
iptables -C FORWARD -o "${BRIDGE}" -i "${EXT_IFACE}" -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null \
  || iptables -A FORWARD -o "${BRIDGE}" -i "${EXT_IFACE}" -m state --state RELATED,ESTABLISHED -j ACCEPT
iptables -C FORWARD -i "${BRIDGE}" -d 169.254.169.254 -j DROP 2>/dev/null \
  || iptables -I FORWARD -i "${BRIDGE}" -d 169.254.169.254 -j DROP
iptables -C FORWARD -i "${BRIDGE}" -o "${BRIDGE}" -j DROP 2>/dev/null \
  || iptables -I FORWARD -i "${BRIDGE}" -o "${BRIDGE}" -j DROP

echo "host-net: ${BRIDGE} up (${BRIDGE_CIDR}), egress via ${EXT_IFACE}"
