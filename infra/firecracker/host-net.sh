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
CANONICAL_CIDR="${FIRECRACKER_CIDR:-172.16.0.0/16}"

die() { echo "host-net: $*" >&2; exit 1; }
ip_to_int() {
  local a b c d extra
  IFS=. read -r a b c d extra <<<"$1"
  [[ -z "${extra:-}" && "$a" =~ ^[0-9]+$ && "$b" =~ ^[0-9]+$ && "$c" =~ ^[0-9]+$ && "$d" =~ ^[0-9]+$ ]] \
    || die "invalid IPv4 address: $1"
  (( a <= 255 && b <= 255 && c <= 255 && d <= 255 )) || die "invalid IPv4 address: $1"
  echo $(( (a << 24) | (b << 16) | (c << 8) | d ))
}
int_to_ip() {
  local n=$1
  echo "$(( (n >> 24) & 255 )).$(( (n >> 16) & 255 )).$(( (n >> 8) & 255 )).$(( n & 255 ))"
}

CIDR_IP="${CANONICAL_CIDR%/*}"
PREFIX="${CANONICAL_CIDR#*/}"
[[ "${CANONICAL_CIDR}" == */* && "${PREFIX}" =~ ^[0-9]+$ ]] \
  || die "invalid FIRECRACKER_CIDR: ${CANONICAL_CIDR}"
(( PREFIX >= 8 && PREFIX <= 29 )) || die "FIRECRACKER_CIDR prefix must be between /8 and /29"
IP_INT="$(ip_to_int "${CIDR_IP}")"
MASK_INT=$(( (0xFFFFFFFF << (32 - PREFIX)) & 0xFFFFFFFF ))
NETWORK_INT=$(( IP_INT & MASK_INT ))
(( IP_INT == NETWORK_INT )) \
  || die "FIRECRACKER_CIDR must use its network address: $(int_to_ip "${NETWORK_INT}")/${PREFIX}"
BROADCAST_INT=$(( NETWORK_INT | (0xFFFFFFFF ^ MASK_INT) ))
PRIVATE_OK=0
for private_range in "10.0.0.0 10.255.255.255" "172.16.0.0 172.31.255.255" "192.168.0.0 192.168.255.255"; do
  read -r private_start private_end <<<"${private_range}"
  if (( NETWORK_INT >= $(ip_to_int "${private_start}") && BROADCAST_INT <= $(ip_to_int "${private_end}") )); then
    PRIVATE_OK=1
    break
  fi
done
(( PRIVATE_OK == 1 )) || die "FIRECRACKER_CIDR must be wholly contained in an RFC1918 private range"
NETWORK_IP="$(int_to_ip "${NETWORK_INT}")"
GATEWAY_IP="$(int_to_ip "$(( NETWORK_INT + 1 ))")"
BOOTSTRAP_IP="$(int_to_ip "$(( BROADCAST_INT - 1 ))")"
NETMASK="$(int_to_ip "${MASK_INT}")"
SUBNET="${NETWORK_IP}/${PREFIX}"
BRIDGE_CIDR="${GATEWAY_IP}/${PREFIX}"

# FIRECRACKER_CIDR is the single source of truth. Keep old knobs compatible
# only when they say exactly the same thing; partial overrides are unsafe.
[[ -z "${FIRECRACKER_SUBNET:-}" || "${FIRECRACKER_SUBNET}" == "${SUBNET}" ]] \
  || die "FIRECRACKER_SUBNET conflicts with FIRECRACKER_CIDR (expected ${SUBNET})"
[[ -z "${FIRECRACKER_BRIDGE_CIDR:-}" || "${FIRECRACKER_BRIDGE_CIDR}" == "${BRIDGE_CIDR}" ]] \
  || die "FIRECRACKER_BRIDGE_CIDR conflicts with FIRECRACKER_CIDR (expected ${BRIDGE_CIDR})"
[[ -z "${FIRECRACKER_GATEWAY:-}" || "${FIRECRACKER_GATEWAY}" == "${GATEWAY_IP}" ]] \
  || die "FIRECRACKER_GATEWAY conflicts with FIRECRACKER_CIDR (expected ${GATEWAY_IP})"
[[ -z "${FIRECRACKER_NETMASK:-}" || "${FIRECRACKER_NETMASK}" == "${NETMASK}" ]] \
  || die "FIRECRACKER_NETMASK conflicts with FIRECRACKER_CIDR (expected ${NETMASK})"
[[ -z "${FIRECRACKER_BOOTSTRAP_IP:-}" || "${FIRECRACKER_BOOTSTRAP_IP}" == "${BOOTSTRAP_IP}" ]] \
  || die "FIRECRACKER_BOOTSTRAP_IP conflicts with FIRECRACKER_CIDR (expected ${BOOTSTRAP_IP})"

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
modprobe br_netfilter
# Security boundary: fail provisioning if bridged frames cannot be filtered.
sysctl -qw net.bridge.bridge-nf-call-iptables=1
sysctl -qw net.bridge.bridge-nf-call-ip6tables=1

# 3. iptables: MASQUERADE egress via the host NIC, allow forward both ways,
#    block the cloud metadata endpoint, and sever VM↔VM traffic on the shared
#    bridge (P0.3). All guarded so a re-run (or netfilter-persistent having
#    already restored them) is a no-op.
VM_INPUT_CHAIN="UNIQUS_VM_INPUT"
VM_FORWARD_CHAIN="UNIQUS_VM_FORWARD"
VM6_INPUT_CHAIN="UNIQUS_VM6_INPUT"
VM6_FORWARD_CHAIN="UNIQUS_VM6_FORWARD"

# Tenant-to-host: permit only replies to connections initiated by the host
# (notably sandbox-agent RPC), then deny every guest-initiated host connection.
iptables -N "${VM_INPUT_CHAIN}" 2>/dev/null || true
iptables -F "${VM_INPUT_CHAIN}"
iptables -A "${VM_INPUT_CHAIN}" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
iptables -A "${VM_INPUT_CHAIN}" -j DROP
while iptables -D INPUT -i "${BRIDGE}" -j "${VM_INPUT_CHAIN}" 2>/dev/null; do :; done
iptables -I INPUT 1 -i "${BRIDGE}" -j "${VM_INPUT_CHAIN}"

# Tenant egress: private/special networks and every interface except the public
# NIC are denied. This chain runs before any older broad FORWARD accept rule.
iptables -N "${VM_FORWARD_CHAIN}" 2>/dev/null || true
iptables -F "${VM_FORWARD_CHAIN}"
for blocked in \
  0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 \
  169.254.0.0/16 172.16.0.0/12 192.168.0.0/16 \
  224.0.0.0/4 240.0.0.0/4; do
  iptables -A "${VM_FORWARD_CHAIN}" -d "${blocked}" -j DROP
done
iptables -A "${VM_FORWARD_CHAIN}" -o "${EXT_IFACE}" -j ACCEPT
iptables -A "${VM_FORWARD_CHAIN}" -j DROP
while iptables -D FORWARD -i "${BRIDGE}" -j "${VM_FORWARD_CHAIN}" 2>/dev/null; do :; done
iptables -I FORWARD 1 -i "${BRIDGE}" -j "${VM_FORWARD_CHAIN}"

# No IPv6 egress is provisioned for tenant VMs. Deny it explicitly so link-local
# or host routes cannot bypass the IPv4 policy.
ip6tables -N "${VM6_INPUT_CHAIN}" 2>/dev/null || true
ip6tables -F "${VM6_INPUT_CHAIN}"
ip6tables -A "${VM6_INPUT_CHAIN}" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
ip6tables -A "${VM6_INPUT_CHAIN}" -j DROP
while ip6tables -D INPUT -i "${BRIDGE}" -j "${VM6_INPUT_CHAIN}" 2>/dev/null; do :; done
ip6tables -I INPUT 1 -i "${BRIDGE}" -j "${VM6_INPUT_CHAIN}"

ip6tables -N "${VM6_FORWARD_CHAIN}" 2>/dev/null || true
ip6tables -F "${VM6_FORWARD_CHAIN}"
ip6tables -A "${VM6_FORWARD_CHAIN}" -j DROP
while ip6tables -D FORWARD -i "${BRIDGE}" -j "${VM6_FORWARD_CHAIN}" 2>/dev/null; do :; done
ip6tables -I FORWARD 1 -i "${BRIDGE}" -j "${VM6_FORWARD_CHAIN}"

iptables -t nat -C POSTROUTING -o "${EXT_IFACE}" -s "${SUBNET}" -j MASQUERADE 2>/dev/null \
  || iptables -t nat -A POSTROUTING -o "${EXT_IFACE}" -s "${SUBNET}" -j MASQUERADE
iptables -C FORWARD -o "${BRIDGE}" -i "${EXT_IFACE}" -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null \
  || iptables -A FORWARD -o "${BRIDGE}" -i "${EXT_IFACE}" -m state --state RELATED,ESTABLISHED -j ACCEPT

echo "host-net: ${BRIDGE} up (${BRIDGE_CIDR}), public IPv4 egress via ${EXT_IFACE}; host/private/IPv6 denied"
