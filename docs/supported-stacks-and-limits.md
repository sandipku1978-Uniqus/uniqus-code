# Supported stacks & runtime limits

What project types Uniqus runs and deploys, and the resource ceilings of the
sandbox VM. Code-grounded in
[`services/orchestrator/src/deploy.ts`](../services/orchestrator/src/deploy.ts)
(the Vercel deploy pipeline),
[`services/orchestrator/src/agent/predeploy.ts`](../services/orchestrator/src/agent/predeploy.ts)
(the pre-deploy build + serverless-safety check),
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

## Deploy-time detection

There is no separate project-shape classifier or generated Dockerfile in the
deploy path today. `startDeploy` (`deploy.ts`) requires a `package.json` or
`index.html` at the sandbox root — anything else is rejected with a clear
"no package.json or index.html at the root" error before it reaches Vercel.
Framework detection itself is left to Vercel: the deploy request sends
`projectSettings.framework: null`, and Vercel infers Next/Vite/CRA/plain-static
etc. from `package.json` and the usual framework config files
(`next.config.js`, `vite.config.*`, ...) the same way it would for a repo
pushed directly to Vercel.

### Pre-deploy build + serverless-safety check

Before deploying (via the agent's `predeploy_check` tool /
`runPredeployCheck` in `predeploy.ts`), the agent runs the project's real
`npm run build` (root or, if the app lives in a single subdirectory, that
subdirectory — e.g. `create-next-app my-app` → `my-app/`) and separately
scans source files for patterns that compile fine but break once the app is
live on Vercel's serverless model:

- **Blockers** (fail the check): filesystem writes outside `/tmp` in
  server-reachable code, file-based SQLite / `better-sqlite3`, and
  `WebSocketServer`/`socket.io` servers.
- **Warnings** (advisory only): module-scope `setInterval`/`setTimeout` in
  server code, and hard-coded `localhost`/`127.0.0.1` URLs.

This replaces routing long-running-style projects (WebSocket servers, queues,
schedulers) to a separate always-on target — see "Deploy targets" below for
what happens to that class of project today.

## Deploy targets

- **Vercel** (`deploy.ts` / `vercel.ts`) — the only built-in one-click deploy
  target. Files are pushed through Vercel's Files API (SHA1-deduped, 100 MB
  per-file limit, 200 MB cumulative cap per deploy) and a deployment is
  created referencing those file SHAs; the project's stored secrets are
  merged into the deploy env (request env wins). Vercel is a serverless
  platform, so long-running processes (open WebSocket servers, queues,
  cron-style schedulers) don't fit it — the pre-deploy safety check above
  flags these as blockers rather than silently shipping a broken deploy.
  There is currently no built-in always-on/container deploy target for that
  class of project; see "Taking your app off Uniqus-hosted infrastructure"
  below for getting the code onto your own infrastructure instead.

## Sandbox VM resource limits (`fleet.ts`)

Per-project Firecracker microVM, all env-tunable:

| Limit | Env var | Default |
| --- | --- | --- |
| vCPUs | `FIRECRACKER_VCPUS` | `2` |
| RAM | `FIRECRACKER_MEM_MIB` | `1024` (1 GiB) |
| Base rootfs size | `ROOTFS_SIZE_MB` (build-rootfs.sh) | `2048` (2 GiB) |
| Per-project `/sandbox` disk | `FIRECRACKER_SANDBOX_SIZE` (`ensureSandboxImage`) | **8 GiB** sparse ext4 |

- The `/sandbox` ext4 image is created sparse at the configured size and
  `mkfs.ext4`'d on first boot (raised from an original 1 GiB default, which
  real projects — `node_modules` + build output + git history — were filling).
  **There is no automatic grow** — a project that fills its image hits ENOSPC
  inside the VM. Growing an existing image is a manual, offline host-side
  operation (`truncate` + `resize2fs` while the VM is stopped), and when the
  golden base-snapshot path is enabled the golden placeholder disk must be
  rebuilt to match the new size.
- The rootfs is shared read-only (golden-snapshot path) or copied per project
  (cold-boot path); mutable runtime dirs (`/tmp`, `/run`, `/var/log`, `/root`)
  are tmpfs and therefore bounded by RAM, not disk.

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

## Taking your app off Uniqus-hosted infrastructure (private cloud / self-host)

Some buyers — finance, GRC, regulated, or air-gapped environments — can't run
production on public Vercel and need to run the **app Uniqus built** on
**their own** infrastructure (their CI/CD, their container registry, their
Kubernetes/VMs). That is fully supported: your generated app is portable code,
not a Uniqus-locked artifact. The full how-to with copy-pasteable commands lives
in [`docs/private-cloud-deploy.md`](./private-cloud-deploy.md); the summary
below is the honest scope.

### What you can take with you (two paths)

1. **GitHub publish → your own CI/CD.** Uniqus can create a (private) repo on
   your GitHub account and push the project's full source
   (`createUserRepo` / initial push in
   [`services/orchestrator/src/github.ts`](../services/orchestrator/src/github.ts)).
   From there it is ordinary source in your control — point your existing
   pipeline at it and deploy however you already deploy.

2. **Download the code as a zip → add your own Dockerfile → your registry →
   your k8s/VMs.** The "get my code out" path is a plain `.zip` of the project
   (`buildProjectZip` in
   [`services/orchestrator/src/export.ts`](../services/orchestrator/src/export.ts)),
   reusing the same secret/build-artifact exclusions as the Vercel deploy path
   so `.env*` files and `node_modules`/`.git` never leave the server. **Uniqus
   does not auto-generate a `Dockerfile`, `.dockerignore`, or
   `docker-compose.yml`** — an earlier build had a per-shape generator tied to
   a built-in Fly.io deploy adapter; both were removed, so there is nothing to
   reuse here today. Write a standard Dockerfile for the project's stack the
   way you would for any non-Uniqus app (e.g. `node:20-slim` for Node,
   `python:3.11-slim` for Python, `golang:1.22-alpine` multi-stage for Go, or
   `nginx:alpine` for static), then build/push/run on your own registry and
   cluster.

### What is explicitly out of scope (be honest)

Self-hosting / air-gapping the **Uniqus Code control plane itself** — the
orchestrator, the Firecracker microVM fleet, and the web app — is **not offered
today**. Only the **generated app** is portable. So a customer can run *their
app* on their own infrastructure, but the *builder* still runs on
Uniqus-hosted infrastructure.

This is a **packaging-and-documentation gap, not a fundamental inability to
leave Vercel**: the generated app is already plain code with no runtime
dependency on Uniqus services (you supply your own Dockerfile, per path 2
above). If full control-plane self-hosting is a hard requirement, say so
during evaluation — it's a roadmap conversation, not something to pretend is
shipped.
