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

## VM cold start (Firecracker)
- A NEW project with no prior VM/snapshot hits `bootNew()` in `fleet.ts` — the
  only path that matters for new-project latency. The "faster reopen" /
  "keep-warm" / pause-resume work all only speed REOPENING a project that
  already booted once; none of it touches first boot. See
  `infra/firecracker/README.md` ("Cold start: the two paths").
- Boot fixes are always on: no `iface eth0 inet dhcp` and the agent no longer
  `need net`s (a doomed DHCP lease used to block OpenRC ~10-15s); mutable dirs
  are tmpfs (`/tmp /run /var/log /root`) so the base rootfs can be shared
  read-only. `/root` on tmpfs is load-bearing: golden clones mount `/` ro, and
  without it npm dies creating `/root/.npm` on every restored VM. The heavy
  package caches live on the per-project disk instead (`/sandbox/.cache/*`, set
  via agent env in BOTH main.rs and agent.mjs; `.cache` is excluded from
  sync/pull/manifest).
- **Golden base snapshot** (`FIRECRACKER_BASE_SNAPSHOT=1`, default OFF) makes
  new-project boots sub-second by restoring a clone of a pre-booted VM. It
  requires a **rootfs rebuild** (the golden boots the rootfs read-only and uses
  the `uniqus_golden=1` cmdline) and must be **validated on the host** before
  trusting it — see the README's "Enabling + validating" steps. Falls back to
  cold boot on any error, so shipping it dark is safe. The agent gained
  `POST /net/configure` (re-stamp IP/MAC + mount sandbox + reseed/clock on
  restore) — mirrored in BOTH `main.rs` and the Node `agent.mjs`. **Requires
  Firecracker ≥ v1.12.0** (the `network_overrides` restore field; `host-setup.sh`
  pins v1.12.1). On older binaries every restore 400s and silently cold-boots, so
  the flag can read as "on" while never restoring — verify with `firecracker
  --version` + a `restored from golden snapshot` log line, not just the env var.

## Model providers (multi-provider agent)
- The coding agent runs on a model resolved by `services/orchestrator/src/agent/router.ts`.
  Default is **Auto**. `router.ts` gives Auto a STATIC floor (**GLM-5.2** when a
  Z.ai key is set, else **Claude Opus** — so Auto is never broken on an
  orchestrator without the key; the switch flips on the moment `ZAI_API_KEY` is
  deployed). On top of that floor, the agent loop + plan mode run **task-aware
  Auto** (`services/orchestrator/src/agent/autoRouter.ts`): per turn it
  classifies the request into one of three tiers and routes to the model whose
  strengths fit, **across all configured providers** (each provider has a home
  tier so its key gets real traffic):
  - **quick** (trivial edits / explicitly speed-sensitive) → the FASTEST model,
    **Gemini 3.5 Flash** leading. GLM is deliberately excluded here — its
    1M-context first-token latency is the opposite of "quick". Falls back to
    Sonnet (the always-present Anthropic safety net) when no Google key.
  - **standard** (routine features) → **GLM-5.2** (cost-effective frontier
    coding); Sonnet/Flash when no Z.ai key.
  - **hard** (debug / architecture / cross-cutting / long briefs) → the strongest
    reasoner: **Opus › GPT-5.5 › Gemini Pro › GLM**.
  - **vision** overlay: image-heavy turns prefer a NATIVELY-multimodal model
    (Gemini/Claude/GPT) over text-only GLM (which would lean on the
    analyze_image bridge); falls through to GLM+bridge only if no native-vision
    key is set.
  Heuristics decide clear cases for free; a tiny Haiku `classify` call does a
  3-way (QUICK/STANDARD/HARD) tiebreak only when ambiguous (plan mode skips it,
  biasing ambiguous→hard). Routing is constrained to providers with a configured
  key (Anthropic, always set, is the terminal fallback in every list so a pick
  always resolves), marks picks `overridden:false` (no "results may vary"
  notice), and on any failure keeps the static floor — it can't break a turn. An
  explicit per-turn pick or `UNIQUS_MODEL_<ROLE>` env pin (`overridden:true`)
  bypasses task routing entirely. **NOTE: Gemini/OpenAI routing only kicks in
  when `GOOGLE_API_KEY`/`OPENAI_API_KEY` are set on the orchestrator** — without
  them Auto picks among Anthropic + GLM only. Users override per-turn / as an account default via
  the composer + Settings "Default model" picker (Anthropic, Z.ai, OpenAI,
  Google). The curated, selectable list is `MODEL_CATALOG` in `packages/api-types`
  — the single source of truth shared by the UI and the router. Low tiers (Haiku,
  Flash-Lite, mini/nano) are intentionally excluded.
