---
description: Run typecheck across the monorepo, then push current branch to origin
---

Verify the codebase builds cleanly, then push to git.

1. Run `npm run typecheck` from the repo root (this fans out to every workspace via turbo).
   - If it fails, **STOP** — show the failing workspace and the first error block, do not push.
2. Run `git status` and `git log @{u}..HEAD --oneline` to see what's about to be pushed.
3. If there are uncommitted changes, ask the user whether to commit them first (and with what message) or skip and only push existing commits. Do **not** auto-commit.
4. Run `git push` for the current branch. Report:
   - branch name
   - number of commits pushed
   - latest commit SHA + subject
5. If the push is rejected (e.g. behind remote), surface the error and suggest `git pull --rebase`. Do not force-push.
