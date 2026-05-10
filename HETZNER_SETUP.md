# Hetzner box — bring-up

End-to-end checklist for standing up the orchestrator + Firecracker fleet on
a Hetzner AX dedicated server. Assumes:

- You've already ordered an **AX41** (or larger) with **Ubuntu 22.04 LTS base**.
- DNS is at a registrar where you can add an A record for `api.<your-domain>`.
- The web app is hosted separately on Vercel — see [`SETUP_PHASE2.md`](SETUP_PHASE2.md)
  steps 7+ for that side.

Everything below runs as **root** on the Hetzner box.

---

## 0. Verify the box

```sh
ssh root@<hetzner-ip>

# Must exist:
ls /dev/kvm

# Must be > 0:
egrep -c '(vmx|svm)' /proc/cpuinfo
```

If `/dev/kvm` is missing, open a Hetzner Robot console ticket asking for KVM.
Free, ~5 min.

## 1. Clone the repo

```sh
apt-get update -y && apt-get install -y git
git clone https://github.com/sandipku1978-Uniqus/uniqus-code /opt/uniqus-code
cd /opt/uniqus-code
```

## 2. Install Node 20

```sh
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
node --version   # v20.x
```

## 3. Install npm deps + Chromium

```sh
cd /opt/uniqus-code
npm install
npx playwright install --with-deps chromium
```

## 4. Find your public NIC

```sh
ip route get 1.1.1.1
# Look for "dev <name>". On AX41 it's usually `enp8s0` or `eth0`.
```

Note that name. Below it's referred to as `EXT_IFACE`.

## 5. Bring up the Firecracker host

```sh
EXT_IFACE=enp8s0 bash ./infra/firecracker/host-setup.sh
REPO_ROOT=/opt/uniqus-code bash ./infra/firecracker/build-rootfs.sh
```

Replace `enp8s0` with whatever step 4 showed.

`host-setup.sh` installs Firecracker + creates the bridge `fcbr0` + adds NAT.
`build-rootfs.sh` produces the Alpine rootfs with the in-VM agent baked in.
Both are idempotent — re-run if interrupted.

Verify both finished:

```sh
ls -lh /var/lib/uniqus/firecracker/{vmlinux,rootfs.ext4}
firecracker --version
ip link show fcbr0   # should print bridge details
```

## 6. Run the database migrations

In Supabase Studio (your project) → SQL Editor:

1. Paste [`services/orchestrator/src/db/schema.sql`](services/orchestrator/src/db/schema.sql).
2. Run.

Idempotent — safe to re-run.

## 7. Create `.env.local`

From your laptop, create the env file locally and `scp` it up — much safer
than typing 64-hex encryption keys into an SSH terminal:

```env
# /opt/uniqus-code/.env.local on the Hetzner box

ANTHROPIC_API_KEY=sk-ant-...
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Must be IDENTICAL to the same var on Vercel — both seal/unseal the cookie.
WORKOS_COOKIE_PASSWORD=<32+ char base64 string>

# Encrypts project_secrets at rest. Generate with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
OAUTH_TOKEN_ENCRYPTION_KEY=<64-hex chars>

# Where the user's browser loads the web app from. Used as CORS allowlist.
WEB_ORIGIN=https://app.<your-domain>

# So the agent quotes the right preview URL back to the user.
PREVIEW_BASE_URL=https://api.<your-domain>

# Firecracker fleet.
UNIQUS_SANDBOX=firecracker
FIRECRACKER_STATE_DIR=/var/lib/uniqus/firecracker
FIRECRACKER_KERNEL=/var/lib/uniqus/firecracker/vmlinux
FIRECRACKER_ROOTFS=/var/lib/uniqus/firecracker/rootfs.ext4
FIRECRACKER_VCPUS=2
FIRECRACKER_MEM_MIB=1024
FIRECRACKER_IDLE_PAUSE_MS=300000
```

Upload:

```powershell
# In Windows PowerShell, in the repo root:
scp .env.local root@<hetzner-ip>:/opt/uniqus-code/.env.local
```

> The `NEXT_PUBLIC_*` and `WORKOS_CLIENT_ID` / `WORKOS_API_KEY` vars belong on
> Vercel, not here. The orchestrator only unseals existing WorkOS cookies; it
> doesn't initiate auth.

