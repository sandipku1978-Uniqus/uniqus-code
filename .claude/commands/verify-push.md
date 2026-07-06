---
description: Run typecheck across the monorepo, then push current branch to origin
---

Verify the codebase builds cleanly, then push to git.

1. Run `npm run typecheck` from the repo root (this fans out to every workspace via turbo).
   - If it fails, **STOP** — show the failing workspace and the first error block, do not push.
2. Check whether the commits about to be pushed (`git log @{u}..HEAD`) touch anything user-facing (features, fixes, UX changes — not pure internal refactors/infra/docs). If so, check whether [apps/web/app/(marketing)/changelog/page.tsx](apps/web/app/(marketing)/changelog/page.tsx) already reflects them.
   - If it doesn't, add a new entry: bump the version (entries are ordered oldest→newest in the `ENTRIES` array and reversed for display; the product is pre-v1, so stay below v1.0 — e.g. v0.17 → v0.18), use the real current date, and write plain-English bullets tagged `new`/`improved`/`fixed` in the existing voice (no internal codenames, infra jargon, or commit hashes). Do this **before** pushing, as part of the same push if there are uncommitted changes.
   - Skip this step only for changes with no user-visible effect (pure refactors, internal docs, CI/tooling).
3. Run `git status` and `git log @{u}..HEAD --oneline` to see what's about to be pushed.
4. If there are uncommitted changes (including a changelog update from step 2), ask the user whether to commit them first (and with what message) or skip and only push existing commits. Do **not** auto-commit.
5. Run `git push` for the current branch. Report:
   - branch name
   - number of commits pushed
   - latest commit SHA + subject
6. If the push is rejected (e.g. behind remote), surface the error and suggest `git pull --rebase`. Do not force-push.
