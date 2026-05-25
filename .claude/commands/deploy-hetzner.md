---
description: SSH to Hetzner, git pull, rebuild rootfs if needed, restart orchestrator
---

Deploy the latest committed code to the Hetzner production box.

**Box:** `root@65.109.89.35`
**Repo path:** `/opt/uniqus-code`
**Service:** `uniqus-orchestrator` (systemd)

Run **one** SSH command that does the full deploy in a single connection. Use this exact command (it `set -e`s, so any failed step aborts the rest):

```bash
ssh root@65.109.89.35 'set -e
cd /opt/uniqus-code
BEFORE=$(git rev-parse HEAD)
git pull --ff-only
AFTER=$(git rev-parse HEAD)

if [ "$BEFORE" = "$AFTER" ]; then
  echo "=== nothing to pull, restarting service anyway ==="
else
  echo "=== changed files ==="
  git diff --name-only "$BEFORE..$AFTER"
fi

if [ "$BEFORE" != "$AFTER" ] && git diff --name-only "$BEFORE..$AFTER" | grep -qE "^(services/sandbox-agent/|infra/firecracker/build-rootfs\.sh)"; then
  echo "=== rebuilding rootfs (sandbox-agent or build-rootfs.sh changed) ==="
  REPO_ROOT=/opt/uniqus-code bash ./infra/firecracker/build-rootfs.sh
fi

echo "=== restarting orchestrator ==="
systemctl restart uniqus-orchestrator
sleep 2
systemctl status uniqus-orchestrator --no-pager | head -20
echo "=== last 20 log lines ==="
journalctl -u uniqus-orchestrator -n 20 --no-pager'
```

Then summarize back to the user:

- Were there commits to pull? (list them if so)
- Was the rootfs rebuilt? (it takes several minutes — call it out)
- Is the service `active (running)`?
- Anything in the log lines that looks like an error or stack trace?

If the SSH command exits non-zero, report which step failed (the `===` markers tell you) and stop — do **not** retry automatically.
