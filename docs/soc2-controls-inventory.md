# SOC 2 Controls Inventory — Uniqus Code

**Document type:** Internal security process documentation
**Status:** Pre-audit self-assessment (Type I readiness)
**Last reviewed:** 2026-06-09
**Owner:** Engineering / Security

---

## 1. Purpose & scope

This document is an internal **controls inventory**. It maps the security
mechanisms that already exist in the Uniqus Code codebase to the AICPA SOC 2
Trust Services Criteria (the Common Criteria, CC1–CC8), and it lists, honestly,
the gaps that remain before the platform could credibly enter a SOC 2 Type I
examination.

**This is a self-assessment, not a compliance claim.** Uniqus Code is **not**
SOC 2 certified, has not completed a Type I or Type II examination, has not
engaged an auditor, and has not had an independent penetration test. Nothing in
this document should be read, quoted, or marketed as a certification, an
attestation, or a statement that any control is operating effectively over a
period of time. Where a control is marked *Implemented*, that means the
mechanism exists in code today — it does **not** mean an auditor has tested it.

Scope of the system under assessment:

- **`apps/web`** — the Next.js front end, deployed to Vercel
  (`app.uniqus-code.com`, production = `main` branch).
- **`services/orchestrator`** — the control-plane API on Hetzner
  (`api2.uniqus-code.com`), which owns auth, secrets, the VM fleet, connectors,
  and the audit log.
- **`services/sandbox-agent`** — the in-VM agent running inside each project's
  Firecracker microVM.
- The Postgres/Supabase database that backs the orchestrator.

