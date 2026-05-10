# Phase 2 — Setup Guide

End-to-end setup for the full Phase 2 stack. Do every step in order — none of
them are optional.

> Phase 1 setup (Anthropic, Supabase, WorkOS, Vercel/GitHub OAuth) is in
> [`README.md`](README.md). Run that first.

What you're standing up:

- A **Hetzner AX bare-metal box** that runs the orchestrator + Firecracker
  fleet (the user-project sandboxes).
- **Fly.io** as the deploy target for non-Vercel projects (Python/Go/long-running).
- Local dev still works on your laptop — the Firecracker step swaps the
  process sandbox for microVMs only when `UNIQUS_SANDBOX=firecracker` is set.

---

## 1. Provision a Hetzner AX server

1. Sign up at <https://hetzner.com>.
2. Order an **AX41** (or larger AX/EX line). ~€39/mo. Avoid the CX cloud line
   — no nested KVM.
3. Pick **Ubuntu 22.04** as the OS image during ordering.
4. After provisioning, SSH in as root:

   ```sh
   ssh root@<your-server-ip>
   ```
5. Verify KVM is on:

   ```sh
   ls /dev/kvm                          # must exist
   egrep -c '(vmx|svm)' /proc/cpuinfo   # must be > 0
   ```

   If `/dev/kvm` is missing, open a free Hetzner Robot console ticket and ask
   for KVM to be enabled. Usually 5–10 min.

## 2. Clone the repo on the Hetzner box

```sh
apt-get update -y && apt-get install -y git
git clone <your-repo-url> /opt/uniqus-code
cd /opt/uniqus-code
```

## 3. Install Node.js 20 and npm

```sh
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
node --version   # should print v20.x
```

## 4. Install dependencies

```sh
cd /opt/uniqus-code
npm install
npx playwright install --with-deps chromium
```

`playwright`, `pg`, and everything else in
[`services/orchestrator/package.json`](services/orchestrator/package.json) are
required deps now — `npm install` pulls them all. The `playwright install`
line downloads Chromium and its system libraries (needed for the
`screenshot_preview` tool).

## 5. Bring up the Firecracker host

Two scripts. Both must run as root.

```sh
# Find your public NIC. On most Hetzner AX boxes this is "eth0";
# on AX102/AX52 it can be "enp35s0" or similar. Run:
ip route get 1.1.1.1
# → look for "dev <name>" in the output. Use that as EXT_IFACE.

EXT_IFACE=eth0 ./infra/firecracker/host-setup.sh
REPO_ROOT=/opt/uniqus-code ./infra/firecracker/build-rootfs.sh
```

`host-setup.sh` does all of this:
- installs `firecracker` v1.10 + `jailer`;
- creates the bridge `fcbr0` at `172.16.0.1/16`;
- adds `iptables MASQUERADE` so VM egress goes out the host NIC;
- adds the `uniqus` system user to the `kvm` group;
- drops the kernel image at `/var/lib/uniqus/firecracker/vmlinux`.

`build-rootfs.sh` produces the Alpine + Node + Python + Go base rootfs at
`/var/lib/uniqus/firecracker/rootfs.ext4` with the in-VM agent baked in.

When either fails, the error message tells you exactly what's missing
(`apt-get install ...`, KVM disabled, etc.) — fix that and rerun.

## 6. Run the database migrations

Open Supabase Studio → your project → SQL editor → paste
[`services/orchestrator/src/db/schema.sql`](services/orchestrator/src/db/schema.sql)
→ **Run**. Idempotent.

## 7. Sign up for Fly.io and generate a token

1. Sign up at <https://fly.io>.
2. Install `flyctl` on the Hetzner box:

   ```sh
   curl -L https://fly.io/install.sh | sh
   echo 'export PATH="$HOME/.fly/bin:$PATH"' >> /root/.bashrc
   export PATH="$HOME/.fly/bin:$PATH"
   flyctl version
   ```
3. Generate an org-scoped Personal Access Token:
   <https://fly.io/user/personal_access_tokens>. Copy it — you'll paste
   it into a project's secrets in step 10.

(You don't pre-create Fly apps. The orchestrator's deploy endpoint
auto-creates them on first deploy.)

## 8. Set environment variables

On the Hetzner box, create `/opt/uniqus-code/.env.local`:

```env
# Phase-1 vars (already documented in README.md) — paste your values:
ANTHROPIC_API_KEY=sk-ant-...
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
WORKOS_CLIENT_ID=client_...
WORKOS_API_KEY=sk_...
WORKOS_COOKIE_PASSWORD=<32+ random chars>
NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:4242/callback
NEXT_PUBLIC_ORCHESTRATOR_URL=http://localhost:8787
WEB_ORIGIN=http://localhost:4242

# Phase-2 vars:
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
OAUTH_TOKEN_ENCRYPTION_KEY=<64-hex chars>

# Turn on the Firecracker fleet.
UNIQUS_SANDBOX=firecracker
FIRECRACKER_STATE_DIR=/var/lib/uniqus/firecracker
FIRECRACKER_KERNEL=/var/lib/uniqus/firecracker/vmlinux
FIRECRACKER_ROOTFS=/var/lib/uniqus/firecracker/rootfs.ext4
FIRECRACKER_VCPUS=2
FIRECRACKER_MEM_MIB=1024
FIRECRACKER_IDLE_PAUSE_MS=300000

# Optional model overrides. Defaults are fine; only set these if you
# want to swap a Claude model for another one.
# UNIQUS_MODEL_AGENT=claude-opus-4-7
# UNIQUS_MODEL_PLAN=claude-opus-4-7
# UNIQUS_MODEL_COMPACT=claude-haiku-4-5-20251001
```

