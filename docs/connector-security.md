# Connector security

First-party connectors let the agent reach external systems (Slack, Postgres,
GitHub, Supabase, Stripe, arbitrary HTTP) **without ever holding the
credential** in its context. Code-grounded in
[`services/orchestrator/src/connectors/`](../services/orchestrator/src/connectors/).

## The connectors

A thin registry (`connectors/index.ts`, `REGISTRY`) the agent reaches via a
single `call_connector` tool. Each connector is one self-contained file
exposing a small set of methods with a JSON-Schema for their args:

| Connector | id | Methods | Default secret(s) |
| --- | --- | --- | --- |
| HTTP | `http` | `request` (GET/POST/PUT/PATCH/DELETE) | `auth_secret` (caller names it) |
| Slack | `slack` | `post_webhook`, `post_message` | webhook URL secret; `SLACK_BOT_TOKEN` |
| Postgres | `postgres` | `query` | `DATABASE_URL` |
| GitHub | `github` | `list_issues`, `get_issue`, `list_pulls`, `get_branch`, `create_branch`, `create_pull`, `list_pull_comments` | `GITHUB_TOKEN` |
| Supabase | `supabase` | `list_organizations`, `list_projects`, `provision_database`, `get_database`, `run_sql`, `get_schema` | the connected user's Supabase OAuth token (not a project secret); writes `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` / `DATABASE_URL` / `SUPABASE_DB_PASSWORD` as project secrets |
| Stripe | `stripe` | `create_checkout_session`, `create_customer`, `create_portal_session`, `retrieve`, `list` | `STRIPE_API_KEY` |

`http.ts` is the escape hatch for systems without a native binding: the agent
calls `http.request` instead of raw `fetch` so the call stays audited and the
credential never enters the agent context. Supabase (database provisioning +
SQL) and Stripe (checkout/customer/portal sessions) shipped in later phases on
the same registry contract; additional Plan §5 sources (Salesforce, Notion,
Airtable, …) plug in the same way — add a file, export a
`ConnectorDefinition`, register it in `REGISTRY`.

## Server-side secret resolution (names, not values)

This is the core security property: **the agent passes secret *names*, never
values.**

- A connector method receives a `ConnectorCtx` with a `secret(name)` helper
  (`index.ts`). When a method needs a credential it calls `ctx.secret("...")`,
  which resolves and decrypts the value **server-side** via
  `getSecretValue(projectId, name)` and uses it directly in the outbound
  request.
- The plaintext is used to build the request header / connection string inside
  the connector (`Authorization: Bearer <value>`, a Postgres `connectionString`,
  etc.) and is **never returned to the agent**. The agent only ever sees the
  method's *result* (e.g. the HTTP response body, the SQL rows).
- Examples, all in the connector files:
  - `http.request` takes `auth_secret` (a name) and sends the resolved value as
    a bearer/custom header; the agent supplies only the name.
  - `slack.post_message` resolves `SLACK_BOT_TOKEN` (or a caller-named secret)
    server-side.
  - `postgres.query` resolves the connection string from `DATABASE_URL`.
  - `github.*` resolve `GITHUB_TOKEN`.
  - `stripe.*` resolves `STRIPE_API_KEY` (or a caller-named secret via
    `api_key_secret`).
- If a named secret isn't configured, `ctx.secret` throws a clear
  "Secret '<name>' is not configured for this project" — the agent learns the
  secret is missing, not its value.
- **Supabase is the one exception to "secret by name":** its methods
  authenticate with the connected user's Supabase OAuth token (via
  `ctx.userId`, not `ctx.secret`), because provisioning a database is an
  account-level action. The keys it produces (service_role key, DB password)
  are still written straight to `project_secrets` and never returned to the
  agent — only the public URL + anon key come back in the result. Those exact
  two config names (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) are intentionally
  excluded from model redaction and routine legacy `.env` cleanup so the agent
  can wire the client (explicit deletion still removes stale assignments). This
  is an explicit allowlist, not a `NEXT_PUBLIC_*` convention;
  service-role/database/password values remain redacted and server-only.

See [`docs/secret-handling.md`](./secret-handling.md) for how the values are
encrypted at rest and scoped per environment.

## Audit logging of every invocation

