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

## Model providers (multi-provider agent)
- The coding agent runs on a model resolved by `services/orchestrator/src/agent/router.ts`.
  Default is **Auto** (Claude Opus). Users override per-turn / as an account
  default via the composer + Settings "Default model" picker (Anthropic,
  OpenAI, Google). The curated, selectable list is `MODEL_CATALOG` in
  `packages/api-types` — the single source of truth shared by the UI and the
  router. Low tiers (Haiku, Flash-Lite, mini/nano) are intentionally excluded.
- Provider adapters live in `services/orchestrator/src/agent/providers/`.
  Canonical message shape is Anthropic's; the OpenAI/Gemini adapters translate
  in/out. Web search + image/screenshot previews work on all three: Anthropic
  server-side `web_search`; OpenAI `web_search_options` (GPT-5.5 family);
  Gemini `googleSearch` grounding (3.x only — 2.5 can't combine it with
  function calling). Tool-result images ride on a follow-up user message
  (OpenAI) or `inlineData` parts (Gemini).
- **Env keys on the orchestrator (Hetzner):** `ANTHROPIC_API_KEY` (required,
  also used for compaction). `OPENAI_API_KEY` and `GOOGLE_API_KEY`
  (or `GEMINI_API_KEY`) are **optional** — only needed when a user picks an
  OpenAI/Gemini model. Missing key ⇒ a clear "set X" error for that turn only.

## Monorepo
- Workspaces: `apps/*`, `services/*`, `packages/*`. Typecheck with
  `npm run typecheck` (turbo). Web dev server runs on port 4242.
