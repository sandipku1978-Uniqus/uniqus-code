# Uniqus Code

AI-powered dev-environment platform. See [the plan](C:/Users/thech/.claude/plans/can-you-come-up-soft-tower.md) for the full roadmap.

## Status

- **1.1** ✅ Agent loop alive (Claude tool-use, local-process sandbox, CLI)
- **1.2** ✅ Web UI shell — Next.js + chat + file tree + Monaco editor + terminal panel, talking to orchestrator over WebSocket
- **1.3** ⚠️ Plan-mode UI ✅ shipped. Firecracker host **deferred** — needs a Linux box with KVM (your Windows machine can't run it natively without WSL2 + nested virt). Will be its own session.

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
  - `src/server.ts` — WS gateway used by the web app
  - `src/cli.ts` — terminal entry point
- `packages/api-types/` — shared event schemas

Sandbox lives at `./.sandbox/` (gitignored) and is shared across runs — the agent sees existing files between prompts.
