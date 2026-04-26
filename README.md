# Uniqus Code

AI-powered dev-environment platform. See [the plan](C:/Users/thech/.claude/plans/can-you-come-up-soft-tower.md) for the full roadmap.

## Status

- **1.1** ✅ Agent loop alive (Claude tool-use, local-process sandbox, CLI)
- **1.2** ✅ Web UI shell — Next.js + chat + file tree + Monaco editor + terminal panel, talking to orchestrator over WebSocket
- **1.3** ⚠️ Plan-mode UI ✅ shipped. Firecracker host **deferred** — needs a Linux box with KVM (your Windows machine can't run it natively without WSL2 + nested virt). Will be its own session.
- **1.5.1** ✅ Preview proxy — iframe loads dev servers through the orchestrator at `/preview/:serverId/`, so previews work in production where the in-sandbox port isn't publicly exposed.
- **1.5.2** ✅ Codebase import — ZIP upload and GitHub clone (with optional PAT for private repos) on the new-project page.

## Setup

```sh
npm install
```

Add your Anthropic API key to `.env.local` at the repo root:

```
ANTHROPIC_API_KEY=sk-ant-...
```

## Run

```sh
npm run dev
```

Starts both servers in parallel:

- Orchestrator WebSocket on `ws://localhost:8787`
- Web app on `http://localhost:3000`

Open the web app, toggle "plan mode" on or off in the input footer, and describe what to build. With plan mode on, you'll get a structured plan from Opus that you can edit before approving; the agent then executes with Sonnet.

## CLI mode (no UI)

```sh
npm run agent -- "create a hello.txt with the text 'hi'"
```

Same loop, terminal-only output. No plan mode in the CLI yet.

## Layout

- `apps/web/` — Next.js 15 web UI (3-pane: chat / file tree+editor / terminal)
- `services/orchestrator/` — Claude tool-use loop + WebSocket server
  - `src/agent/loop.ts` — agent loop
  - `src/agent/plan.ts` — plan-mode (Opus → `submit_plan` tool)
  - `src/agent/sandbox.ts` — local-process sandbox (Firecracker comes later)
  - `src/proxy.ts` — preview proxy: forwards `/preview/:serverId/*` to in-sandbox dev servers (HTTP + WS for HMR)
  - `src/import.ts` — codebase import: ZIP extract + `git clone` with optional PAT
  - `src/server.ts` — HTTP + WS gateway used by the web app
  - `src/cli.ts` — terminal entry point
- `packages/api-types/` — shared event schemas

Sandbox lives at `./.sandbox/` (gitignored) and is shared across runs — the agent sees existing files between prompts.

## Preview proxy

Dev servers the agent starts inside the sandbox are reached at
`{ORCHESTRATOR_URL}/preview/{serverId}/`. The orchestrator forwards both HTTP
and WebSocket traffic to `127.0.0.1:{port}` of the sandboxed process. This is
what makes the iframe work in production where the sandbox port isn't publicly
bound — the proxy is the public entrypoint.

Known limit: HMR / live-reload sockets need `Referer` to find the right server
and browsers don't always include it on WS handshakes. Hard reload from the
preview toolbar works in all cases. The proper fix (wildcard subdomains per
server) is tracked as 1.13.

## Codebase import

On the project picker:

- **Blank project** — empty sandbox (existing behavior).
- **Upload .zip** — multipart upload, extracted into the sandbox. Up to 250 MB
  compressed. `.git/` and `node_modules/` are stripped on extract. A
  GitHub-style single-root folder (e.g. `repo-main/`) is detected and stripped.
- **Clone GitHub** — `git clone --depth 1` of any HTTPS repo. For private
  repos, paste a fine-scoped PAT. The PAT is used once and not stored. The
  cloned `.git/` is removed; you get a clean source tree.
