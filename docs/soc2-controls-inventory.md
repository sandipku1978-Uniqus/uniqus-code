# SOC 2 Controls Inventory — Uniqus Code

**Document type:** Internal security process documentation
**Status:** Pre-audit self-assessment (Type I readiness)
**Last reviewed:** 2026-07-05
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
  (`app.gate15.dev`, production = `main` branch).
- **`services/orchestrator`** — the control-plane API on Hetzner
  (`api.gate15.dev`), which owns auth, secrets, the VM fleet, connectors,
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
| CC6.1 | Project secrets stored encrypted, never exposed to the VM/agent | `project_secrets.encrypted_value` (`services/orchestrator/src/db/schema.sql` ~263–296); decrypted server-side only; connectors pass ephemeral handles, never plaintext, to the agent loop | Implemented |
| CC6.1 | Per-tenant authorization on data access | Routes resolve through `getProjectForUser(id, userId, minRole)` and the effective `project_members`/`org_members` role. `owner_id` is authoritative only for personal projects and is ignored for organization projects (`services/orchestrator/src/db/projects.ts`, `db/members.ts`). Database tables have RLS enabled (`schema.sql`) | Implemented |
| CC6.1 | Tenant isolation of compute | One Firecracker microVM per project + per-project sandbox directories (`services/orchestrator/src/firecracker/fleet.ts`). VMs share the `fcbr0` bridge, but VM↔VM traffic is dropped at L3 via `br_netfilter` + an `fcbr0→fcbr0` DROP rule (`infra/firecracker/host-setup.sh`; re-asserted at runtime by `fleet.ts` `ensureVmIsolation`) | Implemented in code (P0.3) — requires `host-setup.sh` re-run + host validation that a peer-IP connection fails |
| CC6.6 | Restrict outbound egress (anti-SSRF) | `services/orchestrator/src/connectors/ssrfGuard.ts` blocks private/loopback/link-local/CGNAT/multicast/fleet-bridge ranges (IPv4 **and** IPv6, reasoning over raw bytes to defeat alternate spellings), re-validates **every** redirect hop, and strips credential headers on cross-origin redirects. HTTP connector secrets additionally require an owner/admin-managed exact-host binding stored outside model input | Implemented |
| CC6.6 | Restrict inbound access to the in-VM agent | The sandbox-agent on `0.0.0.0:51000` requires a per-VM bearer token on every non-`/health` request, validated in constant time (`services/sandbox-agent/src/main.rs` ~290–311; `src/agent.mjs` ~190–197). Enforcement is **mandatory** — hard-coded on at boot (`fleet.ts` `AGENT_AUTH_ENFORCED`), re-provisioned + enforced on golden-snapshot clones via `/net/configure`. Combined with the L2 isolation above (CC6.1), a peer VM can neither route to nor authenticate against another tenant's agent | Implemented (P0.1/P0.2/P0.3) |
| CC6.7 | Protect data in transit | TLS 1.3 on the public application and API domains: `app.gate15.dev` (Vercel) and `api.gate15.dev` (Hetzner); user previews use the separate TLS origin `preview.gate15.app` | Implemented |
| CC6.7 | Scope preview access to authorized holders | 128-bit unguessable capability `serverId`; preview cookie is `HttpOnly; Secure; SameSite=None; Max-Age=3600` (`services/orchestrator/src/proxy.ts` ~78–86) | Implemented |
| CC6.1/6.3 | Role-based access control for shared projects/orgs | `project_members` / `org_members` tables (`owner`/`admin`/`editor`/`viewer`, `schema.sql` ~589–611). Every membership route resolves the caller's effective role via `getProjectRole`/`getProjectForUser` before acting, with a privilege-escalation guard (a member can never grant a role above their own) (`services/orchestrator/src/collabRoutes.ts`, `services/orchestrator/src/db/members.ts`) | Implemented |
| CC6.1/6.3 | SSO, SAML, SCIM provisioning/deprovisioning | No SAML/SSO/SCIM backend. Authentication is WorkOS AuthKit (email/OAuth) plus guest accounts only; no enterprise identity-provider integration | **Gap (see §3)** |

### CC7 — System operations (monitoring, logging, incident response)

| Criterion | Control objective | Current mechanism (file path) | Status |
|---|---|---|---|
| CC7.2 | Log security-relevant events | `audit_events` table (`schema.sql` ~337–360, kind check widened ~703–724) + `services/orchestrator/src/db/audit.ts`. Actively logs `secret_read` / `secret_write` / `secret_delete`, `connector_invoke` / `connector_invoke_error`, `checkpoint_create` / `checkpoint_restore`, `member_invite` / `member_remove` / `role_change`, `org_create` / `org_update`, `project_update`, `github_action`, `db_lifecycle`. `user_id` captured for these events; events are project-scoped (org-level events use `project_id: null`) | Partial |
| CC7.2 | Make audit trail reviewable | `GET /api/projects/:id/audit`, role-aware via `getProjectForUser(id, userId, "viewer")` before `listAudit` — any project member (not just the owner) can read it (`services/orchestrator/src/server.ts` ~1848–1858) | Partial — project-scoped only; no org-level view |
| CC7.2 | Log role/membership changes | `member_invite` / `member_remove` / `role_change` events are recorded on both project- and org-membership routes (`services/orchestrator/src/collabRoutes.ts`) | Implemented |
| CC7.2 | Log authentication, plan, and deploy events | Not logged. The `AuditKind` enum already reserves `login`/`logout`/`deploy`/`project_create`/`project_delete`/`preview_share` values (`services/orchestrator/src/db/audit.ts`) but no call site emits them yet; there is also no org-level audit view | **Gap (see §3)** |
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

