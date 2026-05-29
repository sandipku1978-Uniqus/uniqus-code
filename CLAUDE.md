# Uniqus Code — working notes for Claude

## Working principles
- **Fix the root cause; never paper over it.** Do not "resolve" an issue by
  disabling the feature, hiding it behind a "coming soon"/`soon` sticker, a
  stub, or by telling the user/model "you don't have X" when the real ask is to
  make X work. If a capability is hard (e.g. a different API surface is needed),
  implement that — or, if it's genuinely out of scope, say so explicitly and
  explain why, rather than shipping a band-aid that looks done.
- When a provider/API rejects something, check the provider's current docs for
  the supported shape before changing code — don't guess from memory (the
  models here are newer than the training cutoff).

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
  in/out.
- **Built-in web search: all three providers.** Anthropic server-side
  `web_search`; OpenAI via the **Responses API** built-in `{type:"web_search"}`
  tool (Chat Completions can't mix `web_search_options`/`reasoning_effort` with
  function tools — that's why OpenAI runs on `/v1/responses`); Gemini **3.x**
  `googleSearch` grounding + `toolConfig.includeServerSideToolInvocations`
  (Gemini **2.5** genuinely can't combine search with function calling, so it
  has no web search). Server-side search calls are surfaced as a `web_search`
  activity row and never executed by the loop; on Gemini they're recognized by
  NOT matching one of our tool names. The system prompt advertises web_search
  only when the resolved model actually has it (loop.ts `hasWebSearch`).
  Image/screenshot previews work on all three (tool-result images ride a
  follow-up user message on OpenAI's Responses input, `inlineData` parts on
  Gemini).
- **Thinking effort** (`ThinkingEffort` = low/medium/high in `api-types`): a
  per-turn reasoning control set in the composer's model picker, account-wide
  default in the store (localStorage), default "medium". Plumbed
  composer → `user_message.thinking` → `runSession` → loop `thinkingEffort` →
  each adapter (params verified against provider docs):
  - **Anthropic** → `output_config.effort` (low/medium/high) + adaptive
    thinking (`thinking:{type:"adaptive"}`). Manual `thinking.budget_tokens`
    returns a **400 on Opus 4.8** — don't use it. Needs `@anthropic-ai/sdk`
    ≥ ~0.100 (we bumped from 0.39) so the stream parser handles adaptive
    thinking blocks. `thinking_delta` events stream the reasoning trace.
  - **OpenAI** → `reasoning_effort` (Chat Completions). `*-pro` models only
    accept `"high"`, so we clamp them. (`web_search_options` is unsupported on
    Chat Completions for GPT-5.x — that's why built-in search was removed.)
  - **Gemini** → `thinkingConfig.thinkingLevel` (low/medium/high) on **3.x**;
    `thinkingConfig.thinkingBudget` (tokens) on **2.5** — sending a budget to a
    3.x model degrades it. Thought signatures on function-call parts are
    preserved across turns (`tool_use.thought_signature`), required for 3.x
    multi-turn function calling.
  - Not applied to forced-tool (plan) calls.
- **Env keys on the orchestrator (Hetzner):** `ANTHROPIC_API_KEY` (required,
  also used for compaction). `OPENAI_API_KEY` and `GOOGLE_API_KEY`
  (or `GEMINI_API_KEY`) are **optional** — only needed when a user picks an
  OpenAI/Gemini model. Missing key ⇒ a clear "set X" error for that turn only.

## Monorepo
- Workspaces: `apps/*`, `services/*`, `packages/*`. Typecheck with
  `npm run typecheck` (turbo). Web dev server runs on port 4242.
