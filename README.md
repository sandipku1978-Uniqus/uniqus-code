# Uniqus Code

A browser-based AI app builder — *engineering, on demand*. Describe what you
want, and a multi-provider coding agent builds it in an isolated sandbox with a
live preview, then helps you ship it.

## Live links

- `https://app.uniqus-code.com` — web app (Vercel, serves the `main` branch)
- `https://api2.uniqus-code.com` — orchestrator (Hetzner box, Firecracker microVMs)

## What it does

- **Describe → build.** Write a project in plain English; Uniqus names it,
  sharpens it into a first prompt, opens the workspace, and (for new projects)
  proposes a plan before touching files. Or import existing code by **.zip** or
  **GitHub clone**.
- **Multi-provider agent.** The coding agent runs on a model resolved per turn:
  **Auto** (Claude Opus) by default, or an explicit override from Anthropic
  (Claude), OpenAI (GPT-5.x, via the Responses API), or Google (Gemini 3.x).
  A per-turn **thinking-effort** control (low / medium / high) maps to each
  provider's native reasoning knob, and the model's reasoning streams into a
  collapsible trace.
- **Built-in web search** on all three providers (Anthropic server-side,
  OpenAI Responses `web_search`, Gemini 3.x `googleSearch`).
- **Tool-use loop.** read/write/edit files, run commands, start dev servers with
  a live preview, grep/list, screenshot the preview, background jobs, first-party
  connectors, and per-project secrets (encrypted; values never returned to the
  model). Plan mode investigates the codebase with read-only tools and streams
  what it's doing before proposing editable steps.
- **Per-project isolation.** Each project runs in its own **Firecracker
  microVM** sandbox on the orchestrator; files sync to object Storage and the VM
  snapshots/restores so reopening is fast.
- **Customization.** Per-project + account-wide **Skills** (`.uniqus/skills.md`),
  ~17 curated **design packs**, account-wide custom prompt + default skills,
  light/dark theme + density.
- **Ship it.** Deploy to **Vercel**, create a GitHub repo, and
  rewind to **checkpoints**. Guest/education accounts work without a Google login.

## Monorepo layout

- `apps/web/` — Next.js web app (Vercel). Dashboard, chat-centric IDE workspace
  (chat / files / editor + preview / logs), settings, guide, marketing.
- `services/orchestrator/` — Node service (Hetzner). Agent loop + WebSocket
  gateway + per-project sandboxes.
  - `src/agent/loop.ts` — the tool-use agent loop (provider-agnostic)
  - `src/agent/plan.ts` — streaming plan mode (read-only investigation → `submit_plan`)
  - `src/agent/router.ts` — model routing (`MODEL_CATALOG`, Auto defaults)
  - `src/agent/providers/` — Anthropic / OpenAI / Gemini adapters
  - `src/agent/compact.ts` — history compaction
  - `src/firecracker/` — Firecracker microVM fleet (boot, snapshot/restore, idle GC)
  - `src/proxy.ts` — preview proxy (`/preview/:serverId/*` → in-sandbox dev server)
  - `src/server.ts` — HTTP + WS gateway; `src/cli.ts` — terminal entry point
- `packages/api-types/` — shared types: WS event schemas, `MODEL_CATALOG`,
  `SKILL_PACKS` (curated design packs).

## Deploy targets

- **`apps/web` → Vercel.** Pushing `main` triggers the production deploy.
  Frontend changes need nothing on Hetzner.
- **`services/orchestrator` + sandbox → Hetzner** (systemd `uniqus-orchestrator`).
  Deploy with the `/deploy-hetzner` command. The Firecracker rootfs only rebuilds
  when `services/sandbox-agent/` or `infra/firecracker/build-rootfs.sh` changes.

See [CLAUDE.md](CLAUDE.md) for working notes (branching, deploy, providers).

## Setup

```sh
npm install
```

Provider keys live in `.env.local` at the repo root (orchestrator reads them):

```
ANTHROPIC_API_KEY=sk-ant-...     # required (agent + compaction)
OPENAI_API_KEY=sk-...            # optional — only for OpenAI models
GOOGLE_API_KEY=...               # optional — only for Gemini models (or GEMINI_API_KEY)
```

A missing optional key produces a clear "set X" error only when a user picks
that provider's model.

## Run

```sh
npm run dev
```

Starts both in parallel:

- Web app on `http://localhost:4242`
- Orchestrator on `http://localhost:8787` (HTTP + WebSocket)

Open the web app, describe what to build, and (optionally) toggle plan mode in
the composer. Locally the sandbox falls back to a local-process directory at
`./.sandbox/` (Firecracker needs a Linux host with KVM, i.e. the Hetzner box).

## Typecheck

```sh
npm run typecheck      # turbo, all workspaces
```

## CLI mode (no UI)

```sh
npm run agent -- "create a hello.txt with the text 'hi'"
```

Same agent loop, terminal-only output.

## Preview proxy

Dev servers the agent starts inside a sandbox are reached at
`{ORCHESTRATOR_URL}/preview/{serverId}/`. The orchestrator forwards HTTP and
WebSocket traffic to the sandboxed process, so previews work in production where
the sandbox port isn't publicly bound. Hard reload from the preview toolbar is
the reliable path when HMR sockets can't resolve the target.
