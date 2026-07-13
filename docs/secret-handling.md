# Secret handling

Per-project secrets: how they're encrypted, scoped, kept away from the model,
and audited. Code-grounded in
[`db/secrets.ts`](../services/orchestrator/src/db/secrets.ts),
[`auth/encrypt.ts`](../services/orchestrator/src/auth/encrypt.ts),
[`db/audit.ts`](../services/orchestrator/src/db/audit.ts), and the
`project_secrets` table in
[`db/schema.sql`](../services/orchestrator/src/db/schema.sql).

## Encryption at rest (AES-256-GCM)

Secret values are encrypted with **AES-256-GCM** before they touch the
database (`auth/encrypt.ts`):

- 256-bit key from `OAUTH_TOKEN_ENCRYPTION_KEY` (or the legacy
  `GITHUB_TOKEN_ENCRYPTION_KEY`), accepted as 64 hex chars or base64, and must
  decode to exactly 32 bytes.
- Per-value random 12-byte IV (NIST SP 800-38D), 16-byte GCM auth tag.
- On-disk layout (base64): `IV (12) || TAG (16) || CIPHERTEXT`.
- The **same key** wraps every third-party OAuth token (GitHub, Vercel,
  Supabase, Figma), the guest recovery codes, and bring-your-own-key provider
  API keys (Anthropic/OpenAI/Google, in `account_provider_keys`) — one env
  var, one blast radius. `encrypt.ts` documents this tradeoff and leaves room
  to split per-provider keys later.

`upsertSecret` calls `encryptToken` before the row is written;
`getSecretValue` calls `decryptToken` on read. **The DB (Supabase/Postgres)
never sees plaintext** — `project_secrets.encrypted_value` is ciphertext. A
decryption failure (e.g. the key was rotated) surfaces a clear
"could not be decrypted (key changed?)" error rather than silently returning
garbage.

## Per-environment scoping

The same secret *name* can hold different values per environment
(`STRIPE_API_KEY` in `production` vs `development`):

- Uniqueness is `(project_id, name, env)` — see the constraint migration in
  `schema.sql`.
- `normalizeEnv` lowercases and validates env names against
  `^[a-z0-9][a-z0-9_-]{0,31}$`, so you can't end up with `Production` vs
  `production` duplicates. Invalid names throw.
- The conventional envs are `default` / `development` / `staging` /
  `production`, but any name matching the regex is allowed.
- `DEFAULT_ENV = "default"` is used when a caller passes nothing. Every legacy
  row was migrated to `default`, so single-env projects keep working unchanged.
- `listSecrets(projectId, env)` filters to one env by default; pass `env=null`
  explicitly to list across all envs.

## Sensitive values are never returned to the model

- `getSecretValue` / `getProjectSecretsAsEnv` return the decrypted plaintext
  **only to server-side callers** — the connector registry and the deploy
  pipeline (which syncs the project's stored secrets into the Vercel deploy env;
  see `deploy.ts`). It is wired into the connector `ctx.secret(name)` helper,
  which uses the value to build the outbound request and returns only the
  request *result* to the agent. See
  [`docs/connector-security.md`](./connector-security.md).
- `listSecrets` and the `SecretRecord` shape expose only metadata — `id`,
  `name`, `env`, `description`, exact HTTP destination bindings, timestamps.
  **There is no `value` field** in the record returned to API/UI callers.
- The agent passes sensitive secret **names**, never values, and never receives
  privileged plaintext in its context. The narrow public-config exception is
  the Supabase connector's `SUPABASE_URL` + `SUPABASE_ANON_KEY`; they are stored
  here for deploy injection but deliberately returned so generated clients can
  be configured. See the explicit policy in `security/projectSecretPolicy.ts`.

## Audit trail

Every secret mutation and access is logged to `audit_events` (`db/audit.ts`,
best-effort — an audit write failure logs but never throws, so it can't fail
the underlying request). Relevant `AuditKind`s:

- `secret_read` — written when a connector resolves a secret, with
  `metadata.via_connector` attributing it to the triggering method.
- `secret_write` / `secret_delete` — for create/update and delete (the
  schema's `kind` CHECK enumerates these).

Each row carries `project_id`, `user_id` (the acting user, or null for a
future scheduled runner), `target` (the secret name), and optional `metadata`.
Query with `listAudit(projectId)`. Rows cascade-delete with their project/user.

## Operational notes

- `OAUTH_TOKEN_ENCRYPTION_KEY` is required on the orchestrator to store/read
  any secret or OAuth token. Generate with:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- **Key rotation is not automated.** Because the same key encrypts existing
  ciphertext, rotating `OAUTH_TOKEN_ENCRYPTION_KEY` makes all previously stored
  secrets/tokens undecryptable until re-entered. There is no migration/
  re-encrypt path in the code today — treat rotation as "users re-add their
  secrets."
