# Supported stacks & runtime limits

What project types Uniqus detects/deploys, and the resource ceilings of the
sandbox VM. Code-grounded in
[`services/orchestrator/src/flyDeploy.ts`](../services/orchestrator/src/flyDeploy.ts)
(detection + Dockerfile generation),
[`services/orchestrator/src/firecracker/fleet.ts`](../services/orchestrator/src/firecracker/fleet.ts),
and [`infra/firecracker/build-rootfs.sh`](../infra/firecracker/build-rootfs.sh).

## Runtimes available in the sandbox

The base rootfs (`build-rootfs.sh`, Alpine 3.20) ships:

- **Node 20** (`nodejs`, `npm`)
- **Python 3** (`python3`, `py3-pip`)
- **Go 1.22**
- `bash`, `coreutils`, `util-linux`, `git`, `curl`, `ca-certificates`,
  `iproute2`, `socat`, `dropbear-ssh`

So Node, Python, and Go projects all run in-VM out of the box.

## Project-shape detection (`detectShape`)

`detectShape(sandboxDir)` in `flyDeploy.ts` classifies a project by the files
present, in this order:

| Detected file(s) | `ProjectShape` |
| --- | --- |
| `package.json` (+ a long-running dep, see below) | `node-server` |
| `package.json` (no long-running dep) | `node` |
| `requirements.txt` or `pyproject.toml` | `python` |
| `go.mod` | `go` |
| `index.html` | `static` |
| none of the above | `unknown` |

Frameworks (Next, Vite, etc.) are **not** branched on by name for detection —
they all classify as `node`/`node-server` via `package.json`. The generated
Node Dockerfile runs `npm run build` when a `build` script exists and `npm
start` when a `start` script exists (falling back to `node server.js`), which
covers Next/Vite/CRA-style apps.

### "node-server" — long-running detection

`isLongRunningNode` scans deps/devDeps for `SERVER_DEPS` — `ws`, `socket.io`,
`engine.io`, `bullmq`/`bull`, `agenda`, `node-cron`, `discord.js`, `telegraf`,
`grammy`, `@slack/socket-mode`, `@fastify/websocket`, etc. A match means the
project holds open sockets/queues/schedulers and **can't run on Vercel's
serverless model**, so it routes to a long-running target (Fly) and its
generated `fly.toml` keeps ≥1 machine warm with auto-stop disabled.

## Deploy targets

- **Vercel** — JS/static apps (the Phase-1.6 path; see project notes).
- **Fly.io** (`flyDeploy.ts`) — long-running containers for the
  Slack-bot/Snowflake/ETL/scheduled-job wedge. It auto-generates a
  `Dockerfile`, `fly.toml`, and `.dockerignore` per detected shape if missing,
  resolves `FLY_API_TOKEN` from project secrets, and shells out to `flyctl
  deploy --remote-only`. An `unknown` shape is rejected with a clear error.
  Generated Fly VMs are `shared` CPU, 1 cpu, **256 MB** by default.

Both deploy paths require their CLI/token to be present (clear errors if
`flyctl` or the token is missing).

## Sandbox VM resource limits (`fleet.ts`)

Per-project Firecracker microVM, all env-tunable:

| Limit | Env var | Default |
| --- | --- | --- |
| vCPUs | `FIRECRACKER_VCPUS` | `2` |
| RAM | `FIRECRACKER_MEM_MIB` | `1024` (1 GiB) |
| Base rootfs size | `ROOTFS_SIZE_MB` (build-rootfs.sh) | `2048` (2 GiB) |
| Per-project `/sandbox` disk | (fixed in `ensureSandboxImage`) | **1 GiB** sparse ext4 |

- The `/sandbox` ext4 image is created sparse at 1 GiB and `mkfs.ext4`'d on
  first boot. **There is no automatic grow** — a project that fills 1 GiB hits
  ENOSPC inside the VM. An auto-grow at >80% full is noted as Phase-3.
- The rootfs is shared read-only (golden-snapshot path) or copied per project
  (cold-boot path); mutable runtime dirs (`/tmp`, `/run`, `/var/log`) are tmpfs
  and therefore bounded by RAM, not disk.

## File hydration limits

When the orchestrator seeds project files into a VM (`hydrateInto`), it caps at
`HYDRATE_MAX_FILES = 5000` files and `HYDRATE_MAX_BYTES = 200 MB`, and skips
`node_modules` and `.git`. A project larger than these caps will not have all
files pushed at boot.

## Import size limits

(See [`docs/github-import.md`](./github-import.md).) Zip imports cap at 200 MB
uncompressed total / 50 MB per file; GitHub clones cap at 500 MB.

## Idle lifecycle (recap)

VMs pause after `FIRECRACKER_IDLE_PAUSE_MS` (5 min), snapshot after
`FIRECRACKER_IDLE_SNAPSHOT_MS` (30 min paused), reclaim RAM/snapshot disk at
`FIRECRACKER_GC_MAX_IDLE_MS` (72 h, keeping `node_modules`), and finally reap
the sandbox disk at `FIRECRACKER_FS_REAP_MAX_IDLE_MS` (14 days). Full detail in
[`infra/firecracker/README.md`](../infra/firecracker/README.md) and
[`infra/firecracker/SECURITY.md`](../infra/firecracker/SECURITY.md).
