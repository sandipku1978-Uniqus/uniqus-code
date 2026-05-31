# GitHub import & sync

Importing source into a new project, by zip upload or GitHub clone.
Code-grounded in
[`services/orchestrator/src/import.ts`](../services/orchestrator/src/import.ts),
the OAuth flow in
[`services/orchestrator/src/github.ts`](../services/orchestrator/src/github.ts),
and the import handler + `validateCloneUrl` in
[`services/orchestrator/src/server.ts`](../services/orchestrator/src/server.ts).

## OAuth scope

GitHub OAuth (`github.ts`) requests scope **`repo read:user`**:

- `repo` (read/write on the API, but we only *use* it to clone) is enough to
  clone any repo the user can see, including private org repos that approved
  the OAuth app.
- `read:user` lets us show "Connected as @octocat".
- Write scopes (`write:repo_hook`, etc.) are **deliberately not requested** —
  Phase-3 territory.

The token is exchanged server-side, stored **AES-256-GCM encrypted** (same key
as project secrets — see [`docs/secret-handling.md`](./secret-handling.md)),
and the plaintext is never logged. The flow uses a sealed, short-lived
(10-min) state cookie, a constant-time state compare, re-authenticates the user
at the callback (the state cookie's `userId` must match the current session),
and sanitizes the `return` URL against the WEB_ORIGIN allowlist to prevent open
redirects. A revoked token (401 from GitHub) is cleared on our side so the UI
re-prompts for reconnection.

## Two import paths and their safeguards

### Zip upload (`importZip`)

- Refuses to extract into a **non-empty** destination (imports require a fresh
  project).
- **Zip-bomb / oversize guards:** rejects archives whose uncompressed total
  exceeds `MAX_TOTAL_SIZE` (200 MB) or any single entry over `MAX_FILE_SIZE`
  (50 MB), checked from the headers before extracting.
- **Path-traversal guard:** entries that resolve outside the destination
  (`..`) are skipped.
- Skips top-level `.git`, `node_modules`, `.next`, `dist`, `build`
  (`SKIP_TOP_DIRS`).
- Detects the GitHub-style single-root folder (`my-repo-main/…`) and strips it
  so files land directly in the project root (`stripped_root` is reported).

### GitHub clone (`importGithub`)

- **SSRF / local-file guard:** `validateCloneUrl` (server.ts) rejects anything
  that isn't `https://` **before** the project is created — no `file://`, no
  arbitrary scheme, hostname required. https-only also means PAT injection
  (which only runs for https URLs) covers every path that reaches `git clone`.
- **Shallow clone:** `git clone --depth 1`, optionally `--branch <branch>`.
- **Auth:** a PAT (or the resolved OAuth token) is injected as
  `https://x-access-token:<token>@github.com/…`; it is scrubbed from any error
  output (`x-access-token:***@`) and never logged.
- **Oversize guard:** after clone, the tree is walked; if it exceeds
  `MAX_CLONE_SIZE` (500 MB) the import **throws** and the caller rolls back the
  project (`rollbackImport`), so a giant repo can't fill the host disk.
- `.git/` is **removed after clone** — the user gets the source tree, not the
  history. (Re-introducing git tracking is noted as the Phase-3
  bidirectional-sync work.)
- If `git` is missing on the orchestrator host, the error tells the operator to
  add it to the build image rather than surfacing a raw `spawn git ENOENT`.

## Branch selection

The import API (`POST /api/projects/import-github`) accepts an optional
`branch`, passed straight to `git clone --branch`. When omitted, the clone uses
the repo's default branch. The repo picker surfaces each repo's
`default_branch` (from `listUserRepos`). Note the **clone branch and the
linked branch are tracked separately**: cloning checks out `branch`, while the
project's `linked_branch` column (schema.sql) records the branch the project is
associated with for the All Projects view.

## What's persisted

- The cloned/extracted tree is written into the project sandbox and pushed to
  Storage (`getTracker(...).syncChanges()`) so other sessions hydrate from it.
- With `link_repo: true`, the project is linked to the source repo:
  `setGithubRepo` records `github_repo_url` and `github_repo_full_name`
  (resolved from the OAuth picker's `repo_full_name` or parsed from the URL via
  `parseGithubFullName`). Linking is **best-effort** — a link failure does not
  fail the import, since the clone already succeeded.
- The import response returns `{ files_imported, total_bytes, stripped_root }`.

The DB columns involved (`schema.sql`): `projects.github_repo_url`,
`github_repo_full_name`, `linked_branch`. A separate "Create GitHub repo"
action (`createUserRepo` in `github.ts`) creates a fresh **private** repo and
links it the same way.

## Current limitations

- **Not PR-native and not bidirectional.** Import is a one-time clone; `.git`
  is discarded. There is no pull/push-back, no branch tracking against the
  remote, and no PR creation/merge flow yet — all Phase-3
  ("GitHub bidirectional sync"), explicitly called out in `import.ts` and
  `github.ts`.
- **Read-only OAuth in practice.** Even though `repo` scope is granted, no code
  path writes to the imported repo today.
- **SSH clone URLs ignore the PAT** (`git@github.com:…`) — only `https://`
  clones authenticate; SSH would need host SSH-key setup, which isn't wired.