- Provider adapters live in `services/orchestrator/src/agent/providers/`.
  Canonical message shape is Anthropic's; the OpenAI/Gemini adapters translate
  in/out.
- **Z.ai (GLM) runs on the OpenAI-style Chat Completions endpoint**, not GLM's
  Anthropic-compatible Messages endpoint. Why: web search is only available as a
  tool on Chat Completions (`/paas/v4`) — the Anthropic/Claude-Code path gets
  search via a separate Search MCP server, coding-plan only. So `ZaiAdapter`
  (`providers/zai.ts`) reuses the `openai` SDK pointed at `https://api.z.ai/api/paas/v4`
  (override via `ZAI_BASE_URL`; long client timeout for GLM's 1M context). It
  translates the canonical Anthropic message shape ↔ Chat Completions (tool_use →
  `tool_calls`, tool_result → a `tool` message, images on a trailing user message
  as `image_url` parts), and attaches GLM's built-in `web_search` tool alongside
  our function tools. GLM thinking is the top-level `reasoning_effort`
  (`"high"`/`"max"`, mapped from our **low/medium→"high", high→"max"**) plus
  `thinking:{type:"enabled"}`; the reasoning trace streams as
  `delta.reasoning_content`. **Do NOT map medium→"max":** GLM-5.2 collapses
  reasoning_effort to two real tiers (low/medium→high, xhigh/max→max), so mapping
  medium to "max" silently ran the deepest tier and let GLM spiral in thinking for
  minutes — only an explicit "high" should opt into "max". GLM also needs
  `tool_stream:true` on the streaming call (GLM-4.6+) or it buffers each tool
  call's whole `arguments` JSON into one end-of-turn burst (lumpy streaming); with
  it the `delta.tool_calls[*].function.arguments` fragments stream live. Z.ai takes
  the `web_search` sub-fields as STRINGS (`enable:"True"`, `count:"5"`). Internal
  roles (compact/classify/design) stay on Claude regardless.
- **GLM-5.2 is TEXT-ONLY → vision bridge.** It can't take image input, so the
  product's screenshot-verify loop is preserved via an `analyze_image(path,
  question)` tool that's added to the tool list ONLY when the active model lacks
  vision (`hasVision = provider !== "zai"` in loop.ts). The handler reads the
  image and forwards it + GLM's targeted question to **GLM-5V-Turbo** (Z.ai's
  VLM, same key/endpoint — `describeImage` in `providers/zai.ts`; model overridable
  via `ZAI_VISION_MODEL`) and returns the analysis as text. The `ZaiAdapter` never
  sends `image_url` (it replaces image blocks — screenshots, uploads — with a text
  note pointing at `analyze_image`; the asset path is already in the tool-result
  text). Vision-capable providers are unchanged and get images natively. New
  general image reader for the bridge: `readImageBase64` in `agent/assets.ts`
  (any sandbox image path, not just uploads/screenshots).
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
  - **Z.ai (GLM)** → top-level `reasoning_effort` (low/medium→`"high"`,
    high→`"max"`; medium must NOT be "max") + `thinking:{type:"enabled"}` on Chat
    Completions; see the Z.ai bullet above.
  - Not applied to forced-tool (plan) calls.
- **Env keys on the orchestrator (Hetzner):** `ANTHROPIC_API_KEY` (required,
  also used for compaction and the internal compact/classify/design roles).
  `ZAI_API_KEY` (or `GLM_API_KEY`), `OPENAI_API_KEY`, and `GOOGLE_API_KEY`
  (or `GEMINI_API_KEY`) are **optional** — only needed when a user picks that
  provider's model. Note `ZAI_API_KEY` is special: setting it also flips the
  **Auto** default for the agent/plan roles to GLM-5.2 (get the key from the Z.ai
  Open Platform → API Keys; per-token pricing ≈ $1.40/$4.40 per Mtok in/out).
  Missing key ⇒ a clear "set X" error for that turn only.

## Monorepo
- Workspaces: `apps/*`, `services/*`, `packages/*`. Typecheck with
  `npm run typecheck` (turbo). Web dev server runs on port 4242.
