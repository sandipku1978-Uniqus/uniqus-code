# Uniqus Code

A browser-based AI app builder — *engineering, on demand*. Describe what you
want, and a multi-provider coding agent builds it in an isolated sandbox with a
live preview, then helps you ship it.

## Live links

- `https://gate15.dev` — marketing site (Vercel, serves the `main` branch)
- `https://app.gate15.dev` — web app (Vercel, serves the `main` branch)
- `https://api.gate15.dev` — orchestrator (Hetzner box, Firecracker microVMs)
- `https://preview.gate15.app` — isolated, cookieless preview origin (Hetzner)

## What it does

- **Describe → build.** Write a project in plain English; Uniqus names it,
  sharpens it into a first prompt, opens the workspace, and (for new projects)
  proposes a plan before touching files. Or import existing code by **.zip** or
  **GitHub clone**.
- **Multi-provider agent.** The coding agent runs on a model resolved per turn
  across four providers: Anthropic (Claude), Z.ai (GLM-5.2, 1M-token context),
  OpenAI (GPT-5.x, via the Responses API), or Google (Gemini 3.x/2.5) — pin one
  explicitly, or leave it on **Auto**, which classifies each turn (quick edit /
  standard feature / hard problem) and routes to whichever configured model
  fits, falling back to a static default when there's no signal. A per-turn
  **thinking-effort** control (low → max) maps to each provider's native
  reasoning knob, and the model's reasoning streams into a collapsible trace.
- **Built-in web search** on all four providers (Anthropic server-side, OpenAI
  Responses `web_search`, Gemini 3.x `googleSearch`, Z.ai/GLM's `web_search`
  tool).
- **Tool-use loop.** read/write/edit files, run commands, start dev servers with
  a live preview, grep/list, screenshot the preview, background jobs, first-party
  connectors, and per-project secrets (encrypted; values never returned to the
  model). Four permission modes — Plan, Ask before edits, Auto-accept, and Full
  autonomy — control how much runs without checking in, switchable mid-turn.
  Plan mode investigates the codebase with read-only tools and streams what
  it's doing before proposing editable steps. Sub-agents can run concurrently
  in the background on parts of a larger task, with a live Activity Monitor
  for token/cost stats and progress.
- **Per-project isolation.** Each project runs in its own **Firecracker
  microVM** sandbox on the orchestrator; files sync to object Storage and the VM
  snapshots/restores so reopening is fast.
- **Customization.** Per-project + account-wide **Skills** (`.uniqus/skills.md`),
  25 curated **design packs**, account-wide custom prompt + default skills,
  light/dark theme + density.
- **Ship it.** Deploy to **Vercel**, create a GitHub repo, and
  rewind to **checkpoints**. Or take it with you: download the project as a
  **.zip**, embed it via an `<iframe>` snippet, or share a revocable preview
  link. Guest/education accounts work without a Google login.

## Monorepo layout

- `apps/web/` — Next.js web app (Vercel). Dashboard, chat-centric IDE workspace
  (chat / files / editor + preview / logs), settings, guide, marketing.
- `services/orchestrator/` — Node service (Hetzner). Agent loop + WebSocket
  gateway + per-project sandboxes.
  - `src/agent/loop.ts` — the tool-use agent loop (provider-agnostic)
  - `src/agent/plan.ts` — streaming plan mode (read-only investigation → `submit_plan`)
  - `src/agent/router.ts` — model routing (`MODEL_CATALOG`, Auto defaults)
  - `src/agent/autoRouter.ts` — task-aware Auto (classifies quick/standard/hard)
  - `src/agent/providers/` — Anthropic / Z.ai (GLM) / OpenAI / Gemini adapters
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

The hosted Supabase database does **not** auto-apply
`services/orchestrator/src/db/schema.sql`. Apply any required idempotent schema
changes in the Supabase SQL editor before restarting code that depends on them;
the Hetzner deploy only pulls/rebuilds/restarts the service.

See [CLAUDE.md](CLAUDE.md) for working notes (branching, deploy, providers).

## Setup

```sh
npm install
```

Provider keys live in `.env.local` at the repo root (orchestrator reads them):

```
ANTHROPIC_API_KEY=sk-ant-...     # required (agent + compaction)
ZAI_API_KEY=...                  # optional — only for GLM models (or GLM_API_KEY)
OPENAI_API_KEY=sk-...            # optional — only for OpenAI models
GOOGLE_API_KEY=...               # optional — only for Gemini models (or GEMINI_API_KEY)
WORKOS_API_KEY=sk_...            # required — direct API/WS session validation
WORKOS_CLIENT_ID=client_...      # required
WORKOS_COOKIE_PASSWORD=...       # required, at least 32 characters
WORKOS_COOKIE_DOMAIN=.example.com
WORKOS_AUTHKIT_ISSUER=https://api.workos.com # set to the custom auth domain when configured
PUBLIC_BASE_URL=https://api.example.com      # production API + OAuth callbacks
PREVIEW_BASE_URL=https://preview.example.net # production, outside the cookie domain
UNIQUS_ALLOW_HOST_SANDBOX=1      # local development only
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
the composer. Local host execution is available only with the explicit
`UNIQUS_ALLOW_HOST_SANDBOX=1` development opt-in. Production must set
`UNIQUS_SANDBOX=firecracker` and fails startup otherwise.

Production previews require a separate cookieless site outside
`WORKOS_COOKIE_DOMAIN`: set `PUBLIC_BASE_URL` to the authenticated orchestrator
API origin, `PREVIEW_BASE_URL` to the isolated preview origin, and use that same
preview origin as `NEXT_PUBLIC_PREVIEW_URL` on Vercel. OAuth callbacks always
use `PUBLIC_BASE_URL`; the orchestrator rejects a preview host that could receive
application-domain cookies.

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
