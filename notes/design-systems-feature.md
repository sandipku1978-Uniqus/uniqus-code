# Design Systems — feature spec

Status: **planned** (build order: after Supabase, before edit-diffs).
Reference product: Claude Design (auto-induces a design system from your
codebase/files, then applies it to every project).

## Goal

Make design systems a **global, reusable** asset — not per-project. A user
builds one or more design systems once (typography, color, spacing, radius,
logos, component conventions) and attaches one to any project (or none). This is
the single highest-leverage UX lever for output consistency (see
`notes/large-features-coding-prompts.md` / strategy notes): the agent generates
*against* the tokens instead of re-inventing styling every turn.

## Surfaces

### 1. Design Systems tab (projects screen)
- A new tab/section beside the project list (the "projects screen") to **create**
  a new design system and **view/edit** existing ones.
- Design systems are **account-global** (per-user, like skills packs are curated
  globally), NOT created per project.
- List view: each system shows name + a small token preview (color swatches,
  type sample). Actions: edit, duplicate, delete.

### 2. New-design-system flow
Creation options (a small chooser):
- **Name** (required).
- **Import from .zip** — upload a codebase; the agent infers the design system.
- **Import from GitHub** — same, via a repo URL (reuse the existing GitHub
  import path in `services/orchestrator/src/import.ts`).
- **Start blank** — hand-author from a default token scaffold.

For the two imports: the agent reads the imported code (Tailwind config, CSS
vars, component library, globals.css, theme files) and **infers a full design
system**, then presents it to the user for review/edit (Claude Design behavior).

### 3. New-project creation
- Add a **dropdown** to the new-project flow to select a design system (or
  "No design system"). The selected system id is stored on the project.

## Data model (proposed)

- New global table `design_systems` (per-user): `id`, `user_id`, `name`,
  `tokens` (JSON — the canonical artifact), `created_at`, `updated_at`.
  - `tokens`: a structured doc — color (primitive → semantic → component),
    typography (families, scale), spacing, radius, shadow, plus freeform
    `notes`/`components` guidance and optional `logo` asset refs. Follow a
    three-tier naming convention (semantic names like `color-primary`, not raw
    hex) — research shows this is what makes AI output consistent.
- `projects.design_system_id` (nullable FK) — which system a project uses (null
  = none).

## Agent integration (cheap — reuses existing plumbing)

- The design-system tokens are injected into the system prompt at the **same
  point project skills are injected** (`formatSkillsForPrompt` in
  `services/orchestrator/src/agent/skills.ts`, called from `loop.ts`
  `buildSystemPrompt`). Add a `formatDesignSystemForPrompt(tokens)` that emits a
  `<design_system>` block instructing the agent to generate against these tokens
  exclusively and to scaffold a tokens file (CSS vars / Tailwind config) the app
  references by variable, not hardcoded values.
- On project creation with a selected system, scaffold the tokens file into the
  sandbox so the very first generation is on-system.

## Inference (imports)

- Reuse `importZip` / `importGithub` to land the source in a scratch sandbox,
  then run a focused agent pass ("extract a design system from this codebase")
  that returns the structured `tokens` JSON. Present it in the editor for the
  user to refine before saving. This is a constrained, schema-validated agent
  call (force a StructuredOutput-shaped result), not a free-form turn.

## Build phases

1. Backend: `design_systems` table + CRUD routes + `projects.design_system_id`.
2. Prompt injection (`formatDesignSystemForPrompt`) + scaffold-on-create.
3. UI: Design Systems tab (list + token editor), new-project dropdown.
4. Import-and-infer (zip + GitHub) → structured extraction → editable result.

## Synergy

A **template** = starter code + a design system + skills. Building this makes
the Templates/marketplace feedback item largely incremental afterward. The
design system is also the artifact a future "design sub-agent" would own.