## 8. DNS

In your registrar, add:

| Name | Type | Value | TTL |
|---|---|---|---|
| `api` | A | `<your-hetzner-ip>` | 300 |

Verify before continuing — Caddy's TLS issuance needs DNS:

```sh
dig +short api.<your-domain>
# Must return your Hetzner IP. Wait + retry if not.
```

## 9. Caddy (TLS for `api.<your-domain>`)

```sh
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update -y && apt-get install -y caddy

cat > /etc/caddy/Caddyfile <<EOF
api.<your-domain> {
  reverse_proxy 127.0.0.1:8787
}
EOF

systemctl restart caddy
systemctl enable caddy
journalctl -u caddy -f
```

(Substitute your actual domain in the Caddyfile.)

Wait until you see `certificate obtained successfully`. `Ctrl+C` to stop tailing.

If it fails with `Invalid response from http://api.<domain>/.well-known/...`,
DNS isn't pointing at the box yet — re-run `dig` and wait. Caddy retries
every 60s automatically.

## 10. Systemd service for the orchestrator

```sh
cat > /etc/systemd/system/uniqus-orchestrator.service <<'EOF'
[Unit]
Description=Uniqus orchestrator
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/uniqus-code
EnvironmentFile=/opt/uniqus-code/.env.local
ExecStart=/usr/bin/npm --workspace=@uniqus/orchestrator run start
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now uniqus-orchestrator
journalctl -u uniqus-orchestrator -f
```

You're looking for these lines:

```
[firecracker] enabled — VMs boot lazily on first user_message
orchestrator: ws://localhost:8787 ...
```

`Ctrl+C` to stop tailing — service stays up.

## 11. Firewall

```sh
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw deny  8787      # only Caddy on localhost should reach the orchestrator
ufw --force enable
```

## 12. Verify

From your laptop:

```sh
curl -I https://api.<your-domain>/health
# HTTP/2 200

curl https://api.<your-domain>/health
# {"ok":true}
```

If both work, the Hetzner side is done. Continue with the Vercel setup
in [`SETUP_PHASE2.md`](SETUP_PHASE2.md) §7 onward.

---

## Day-2 ops

| What | Command |
|---|---|
| Pull latest code | `cd /opt/uniqus-code && git pull` |
| Restart orchestrator | `systemctl restart uniqus-orchestrator` |
| Tail logs | `journalctl -u uniqus-orchestrator -f` |
| Tail TLS / proxy | `journalctl -u caddy -f` |
| Live VMs | `ls /var/lib/uniqus/firecracker/*.api.sock` |
| Wipe a stuck VM | `rm -f /var/lib/uniqus/firecracker/<projectId>.*` |
| Rebuild rootfs after editing `services/sandbox-agent/` | `bash ./infra/firecracker/build-rootfs.sh` |
| Disk usage | `du -sh /var/lib/uniqus/firecracker/*` |
| Memory by VM | `ps aux \| grep firecracker` |

## Troubleshooting

**Caddy won't get a cert:** check `dig +short api.<your-domain>` returns your
Hetzner IP. Most failures are DNS not propagated yet.

**`firecracker` not in PATH for the orchestrator:** systemd's environment is
spartan. Check `which firecracker` as root manually — should be
`/usr/local/bin/firecracker`. Add it to the service's `Environment=PATH=...`
line if needed.

**`agent did not answer /health within 10s`:** vsock isn't enabled in the
shipped kernel, or the in-VM agent crashed at boot. Mount the rootfs as a
loopback (`mount -o loop /var/lib/uniqus/firecracker/<id>.root.ext4 /mnt`)
and tail `/mnt/var/log/uniqus-agent.log`.

**Build of a project's npm install fails inside the VM:** the rootfs Node may
be older than the project requires. Rebuild rootfs with a newer Alpine via
`ALPINE_VERSION=3.21 bash ./infra/firecracker/build-rootfs.sh`.

**`Permission denied` on `./infra/firecracker/*.sh`:** Windows checkouts drop
the executable bit. Run them as `bash ./infra/firecracker/host-setup.sh`
instead, or `chmod +x` once.
