---
name: verify-push
description: Run the Gate 15 verify-and-push workflow. Use when the user asks for the Codex equivalent of /verify-push, to verify the monorepo, update changelog when needed, and push the current branch.
---

# Verify Push

This is the Codex-native equivalent of `.claude/commands/verify-push.md`.

Before acting, read `.claude/commands/verify-push.md` completely and follow that workflow exactly. In particular:

1. Run `npm run typecheck` from the repo root.
2. Stop on typecheck failure and report the failing workspace plus the first error block.
3. Check commits about to be pushed with `git log @{u}..HEAD`.
4. If user-facing commits need a changelog entry, update `apps/web/app/(marketing)/changelog/page.tsx` before pushing.
5. If there are uncommitted changes, ask whether to commit them first and with what message. Do not auto-commit.
6. Push the current branch only after verification and any required user decision.
7. Report the branch, number of commits pushed, and latest commit SHA plus subject.

Do not force-push. If the push is rejected, surface the error and suggest `git pull --rebase`.
