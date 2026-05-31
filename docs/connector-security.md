# Connector security

First-party connectors let the agent reach external systems (Slack, Postgres,
GitHub, arbitrary HTTP) **without ever holding the credential** in its context.
Code-grounded in
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
| GitHub | `github` | `list_issues`, `get_issue`, `list_pulls` | `GITHUB_TOKEN` |

`http.ts` is the escape hatch for systems without a native binding: the agent
calls `http.request` instead of raw `fetch` so the call stays audited and the
credential never enters the agent context. Phase-3 will add the remaining
Plan §5 connectors (Salesforce, HubSpot, Snowflake, Notion, …) into the same
registry without changing the contract.

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
- If a named secret isn't configured, `ctx.secret` throws a clear
  "Secret '<name>' is not configured for this project" — the agent learns the
  secret is missing, not its value.

See [`docs/secret-handling.md`](./secret-handling.md) for how the values are
encrypted at rest and scoped per environment.

## Audit logging of every invocation

`callConnector` (`index.ts`) writes `audit_events` rows (best-effort; an audit
failure never fails the user's request — see `db/audit.ts`). For one connector
call you get up to two kinds of rows:

- **`secret_read`** — emitted from inside `ctx.secret`, with
  `target` = the secret name and `metadata.via_connector =
  "<connector>.<method>"`, so each credential access is attributed to the call
  that triggered it.
- **`connector_invoke`** on success, or **`connector_invoke_error`** on
  failure (`metadata.error` = the error message), with `target =
  "<connector>.<method>"`.

Rows carry `project_id` and `user_id` (the acting web user, or null for a
future scheduled-job runner). They are tenant-scoped and queryable via
`listAudit(projectId)`. The `audit_events.kind` CHECK in
[`db/schema.sql`](../services/orchestrator/src/db/schema.sql) constrains the
allowed kinds.

## Built-in safety limits

The connectors apply their own guardrails so a tool call can't be abused into a
DoS or footgun:

- **HTTP:** scheme must be `http(s)://`; request timeout capped at 60s; the
  response body is truncated to ~32 KB so it can't balloon the agent context.
- **Slack:** `post_webhook` rejects any URL that isn't a real
  `https://hooks.slack.com/` webhook (a misused secret can't be exfiltrated to
  an arbitrary host through that method).
- **Postgres:** `row_limit` defaults to 200, capped at 5000; the method
  description steers the agent to parameterized queries (`$1`, `$2`) rather
  than string-concatenated SQL. (Note: the connector does not itself reject
  raw SQL — it runs whatever statement it's given against the resolved
  connection. SQL safety relies on the agent using `params`.)
- **GitHub:** `per_page` capped at 100; only read-shaped methods exist today
  (no create/push/merge — that's Phase-3, gated by a builder-tier permission
  when permissions land).