For local development on a laptop (no Firecracker), drop the
`UNIQUS_SANDBOX=firecracker` line — the orchestrator falls back to the
process sandbox.

## 9. Start the stack

```sh
cd /opt/uniqus-code
npm run dev
```

In the orchestrator startup log you should see:

```
[firecracker] enabled — VMs boot lazily on first user_message
orchestrator: ws://localhost:8787 ...
```

The web app comes up on `http://localhost:4242`. (For public access from
your browser to the Hetzner box: open ports 4242 and 8787 in the Hetzner
firewall, or — better — front them with caddy/nginx + TLS.)

## 10. Configure a project for Fly deploys

Once the orchestrator is up, sign in and open or create a project. From the
**Secrets** button in the topbar, add:

| Name | Value |
|---|---|
| `FLY_API_TOKEN` | Your Fly Personal Access Token from step 7. |
| `DATABASE_URL` | (Optional) A Postgres connection string — needed only if a project uses the Postgres connector. |
| Any other secrets your project needs at runtime. | Encrypted at rest; the agent reaches them via `get_secret` only. |

To deploy a project to Fly, the agent (or you) calls:

```sh
curl -X POST http://localhost:8787/api/projects/<projectId>/fly-deploy \
  -H "Cookie: <your auth cookie>" \
  -H "Content-Type: application/json" \
  -d '{"app_name":"my-app"}'
```

The orchestrator will:
1. Generate a `Dockerfile` + `fly.toml` + `.dockerignore` if missing.
2. Auto-create `my-app.fly.dev` if it doesn't already exist on your account.
3. Run `flyctl deploy --remote-only`, streaming the build log to the
   project's WS as `text` events.

## 11. End-to-end smoke test

In the workspace, run through this checklist. Each row exercises one of the
new Phase-2 systems.

| What to do | Expected result |
|---|---|
| Click **Skills** in the topbar. Apply a design pack. Save. | A `.uniqus/skills.md` file appears in the file tree. |
| Click **Secrets**. Add `DEMO_VAR` with throwaway value. | Row appears; value is never echoed back. |
| Type `/review` in chat. Press Enter. | Composer expands to `/review`; sending it runs the review prompt. |
| Tell the agent: *"Use get_secret to plumb DEMO_VAR into a .env file."* | A `.env` appears in the sandbox; chat does NOT show plaintext. |
| Click **Rewind**. | Each agent file edit / run_command shows up as a checkpoint. |
| Tell the agent: *"Plan a multi-step refactor and use todo_write."* | The Tasks pane auto-pops and updates as work progresses. |
| Tell the agent: *"Run uname -a and cat /etc/os-release."* | Output mentions **Alpine Linux** (the rootfs), NOT the Hetzner host's kernel — proves the VM substrate is in play. The orchestrator log shows `[fleet] booted Firecracker VM vm_<id>`. |
| Tell the agent: *"Create a tiny Express server on port 3000 and start it."* | The preview iframe in the workspace renders the page. The orchestrator routes through the VM's `172.16.x.y:3000` automatically. |
| Tell the agent: *"Take a screenshot of the preview."* | Returns an `assets/screenshots/<id>.png` path; file appears in the tree. |
| Run the Fly deploy curl from step 10. | The build log streams into the project's chat as `text` events; ends with `https://my-app.fly.dev`. |

If any row fails:

- **Firecracker boot timeouts:** look at
  [`infra/firecracker/README.md`](infra/firecracker/README.md) → Troubleshooting.
- **Preview not rendering inside an iframe:** check that `iptables -L -n |
  grep 172.16` shows the FORWARD rules from `host-setup.sh` are present.
- **Fly errors on app create:** regenerate `FLY_API_TOKEN` with org-level
  scope (the default token from the UI dropdown is org-scoped; the older
  app-scoped tokens can't create new apps).

## 12. Reset / teardown

- **Reset chat:** "clear" in the chat pane.
- **Delete project:** topbar dropdown → also tears down its Firecracker VM and
  Storage objects.
- **Wipe a Firecracker VM manually:** `rm -f /var/lib/uniqus/firecracker/<projectId>.*`.
- **Rebuild the rootfs after editing `services/sandbox-agent/`:** rerun
  `./infra/firecracker/build-rootfs.sh` (idempotent).
- **Tear down a Fly app:** `flyctl apps destroy <name>`.

---

## What this gives you, end to end

- Every project's code runs in its own Firecracker microVM with a TAP
  device, NAT'd egress, vsock control channel, and ~125 ms cold boot.
- Per-VM static IP keyed off projectId — preview proxy in the workspace
  reaches `<vm-ip>:port` automatically; iframes work.
- Idle VMs auto-pause after 5 min and resume sub-millisecond on the next
  message.
- Every secret read and connector call is audit-logged.
- Every agent edit / shell command is a checkpoint you can roll back.
- Every project can deploy to Vercel (JS/static, existing) or Fly
  (Python/Go/long-running, new) with one POST.
- The agent can Slack you, query Postgres, hit GitHub, or send arbitrary
  HTTP — credentials never enter chat context.