### P0 — Cross-tenant sandbox-agent isolation (remediated in code; needs host validation)

The original critical was a sandbox-agent that listened on `0.0.0.0:51000`
**without authentication** while **all project VMs shared one L2 bridge** — any
VM that could address a peer's bridge IP could drive that peer's agent RPC
(cross-tenant RCE). Both required defenses are now implemented in code:

1. **Per-VM authentication (Implemented — P0.1/P0.2).** The orchestrator mints a
   deterministic per-project bearer token and the in-VM agent requires it on
   every non-`/health` request, validated in constant time. Enforcement is
   **mandatory** (hard-coded on, not a dark-launch env gate) and is
   re-provisioned + enforced on golden-snapshot clones via `/net/configure`
   (closing the old C-13 caveat). Surfaced on `/health` as `agentAuthEnforced`.
2. **L2 network isolation (Implemented — P0.3).** `br_netfilter` +
   `bridge-nf-call-iptables=1` route bridged frames through iptables, and an
   `fcbr0→fcbr0` DROP rule severs all VM↔VM traffic while leaving VM→gateway and
   VM→internet egress intact. Installed by `host-setup.sh` and re-asserted at
   runtime by `fleet.ts` `ensureVmIsolation`.

**Remaining before a SOC 2 auditor / pentest:** deploy (re-run `host-setup.sh`
on each host so the isolation rules + `br_netfilter` sysctl are present) and
**validate on the host** that a connection from inside VM A to VM B's
`172.16.x.y:51000` fails while egress + the metadata block still work.

Defense-in-depth, still in place: the SSRF guard blocks the orchestrator (and
connectors) from reaching `172.16.x.y:51000`, and now pins connect-time IPs to
close the DNS-rebind TOCTOU (P0.4).

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

Role/permission-change events (`member_invite`, `member_remove`, `role_change`)
are already logged. Still missing: `login`, `plan_create`/`plan_execute`, and
`deploy` events (the `AuditKind` values exist but nothing emits them yet), and
an **org-level** audit view (currently project-scoped only). Required to make
CC7.2 more than Partial.

### P5 — Sub-processor register

Publish and maintain the register in §4 (name, purpose, data shared) and a
process for notifying customers of changes.

### P6 — Vulnerability management & third-party pentest

Establish dependency scanning + a remediation SLA, then commission an
independent penetration test. **Do P0 first** — pentesting the current
sandbox-agent would only re-confirm a known critical.

### P7 — SSO / SAML / SCIM

Project/org membership and role-based authorization (`owner`/`admin`/`editor`/
`viewer`) already ship in code (§2, CC6.1/6.3). What remains is enterprise
identity: SSO/SAML and SCIM provisioning/deprovisioning on top of WorkOS
AuthKit. Closes the last piece of the CC6 access-control gap.

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
| Anthropic | Coding-agent LLM inference (default / terminal-fallback provider, always configured) | Prompts, project code/context sent in the turn, agent outputs |
| Z.ai | LLM inference when a user selects a GLM model (or Auto routes a turn to it) | Prompts, project code/context for that turn, outputs |
| OpenAI | LLM inference when a user selects an OpenAI model | Prompts, project code/context for that turn, outputs |
| Google | LLM inference when a user selects a Gemini model | Prompts, project code/context for that turn, outputs |
| Vercel | Front-end hosting (`gate15.dev` and `app.gate15.dev`) | Web traffic, request metadata for the marketing site and web app |
| Hetzner | Orchestrator + Firecracker fleet hosting (`api.gate15.dev` and `preview.gate15.app`) | All control-plane data at the infrastructure layer (encrypted secrets at rest, project files in VMs) |
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
- **The former P0 critical is remediated in code, not yet host-validated** —
  the sandbox-agent now requires mandatory per-VM bearer auth and VM↔VM bridge
  traffic is dropped (§3, P0). The platform should not represent its tenant
  isolation as independently verified until the isolation rules are deployed to
  every host and a peer-to-peer reachability test is run there.
- **No SSO/SAML/SCIM.** Project/org membership with role-based access
  (`owner`/`admin`/`editor`/`viewer`) does exist in code (§2, CC6.1/6.3), but
  there is no enterprise identity-provider integration (SSO/SAML) or
  automated user provisioning/deprovisioning (SCIM). Any marketing implying
  enterprise SSO/SCIM is ahead of the implementation.
- **No data-retention/purge policy** is enforced; data persists for the life of
  the account and is removed only by cascade on deletion.
- **No monitoring/alerting and no incident-response runbook** are in place.
- **The sub-processor register (§4) is not yet published** to customers.
- We make **no claim about the sub-processors' own controls** beyond identifying
  them; their compliance posture is their own.

This document should be revised as remediation items in §3 ship, and re-baselined
before any external SOC 2 examination begins.
