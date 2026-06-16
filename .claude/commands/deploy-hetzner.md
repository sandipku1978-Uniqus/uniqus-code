---
description: SSH to Hetzner, git pull, npm ci if deps changed, rebuild rootfs / re-run host-setup if needed, restart orchestrator
---

Deploy the latest committed code to the Hetzner production box.

**Box:** `root@65.109.89.35`
**Repo path:** `/opt/uniqus-code`
**Service:** `uniqus-orchestrator` (systemd)

Run **one** SSH command that does the full deploy in a single connection. Use this exact command (it `set -e`s, so any failed step aborts the rest):

```bash
ssh root@65.109.89.35 
set -e
cd /opt/uniqus-code
# A prior npm install on the box can rewrite package-lock.json, which blocks a
# fast-forward pull ("local changes would be overwritten"). Discard that
# regenerated lockfile first — the committed one is authoritative and npm ci
# below reinstalls exactly from it when deps changed.
git checkout -- package-lock.json 2>/dev/null || true
BEFORE=$(git rev-parse HEAD)
git pull --ff-only
AFTER=$(git rev-parse HEAD)

if [ "$BEFORE" = "$AFTER" ]; then
  echo "=== nothing to pull, restarting service anyway ==="
else
  echo "=== changed files ==="
  git diff --name-only "$BEFORE..$AFTER"
fi

# Reinstall deps only when a package.json / package-lock.json actually changed
# in the pulled diff. npm ci is reproducible and never rewrites the lockfile.
if [ "$BEFORE" != "$AFTER" ] && git diff --name-only "$BEFORE..$AFTER" | grep -qE "(^|/)package(-lock)?\.json$"; then
  echo "=== dependencies changed — npm ci ==="
  npm ci
fi

if [ "$BEFORE" != "$AFTER" ] && git diff --name-only "$BEFORE..$AFTER" | grep -qE "^(services/sandbox-agent/|infra/firecracker/build-rootfs\.sh)"; then
  echo "=== rebuilding rootfs (sandbox-agent or build-rootfs.sh changed) ==="
  REPO_ROOT=/opt/uniqus-code bash ./infra/firecracker/build-rootfs.sh
fi

# Re-run host-setup.sh when it changed (e.g. new firewall / per-VM isolation
# rules). It's idempotent and persists the rules (sysctl.conf + iptables save)
# so they survive a host reboot. EXT_IFACE is auto-detected so MASQUERADE +
# isolation target the real public NIC. Non-fatal: fleet.ts ensureVmIsolation
# re-asserts the runtime rules on the next VM boot anyway, so a host-setup
# failure must NOT block the orchestrator restart below — it's logged instead.
# It runs apt-get update/installs, so it adds a couple of minutes — call it out.
if [ "$BEFORE" != "$AFTER" ] && git diff --name-only "$BEFORE..$AFTER" | grep -qE "^infra/firecracker/host-setup\.sh$"; then
  echo "=== host-setup.sh changed — re-running (idempotent; persists firewall/isolation rules) ==="
  EXT_IFACE="$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'dev \K\S+' || echo eth0)" \
    bash ./infra/firecracker/host-setup.sh \
    || echo "WARN: host-setup.sh failed — isolation still applied at runtime by fleet.ts ensureVmIsolation; re-run it manually for reboot persistence"
fi

echo "=== restarting orchestrator ==="
systemctl restart uniqus-orchestrator
sleep 2
systemctl status uniqus-orchestrator --no-pager | head -20
echo "=== last 20 log lines ==="
journalctl -u uniqus-orchestrator -n 20 --no-pager
```
 
(Alternate after ssh-ing into the hetzner box.)

``` sh
cd /opt/uniqus-code && git checkout -- package-lock.json && git pull --ff-only && systemctl restart uniqus-orchestrator
sleep 2; echo "service: $(systemctl is-active uniqus-orchestrator)"; journalctl -u uniqus-orchestrator -n 20 --no-pager
```

(Re-run host-setup.sh by itself — e.g. to (re)apply firewall / per-VM isolation
rules and persist them across a host reboot. Idempotent; auto-detects the public
NIC. The deploy command above already does this automatically when the script
changed; this is for an out-of-band re-run.)

``` sh
cd /opt/uniqus-code && git pull --ff-only
EXT_IFACE="$(ip route get 1.1.1.1 | grep -oP 'dev \K\S+')" bash infra/firecracker/host-setup.sh
# verify the per-VM isolation rule is present:
iptables -C FORWARD -i fcbr0 -o fcbr0 -j DROP && echo "VM↔VM isolation: ON"
```

Then summarize back to the user:

- Were there commits to pull? (list them if so)
- Were dependencies reinstalled? (the `npm ci` block runs only when a
  package.json/lock changed — call it out, it adds time)
- Was the rootfs rebuilt? (it takes several minutes — call it out)
- Was `host-setup.sh` re-run? (only when it changed; it runs apt + persists
  firewall/isolation rules — call it out, and flag the `WARN:` line if it failed)
- Is the service `active (running)`?
- Anything in the log lines that looks like an error or stack trace?

If the SSH command exits non-zero, report which step failed (the `===` markers tell you) and stop — do **not** retry automatically.
