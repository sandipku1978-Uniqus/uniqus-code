---
name: deploy-hetzner
description: Deploy the latest committed Gate 15 orchestrator/sandbox code to Hetzner. Use when the user asks for the Codex equivalent of /deploy-hetzner, to SSH to production, pull, rebuild only what changed, and restart uniqus-orchestrator.
---

# Deploy Hetzner

This is the Codex-native equivalent of `.claude/commands/deploy-hetzner.md`.

Before acting, read `.claude/commands/deploy-hetzner.md` completely and follow that production deploy procedure exactly. Preserve these operational constraints:

1. Deploy only committed code.
2. Use one SSH connection to `root@65.109.89.35` and run the documented deploy script.
3. Let `set -e` abort on failures.
4. Reinstall dependencies only when package manifests changed.
5. Rebuild the Firecracker rootfs only when the sandbox agent or rootfs build script changed.
6. Re-run `host-setup.sh` only when it changed.
7. Restart `uniqus-orchestrator`, check service status, and inspect the last log lines.

If the SSH command exits non-zero, report which marked step failed and stop. Do not retry automatically.