Out of scope for this revision: customer end-user applications built *with*
Uniqus Code (those are the customer's own systems), and the sub-processors'
internal controls (covered only by reference; see §4).

---

## 2. Common Criteria → existing mechanisms

Status legend: **Implemented** = mechanism exists and is the primary control
for the objective. **Partial** = a mechanism exists but does not fully cover
the objective. **Gap** = no implemented control today.

### CC6 — Logical & physical access controls

| Criterion | Control objective | Current mechanism (file path) | Status |
|---|---|---|---|
| CC6.1 | Secrets/credentials encrypted at rest | AES-256-GCM, random 12-byte IV, 16-byte auth tag, 256-bit key from `OAUTH_TOKEN_ENCRYPTION_KEY`. Layout `IV‖TAG‖CIPHERTEXT` base64. `services/orchestrator/src/auth/encrypt.ts` (`encryptToken`/`decryptToken`) | Implemented |
| CC6.1 | Project secrets stored encrypted, never exposed to the VM/agent | `project_secrets.encrypted_value` (`services/orchestrator/src/db/schema.sql` ~258–309); decrypted server-side only; connectors pass ephemeral handles, never plaintext, to the agent loop | Implemented |
| CC6.1 | Per-tenant authorization on data access | Every project route resolves through `getProject(id, ownerId)`, which filters `.eq("owner_id", ownerId)` (`services/orchestrator/src/db/projects.ts` ~105–114). Database tables have RLS enabled (`schema.sql`) | Implemented |
| CC6.1 | Tenant isolation of compute | One Firecracker microVM per project + per-project sandbox directories (`services/orchestrator/src/firecracker/fleet.ts`) | Partial — VMs are separate but share one L2 bridge (see CC6.6 / P0) |
| CC6.6 | Restrict outbound egress (anti-SSRF) | `services/orchestrator/src/connectors/ssrfGuard.ts` blocks private/loopback/link-local/CGNAT/multicast/fleet-bridge ranges (IPv4 **and** IPv6, reasoning over raw bytes to defeat alternate spellings), re-validates **every** redirect hop, and strips credential headers on cross-origin redirects. `http` connector additionally requires `allowed_secret_hosts` | Implemented |
| CC6.6 | Restrict inbound access to the in-VM agent | The sandbox-agent binds `0.0.0.0:51000` with **no authentication** (`services/sandbox-agent/src/main.rs` ~79; `src/agent.mjs` ~146), and all VMs share one bridge | **Gap (P0 — see §3)** |
| CC6.7 | Protect data in transit | TLS 1.3 on both public domains: `app.uniqus-code.com` (Vercel) and `api2.uniqus-code.com` (Hetzner) | Implemented |
| CC6.7 | Scope preview access to authorized holders | 128-bit unguessable capability `serverId`; preview cookie is `HttpOnly; Secure; SameSite=None; Max-Age=3600` (`services/orchestrator/src/proxy.ts` ~53–61) | Implemented |
| CC6.1/6.3 | Role-based access control, SSO, provisioning/deprovisioning | No `members`/`roles` tables; no SAML/SSO/SCIM backend. Access is single-owner per project | **Gap (see §3)** |

### CC7 — System operations (monitoring, logging, incident response)

| Criterion | Control objective | Current mechanism (file path) | Status |
|---|---|---|---|
| CC7.2 | Log security-relevant events | `audit_events` table (`schema.sql` ~315–334) + `services/orchestrator/src/db/audit.ts`. Logs `secret_read` / `secret_write` / `secret_delete`, `connector_invoke` / `connector_invoke_error`, `checkpoint_create` / `checkpoint_restore`. `user_id` captured for secret/connector events; events are project-scoped | Partial |
| CC7.2 | Make audit trail reviewable | `GET /api/projects/:id/audit`, owner-scoped via `getProject` before `listAudit` (`services/orchestrator/src/server.ts` ~1262–1271) | Partial — project-scoped only; no org-level view |
| CC7.2 | Log authentication, authorization, plan, and deploy events | Not logged. The audit log does **not** record logins, plan generation/execution, deploys, or role changes; there is no org-level audit | **Gap (see §3)** |
| CC7.2 | Continuous monitoring & alerting | No monitoring, metrics-based alerting, or anomaly detection is configured | **Gap (see §3)** |
| CC7.3/7.4/7.5 | Incident detection, response, and recovery | No documented incident-response runbook, on-call rotation, or breach-notification procedure | **Gap (see §3)** |
| CC7.1 | Vulnerability detection & management | No vulnerability-management program, dependency-scanning policy, or third-party penetration test completed | **Gap (see §3)** |

### CC8 — Change management

| Criterion | Control objective | Current mechanism (file path) | Status |
|---|---|---|---|
| CC8.1 | Code changes are version-controlled and deployed through a defined pipeline | All code ships via git. Front end → Vercel (`main` = production); orchestrator → a `/deploy-hetzner` flow (SSH, `git pull`, conditional `npm ci`, conditional rootfs rebuild, service restart) | Partial |
| CC8.1 | Roll back unintended changes | Per-tool checkpoints write to a shadow git repo; `checkpoint_create` / `checkpoint_restore` give per-project rollback and are audit-logged | Implemented |
| CC8.1 | Mandatory review / segregation of duties on change | No enforced PR-review gate, branch protection, or approval requirement is documented as a control | **Gap (see §3)** |

### CC1–CC5 — Governance, risk, and control environment (brief notes)

These criteria concern organizational governance rather than code. They are
largely **process gaps** for a team of this size and are noted here for
completeness; none should be read as implemented.

| Criterion | Objective | Current state |
|---|---|---|
| CC1 | Control environment — org structure, security ownership, code of conduct, background checks | Informal. No documented security charter or org chart. **Gap.** |
| CC2 | Communication & information — internal/external security communication, policies published | Engineering notes (`CLAUDE.md`, `docs/`) exist; no formal security policy set. **Partial.** |
| CC3 | Risk assessment — documented, periodic risk assessment | This inventory + prior security audits are the closest artifact; not yet a recurring program. **Partial.** |
| CC4 | Monitoring of controls — internal control testing / self-review cadence | Ad hoc security reviews only; no scheduled control testing. **Gap.** |
| CC5 | Control activities — policies & procedures that enforce the above | Technical controls exist (§CC6/§CC8); written policies do not. **Partial.** |

---

## 3. Prioritized remediation roadmap

Ordered by severity and by what blocks an external audit/pentest.

### P0 — Unremediated critical: unauthenticated in-VM sandbox-agent (blocker)

The sandbox-agent listens on `0.0.0.0:51000` with **no authentication**
(`services/sandbox-agent/src/main.rs`, `src/agent.mjs`), and **all project VMs
share one L2 bridge**. Any VM that can address a peer's bridge IP can drive that
peer's agent RPC — arbitrary file read/write and command execution inside
another tenant's microVM. This is a cross-tenant remote-code-execution risk and
it directly contradicts the CC6 isolation objective.

**Required remediation (hard prerequisite before engaging a SOC 2 auditor or
commissioning a pentest):**

1. A per-VM authentication token (minted by the orchestrator per project,
   required on every agent RPC, rejected if absent/mismatched), **and**
2. L2 network isolation so VMs cannot reach each other's bridge IP at all
   (e.g. per-VM tap with no peer routing, or per-project network namespace).

Defense-in-depth, not a substitute: the SSRF guard already blocks the
orchestrator from reaching `172.16.x.y:51000`, but that does not stop VM↔VM
traffic on the shared bridge.

### P1 — Data retention & purge

Today there is **no** time-based retention or purge job. Data lives for the life
of the project/account and is only removed by hard delete via `ON DELETE
CASCADE` when a project/account is deleted. Define retention windows (audit
events, logs, checkpoints, secrets) and implement a scheduled purge.

### P2 — Monitoring & alerting

Stand up metrics + alerting (error rates, auth failures, egress denials,
agent-RPC anomalies) with paging. Required for CC7.2/CC7.4.

### P3 — Incident-response runbook

Document detection → triage → containment → eradication → recovery →
notification, with roles and a breach-notification SLA. Required for
CC7.3–CC7.5.

### P4 — Expand the audit log

Add `login`, `plan_create`/`plan_execute`, `deploy`, and role/permission-change
events, and add an **org-level** audit view (currently project-scoped only).
Required to make CC7.2 more than Partial.

### P5 — Sub-processor register

Publish and maintain the register in §4 (name, purpose, data shared) and a
process for notifying customers of changes.

### P6 — Vulnerability management & third-party pentest

Establish dependency scanning + a remediation SLA, then commission an
independent penetration test. **Do P0 first** — pentesting the current
sandbox-agent would only re-confirm a known critical.

### P7 — SSO / SAML / SCIM / RBAC backend

Introduce `members`/`roles` tables, role-based authorization, SSO/SAML, and SCIM
provisioning/deprovisioning. Closes the CC6 access-control gap and aligns the
product with its marketing.

### P8 — Change-management hardening

Enforce branch protection, required reviews, and documented approval as control
activities, to lift CC8.1 from Partial.

---

## 4. Sub-processor register

These third parties process or store Uniqus Code customer data. This register
is **not yet formally published** (see §3, P5); it is reproduced here for
internal tracking.

| Sub-processor | Purpose | Data shared |
|---|---|---|
| Anthropic | Coding-agent LLM inference (default provider) | Prompts, project code/context sent in the turn, agent outputs |
| OpenAI | LLM inference when a user selects an OpenAI model | Prompts, project code/context for that turn, outputs |
| Google | LLM inference when a user selects a Gemini model | Prompts, project code/context for that turn, outputs |
| Vercel | Front-end hosting (`app.uniqus-code.com`) | Web traffic, request metadata for the web app |
| Hetzner | Orchestrator + Firecracker fleet hosting (`api2.uniqus-code.com`) | All control-plane data at the infrastructure layer (encrypted secrets at rest, project files in VMs) |
| Supabase | Managed Postgres for the orchestrator | Project metadata, messages, encrypted secrets, audit/usage events |
| WorkOS | Authentication | User identity / auth profile data |

Customer prompts and code are sent to whichever LLM provider the user selects
for a given turn; only one provider receives a given turn's content.

---

## 5. What we are NOT claiming

To keep this assessment honest, the following are explicitly **out of scope as
claims**:

- **Not certified.** Uniqus Code has no SOC 2 Type I or Type II report. No
  auditor has been engaged. "Implemented" in §2 means the mechanism exists in
  code, not that it has been independently tested or is operating effectively
  over a period.
- **No completed penetration test** and **no vulnerability-management program**
  exist today.
- **A known critical is unremediated** — the unauthenticated sandbox-agent on a
  shared bridge (§3, P0). The platform should not represent its tenant
  isolation as complete until P0 ships.
- **No SSO/SAML/SCIM/RBAC** backend exists. Any marketing implying enterprise
  access controls is ahead of the implementation.
- **No data-retention/purge policy** is enforced; data persists for the life of
  the account and is removed only by cascade on deletion.
- **No monitoring/alerting and no incident-response runbook** are in place.
- **The sub-processor register (§4) is not yet published** to customers.
- We make **no claim about the sub-processors' own controls** beyond identifying
  them; their compliance posture is their own.

This document should be revised as remediation items in §3 ship, and re-baselined
before any external SOC 2 examination begins.