`callConnector` (`index.ts`) writes `audit_events` rows (best-effort; an audit
failure never fails the user's request — see `db/audit.ts`). For one connector
call you get up to three kinds of rows:

- **`secret_read`** — emitted from inside `ctx.secret`, with
  `target` = the secret name and `metadata.via_connector =
  "<connector>.<method>"`, so each credential access is attributed to the call
  that triggered it.
- **`connector_invoke`** on success, or **`connector_invoke_error`** on
  failure (`metadata.error` = the error message), with `target =
  "<connector>.<method>"`.
- **`db_lifecycle`** — the one connector-specific kind: `supabase.run_sql`
  emits it whenever a destructive statement (`DROP`, `TRUNCATE`, `DELETE`,
  `ALTER ... DROP`, `REVOKE`) actually executes after the caller re-sends the
  query with `confirm:true` (see the destructive-SQL confirmation flow below),
  with `target = "run_sql:<OP>"` and `metadata.ref` set to the project ref —
  so every confirmed destructive operation against a linked database leaves
  its own record, on top of the `connector_invoke` row for the call itself.

Rows carry `project_id` and `user_id` (the acting web user, or null for a
future scheduled-job runner). They are tenant-scoped and queryable via
`listAudit(projectId)`. The `audit_events.kind` CHECK in
[`db/schema.sql`](../services/orchestrator/src/db/schema.sql) constrains the
allowed kinds.

## Built-in safety limits

The connectors apply their own guardrails so a tool call can't be abused into a
DoS or footgun:

- **HTTP:** scheme must be `http(s)://`, and the resolved address must be
  publicly routable — `ssrfGuard.ts`'s `assertPublicUrl`/`safeFetch` block
  private, loopback, link-local, CGNAT, multicast, and cloud-metadata
  (`169.254.169.254`) addresses, re-validate every redirect hop, and pin the
  connect-time IP against a fresh re-resolution to close a DNS-rebind window.
  When `auth_secret` is set, the destination must match an exact hostname bound
  to that secret by a project owner/admin in the Secrets pane. The model cannot
  create or widen this binding. No redirect is followed at all, so a 30x
  response can't bounce the credential to an attacker-controlled host. Request timeout capped at 60s; the response body
  is truncated to ~32 KB so it can't balloon the agent context.
- **Slack:** `post_webhook` rejects any URL that isn't a real
  `https://hooks.slack.com/` webhook (a misused secret can't be exfiltrated to
  an arbitrary host through that method).
- **Postgres:** the connection host is checked against the same
  private/loopback/metadata block-list as HTTP (`assertPublicHost`), so a
  stored `DATABASE_URL` can't be used to port-scan internal infrastructure;
  connect/statement/query are each time-bounded (10s connect, 30s
  statement/query) so an unresponsive host can't hang a turn; `row_limit`
  defaults to 200, capped at 5000; the method description steers the agent to
  parameterized queries (`$1`, `$2`) rather than string-concatenated SQL.
  (Note: the connector does not itself reject raw SQL — it runs whatever
  statement it's given against the resolved connection. SQL safety relies on
  the agent using `params`.)
- **GitHub:** `per_page` capped at 100; owner/repo/branch values are validated
  against a safe charset before being interpolated into the API URL (no `..`
  traversal). Read methods (`list_issues`, `get_issue`, `list_pulls`,
  `get_branch`) sit alongside a PR-workflow write path (`create_branch`,
  `create_pull`, `list_pull_comments`) that needs a token with `repo` scope;
  there's still no merge or delete method.
- **Stripe:** every call is pinned to the fixed host `api.stripe.com` and
  never follows a redirect (the API key is attached to the request), so a
  redirect response can't carry the key off-host.
- **Supabase:** destructive SQL (`DROP`, `TRUNCATE`, `DELETE`,
  `ALTER ... DROP`, `REVOKE`) is blocked by default — `run_sql` returns an
  impact preview (e.g. the row count that would be affected) instead of
  executing, and only runs once the caller re-sends the same query with
  `confirm:true`. A `project_ref` is validated as exactly 20 lowercase
  alphanumeric characters before it's interpolated into a Management-API
  path, so it can't be used to traverse to another project's endpoints or
  access another user's database.
