# Checkpoints (shadow git)

Automatic per-tool-call snapshots of the project tree, restorable from the UI.
Code-grounded in
[`services/orchestrator/src/agent/checkpoints.ts`](../services/orchestrator/src/agent/checkpoints.ts).

## What it is

After every successful `write_file` / `edit_file` / `run_command`, the
orchestrator commits the entire sandbox tree into a **shadow git repo** kept
**sibling to the sandbox**, not inside it:

```
SANDBOX_ROOT/<id>/                       ← the project tree
SANDBOX_ROOT/<id>.checkpoints/.git       ← the shadow repo (work-tree points back)
```

`git` is driven with `--git-dir <shadow>/.git --work-tree <sandbox>` so the
shadow `.git` never appears in the user's file tree and never fights the
project's own real `.git` (which imported repos often have). The shadow repo is
initialized on its own `checkpoints` branch with a fixed identity
(`Uniqus Agent <agent@uniqus.local>`) and `core.hooksPath=/dev/null` to bypass
any global pre-commit hooks the user installed.

## What's captured / excluded

`git add -A` against the work-tree captures everything **except** the patterns
written to `.git/info/exclude` (`CHECKPOINT_EXCLUDES`):

```
node_modules/  .next/  .turbo/  dist/  build/
.venv/  venv/  __pycache__/
.env  .env.*  *.log
```

So build output, dependency trees, virtualenvs, and `.env*` files are **not**
checkpointed. Commits use `--allow-empty` so a no-op edit still produces a
checkpoint marker, and the message is truncated to 200 chars.

## Concurrency & GC

- **Per-project commit queue** (`commitQueues`): parallel tool calls would race
  on `git`'s exclusive `index.lock`, so commits are chained on a per-project
  Promise and run in order. A stale `index.lock` from a crashed prior process
  is cleared defensively before each commit.
- **GC** (`runGc`) runs `git gc --quiet` in the background after each commit —
  it never blocks the agent loop. The intended retention policy (keep last
  `KEEP_RECENT = 20` + every `KEEP_EVERY = 10`th + tagged restore points) is
  **declared but not yet enforced**: the source notes the aggressive prune is a
  stub and history is currently left intact, relying on git's own GC. Treat
  "20 + every 10th" as aspirational, not active.

## Restore semantics

`restoreCheckpoint(sandboxDir, projectId, sha)`:

1. Validates the sha (`^[0-9a-f]{6,40}$`).
2. **Stashes a "pre-restore" checkpoint first** so the user can rewind the
   rewind.
3. Runs `git checkout <sha> -- .` against the work-tree.

This is **non-destructive from the user's POV**: it overwrites paths that exist
in the target commit but does **not delete files added after that commit**. A
true "hard restore" that mirrors the commit exactly (deleting newer files) is
noted as Phase-3 and is not implemented yet.

`listCheckpoints` returns up to `min(limit, 100)` recent commits as
`{ sha, short_sha, message, created_at }`. `clearCheckpoints` removes the
entire shadow dir.

## Diff preview

`getCheckpointDiff(sandboxDir, projectId, sha)` computes the change a single
checkpoint introduced — `git diff <sha>~1 <sha>` against the shadow repo, or
against git's well-known empty-tree object (`4b825dc6…`) when `sha` is the
first commit and has no parent. It returns the unified diff text (capped at
256 KB, with a `truncated` flag past that) plus a per-file numstat
(`{ path, added, removed }`). Read-only — it never touches the work-tree. This
is what backs the UI's "what changed" view, letting a user preview a diff
before choosing to restore to that checkpoint.

## Audit

Checkpoint create/restore are part of the `audit_events` `kind` enum
(`checkpoint_create`, `checkpoint_restore` — see
[`db/audit.ts`](../services/orchestrator/src/db/audit.ts) and `schema.sql`).
The audit emission for these is wired by the server layer, not by
`checkpoints.ts` itself.

## Failure modes (degrade gracefully)

If `git` isn't installed, `git init` fails and `ensureShadow` returns null —
checkpoints become a no-op (`null` / empty list) and the rest of the system
keeps working. Restore returns a clear "checkpoints unavailable (git not
installed?)" error in that case.
