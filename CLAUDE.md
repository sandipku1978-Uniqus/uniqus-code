# Uniqus Code — working notes for Claude

## Branching / git
- **Do NOT create new branches.** Work directly on `main` and commit there.
  Only create a branch if the user explicitly asks for one in that message.
  (This overrides the default "branch before committing on main" behavior.)
- Commit/push only when the user asks.

## Deploy targets (two separate places)
- **`apps/web` → Vercel.** The production domain serves the **`main`** branch.
  Pushing `main` triggers the production deploy; other branches get preview
  deploys. UI/frontend changes only need this — nothing on Hetzner.
- **`services/orchestrator` + sandbox → Hetzner** (`root@65.109.89.35`, systemd
  service `uniqus-orchestrator`). Deploy with the `/deploy-hetzner` command. The
  Firecracker rootfs only rebuilds when `services/sandbox-agent/` or
  `infra/firecracker/build-rootfs.sh` changes.

## Monorepo
- Workspaces: `apps/*`, `services/*`, `packages/*`. Typecheck with
  `npm run typecheck` (turbo). Web dev server runs on port 4242.
