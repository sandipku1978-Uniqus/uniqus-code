# Gate 15 comprehensive security audit

**Audit date:** 2026-07-14  
**Repository:** `C:\Users\Aarav\Desktop\uniqus-projects\uniqus-code`  
**Audited revision:** `bd5fd40aa64ab3927568688a0baca7e935f3f01c` (`main`)  
**Assessment type:** Authorized, non-destructive source, configuration, dependency, AI-agent, and infrastructure review  
**Report status:** Final source-audit report; production configuration and live-environment claims remain explicitly unverified

## Audit orientation

- **Repository areas found:** `apps/web`, `services/orchestrator`, `services/sandbox-agent`, `infra/firecracker`, `packages/*`, root workspace/build configuration, package locks, and local coding-agent configuration.
- **Technologies/frameworks:** Next.js 15/React, Node.js/TypeScript HTTP and WebSockets, WorkOS AuthKit and iron-session, Supabase/PostgreSQL/Storage, Anthropic/OpenAI/Google/Z.ai integrations, Playwright/browser automation, Firecracker/KVM, a Rust/Node sandbox agent, npm/Turbo/Vitest, Cargo, Alpine, and Vercel deployment.
- **Security-sensitive components:** authentication and guest sessions; project/org authorization; BYOK and project-secret encryption; OAuth/connectors; uploads/import/storage; AI prompt/tool permissions; preview/browser control; model/VM admission and quotas; Firecracker networking/snapshots/agent authentication; privileged host/rootfs supply chain.
- **Unavailable environments/files:** no live target, production/cloud credentials, Supabase/Vercel/Cloudflare dashboards, Hetzner host, production database grants, bucket policies, edge headers, firewall state, backups, runtime logs, or tracked production systemd unit. Environment values were not exposed or copied.
- **Audit plan followed:** map architecture and trust boundaries; threat-model highest-risk paths; review the full tracked source/configuration; run non-destructive static, dependency, secret, schema, test, and targeted runtime checks; re-trace high-impact findings and compensating controls; then prioritize remediation and runtime validation.

## Executive summary

Gate 15 has several unusually strong security foundations for an AI coding platform: WorkOS sessions are validated server-side and bound to users, WebSocket origins and project membership are rechecked, OAuth return paths and state are constrained, browser and HTTP connectors contain substantial SSRF defenses, project secrets are encrypted and kept out of the model/VM path, preview origins are isolated from the authenticated application, and Firecracker roots are read-only with per-project data disks. Those controls prevented many common findings from becoming credible vulnerabilities.

The audit nevertheless identified **18 reportable issues: 11 High and 7 Medium**. No source-only finding is rated Critical. Two High findings could become Critical in a particular deployment or authorization policy:

1. A project editor can deploy all project secrets to a Vercel account/team they control. If editors are not intended to be secret trustees, this is a direct confidentiality boundary failure.
2. The BYOK table, `account_provider_keys`, is the only application table missing Row Level Security. Whether an external attacker can exploit it depends on the deployed Supabase Data API exposure and grants, which were not available for inspection.

The most urgent recurring theme is that the application-level permission model is stronger than several adjacent execution boundaries. Guest workloads can reach host/private-network destinations unless the production host supplies additional firewall controls; Firecracker is launched directly despite the jailer being installed; imported repositories can establish durable system-prompt instructions after import; browser mutation tools are classified as read-only; and sensitive files blocked by file APIs remain reachable through shell commands, rename operations, and persistence paths.

Availability and cost controls also need work before hostile public scale. Personal and guest accounts have no durable project, VM, session, or model-spend admission limits. Several endpoints and connectors buffer large inputs or responses in memory, the WebSocket server accepts 100 MiB messages by default, and guest ZIP imports can hold hundreds of megabytes before archive inspection. These are practical denial-of-service and cost-amplification paths, not merely theoretical hardening suggestions.

### Priority findings

| ID | Severity | Confidence / status | Finding | Primary impact |
|---|---:|---|---|---|
| F01 | High | Confirmed behavior; policy-dependent severity | Editors can deploy every project secret into their own Vercel target | Secret exfiltration, deployment compromise |
| F02 | High | Confirmed schema defect; runtime-dependent exploitability | `account_provider_keys` lacks RLS and row-bound encryption context | BYOK disclosure, tampering, cross-account key use |
| F03 | High | Confirmed control gap; host-dependent | Guest VM egress permits host and private-network reachability | Lateral movement, host-service access |
| F04 | High | Confirmed defense gap | Firecracker runs outside the installed jailer | Greater impact from hypervisor/device escape |
| F05 | High | Likely; feature-gated | Golden snapshot bootstrap sends a replacement bearer token over shared L2 | Cross-VM token interception or impersonation |
| F06 | High | Confirmed | Personal/guest workloads lack durable quotas and global admission controls | Unbounded spend and host exhaustion |
| F07 | High | Confirmed | Multiple request, connector, WebSocket, and serial-log memory sinks | Remote or guest-triggered denial of service |
| F08 | High | Likely exploit chain; deterministic trust-state flaw | Imported repositories can create trusted durable agent instructions after import | Persistent prompt injection and tool abuse |
| F09 | High | Confirmed classification flaw; model-dependent exploitation | Arbitrary browser egress and mutations are treated as read-only | Data egress and public-side effects without approval |
| F10 | High | Confirmed boundary gap; impact conditional on file presence | Sensitive-file protection is bypassable through shell, rename, and persistence | Credential exposure to model/providers/collaborators |
| F11 | Medium | Confirmed | PostgreSQL connector has DNS validation/use TOCTOU | DNS-rebinding access to internal PostgreSQL endpoints |
| F12 | Medium | Confirmed; high-entropy ID mitigates | Preview management APIs do not bind preview IDs to the caller's project | Cross-project preview control after ID leakage |
| F13 | Medium | Confirmed | Project admins can demote or remove direct project owners | Authorization integrity and project takeover risk |
| F14 | Medium | Confirmed | Legacy guest cookies survive web logout | Shared-device guest-session persistence |
| F15 | Medium | Runtime-dependent | Existing storage bucket privacy is assumed, not asserted | Public source/knowledge object exposure after drift |
| F16 | High | Confirmed supply-chain weakness; upstream compromise required | Privileged build/setup downloads are not pinned and verified | Host/rootfs supply-chain compromise |
| F17 | Medium | Confirmed | Patchable npm advisories and no repository security gates | Development-service exposure and supply-chain lag |
| F18 | Medium | Runtime-dependent | VM state/snapshot ownership, modes, encryption, and service hardening are undefined in-repo | Local/host-user disclosure of project state |

### Immediate decisions

- Treat project editors as **not authorized to export or retarget all project secrets** unless product policy explicitly says otherwise. Enforce this server-side before the next deployment containing production credentials.
- Verify Supabase grants and RLS for `account_provider_keys` in production immediately. Until confirmed, regard BYOK confidentiality as uncertain.
- Keep `FIRECRACKER_BASE_SNAPSHOT` disabled until its bootstrap channel is authenticated without transmitting replacement credentials over the shared bridge.
- Put hard global and per-principal admission limits in front of VM creation and model execution before increasing anonymous traffic.
- Apply host-level egress and jailer controls before treating a Firecracker guest as a fully hostile tenant boundary.

## Scope, architecture, and method

### Repository areas reviewed

- `apps/web`: Next.js 15 application, WorkOS/AuthKit session integration, guest sessions, deployment UI/API relay, uploads, Markdown rendering, and security headers.
- `services/orchestrator`: HTTP and WebSocket APIs, authorization, collaboration, Supabase access, encrypted secrets, provider BYOK, OAuth connectors, deployment, browser automation, preview management, agent loop, tool permissions, quotas, imports, storage synchronization, and error handling.
- `services/sandbox-agent`: Rust and Node agent implementations, bearer authentication, filesystem/command endpoints, network reconfiguration, and Firecracker guest behavior.
- `infra/firecracker`: host networking, rootfs construction, runtime installation, kernel/Firecracker acquisition, snapshot behavior, and operational scripts.
- `packages/*`: shared API types and model catalog surfaces used by the UI and router.
- Root development configuration: npm workspaces, lockfiles, TypeScript/Turbo/Vitest configuration, local agent permissions, and ignored/generated artifacts.

### Technology and sensitive-component inventory

| Layer | Technology | Sensitive assets / trust decisions |
|---|---|---|
| Web | Next.js 15, React, WorkOS AuthKit, iron-session | Auth cookies, guest cookies, deployment actions, OAuth redirects, uploaded files |
| API | Node.js, TypeScript, HTTP + `ws` WebSockets | Project membership, org roles, service-role DB credentials, live agent sessions |
| Data | Supabase/PostgreSQL, Supabase Storage | User/org/project records, encrypted provider keys, project secrets, source and knowledge objects |
| AI | Anthropic, OpenAI, Google, Z.ai adapters | User prompts, tool results, reasoning state, BYOK credentials, persistent project instructions |
| Connectors | GitHub, Vercel, Figma, Supabase, generic HTTP/PostgreSQL, browser | OAuth tokens, allowed hosts, network reachability, third-party side effects |
| Sandbox | Firecracker, Rust/Node sandbox agent, TAP bridge, project disks | Host isolation, VM bearer tokens, source trees, shell output, snapshots |
| Supply chain | npm, Cargo, Alpine APK, Firecracker/kernel downloads, rustup | Build integrity, rootfs provenance, developer/production host integrity |

### Trust boundaries and attack surfaces

1. Anonymous browser to the public Next.js and orchestrator guest endpoints.
2. Authenticated user to project/org authorization and collaboration APIs.
3. Web application to orchestrator, including cookies, forwarded requests, and WebSocket upgrade state.
4. Orchestrator to Supabase service-role access and encrypted-at-rest fields.
5. Model-generated tool calls to file, shell, browser, connector, preview, and deployment capabilities.
6. Orchestrator/host to hostile Firecracker guest code over TAP networking and the sandbox-agent bearer channel.
7. Repository/imported content to durable `.uniqus/skills.md` system instructions.
8. Build scripts and package managers to third-party artifact registries and mutable downloads.

### Inaccessible or intentionally untested environment

No live URL, production credentials, Supabase dashboard, Vercel account, Cloudflare Turnstile configuration, Hetzner shell, production systemd unit, firewall state, bucket policy, database grants, backups, or runtime logs were provided. Accordingly, this audit did **not**:

- probe production, send traffic to third parties, create accounts, mutate remote resources, or attempt exploitation;
- inspect actual environment-variable values or reveal locally present secrets;
- confirm production RLS grants, bucket public/private state, TLS termination, CSP injected by an edge, host firewall rules, systemd sandboxing, file ownership, disk encryption, or whether feature flags are enabled;
- run Unix-only Firecracker or sandbox-agent integration tests from this Windows workstation.

Findings dependent on those facts are labeled runtime-dependent, conditional, or likely rather than confirmed-exploitable.

### Audit procedure

The review combined:

- full tracked-file and architecture inventory at the audited commit;
- manual data-flow and authorization tracing from public routes through database, provider, VM, and connector boundaries;
- searches for unsafe deserialization, dynamic execution, shell use, raw HTML, SQL construction, filesystem traversal, URL fetches, cookie/session handling, secret flow, cryptography, and role checks;
- route-by-route review of auth, collaboration, guest, deployment, upload/import, preview, connector, and WebSocket paths;
- agent-specific review of prompt construction, persistent instructions, tool risk classification, approval bypasses, browser egress, sensitive paths, model-provider translation, and tool-output handling;
- Firecracker host, network, snapshot, rootfs, and agent authentication review against the official production-host guidance;
- tracked-tree high-confidence credential-pattern checks, dependency audits, targeted runtime proofs, type checking, and test execution;
- false-positive elimination where compensating controls made an apparent issue non-exploitable.

### Verification executed

| Check | Result |
|---|---|
| `npm run typecheck` | Passed for both workspaces (Turbo cache replay) |
| `npm --workspace=@gate15/orchestrator test` | 56 files; 469 passed; 1 skipped |
| `cargo test --manifest-path services/sandbox-agent/Cargo.toml` | Not runnable on Windows because the crate intentionally uses Unix-only process and signal APIs; this is an environment limitation, not a test failure attributed to the code |
| Full `npm audit --json` | 7 advisories: 1 critical, 1 high, 4 moderate, 1 low; critical/high are development-tool conditions described in F17 |
| Production-only npm audit | 4 advisories: PostCSS/Next and protobufjs moderate; esbuild low; no high or critical production dependency advisory |
| Cargo lockfile OSV batch query | 22 locked packages queried; 0 advisories returned |
| `cargo-audit` | Not available; installation could not complete on this Windows toolchain because `dlltool.exe` was missing after an initial timeout |
| Tracked credential-pattern review | No high-confidence AWS, GitHub, Slack, OpenAI/Anthropic, Google API, or private-key credential found in tracked source |
| RLS catalog proof from schema | 20 application tables found; 19 enable RLS; `account_provider_keys` is the sole omission |
| WebSocket payload proof | Default `ws` `maxPayload` resolves to 104,857,600 bytes |
| Tool classifier proof | External `screenshot_preview` and mutating `interact_preview` both classify as `read` |

## Threat model and credible attack chains

### Primary adversaries

- Anonymous user seeking compute/model-spend abuse or denial of service.
- Malicious project editor/collaborator with legitimate low-privilege access.
- Attacker controlling imported repository content, dependency output, a web page visited by the agent, or other prompt-injection input.
- Hostile code executing as root inside a tenant VM.
- Network or upstream artifact compromise affecting build/setup downloads.
- Local low-privilege host account or operational mistake exposing snapshots, storage, or deployment configuration.

### Highest-risk chains

**Editor-to-secret export:** join a project as editor → attach an attacker-owned Vercel account/team → deploy code that exposes environment variables → server decrypts and uploads all project secrets to that deployment.

**Imported prompt persistence:** import a repository without `.uniqus/skills.md` → repository text induces the model to create that file → trust state is never invalidated → its content enters subsequent system prompts as trusted project instructions → tool and data boundaries are attacked over later turns.

**Sensitive-file-to-model/provider:** import or create `.env`/key material → prompt injection calls `run_command` or renames the file to a non-sensitive path → output enters model context → can then be sent through arbitrary browser interactions or external connector calls.

**Guest-to-host/private network:** create a guest project → run arbitrary VM code → reach the TAP gateway or private/link-local destinations not blocked by the repository firewall rules → probe host/private services that assumed perimeter isolation.

**Cost/availability amplification:** solve Turnstile once (or use an environment where it ships dark) → create projects/sessions/VMs and model turns without durable personal quotas → combine with large ZIPs, WebSocket frames, connector responses, or serial output → exhaust memory, disk, VM slots, model budget, or logs.

## Detailed findings

### F01 — Editors can deploy all project secrets into an editor-controlled Vercel target

**Severity:** High  
**Confidence:** High; the server-side data flow is confirmed. Severity is policy-dependent: it is Critical only if the product promises that editors cannot ever obtain project secrets.  
**Class:** Authorization/confidentiality  
**CWE / standards:** CWE-862 (Missing Authorization), CWE-269 (Improper Privilege Management), CWE-200 (Exposure of Sensitive Information); OWASP Top 10 2025 A01/A04; OWASP API Security API5.

**Affected surface:** `handleHttp`, `POST /api/projects/:projectId/deploy` (`services/orchestrator/src/server.ts:2866-2915`); `startDeploy`, external Vercel deployment request (`services/orchestrator/src/deploy.ts:242-310`, secret merge at `:272-299`).

**Affected code and evidence**

- `services/orchestrator/src/server.ts:2869-2875`: deployment requires only editor-level project access.
- `services/orchestrator/src/server.ts:2907-2915`: the deployment target uses the acting editor's user ID, Vercel token, and selected team.
- `services/orchestrator/src/deploy.ts:272-281`: all stored project secrets are decrypted and merged into deployment variables.
- `services/orchestrator/src/deploy.ts:286-299`: the merged secret set is supplied to both runtime `env` and build-time `build.env`.

**Why this is vulnerable**

The normal secret UI is write-only, but deployment becomes an export oracle. A collaborator who may edit code can bind a Vercel account/team they control, deploy code that prints, transmits, or otherwise exposes environment variables, and inspect build/runtime output in infrastructure they own. The server performs the decryption and cross-boundary transfer; write-only UI semantics do not mitigate it.

**Exploit prerequisites:** Authenticated non-guest editor access to a project containing secrets; an attacker-controlled Vercel integration/team; permission to deploy. No database or host compromise is required.

**Example abuse path:** The editor modifies the build script to POST selected environment variables to an endpoint they control, chooses their own Vercel team, and starts a deploy. Since secrets are also placed in `build.env`, build output alone may be sufficient.

**Impact:** Full disclosure and misuse of database passwords, API keys, signing secrets, or other project credentials; compromise of downstream systems; persistent unauthorized deployment. Build-time exposure broadens the set of third-party build components that receive runtime-only secrets.

**Safe validation:** In a staging project, create a harmless canary secret as the owner, add an editor, connect a disposable editor-owned Vercel team, and verify that the server either rejects the deployment or omits the canary. Do not use real credentials and do not log the canary outside the disposable target.

**Remediation:** Define secret-trust roles explicitly. Require owner/admin approval for any deployment that includes stored secrets, bind production deployment targets to a project/org rather than the acting user's arbitrary account, and require explicit selection of which secrets are exposed. Separate build-time and runtime secrets; default runtime-only values out of `build.env`. Consider a one-time approval record containing target account/team/project, secret names, approver, and expiration.

**Proposed change (illustrative):**

```ts
const deployment = await requireProjectRole(userId, projectId, "editor");
const target = await getApprovedProjectDeploymentTarget(projectId);
const mayExportSecrets = deployment.role === "owner" || deployment.role === "admin";

const selected = mayExportSecrets
  ? await loadApprovedDeploymentSecrets(projectId, request.secretNames, target.id)
  : {};

await deployToVercel({
  target,
  runtimeEnv: selected.runtime,
  buildEnv: selected.build, // never all runtime secrets by default
});
```

**Regression tests:** Editor cannot select a personal target for a secret-bearing deploy; editor-only deploy receives no stored secrets; owner/admin approval is bound to the exact target and secret-name set; runtime-only secrets are absent from build environment and logs; revoked approval fails closed.

**Resolution status (2026-07-14): Fixed**

- **Files changed:** `services/orchestrator/src/deploy.ts`, `services/orchestrator/src/server.ts`, `services/orchestrator/src/deploy.security.test.ts`.
- **Fix:** Stored secrets are loaded only for project admins/owners; editor deploys receive request-supplied variables only. Stored project secrets are runtime-only and are omitted from Vercel `build.env`; explicitly supplied per-deploy values remain available to both phases. Authorized secret loading now fails closed instead of silently publishing without credentials.
- **Validation:** `deploy.security.test.ts` verifies runtime/build separation and explicit override behavior; the orchestrator type-check passed.
- **Remaining limitations:** This implements the explicit admin/owner secret-trust policy without adding a separate deployment-target approval table or per-secret selection UI. Those would be product-policy enhancements, not a remaining editor export path.

### F02 — `account_provider_keys` lacks RLS and ciphertext is not bound to account/provider rows

**Severity:** High  
**Confidence:** High for the schema defect; production exploitability is unverified and depends on Supabase Data API exposure and grants.  
**Class:** Data authorization / cryptographic context binding  
**CWE / standards:** CWE-862, CWE-639 (Authorization Bypass Through User-Controlled Key), CWE-653 (Improper Isolation or Compartmentalization), CWE-345 (Insufficient Verification of Data Authenticity); OWASP 2025 A01/A04; OWASP API1/API5.

**Affected surface:** `public.account_provider_keys` and conditional Supabase Data API `/rest/v1/account_provider_keys` (`services/orchestrator/src/db/schema.sql:297-308`); normal `GET|PUT|DELETE /api/account/provider-keys` handlers (`services/orchestrator/src/server.ts:1400-1425`); `listAccountProviderKeys`, `setAccountProviderKey`, `deleteAccountProviderKey`, `getAccountProviderKeys`, and `resolveProviderKeysForUser` (`services/orchestrator/src/db/providerKeys.ts:23-106`); `encryptToken`/`decryptToken` (`services/orchestrator/src/auth/encrypt.ts:33-53`).

**Affected code and evidence**

- `services/orchestrator/src/db/schema.sql:269-276`: the schema states the RLS invariant for application tables.
- `services/orchestrator/src/db/schema.sql:297-308`: defines `account_provider_keys` but does not enable RLS or add policies.
- `services/orchestrator/src/db/schema.sql:354` onward: the next table, `project_secrets`, resumes RLS configuration, confirming this is not merely displaced SQL.
- `services/orchestrator/src/db/providerKeys.ts:23-78`: service-side CRUD/decryption; `:88-106` resolves stored keys for model providers.
- `services/orchestrator/src/auth/encrypt.ts:33-53`: AES-GCM uses a global key with no Additional Authenticated Data tying ciphertext to user, provider, table, or row.

Supabase documents that tables in an exposed schema must use RLS and that grants/Data API exposure determine accessibility: [Securing your API](https://supabase.com/docs/guides/api/securing-your-api) and [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).

**Why this is vulnerable**

If `anon` or `authenticated` retains table privileges in an exposed schema, the only application table without RLS can be queried or changed directly through the Data API. Ciphertexts are authenticated against the global encryption key but not their logical owner/provider, so a write-capable attacker could copy a victim ciphertext into their own row and ask the legitimate service to decrypt/use it, or place an attacker-controlled key into a victim's provider row.

**Exploit prerequisites:** The production table is in an API-exposed schema; an attacker has the public Supabase URL/key or an authenticated client token; applicable CRUD grants exist. These facts require live verification.

**Example abuse path:** Enumerate `account_provider_keys`; copy a victim's `encrypted_key` and nonce/tag fields into an attacker-owned `(user_id, provider)` row; select that provider in the application so the service-role path decrypts and spends the victim key. Exact feasibility depends on table columns and deployed grants.

**Impact:** Provider-key metadata/ciphertext disclosure, key deletion or replacement, cross-account provider billing, and account-integrity compromise. Direct plaintext disclosure is not shown because encryption remains intact.

**Safe validation:** Run read-only production/staging catalog checks:

```sql
select relrowsecurity
from pg_class
where oid = 'public.account_provider_keys'::regclass;

select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'account_provider_keys';
```

From a disposable staging client, verify `anon` and a normal authenticated user cannot select, insert, update, or delete any row. Never query real ciphertext values for this test.

**Remediation:** Enable RLS immediately and revoke direct `anon`/`authenticated` privileges; preferably move provider-key storage to a private, non-Data-API schema accessed only by the service role. Add versioned domain/row AAD such as `account-provider-key:<user-id>:<provider>`, then re-encrypt during a controlled rotation. Do not rely on RLS alone for this server-private table.

**Proposed SQL/config:**

```sql
alter table public.account_provider_keys enable row level security;
alter table public.account_provider_keys force row level security;
revoke all on table public.account_provider_keys from anon, authenticated;
-- No client policy: service-role access only.
```

**Regression tests:** Schema/catalog test fails if any exposed application table lacks RLS; anonymous/authenticated CRUD tests fail closed; ciphertext copied to a different user/provider fails AES-GCM authentication after AAD migration; encryption records carry an explicit key/version identifier.

**Resolution status (2026-07-14): Needs Manual Validation**

- **Files changed:** `services/orchestrator/src/db/schema.sql`, `services/orchestrator/src/auth/encrypt.ts`, `services/orchestrator/src/auth/encrypt.test.ts`, `services/orchestrator/src/db/providerKeys.ts`, `services/orchestrator/src/db/secrets.ts`, `services/orchestrator/src/db/users.ts`, `services/orchestrator/src/db/schema.security.test.ts`.
- **Fix applied in source:** `account_provider_keys` now has forced RLS and explicit `anon`/`authenticated` revocation, including an idempotent Z.ai provider constraint migration. New credential writes use versioned AES-GCM envelopes with key IDs and row/purpose AAD; provider-key ciphertext is bound to `(user, provider)`. All OAuth, guest-recovery, and project-secret callers use canonical contexts. Legacy ciphertext remains dual-readable during rotation.
- **Validation:** Encryption tests cover cross-row/context rejection, nonce variation, legacy dual-read, old/new keyrings, removed keys, and unknown versions. Schema tests assert forced RLS/revocation. Targeted tests and the orchestrator type-check passed.
- **Manual validation still required:** Apply `schema.sql` to staging/production and record catalog/grant evidence plus anonymous/authenticated CRUD denial. Existing legacy rows remain readable by design until rewritten/rotated; review live exposure history before declaring the deployed data plane closed.

### F03 — Guest VMs can reach host and private-network destinations unless production adds untracked controls

**Severity:** High  
**Confidence:** High for the repository firewall gap; actual host exposure depends on out-of-repo nftables/iptables/cloud-firewall state.  
**Class:** Network isolation / SSRF-like lateral movement  
**CWE / standards:** CWE-923 (Improper Restriction of Communication Channel to Intended Endpoints), CWE-284; OWASP API7 (SSRF); Firecracker production-host guidance.

**Affected surface:** Top-level `host-net.sh` firewall setup, with no application endpoint (`infra/firecracker/host-net.sh:60-69`); orchestrator `main()` listener (`services/orchestrator/src/server.ts:722-799`, bind at `:796-797`). The attack surface is guest-originated VM network traffic.

**Affected code and evidence**

- `infra/firecracker/host-net.sh:60-69`: permits VM egress, blocks a specific metadata address, and blocks forwarded VM-to-VM traffic on `fcbr0`, but does not deny guest-to-host `INPUT` or private, loopback, link-local, CGNAT, multicast, and IPv6 destinations comprehensively.
- `services/orchestrator/src/server.ts:796-797`: orchestrator listens on `0.0.0.0`; a host firewall/service binding must supply the missing tenant boundary.

The [Firecracker production host setup guide](https://github.com/firecracker-microvm/firecracker/blob/main/docs/prod-host-setup.md) makes host firewalling the operator's responsibility; Firecracker does not provide destination filtering for guest traffic.

**Why this is vulnerable**

A hostile guest has arbitrary shell/network capability. Blocking only metadata and forwarded VM-to-VM traffic leaves routes to the TAP gateway/host and potentially RFC1918, link-local, CGNAT, multicast, IPv6, or other host-reachable networks. Services bound broadly may have assumed they were protected by the external perimeter rather than by tenant-local traffic.

**Exploit prerequisites:** Ability to execute code in a project VM (including a guest project); a reachable host/private service; no stronger production firewall than the tracked script.

**Example abuse path:** Scan the TAP gateway and private ranges for orchestrator/debug/database/metrics/admin services, then interact with one whose authentication or exposure model assumed traffic could not originate from a tenant VM.

**Impact:** Host-service access, private-network reconnaissance, lateral movement, credential theft, or bypass of external ingress controls. Specific compromise depends on reachable services.

**Safe validation:** On a staging host with canary listeners, run a destination matrix from a disposable VM: public HTTPS should follow policy; host gateway, host service ports, RFC1918, loopback aliases, link-local, metadata, CGNAT, multicast, other TAPs, and IPv6 must fail. Capture only allow/deny results.

**Remediation:** Adopt default-deny VM egress with an authenticated/filtered proxy for required internet access. Add an `INPUT` rule blocking `fcbr0` except the minimum sandbox-agent/control channel, deny all special/private destinations in both IPv4 and IPv6, and fail closed if firewall installation fails. Separate VM networking into namespaces where feasible.

**Proposed configuration direction:**

```nft
table inet gate15_vm {
  chain vm_input { type filter hook input priority -10; iifname "fcbr0" drop; }
  chain vm_forward {
    type filter hook forward priority -10;
    iifname "fcbr0" ip daddr { 10.0.0.0/8, 100.64.0.0/10,
      127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12,
      192.168.0.0/16, 224.0.0.0/4 } drop;
    iifname "fcbr0" ip6 daddr { ::1/128, fe80::/10, fc00::/7, ff00::/8 } drop;
  }
}
```

This is illustrative; preserve the exact control-plane channel and apply equivalent policy in the deployed firewall framework.

**Regression tests:** Host setup fails if the isolation rules cannot be installed; staging network matrix runs on every image/network change; IPv4 and IPv6 are tested; public egress cannot route around the proxy; one VM cannot reach another VM or the host control plane.

**Resolution status (2026-07-14): Needs Manual Validation**

- **Files changed:** `infra/firecracker/host-net.sh`.
- **Fix applied in source:** Host networking now fails if bridge netfilter cannot be enabled; dedicated rules run before broad forwarding rules, allow only established guest-to-host replies, block guest-initiated host access and IPv4 private/special destinations, restrict forwarding to the public interface, and deny guest IPv6 input/forwarding. Re-runs flush/rebuild the dedicated chains to repair drift.
- **Validation:** `bash -n infra/firecracker/host-net.sh` passed.
- **Manual validation still required:** The Linux staging/production destination matrix (host gateway/services, RFC1918, CGNAT, link-local, metadata, multicast, peer TAPs, IPv6, and permitted public egress) was not available from this Windows workspace. Production may also have out-of-repo nftables/cloud rules that must be recorded.

### F04 — Firecracker is launched directly instead of through the installed jailer

**Severity:** High  
**Confidence:** High  
**Status:** Confirmed high-impact sandbox hardening weakness; it is not a confirmed exploitable vulnerability without an underlying Firecracker/KVM/kernel/device escape.  
**Class:** Sandbox defense in depth  
**CWE / standards:** CWE-250 (Execution with Unnecessary Privileges), CWE-269, CWE-653; NIST SSDF operational hardening; Firecracker production-host guidance.

**Affected surface:** `spawnFirecracker`/internal VM lifecycle, no public endpoint (`services/orchestrator/src/firecracker/client.ts:166-225`); top-level jailer installation (`infra/firecracker/host-setup.sh:53-68`).

**Affected code and evidence**

- `infra/firecracker/host-setup.sh:53-68`: installs both `firecracker` and `jailer`.
- `services/orchestrator/src/firecracker/client.ts:166-193`: spawns the raw Firecracker binary with inherited process identity/environment rather than jailer-provided chroot, UID/GID, namespaces, cgroups, resource limits, and capability reduction.

The [Firecracker production host setup guide](https://github.com/firecracker-microvm/firecracker/blob/main/docs/prod-host-setup.md) calls for the jailer or equivalent controls, unique UID/GID, chroot, namespaces, and cgroups for production multi-tenant workloads.

**Why this is vulnerable**

The VM boundary still exists, but the containment layer intended to reduce the blast radius of a Firecracker/device/kernel escape is absent. A successful escape lands in the orchestrator service's host context, with whatever filesystem access, environment variables, network reachability, and privileges the deployed unit has.

**Exploit prerequisites:** A Firecracker/KVM/kernel/device escape or host-side vulnerability reachable from a malicious guest. No such exploit was attempted or established.

**Realistic abuse scenario:** A hostile tenant exercises a future Firecracker virtio/device escape. Instead of landing inside a per-VM jail with a unique UID and minimal filesystem, the exploit inherits the orchestrator service's host identity and can attempt to read its environment, runtime directories, neighboring VM state, and reachable control services.

**Impact:** Materially increased consequence of a sandbox escape, potentially including service credentials, other project state, snapshots, host networking, or orchestrator control.

**Safe validation:** On staging, inspect the Firecracker PID's `/proc/<pid>/{status,environ,mountinfo,cgroup}` and systemd unit. Confirm unique non-service UID/GID, empty/minimal environment, chrooted filesystem, private namespaces, cgroup limits, and no unnecessary capabilities. Run `systemd-analyze security` against the tracked/deployed unit.

**Remediation:** Launch each microVM through jailer with a unique identity/chroot/cgroup. Move TAP/device setup into a small privileged helper with a narrow protocol; run the orchestrator unprivileged; pass only allowlisted environment values; make kernels/rootfs/config root-owned and immutable to the VM process.

**Proposed change:** Replace direct `spawn(firecrackerPath, ...)` with a jailer command builder whose required parameters include `--id`, `--uid`, `--gid`, `--chroot-base-dir`, `--exec-file`, cgroup settings, and an explicit sanitized environment. Treat jailer setup failure as fatal, not a fallback to raw Firecracker.

**Regression tests:** Process inspection asserts chroot/UID/cgroup/namespace properties; concurrent VMs receive distinct identities and directories; the VM process cannot read orchestrator environment or sibling state; a failed jailer launch does not start an unjailed VM.

**Resolution status (2026-07-14): Blocked**

- **Blocker:** A correct jailer migration requires per-VM UID/GID allocation, chroot/device layout, cgroup ownership, TAP setup through a narrow privileged helper, production systemd changes, and Linux `/proc`/namespace validation. None of those deployed-host identities, paths, or privilege boundaries are available in this workspace, and guessing them could make every VM unbootable or weaken isolation.
- **Partial hardening elsewhere:** The tracked systemd/host hardening work does not change the confirmed raw `spawn(firecracker)` path, so this item is not marked fixed.
- **Required next action:** Implement and canary a fail-closed jailer command builder on an isolated Hetzner staging host, then capture UID/chroot/mount/cgroup/capability evidence before production rollout.

### F05 — Golden snapshot restore transmits a replacement VM bearer token over a shared unauthenticated L2 bootstrap channel

**Severity:** High  
**Confidence:** Medium-high; the trust flaw is visible, while a complete exploit needs Linux bridge/TAP staging validation. The feature defaults off.  
**Class:** Cross-tenant authentication / network identity  
**CWE / standards:** CWE-319 (Cleartext Transmission of Sensitive Information), CWE-345, CWE-287, CWE-441 (Unintended Proxy/Intermediary); OWASP 2025 A04/A07.

**Affected surface:** `restoreFromGolden` (`services/orchestrator/src/firecracker/fleet.ts:667-850`, credential delivery at `:731-833`); `finalizeRestore`, internal `POST /net/configure` (`services/orchestrator/src/firecracker/agentRpc.ts:368-413`); Rust agent request match arm (`services/sandbox-agent/src/main.rs:298-360`) and Node mirror (`services/sandbox-agent/src/agent.mjs:211-233`).

**Affected code and evidence**

- `services/orchestrator/src/firecracker/fleet.ts:132-137`: defines fixed golden bootstrap IP/MAC identity.
- `services/orchestrator/src/firecracker/fleet.ts:720-728`: the clone TAP is initially addressed through that bootstrap identity.
- `services/orchestrator/src/firecracker/fleet.ts:731-833`, especially `:756-770`: sends target IP/MAC/mount data and a newly generated bearer token to `/net/configure` over the shared bridge.
- `services/sandbox-agent/src/main.rs:307-360`: the restored agent accepts the bootstrap reconfiguration and installs the replacement token.
- `services/orchestrator/src/firecracker/fleet.ts:1623-1662`: isolation setup has paths that continue rather than fail closed.
- `services/orchestrator/src/firecracker/fleet.ts:1664-1671`: TAP configuration does not establish cryptographic/source binding to the intended clone.

**Why this is vulnerable**

Before a restored clone obtains its unique network identity, the orchestrator reaches a shared bootstrap address and sends the credential that will authenticate all subsequent sandbox-agent control. A malicious guest with root networking on the same L2 may be able to spoof/respond as the bootstrap IP/MAC, capture the request, or cause configuration to reach the wrong endpoint. IP/MAC identity on a shared bridge is not authentication.

**Exploit prerequisites:** `FIRECRACKER_BASE_SNAPSHOT=1`; at least one attacker-controlled VM sharing the relevant bridge; ability to spoof/observe L2 traffic; timing during victim restore. The required packet-level behavior was not tested against production.

**Example abuse path:** Poison neighbor/bridge state for the bootstrap identity, receive `/net/configure`, learn the target address and new bearer token, then impersonate or control the victim sandbox-agent endpoint.

**Impact:** Cross-project VM control, victim source/state access, command execution in the victim VM, or denial/misdirection of snapshot hydration.

**Safe validation:** Keep the feature off in production. On an isolated staging host, run an attacker VM that attempts ARP/NDP spoofing and a fake bootstrap server while restoring a canary clone. Verify that no credential is observable and that the orchestrator cryptographically authenticates the intended clone before provisioning it.

**Remediation:** Use a host-local, per-VM authenticated channel not reachable from tenant L2—such as vsock, a private network namespace/point-to-point link, or a per-clone Unix-socket proxy. Derive/attest a one-time bootstrap credential bound to the snapshot instance and never send the long-lived replacement bearer token to an endpoint authenticated only by IP/MAC. Make network-isolation failures fatal.

**Proposed code/config change:** Replace `configureRestoredClone(bootstrapIp, replacementToken, ...)` with an API that requires a host-created per-clone control handle, snapshot-instance nonce, and one-time bootstrap proof. Deliver the runtime token only through that handle, close it after acknowledgement, and reject startup unless the host reports isolated control-channel capability. Remove the shared bootstrap IP/MAC as an authentication decision.

**Regression tests:** Malicious ARP/MAC responder cannot receive bootstrap data; wrong clone identity is rejected; tokens are single-use and instance-bound; failure leaves the clone stopped and credential invalidated; the feature remains disabled unless host capability and isolation tests pass.

**Resolution status (2026-07-14): Blocked**

- **Blocker:** The replacement bearer still needs a host-local per-clone control channel (for example vsock or a private namespace/socket proxy) and an instance-bound one-time bootstrap proof. That requires coordinated Firecracker/rootfs/agent protocol design plus packet-level hostile-L2 validation on a Linux host; the repository alone cannot prove the channel.
- **Current containment:** The golden snapshot feature remains default-off. Network-isolation failure paths were tightened by related runtime work, but that does not authenticate the shared bootstrap endpoint and is not treated as a fix.
- **Required next action:** Build the host-local channel, reject restore unless the host attests it, invalidate failed one-time credentials, and run the documented ARP/MAC canary test before enabling `FIRECRACKER_BASE_SNAPSHOT`.

### F06 — Personal and guest workloads lack durable quotas and global VM/model admission controls

**Severity:** High  
**Confidence:** High  
**Class:** Uncontrolled resource consumption / business-logic abuse  
**CWE / standards:** CWE-770 (Allocation of Resources Without Limits), CWE-799 (Improper Control of Interaction Frequency); OWASP API4/API6; OWASP A06.

**Affected surface:** `handleHttp`, `POST /api/projects` and `POST /api/projects/from-brief` (`services/orchestrator/src/server.ts:1504-1565`); `handleUpgrade`/`handleConnection`, agent WebSocket `user_message` (`:4237-4305`, `:4310-4329`, `:4839-5130`); `runSession`/`checkOrgBudget` (`:5724-5804`, `:6828-6845`); fleet `ensureVm` (`services/orchestrator/src/firecracker/fleet.ts:180-217`).

**Affected code and evidence**

- `services/orchestrator/src/server.ts:1504-1521`: direct project creation has no per-user/project cap; the brief path at `:1528-1540` also lacks durable admission control.
- `services/orchestrator/src/server.ts:4880` onward and `:5101-5109`: WebSocket agent runs can start without an atomic spend/concurrency reservation.
- `services/orchestrator/src/server.ts:5788-5804`: budget enforcement is organization-centric.
- `services/orchestrator/src/server.ts:6815-6845`: personal accounts return no applicable budget and budget lookup failures fail open.
- `services/orchestrator/src/firecracker/fleet.ts:39-59`: each VM defaults to 2 vCPU, 1 GiB RAM, and an 8 GiB disk.
- `services/orchestrator/src/firecracker/fleet.ts:155-217`: fleet creation/registration has no hard global or per-principal admission semaphore.

**Why this is vulnerable**

Per-IP guest signup throttling and optional Turnstile do not constrain resource use after signup. A single account can create projects, start model turns, and allocate VMs without a durable personal/guest ceiling. Concurrent requests can race any later accounting because resources are not atomically reserved before execution. Database/control failures permit spend rather than deny it.

**Exploit prerequisites:** Guest or normal account; CAPTCHA token if production enables Turnstile. Distributed sources are unnecessary after an account is established.

**Example abuse path:** Create many projects, open concurrent WebSockets, trigger agent starts and long model/tool loops, and keep VMs active until memory/disk/model-provider limits are exhausted.

**Impact:** Provider charges, VM/host memory and disk exhaustion, degraded availability for all tenants, operational paging, and potential inability to enforce public pricing promises.

**Safe validation:** In staging, issue N+1 concurrent project creations and agent starts for a canary user, guest, and org. Confirm the excess request receives a stable 429/402 before VM/model allocation and that accounting remains correct after cancellation/failure.

**Remediation:** Add durable per-user/org/IP quotas for projects, active VMs, concurrent runs, tokens/dollars, storage, uploads, and connector calls; stricter guest limits; atomic reservations before model/VM allocation; a global host VM semaphore and resource-watermark circuit breaker; hard cgroup/disk quotas; and fail-closed behavior for spend-control infrastructure.

**Proposed change (illustrative):**

```ts
await db.transaction(async (tx) => {
  const reservation = await reserveRunBudgetForUpdate(tx, principal, estimate);
  if (!reservation.allowed) throw tooManyRequests(reservation.retryAfter);
  await reserveVmSlotForUpdate(tx, principal, GLOBAL_VM_LIMIT);
});
```

**Regression tests:** N+1 concurrent requests cannot exceed each limit; canceled/failed runs refund reservations idempotently; budget-database failure denies new paid work; guests have lower ceilings; global watermarks stop new allocation without killing existing healthy workloads.

**Resolution status (2026-07-14): Blocked**

- **Blocker:** Durable quota values and product policy (guest/personal project, VM, token/dollar, storage, and connector ceilings), refund semantics, multi-worker reservation ownership, and host watermarks are not defined. A guessed in-memory semaphore would not fix the reported restart/race/multi-instance weakness, while guessed durable limits could break paid-user promises.
- **Partial controls, not a closure:** F07 now bounds individual memory sinks and the guest routes have stronger pre-CAPTCHA flood protection, but there is still no atomic durable spend/VM reservation layer.
- **Required next action:** Approve concrete per-plan limits and reservation/refund rules, then add a transactional reservation table/RPC and host-capacity admission check with N+1 concurrency tests. Production database and host-capacity access are required to validate it.

### F07 — Large buffered inputs, responses, WebSocket frames, and serial logs enable resource exhaustion

**Severity:** High  
**Confidence:** High  
**Class:** Denial of service / resource management  
**CWE / standards:** CWE-400 (Uncontrolled Resource Consumption), CWE-770, CWE-789 (Memory Allocation with Excessive Size Value); OWASP API4.

**Affected surface:** `handleZipImport`, `POST /api/projects/import-zip` (`services/orchestrator/src/server.ts:1699-1703`, `:3146-3220`); `handleProjectUploads`, `POST /api/projects/:id/uploads` (`:1705-1710`, `:3231-3341`); `handleKnowledgeUpload`, `POST /api/knowledge-documents` (`:2648-2651`, `:3359-3454`); `main`/`handleConnection` WebSocket parsing (`:785`, `:4571-4577`); HTTP and PostgreSQL connector `invoke` methods (`services/orchestrator/src/connectors/http.ts:22-149`, `services/orchestrator/src/connectors/postgres.ts:9-86`); `handleDesignSystemAnalyze`/`fetchLiveSiteContext`, `POST /api/design-systems/analyze` with `source=url` (`services/orchestrator/src/server.ts:2806-2809`, `:8222-8263`, `:8311-8435`); `spawnFirecracker` serial forwarding (`services/orchestrator/src/firecracker/client.ts:203-219`).

**Affected code and evidence**

- `services/orchestrator/src/server.ts:1699-1703`, `:3146-3186`, `:3209-3212`: guest ZIP import accepts/buffers up to roughly 250 MB before `AdmZip` archive parsing.
- `services/orchestrator/src/import.ts:4`, `:7-15`, `:41-48`: file/decompression limits are applied after the archive is already resident.
- `services/orchestrator/src/server.ts:3222-3279`: project uploads use `Buffer.concat` for up to 10 × 5 MB files.
- `services/orchestrator/src/server.ts:3343-3393`: knowledge uploads similarly retain up to 10 × 25 MB files.
- `services/orchestrator/src/server.ts:785`, `:4571-4577`: `ws` is constructed without `maxPayload`, leaving the 100 MiB default, then converts and parses complete JSON messages.
- `services/orchestrator/src/connectors/http.ts:121-145`: awaits unbounded `response.text()` before applying a string-only size cap; large JSON/non-string results bypass the intended response-size semantics.
- `services/orchestrator/src/connectors/postgres.ts:75-80`: buffers the complete result set before slicing.
- `services/orchestrator/src/server.ts:8241`, `:8263`: live-site design fetches buffer complete text before slicing.
- `services/orchestrator/src/firecracker/fleet.ts:348`, `:607` and `services/orchestrator/src/firecracker/client.ts:203-219`: guest serial console is enabled and forwarded line-by-line to journald without a repository-level volume bound.

The [Firecracker production host setup guide](https://github.com/firecracker-microvm/firecracker/blob/main/docs/prod-host-setup.md) specifically warns that guest-controlled serial output can fill the host and recommends disabling/bounding it.

**Why this is vulnerable**

Nominal body/file limits are too large for per-request in-memory assembly and do not account for decompression/parser copies or concurrency. Several outbound reads impose limits only after the body/query result is fully allocated. The WebSocket default alone allows a single client message large enough to cause multiple 100 MiB copies. A guest can also generate unbounded serial output independent of HTTP limits.

**Exploit prerequisites:** Various low barriers: guest/authenticated upload or WebSocket access; an allowed connector URL returning a large/chunked body; a permitted PostgreSQL query with many rows; or shell access in a VM for serial flooding.

**Example abuse path:** Open several WebSockets and send near-100 MiB JSON frames concurrently; or import several 250 MB archives; or make an allowed HTTP connector return an indefinitely streamed JSON response. Memory amplification occurs before rejection.

**Impact:** Orchestrator OOM/restart, event-loop stalls, host disk exhaustion through journald, collateral loss of active sessions/VM control, and cost amplification.

**Safe validation:** In an isolated staging environment, use synthetic streams at limit−1 and limit+1, concurrent slow/chunked responses, oversized WebSocket frames, a large database result, and serial-output canaries. Measure peak RSS/disk and confirm early termination without reading the rest of the body.

**Remediation:** Stream uploads to bounded temporary/object storage; enforce aggregate and concurrent byte budgets before allocation; set a small WebSocket `maxPayload` (for example 256 KiB, based on actual protocol envelopes) and per-connection message rates; use a capped streaming response reader that aborts at N bytes; enforce SQL `LIMIT`/statement timeout/cursor row caps before retrieval; disable serial (`8250.nr_uarts=0`) or use a bounded ring buffer and journald rate/size caps.

**Proposed change (illustrative):**

```ts
const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

async function readBodyLimited(res: Response, maxBytes: number) {
  const reader = res.body?.getReader();
  let total = 0;
  const chunks: Uint8Array[] = [];
  while (reader) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel("response too large");
      throw new Error("connector_response_too_large");
    }
    chunks.push(value);
  }
  return concatBounded(chunks, total);
}
```

**Regression tests:** Oversized WS closes with 1009 before JSON parsing; aggregate upload/concurrency limits reject early; chunked/lying-content-length bodies are capped; huge JSON and database results cannot bypass limits; serial flood remains within a fixed host-disk/RSS envelope.

**Resolution status (2026-07-14): Fixed**

- **Files changed:** `services/orchestrator/src/server.ts`, `services/orchestrator/src/connectors/ssrfGuard.ts`, `services/orchestrator/src/connectors/ssrfGuard.test.ts`, `services/orchestrator/src/connectors/http.ts`, `services/orchestrator/src/connectors/postgres.ts`, `services/orchestrator/src/connectors/postgres.test.ts`, `services/orchestrator/src/firecracker/client.ts`.
- **Fix:** WebSockets now reject frames above 512 KiB and disable compression; ZIP uploads are capped at 50 MB; knowledge uploads have a 50 MB aggregate cap; outbound HTTP/live-page/CSS reads use a streaming byte cap that cancels over-limit bodies; PostgreSQL retains only the requested bounded rows with query/statement timeouts; Firecracker serial forwarding stops after 2,000 bounded lines per VM.
- **Validation:** SSRF/body-reader tests cover cancellation and truncation; PostgreSQL lookup/limit tests, upload-path tests, targeted connector tests, and the orchestrator type-check passed.
- **Remaining limitations:** ZIP parsing is still intentionally buffered, now at a bounded 50 MB maximum. Cross-request/global concurrency admission is tracked separately under F06; production RSS/journald pressure should still be measured with the staging canaries.

### F08 — Imported repositories can establish persistent trusted system instructions after import

**Severity:** High  
**Confidence:** High for the trust-state defect; medium-high for the full model-mediated exploitation chain.  
**Class:** Prompt injection / provenance failure  
**CWE / standards:** CWE-346 (Origin Validation Error), CWE-913 (Improper Control of Dynamically-Managed Code Resources), CWE-284; OWASP LLM01 Prompt Injection, LLM06 Excessive Agency; OWASP A08.

**Affected surface:** `markImportedSkillsUntrustedIfPresent` (`services/orchestrator/src/server.ts:400-408`); `POST /api/projects/import-github` (`:1573-1645`) and `POST /api/projects/import-zip`/`handleZipImport` (`:1699-1703`, `:3146-3212`); `executeTool` tools `write_file`, `edit_file`, and `run_command` (`services/orchestrator/src/agent/loop.ts:2808-2915`); `runSession` (`services/orchestrator/src/server.ts:5724-5824`) and durable `executeAgentTask` trust read (`:6863`, `:6951-6956`); human `PUT /api/projects/:id/skills` and `POST /api/projects/:id/files` rename (`:1815-1840`, `:3667-3720`).

**Affected code and evidence**

- `services/orchestrator/src/db/schema.sql:113-118`: project skills trust defaults to trusted.
- `services/orchestrator/src/server.ts:400-408`: import only marks instructions untrusted when `.uniqus/skills.md` exists at import time.
- Import paths at `services/orchestrator/src/server.ts:1640-1645` and `:3209-3212` call that check.
- `services/orchestrator/src/agent/loop.ts:2876-2915`: model file writes/edits and shell commands can later create or modify `.uniqus/skills.md` without invalidating trust.
- `services/orchestrator/src/server.ts:5821-5824` and `:6954-6956`: trusted current bytes are inserted into normal and durable task system prompts.
- `services/orchestrator/src/server.ts:3717-3720`, `:4790-4814`: human write/rename paths auto-trust, showing that trust is attached to project state rather than an exact reviewed byte hash/provenance.

**Why this is vulnerable**

The absence of an instruction file at import is interpreted as trusted state. Untrusted repository text—README content, issue text, logs, dependencies, or generated output—can induce the model to create the instruction file later. Because the mutation does not invalidate trust, those attacker-influenced bytes become privileged system-level instructions on subsequent turns. The probabilistic step is whether the model follows the injection; the durable trust bypass itself is deterministic.

**Exploit prerequisites:** Import attacker-controlled repository/content; model processes the injected text and has write/shell capability; a later turn loads project skills. An attacker does not need editor access after import.

**Example abuse path:** A README says a required setup step is to create `.uniqus/skills.md` containing attacker rules. The model complies during the first task. On the next task those rules are inserted above user content as trusted project instructions and request secrets, external browser calls, or destructive tools.

**Impact:** Persistent cross-turn prompt injection, covert policy manipulation, data egress, unauthorized tool actions, and contamination of durable/automated tasks.

**Safe validation:** Import a disposable repository without the file but containing a benign instruction to create it. Manually create the file through the agent/shell if needed, then confirm the next-turn prompt refuses to treat it as trusted until an owner reviews the exact hash. Use only harmless marker text.

**Remediation:** Mark **all imported projects/instruction provenance untrusted by default**. Trust an exact SHA-256 of reviewed bytes, with reviewer/time/source; invalidate trust on every mutation path, including agent file tools, shell commands, VM sync/pull, storage hydration, rename, restore, and merges. Prefer blocking model writes to the privileged instruction surface entirely. Owner/admin review should be required to trust a changed hash.

**Proposed schema/logic:**

```sql
alter table projects add column skills_trusted_sha256 text;
alter table projects alter column skills_trusted set default false;
```

```ts
const bytes = await readProjectSkills(projectId);
const trusted = project.skillsTrustedSha256 === sha256(bytes);
if (!trusted) prompt.addUntrustedProjectContext(bytes);
```

**Regression tests:** Imported project with no initial file → agent/shell creates file → file is not loaded as system instruction; any write/rename/sync changes the hash and invalidates trust; only owner/admin approval of the exact current hash restores trust; rollback/restore cannot resurrect stale trust.

**Resolution status (2026-07-14): Fixed**

- **Files changed:** `services/orchestrator/src/agent/skills.ts`, `services/orchestrator/src/agent/skills.test.ts`, `services/orchestrator/src/db/projects.ts`, `services/orchestrator/src/db/schema.sql`, `services/orchestrator/src/server.ts`.
- **Fix:** Every GitHub/ZIP import is marked untrusted even when no skills file exists. Prompt injection now requires both trusted state and an exact SHA-256 match to the last admin/owner-approved bytes. Human approval records that digest; editor/model/shell/pull/sync mutations automatically fail the digest check. Checkpoint restore explicitly clears trust so an old matching version cannot silently regain privilege. Dedicated skills and skill-pack approval now require admin access.
- **Validation:** Skill tests prove exact-byte matching, changed-byte rejection, untrusted-import rejection, and missing-digest fail-closed behavior; import and orchestrator tests plus type-check passed.
- **Remaining limitations:** After applying the schema migration, previously trusted rows have no digest and intentionally remain excluded until an admin/owner re-saves the skills file.

### F09 — Arbitrary browser navigation and mutating interaction are classified as read-only tools

**Severity:** High  
**Confidence:** High for the classification/control defect; exploitation is model/prompt-injection dependent.  
**Class:** Excessive agency / missing action authorization  
**CWE / standards:** CWE-862, CWE-749 (Exposed Dangerous Method or Function), CWE-441; OWASP LLM01/LLM06; OWASP API5.

**Affected surface:** `classifyToolRisk`/`decidePermission` for agent WebSocket tools `screenshot_preview` and `interact_preview` (`services/orchestrator/src/agent/permissions.ts:30-65`, `:138-143`, `:239-247`); schemas (`services/orchestrator/src/agent/tools.ts:367-423`); execution through `executeTool` (`services/orchestrator/src/agent/loop.ts:3039-3099`). There is no standalone HTTP endpoint.

**Affected code and evidence**

- `services/orchestrator/src/agent/permissions.ts:30-65`, `:141-143`, `:239-247`: browser screenshot and interaction paths resolve to the `read` category.
- `services/orchestrator/src/agent/tools.ts:367-423`: accepts arbitrary URLs and browser actions including navigation, click, type/fill/select, and press.
- `services/orchestrator/src/agent/loop.ts:3039-3099`: forwards those calls for execution.
- Targeted runtime proof returned `{ category: "read" }` for both an external `screenshot_preview` and an external mutating `interact_preview` call.

**Why this is vulnerable**

A screenshot of the project preview can be read-only, but arbitrary off-origin navigation and form interaction create network egress and public side effects. Treating them as read permits execution under policies that would require approval for external writes. Browser SSRF controls and fresh contexts reduce internal-network/cookie risk but do not prevent sending project/model data in URLs/forms or submitting public actions.

**Exploit prerequisites:** A turn with browser tools enabled; tool policy that auto-runs read actions; prompt injection or model error causing an external/mutating call.

**Example abuse path:** Injected page text asks the model to open `https://attacker.example/collect?data=<project-fragment>` or fill/submit a public form. The permission layer regards the action as read-only and does not request approval.

**Impact:** Project-data exfiltration, spam/abuse, public form submissions, unauthorized state changes in unauthenticated sessions, and misleading audit trails.

**Safe validation:** In staging, ask for a project-origin screenshot (should remain read-only), an arbitrary external screenshot, off-origin navigation, and fill+submit to a local canary. Verify external/mutating actions require approval and include destination/action details.

**Remediation:** Make risk classification argument-aware. Only project-bound screenshot/assertion operations should be read. Any arbitrary URL, off-origin navigation, click, type/fill/select/press, upload, submit, or download should be dangerous/write and require approval unless a narrowly scoped user policy explicitly allows the exact origin/action. Add DLP and egress logging.

**Proposed classification:**

```ts
if (tool === "screenshot_preview" && isCurrentProjectPreview(args.previewId, projectId)) {
  return { category: "read" };
}
if (tool === "interact_preview" || args.url || isOffProjectOrigin(args)) {
  return { category: "dangerous", reason: describeBrowserSideEffect(args) };
}
```

**Regression tests:** Project screenshot remains read-only; arbitrary URL requests approval; every mutating action is never auto-run under read bypass; approval UI shows origin and normalized action; prompt-injected external query/form exfiltration is denied or redacted.

**Resolution status (2026-07-14): Fixed**

- **Files changed:** `services/orchestrator/src/agent/permissions.ts`, `services/orchestrator/src/agent/permissions.test.ts`.
- **Fix:** Browser risk classification is argument-aware. Only a server-bound screenshot and server-bound observational assertions/waits remain read-only; arbitrary URLs, navigation, click/type/fill/select/press/scroll, and other browser interactions are dangerous and require approval under normal permission modes.
- **Validation:** Permission tests cover project-bound observation, arbitrary screenshot egress, external interaction, and mutating action classification; all 17 targeted permission tests passed.
- **Remaining limitations:** The explicit user-selected `bypass` permission mode still bypasses approvals by design. Project ownership of the referenced server is enforced at execution under F12 rather than inside this pure classifier.

### F10 — Sensitive-file controls are bypassable through shell, rename, and persistence paths

**Severity:** High  
**Confidence:** High for the control gaps; impact requires sensitive files to be present in the project workspace.  
**Class:** Secret exposure / incomplete mediation  
**CWE / standards:** CWE-22, CWE-200, CWE-284, CWE-312 (Cleartext Storage of Sensitive Information); OWASP 2025 A01/A04; OWASP LLM02 Sensitive Information Disclosure.

**Affected surface:** `isSensitiveProjectPath` (`services/orchestrator/src/security/sensitivePaths.ts:1-21`); `executeTool` file guards and `run_command` (`services/orchestrator/src/agent/loop.ts:2802-2933`) plus `runCommand` (`services/orchestrator/src/agent/sandbox.ts:839-921`); `handleFileOp`, `POST /api/projects/:id/files` with `op=rename` (`services/orchestrator/src/server.ts:1815-1817`, `:3667-3719`); import functions (`services/orchestrator/src/import.ts:41-114`); `shouldPull`/`pullVmChangesStrict` (`services/orchestrator/src/firecracker/pull.ts:77-89`, `:214-392`); `shouldSync`/`ProjectSync` (`services/orchestrator/src/storage/sync.ts:34-141`).

**Affected code and evidence**

- `services/orchestrator/src/security/sensitivePaths.ts:1-21`: central sensitive-path patterns.
- `services/orchestrator/src/agent/loop.ts:2802-2805`, `:2867-2875`, `:2917-2933`: file tools enforce sensitive-path checks.
- `services/orchestrator/src/agent/loop.ts:2913-2915`, `:2331-2341`: `run_command` can read arbitrary workspace files and returns output to model context.
- `services/orchestrator/src/agent/loop.ts:993-1015`, `:2303-2310`: output redaction focuses on database-stored project secrets, not imported `.env`, key, or credential-file bytes.
- `services/orchestrator/src/import.ts:17`, `:58-65`, `:88-114`: Git/ZIP import does not quarantine all sensitive files from the workspace.
- `services/orchestrator/src/server.ts:3701-3717`: HTTP rename does not reject a sensitive source or destination; editor authorization at `:1815-1817`, `:3667-3674` makes this a collaborator-reachable bypass.
- `services/orchestrator/src/firecracker/pull.ts:77-89`, `:378-392` and `services/orchestrator/src/storage/sync.ts:34-44`, `:122-141`: persistence/sync filters do not centrally apply `isSensitivePath`.

**Why this is vulnerable**

Protection is attached to selected file APIs rather than the data's complete lifecycle. A shell command can print a blocked file, or an editor can rename `.env` to a benign filename and then read it through allowed APIs. Sensitive content may be synchronized to storage, restored, checkpointed, or shared with collaborators. Once shell/file output reaches the model, it also crosses into the selected model provider's trust boundary.

**Exploit prerequisites:** A sensitive file is imported, generated, or copied into the project workspace; an attacker controls prompts or has editor access. Database-backed project secrets are better protected and are not shown to be mounted in the VM.

**Example abuse path:** Rename `.env` to `config.txt` through the file endpoint, read it normally, or prompt the agent to run `sed -n '1,20p' .env`; then use an external browser/connector action to transmit the output.

**Impact:** Disclosure of repository credentials, deployment tokens, private keys, signing material, or third-party secrets to models, collaborators, object storage, logs, or attackers.

**Safe validation:** In staging, place a synthetic canary in `.env`, a PEM-like test file, and a cloud-credential filename. Attempt file read, shell read, rename both directions, sync/pull/checkpoint/export/hydrate, and model-tool output. Confirm the canary is denied/redacted and never appears in storage/provider traces.

**Remediation:** Centralize a `shouldPersistProjectPath`/sensitive-data policy used by every import, file, rename, shell-output, sync, pull, snapshot, export, and hydration path. Quarantine or omit sensitive files before a workspace becomes model-accessible. Deny rename when either source or destination is sensitive. For shell output, apply robust secret/canary detection and truncate/redact, while documenting that arbitrary shell plus local secrets is inherently a broad capability. Inventory and purge already persisted sensitive objects.

**Proposed change:**

```ts
function assertSafeRename(from: string, to: string) {
  if (isSensitivePath(from) || isSensitivePath(to)) throw forbidden("sensitive_path");
}

function shouldPersistProjectPath(path: string) {
  return !isSensitivePath(path) && !isCachePath(path) && !isSocketOrDevice(path);
}
```

Apply the same predicate server-side and in both sandbox-agent implementations; do not rely on model instructions.

**Regression tests:** Shell `cat`/PowerShell reads of canary files are blocked or redacted; rename from/to sensitive names is denied; sensitive objects never appear in sync manifests/storage/checkpoints/exports; import reports quarantined files; model/provider traces do not contain canaries.

**Resolution status (2026-07-14): Needs Manual Validation**

- **Files changed:** `services/orchestrator/src/security/sensitivePaths.ts`, `services/orchestrator/src/security/sensitivePaths.test.ts`, `services/orchestrator/src/server.ts`, `services/orchestrator/src/import.ts`, `services/orchestrator/src/import.test.ts`, `services/orchestrator/src/storage/sync.ts`, `services/orchestrator/src/storage/sync.test.ts`, `services/orchestrator/src/firecracker/pull.ts`, `services/orchestrator/src/firecracker/pull.test.ts`, `services/orchestrator/src/deploy.ts`, `services/orchestrator/src/export.ts`, `services/orchestrator/src/export.security.test.ts`, `services/orchestrator/src/agent/checkpoints.ts`, `services/orchestrator/src/agent/checkpoints.security.test.ts`, `services/orchestrator/src/agent/secretRedaction.ts`, `services/orchestrator/src/agent/secretRedaction.test.ts`, `services/orchestrator/src/agent/loop.ts`.
- **Fix applied in source:** Rename rejects a sensitive source or destination. ZIP/Git worktrees remove sensitive paths before sync; VM pull and Storage sync/hydration filters use the same predicate; deploy/export omit every sensitive path family. Checkpoints exclude those paths and recreate legacy shadow repositories that tracked sensitive filenames. Command/log results receive local credential, env-assignment, URL-auth, token/JWT, and PEM redaction before model context.
- **Validation:** Import, sync, pull, export, checkpoint, path-policy, and shell-output canary tests passed; the orchestrator type-check passed.
- **Manual validation still required:** Inventory/purge any sensitive objects already present in production Storage and model/provider traces. Explicitly preserved Git history can contain deleted historical secrets, and arbitrary shell encoding/transformation cannot be proven safe by pattern redaction; run the staging lifecycle canary and decide whether preserved history must be rejected or rewritten before this finding can be fully closed.

### F11 — PostgreSQL connector DNS validation is subject to rebinding between check and connect

**Severity:** Medium  
**Confidence:** High  
**Class:** SSRF / time-of-check-time-of-use  
**CWE / standards:** CWE-367 (TOCTOU Race Condition), CWE-918 (SSRF), CWE-441; OWASP API7.

**Affected surface:** `postgresConnector.methods.query.invoke`, exposed to the agent as `call_connector { connector: "postgres", method: "query" }` (`services/orchestrator/src/connectors/postgres.ts:9-86`; validation at `:42-59`, later dial at `:67-75`). There is no direct HTTP endpoint.

**Affected code and evidence**

- `services/orchestrator/src/connectors/postgres.ts:42-59`: resolves and validates the hostname/IP once.
- `services/orchestrator/src/connectors/postgres.ts:67-75`: later gives the original hostname to `pg`, which performs a separate DNS resolution and connection.

**Why this is vulnerable**

An attacker-controlled DNS name can return a public address during validation and a private/loopback address during the driver's later lookup. The existing validation is strong at check time but not bound to the actual socket peer. The protocol limits this to PostgreSQL-compatible targets and related port-oracle effects, so Medium is appropriate.

**Exploit prerequisites:** Ability to configure/use the PostgreSQL connector with an attacker-controlled hostname and DNS rebinding infrastructure; an internal PostgreSQL endpoint reachable from the orchestrator.

**Realistic abuse scenario:** The hostname returns an attacker-controlled public IP during `assertPublicHost`, then a loopback/RFC1918 database IP when `pg` resolves it. The connector sends a login/query attempt to the internal database, giving the attacker a port/authentication oracle and any query capability carried by supplied credentials.

**Impact:** Connection attempts, authentication traffic, query execution, or service probing against internal PostgreSQL endpoints.

**Safe validation:** Unit-test with a deterministic resolver that returns a public IP on the first lookup and loopback/private on the second. The connector must either dial only the originally validated IP or reject before connection. Use a local canary listener, not a real internal database.

**Remediation:** Resolve all candidate addresses once, validate each, and pin the actual socket connection to an approved IP. Preserve the original hostname only for TLS SNI/certificate verification. After connect, verify `remoteAddress` equals the approved address; reject redirects/proxies or re-resolution paths.

**Proposed change:** Supply a custom `lookup`/socket factory to `pg` that returns only the validated address, or connect through the existing egress proxy using a signed destination tuple. Keep TLS hostname verification against the original hostname.

**Regression tests:** Rebinding public→private fails; multi-A/AAAA sets reject if policy requires all-safe or pin a specifically validated member; IPv4-mapped IPv6 and DNS aliases are normalized; connected peer address is asserted.

**Resolution status (2026-07-14): Fixed**

- **Files changed:** `services/orchestrator/src/connectors/ssrfGuard.ts`, `services/orchestrator/src/connectors/postgres.ts`, `services/orchestrator/src/connectors/postgres.test.ts`.
- **Fix:** PostgreSQL resolves all candidates once, rejects the entire set if any address is non-public, dials through a custom lookup that can return only the selected validated IP, preserves the original hostname for TLS, and rejects a connected peer whose address does not match the pin (including IPv4-mapped IPv6 handling).
- **Validation:** Pinned lookup tests cover single-address and `all:true` Node lookup shapes; shared SSRF tests cover private/special IPv4/IPv6 rejection; targeted tests and type-check passed.
- **Remaining limitations:** A live TLS PostgreSQL rebind canary was not available; staging should still confirm SNI/certificate behavior and peer-address logging against an owned database endpoint.

### F12 — Preview management operations are not bound to the caller's project

**Severity:** Medium  
**Confidence:** High  
**Class:** Object-level authorization  
**CWE / standards:** CWE-639, CWE-862; OWASP API1/API5.

**Affected surface:** `startServer`, `stopServer`, `getServer`, and `readServerLogAsync` (`services/orchestrator/src/agent/sandbox.ts:1069-1112`, `:1220-1328`); `executeTool` agent WebSocket tools `stop_server`, `read_server_log`, `screenshot_preview`, `interact_preview`, and `run_flow` (`services/orchestrator/src/agent/loop.ts:3015-3099`, `:3278-3307`); `resolvePreviewUrl` (`services/orchestrator/src/agent/screenshot.ts:195-219`).

**Affected code and evidence**

- `services/orchestrator/src/agent/sandbox.ts:1095-1112`: previews record project ID and a cryptographically random 128-bit ID.
- `services/orchestrator/src/agent/sandbox.ts:1220-1230`, `:1266-1283`, `:1286-1328`: stop/get/log operations use preview ID without an expected project ID.
- `services/orchestrator/src/agent/loop.ts:3015-3026`, `:3039-3099`, `:3278-3307`: agent tool paths invoke those unbound operations.
- `services/orchestrator/src/agent/screenshot.ts:195-219`: screenshot resolution follows the same handle-centric model.

**Why this is vulnerable**

The preview ID behaves as a bearer capability. Its 128 bits make guessing infeasible, which materially reduces severity, but any leak through logs, shared URLs, model context, screenshots, or collaborators lets another project context read logs, interact with, screenshot, or stop the victim preview because server-side operations do not assert project ownership.

**Exploit prerequisites:** Knowledge of a valid victim preview ID/URL; ability to invoke preview tools from another project/account.

**Realistic abuse scenario:** A victim shares a diagnostic transcript or URL containing the internal preview ID. A collaborator in another project passes that ID to `read_server_log`, `screenshot_preview`, `interact_preview`, or `stop_server`; the registry lookup succeeds because only the bearer ID is checked.

**Impact:** Cross-project preview observation, interaction, log disclosure, or denial of service. It does not directly establish source/database access.

**Safe validation:** Create two staging projects, obtain project A's canary preview ID through an authorized test harness, and attempt all management calls from project B. Every call must return indistinguishable not-found/forbidden without revealing metadata.

**Remediation:** Require `expectedProjectId` in every internal preview lookup/stop/log/screenshot/interact operation and compare it server-side. Separate a revocable, view-only share token from the internal control handle. Avoid placing control IDs in public URLs/logs.

**Proposed code change:** Change management signatures to forms such as `getServer(expectedProjectId, serverId)`, `stopServer(expectedProjectId, serverId)`, and `readServerLog(expectedProjectId, serverId)`. Perform a constant server-side `server.projectId === expectedProjectId` check before returning any metadata or executing an action; pass the current project ID from every agent-tool call site.

**Regression tests:** Cross-project calls fail for every operation; view share token cannot stop/read privileged logs; revoked/expired share token fails; internal preview ID is redacted from public logs.

**Resolution status (2026-07-14): Fixed**

- **Files changed:** `services/orchestrator/src/agent/sandbox.ts`, `services/orchestrator/src/agent/screenshot.ts`, `services/orchestrator/src/agent/interact.ts`, `services/orchestrator/src/agent/loop.ts`, `services/orchestrator/src/proxy.ts`, `services/orchestrator/src/server.ts`, `services/orchestrator/src/agent/sandboxIo.test.ts`.
- **Fix:** Internal preview get/stop/log/screenshot/interact/flow operations now require the caller's expected project ID and return no server on mismatch. Public proxy/share paths use a separate explicit view-capability lookup instead of the privileged project-control API.
- **Validation:** The sandbox I/O security test registers a preview and proves a different project cannot retrieve or stop it; all 12 targeted sandbox tests and the orchestrator type-check passed.
- **Remaining limitations:** Public view capabilities remain bearer tokens by design and retain their existing high entropy, expiry, and revocation requirements; they do not grant management/log access.

### F13 — Project admins can demote or remove the direct project owner

**Severity:** Medium  
**Confidence:** High  
**Class:** Role hierarchy / authorization integrity  
**CWE / standards:** CWE-269, CWE-862; OWASP A01; OWASP API5.

**Affected surface:** `handleCollabRoute`, `PATCH|DELETE /api/projects/:projectId/members/:targetUserId` (`services/orchestrator/src/collabRoutes.ts:40-68`, vulnerable branches at `:107-128`); `setProjectMemberRole`/`removeProjectMember` (`services/orchestrator/src/db/members.ts:214-229`); membership schema (`services/orchestrator/src/db/schema.sql:993-1003`).

**Affected code and evidence**

- `services/orchestrator/src/collabRoutes.ts:107-128`: member update/delete validates the actor but does not protect a target whose role is owner.
- `services/orchestrator/src/db/schema.sql:993-1000`: project-owner membership is a supported state.
- `services/orchestrator/src/db/members.ts:214-229`: mutation helpers update/delete the target membership without an owner-specific invariant.
- `services/orchestrator/src/collabRoutes.ts:419-441`: organization routes include the missing owner guard, demonstrating the intended pattern.

**Why this is vulnerable**

An admin should manage lower roles, not modify the principal that outranks them. Without a target-role check, a project admin can demote/remove a membership owner. Personal projects retain an implicit `owner_id`, which may prevent full ownership deletion in some paths, but direct project-owner membership and role integrity remain inconsistent.

**Exploit prerequisites:** Project admin membership and a target represented as an owner membership.

**Realistic abuse scenario:** A project admin sends `PATCH /api/projects/:projectId/members/:ownerId` with `{"role":"viewer"}` or deletes that membership, then uses their remaining admin control while the intended owner is locked out or demoted.

**Impact:** Loss of owner access, unauthorized control-plane changes, project lockout, or privilege inversion.

**Safe validation:** In staging, create owner/admin/editor members and attempt every role transition/removal. Admin→owner mutations must fail; only an owner may manage another owner under an explicit transfer/last-owner policy.

**Remediation:** Load the target membership before mutation. Only owners may modify owners; prevent removal/demotion of the last effective owner; require an explicit atomic ownership-transfer operation with audit logging.

**Proposed code change:** Before PATCH/DELETE, resolve `targetRole`; reject when `targetRole === "owner" && actorRole !== "owner"`. Move last-owner and ownership-transfer invariants into a database transaction/trigger so concurrent requests cannot bypass them, and expose a separate `transferProjectOwnership` operation instead of expressing transfer as two independent membership writes.

**Regression tests:** Admin cannot mutate owner; editor cannot mutate anyone; last owner cannot be removed; owner transfer is atomic and preserves exactly one/effective owner; absent memberships return non-enumerating errors.

**Resolution status (2026-07-14): Fixed**

- **Files changed:** `services/orchestrator/src/collabRoutes.ts`, `services/orchestrator/src/db/members.ts`, `services/orchestrator/src/db/schema.sql`, `services/orchestrator/src/collabRoutes.security.test.ts`, `services/orchestrator/src/db/schema.security.test.ts`.
- **Fix:** Mutations load the target's direct role; admins cannot demote/remove owners, missing members return 404, and the last direct owner cannot be changed or removed. A database trigger locks the parent project row before checking the last-owner invariant, closing the concurrent two-request race.
- **Validation:** Route tests cover admin demotion/removal denial and last-owner preservation; schema tests assert the serialized database trigger; targeted tests and type-check passed.
- **Remaining limitations:** A dedicated audited ownership-transfer endpoint is still not exposed; owner-to-owner changes remain constrained by the invariant rather than modeled as a separate product flow.

### F14 — Legacy guest session cookies survive web logout

**Severity:** Medium  
**Confidence:** High  
**Class:** Session invalidation  
**CWE / standards:** CWE-613 (Insufficient Session Expiration), CWE-384 (Session Fixation); OWASP A07.

**Affected surface:** `unsealGuestFromCookieHeader` (`services/orchestrator/src/auth/guest.ts:44-60`, `:128-146`); web `GET /api/guest/signout` handler (`apps/web/app/api/guest/signout/route.ts:12-15`); web `GET /api/guest/convert` handler (`apps/web/app/api/guest/convert/route.ts:22-53`); `GUEST_COOKIE_NAME`/clear options (`apps/web/lib/guest-session.ts:20-22`, `:76-88`).

**Affected code and evidence**

- `services/orchestrator/src/auth/guest.ts:44-60`, `:128-146`: accepts both `gate15-guest` and legacy `uniqus-guest` cookies.
- `services/orchestrator/src/auth/guest.ts:61-64`: guest session lifetime is one year.
- `apps/web/lib/guest-session.ts:20-22`: the web app defines only the new cookie name.
- `apps/web/app/api/guest/signout/route.ts:12-15`: logout expires only the new cookie.
- Conversion code at `apps/web/app/api/guest/convert/route.ts:51-53` addresses its own flow, but ordinary logout leaves an accepted legacy token in the browser.

**Why this is vulnerable**

The orchestrator preserves compatibility with a long-lived legacy credential while the UI's logout path clears only its replacement. On a shared device, a user can appear logged out while direct orchestrator API/WebSocket requests remain authorized by the legacy cookie.

**Exploit prerequisites:** Browser still holds a valid legacy guest cookie; another person or script can use the same browser/profile after logout.

**Realistic abuse scenario:** A user signs out of a guest workspace on a shared computer. The UI returns to login because it reads only `gate15-guest`, but a later user/script sends requests with the untouched `uniqus-guest` cookie and regains the prior guest projects over HTTP or WebSocket.

**Impact:** Continued access to the prior guest workspace/session on a shared device and misleading logout semantics.

**Safe validation:** Seed a disposable browser jar with only the legacy cookie, call the web logout route, then attempt an orchestrator guest API and WebSocket handshake. Both must fail after the fix.

**Remediation:** Expire both cookie names with identical path/domain/security attributes on every logout/conversion path. After a measured migration window, stop accepting the legacy cookie. For long-lived guest identities, add server-side session version/revocation so clearing a cookie is not the only invalidation mechanism.

**Proposed code change:** Export `LEGACY_GUEST_COOKIE_NAME = "uniqus-guest"` in the web session module and call `response.cookies.set(name, "", guestCookieClearOptions())` for both names in signout and successful conversion. Add an orchestrator cutoff/version check before eventually deleting the legacy parser.

**Regression tests:** New-only, legacy-only, and dual-cookie jars are all unauthorized after logout; conversion invalidates both; logout paths across domains use correct attributes; revoked guest tokens fail before their nominal expiry.

**Resolution status (2026-07-14): Fixed**

- **Files changed:** `apps/web/lib/guest-session.ts`, `apps/web/lib/guest-server.ts`, `apps/web/middleware.ts`, `apps/web/app/api/guest/signout/route.ts`, `apps/web/app/api/guest/convert/route.ts`, `apps/web/components/SettingsView.tsx`, `apps/web/components/ProjectPicker.tsx`, `apps/web/components/Workspace.tsx`.
- **Fix:** The web app recognizes the temporary legacy cookie where compatibility is required and expires both `gate15-guest` and `uniqus-guest` with matching domain/path/security attributes on logout and successful conversion. Logout UI now posts explicitly.
- **Validation:** Same-origin helper tests and web type-check cover the changed route/UI types; direct code review confirms both cookie names are cleared in both success paths.
- **Remaining limitations:** Guest sessions are still stateless sealed cookies; server-side session-version revocation and final removal of legacy-cookie acceptance remain a future migration after the compatibility window.

### F15 — Existing Supabase storage bucket privacy is trusted rather than verified

**Severity:** Medium  
**Confidence:** Medium; the code gap is confirmed but actual bucket privacy/policies were unavailable.  
**Class:** Storage misconfiguration / fail-open initialization  
**CWE / standards:** CWE-732 (Incorrect Permission Assignment for Critical Resource), CWE-284; OWASP 2025 A01/A02.

**Affected surface:** `ensureBucket` (`services/orchestrator/src/storage/client.ts:47-54`), called from orchestrator `main()` (`services/orchestrator/src/server.ts:747-750`). There is no public endpoint; this is startup/storage configuration.

**Affected code and evidence**

- `services/orchestrator/src/storage/client.ts:47-54`: initialization returns when a bucket with the expected name exists, without checking that `public` is false or that access policies match the intended private model.
- New bucket creation sets private state, but it does not repair or reject drift in an existing bucket.

**Why this is vulnerable**

Operational drift, manual recreation, or an older configuration can leave a named bucket public. The application then proceeds as if source/knowledge objects are private. Object paths may leak through logs, model context, URLs, or collaborators; public status would turn path disclosure into anonymous content access.

**Exploit prerequisites:** Existing bucket is public or has permissive policies; attacker obtains/guesses an object path. Neither condition was confirmed.

**Realistic abuse scenario:** An operator recreates the bucket as public during recovery. Startup sees the expected name and accepts it; an object path later copied from a log or model trace can then be fetched anonymously without going through project authorization.

**Impact:** Anonymous disclosure of source, knowledge documents, checkpoints, or other project artifacts stored in the bucket.

**Safe validation:** Query bucket metadata/policies in production without fetching user objects. Create a staging canary object and verify anonymous/public-key GET/list operations fail while the service-role path works.

**Remediation:** On startup/deploy, assert exact bucket privacy and required policies; fail closed or repair with an explicit migration. Alert on drift. Use opaque object paths, short signed URLs, and least-privilege storage policies in addition to the bucket flag.

**Proposed configuration/code change:** When `getBucket()` finds the named bucket, require `bucket.public === false`; otherwise set it private through an audited migration or fail the storage readiness check. Add a deployment-time SQL/policy assertion that anonymous roles have no object read/list path for project prefixes.

**Regression tests:** Existing public bucket causes startup health failure or controlled repair; anonymous list/get fails; signed URLs expire and are scoped; policy migration is idempotent.

**Resolution status (2026-07-14): Needs Manual Validation**

- **Files changed:** `services/orchestrator/src/storage/client.ts`, `services/orchestrator/src/storage/client.test.ts`, `services/orchestrator/src/server.ts`.
- **Fix applied in source:** Startup lists the named bucket, requires `public === false`, creates a missing bucket as private, and now fails orchestrator startup instead of continuing when the storage confidentiality check fails.
- **Validation:** Storage tests cover existing-private success, existing-public rejection, missing-bucket private creation, and pagination behavior; targeted tests and type-check passed.
- **Manual validation still required:** Query production bucket metadata and `storage.objects` policies, and verify anonymous/public-key list/get denial with a staging canary. The bucket flag assertion cannot prove policy state that was inaccessible during this run.

### F16 — Privileged host/rootfs build scripts execute mutable or unverified upstream artifacts

**Severity:** High  
**Confidence:** High for the weakness; exploitation requires compromise/tampering of an upstream, DNS/TLS path, mirror, or mutable release artifact.  
**Status:** Confirmed high-impact supply-chain hardening weakness; no upstream compromise or malicious artifact was detected.  
**Class:** Software supply chain / build integrity  
**CWE / standards:** CWE-494 (Download of Code Without Integrity Check), CWE-829 (Inclusion of Functionality from Untrusted Control Sphere); OWASP A03/A08; NIST SSDF PS.1/PS.2/PW.4.

**Affected surface:** Top-level privileged script entrypoints, with functions/endpoints not applicable: Firecracker/jailer/kernel acquisition (`infra/firecracker/host-setup.sh:53-98`); rustup bootstrap (`infra/firecracker/install-rust-toolchain.sh:29-39`); Alpine/APK/Cargo rootfs build (`infra/firecracker/build-rootfs.sh:60-112`).

**Affected code and evidence**

- `infra/firecracker/host-setup.sh:63-68`: downloads Firecracker artifacts without a repository-pinned checksum/signature verification step.
- `infra/firecracker/host-setup.sh:79-98`: selects a mutable/latest 5.10 kernel artifact.
- `infra/firecracker/install-rust-toolchain.sh:29-39`: downloads and executes rustup bootstrap code directly.
- `infra/firecracker/build-rootfs.sh:60-84`: downloads Alpine minirootfs and installs current repository packages without a complete pinned artifact manifest.
- `infra/firecracker/build-rootfs.sh:106-112`: Cargo build is not enforced with `--locked --frozen`.
- Nixpacks/rootfs package selections rely on names/channels rather than a committed digest/SBOM/provenance set.

**Why this is vulnerable**

These scripts run in privileged host/rootfs provisioning contexts. TLS protects transport but does not make a mutable filename/repository snapshot reproducible or defend against upstream/repository compromise. A changed artifact becomes trusted executable code with host or guest-image persistence.

**Exploit prerequisites:** Upstream/mirror/release/DNS/TLS compromise, mutable artifact replacement, or compromised package account. No current compromise was detected.

**Realistic abuse scenario:** A mutable Firecracker/kernel/minirootfs release or package mirror is replaced after review. A privileged provisioning run downloads and installs the changed executable/image without comparing it to an independently pinned digest, persisting attacker code on the host or in every new guest rootfs.

**Impact:** Production host takeover, malicious rootfs/kernel/agent, durable cross-tenant credential theft, or compromised developer/build systems.

**Safe validation:** In CI, download artifacts unprivileged, compare to committed SHA-256/signature/provenance metadata, and deliberately substitute one byte to ensure the build stops before extraction/execution. Generate and compare SBOMs.

**Remediation:** Pin immutable versions and digests; verify vendor signatures/checksums and provenance before privileged installation; snapshot Alpine repositories or pin package versions; use `cargo build --locked --frozen`; pin container/Nix inputs by digest/revision; build unprivileged then promote verified outputs; retain SBOM and attestation per release.

**Proposed pattern:**

```sh
curl --fail --location --output "$tmp/firecracker.tgz" "$immutable_url"
echo "$FIRECRACKER_SHA256  $tmp/firecracker.tgz" | sha256sum --check --status
tar -xzf "$tmp/firecracker.tgz" -C "$tmp/verified"
```

Checksums must be reviewed/pinned separately, not downloaded from the same mutable location in the same trust step.

**Regression tests:** Digest/signature mismatch is fatal; offline/frozen build resolves no new dependency; SBOM contains expected kernel/Firecracker/agent/package versions; privileged install accepts only verified staging artifacts.

**Resolution status (2026-07-14): Blocked**

- **Files changed:** `infra/firecracker/host-setup.sh`, `infra/firecracker/install-rust-toolchain.sh`, `infra/firecracker/build-rootfs.sh`.
- **Hardening completed:** Firecracker 1.12.1, the 5.10.223 kernel, Alpine 3.22.3 minirootfs, and the immutable rustup-init 1.28.2 binary now have pinned default URLs and repository-pinned SHA-256 digests that are checked before extraction or execution. Provisioning uses a restrictive umask; Rust is pinned to 1.97.0; Cargo fetches with `--locked` and the build runs `--locked --offline`.
- **Validation:** All four pinned artifacts were downloaded independently during this run and matched the committed digests. `bash -n` passed for all four Firecracker provisioning scripts after normalizing their line endings.
- **Blocker / remaining limitation:** Alpine `apk update/add` and host `apt-get` still resolve mutable channel packages, so the complete privileged build is not yet reproducible or independently attested. Full closure requires an immutable Alpine/APT snapshot or checked package manifest, an SBOM/provenance record, and a Linux tamper/offline image-build test; those trusted snapshot inputs and a Linux build host were unavailable. The verified direct-artifact work materially narrows the gap but does not justify marking the whole finding fixed.

### F17 — Patchable npm advisories remain and no repository CI security gates are defined

**Severity:** Medium  
**Confidence:** High  
**Class:** Vulnerable/outdated components / security-process gap  
**CWE / standards:** CWE-1104 (Use of Unmaintained Third-Party Components); OWASP A03/A06/A08; NIST SSDF RV.1/RV.2.

**Affected surface:** Dependency/build configuration, with functions/endpoints not applicable: Turbo scripts/range (`package.json:11-17`); orchestrator `vitest run`, `@google/genai`, `tsx`, and Vitest ranges (`services/orchestrator/package.json:12`, `:16`, `:42`, `:44`); Next scripts/range (`apps/web/package.json:6-8`, `:18`). Exact resolved entries are `package-lock.json:532-535` (`@google/genai`), `:2871-2874` (esbuild), `:4546-4549` (Next), `:4598-4601` (Next-internal PostCSS), `:4988-4991` (top PostCSS), `:5199-5202` (protobufjs), `:6039-6043` (Turbo), `:6249-6253` (Vite), and `:6378-6382` (Vitest).

**Affected code and dependency evidence**

- Vitest 3.2.4: Critical [GHSA-5xrq-8626-4rwp](https://github.com/advisories/GHSA-5xrq-8626-4rwp), patched in 3.2.6. Exploitation requires a network-exposed Vitest API/UI or UI/browser mode on Windows. This repository's normal command is `vitest run`, so no active production path was found.
- Vite 7.3.3: High [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff), patched in 7.3.5. The relevant condition is a network-exposed Vite dev server on Windows plus a sensitive file in allowed directories; here Vite is brought through test tooling.
- Vite also has the development-only NTLM/UNC issue [GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3).
- Turbo 2.9.6: login-flow CSRF/session fixation [GHSA-hcf7-66rw-9f5r](https://github.com/advisories/GHSA-hcf7-66rw-9f5r) and local Yarn-detection execution [GHSA-3qcw-2rhx-2726](https://github.com/advisories/GHSA-3qcw-2rhx-2726); upgrade to at least 2.9.14.
- Production tree: PostCSS/Next moderate (conditional attacker-controlled CSS stringification; no path found), protobufjs 7.6.1 moderate through `@google/genai` (requires attacker-derived schema/name inputs; no path found), and esbuild low (local Windows dev-server condition). No production high/critical advisory was reported.
- No `.github` workflows, Dependabot/Renovate policy, CodeQL/SAST, secret scanning, SBOM, or audit gate is committed in the repository.

**Why this is vulnerable**

The headline critical/high severities are not equivalent to a remotely exploitable production vulnerability in the observed usage, but the versions are patchable and developer tooling is often run with repository/workstation access. Absence of automated gates makes recurrence and unnoticed production-reachable advisories likely.

**Exploit prerequisites:** Advisory-specific: exposed development/test service, malicious local repository/worktree, or attacker-controlled input reaching the affected production library behavior.

**Realistic abuse scenario:** A developer or CI worker starts Vitest UI/Vite on a reachable Windows interface while reviewing an untrusted project, or invokes Turbo's affected local detection/login flow. An attacker meeting the advisory's network/local preconditions uses the known issue to read an allowed file, execute local behavior, or fix a login session. No such production service was found.

**Impact:** Developer-file disclosure or local code execution, dependency compromise lag, and future production exposure if tool usage changes.

**Safe validation:** Upgrade in a branch/worktree or controlled local change, run typecheck/tests/build, and rerun both full and `--omit=dev` audits. Verify no Vite/Vitest service binds externally in CI/development defaults.

**Remediation:** Upgrade Vitest ≥3.2.6, Vite ≥7.3.5, Turbo ≥2.9.14, and dependencies that lift protobufjs/PostCSS to fixed supported versions. Do not accept an automated fix that downgrades Next.js outside the supported product baseline. Add CI dependency gates with a production severity threshold and explicit time-bounded triage for dev-only advisories.

**Proposed package/config change:** Update the direct dev dependencies to fixed supported releases, refresh `package-lock.json` with `npm install`, and use an `overrides` entry only when the owning package officially supports the overridden transitive version. Add a CI job for production and full audits; represent temporary dev-only exceptions in a reviewed file with advisory ID, reachability rationale, owner, and expiry.

**Regression tests/gates:** `npm ci`, typecheck, unit/integration tests, production build, `npm audit --omit=dev --audit-level=high`, full audit with documented allowlist expiries, OSV/Dependabot scan, and lockfile diff review.

**Resolution status (2026-07-14): Fixed**

- **Files changed:** `package.json`, `package-lock.json`, `apps/web/package.json`, `services/orchestrator/package.json`, `.github/workflows/security.yml`.
- **Fix:** Direct tooling and transitive dependencies were upgraded to patched supported releases. Next remains on the supported 15.5 line; a root resolution anchor plus a scoped override replaces its vulnerable pinned PostCSS with 8.5.19 without a framework major upgrade. CI now performs locked installation, production and full-toolchain audit gates, monorepo type-check, orchestrator tests, web production build, and locked Rust tests on pushes to `main` and pull requests; third-party actions are pinned by commit.
- **Validation:** A clean `npm ci` succeeded; `npm ls postcss next --all` resolved only PostCSS 8.5.19; `npm audit --json` reported 0 vulnerabilities. Both workspace type-checks, the targeted security suites, and the Next production build passed.
- **Remaining limitations:** The committed audit gate fails High/Critical findings; future Moderate findings still require review rather than automatically failing CI. Dependabot/OSV scheduling, full-history secret scanning, SBOM generation, and expiring advisory exceptions remain useful release-process additions but no known npm advisory remains in the current lockfile.

### F18 — VM state/snapshot filesystem protection and service hardening are not defined in tracked configuration

**Severity:** Medium  
**Confidence:** Medium; repository omissions are confirmed, deployed ownership/modes/encryption may be stronger.  
**Class:** Host data protection / secure configuration  
**CWE / standards:** CWE-276 (Incorrect Default Permissions), CWE-732, CWE-311 (Missing Encryption of Sensitive Data); OWASP 2025 A02/A04; CIS Ubuntu 24.04 control themes.

**Affected surface:** Top-level host setup (`infra/firecracker/host-setup.sh:77-98`); internal `snapshotPaused`/`restoreFromSnapshot` (`services/orchestrator/src/firecracker/fleet.ts:956-1015`), `ensureSandboxImage` (`:1364-1380`), and `snapshotPaths` (`:1538-1546`). There is no public endpoint; VM lifecycle is triggered indirectly by agent WebSocket activity and the idle sweeper.

**Affected code and evidence**

- `infra/firecracker/host-setup.sh:77-98`: creates/uses runtime artifact locations without an explicit complete owner/mode/umask policy.
- `services/orchestrator/src/firecracker/fleet.ts:273`, `:1364-1374`: manages VM state/project disks under host paths.
- `services/orchestrator/src/firecracker/fleet.ts:1538-1546`: writes snapshot state/memory artifacts.
- No tracked production `uniqus-orchestrator` systemd unit was available to verify `User`, `Group`, `UMask`, `ProtectSystem`, `ProtectHome`, `PrivateTmp`, capabilities, syscall filters, or read/write path restrictions.

**Why this is vulnerable**

Snapshots contain guest memory; project disks contain source and possibly generated credentials. If directories/files inherit permissive modes, service group membership is broad, backups are unencrypted, or deletion is not controlled, local host users/agents can read tenant state. Code-level deletion is not cryptographic erasure, especially on copy-on-write storage/backups.

**Exploit prerequisites:** Local host access, overly broad service/group permissions, backup/storage access, or stolen disk; actual conditions are unverified.

**Realistic abuse scenario:** A low-privilege host account or backup operator reads a world/group-readable Firecracker memory snapshot or project disk. The snapshot contains live process memory and the disk contains tenant source, so application-level project authorization is bypassed entirely.

**Impact:** Cross-project source, tokens, in-memory secrets, and user-data disclosure; persistence in backups after deletion.

**Safe validation:** On production, record only metadata: `stat` relevant directories/files, mount/encryption properties, service UID/groups, `systemctl cat uniqus-orchestrator`, `systemd-analyze security`, backup ACL/retention, and deletion lifecycle. Do not inspect tenant contents.

**Remediation:** Dedicated unprivileged service identity; `UMask=0077`; directories 0700 and files 0600; root-owned immutable kernel/rootfs; narrowly scoped `ReadWritePaths`; systemd sandboxing and capability reduction; encrypted host volume/backups with separated keys; documented retention and crypto-erasure strategy; audit access.

**Proposed configuration change:** Commit the production systemd unit (or a hardened drop-in) with at least `User`/`Group`, `UMask=0077`, `NoNewPrivileges=yes`, `ProtectSystem=strict`, `ProtectHome=yes`, `PrivateTmp=yes`, an empty/default-denied capability set plus only justified exceptions, and explicit `ReadWritePaths` for `/var/lib/uniqus` and required runtime paths. Make host setup install directories with `install -d -m 0700 -o <service-user> -g <service-group>` and files with 0600.

**Regression tests/operational checks:** Provisioning test asserts modes/owners; systemd security baseline has an enforced score/control set; backup restore preserves ACLs; expired/deleted project snapshots are absent after retention window; service cannot read unrelated host paths.

**Resolution status (2026-07-14): Needs Manual Validation**

- **Files changed:** `infra/firecracker/host-setup.sh`, `infra/firecracker/build-rootfs.sh`, `infra/firecracker/uniqus-orchestrator-hardening.conf`.
- **Fix applied in source:** Provisioning now uses `umask 0077`, installs the Firecracker state directory as 0700, and reasserts root ownership/modes for kernel and rootfs artifacts. Host setup installs a tracked orchestrator systemd drop-in with `UMask=0077`, `NoNewPrivileges`, private temporary storage, home/kernel-log/control-group protection, SUID/SGID restriction, personality locking, and native syscall architecture restriction.
- **Validation:** Shell syntax passed and the tracked unit/drop-in were reviewed for the asserted controls.
- **Manual validation still required:** On Hetzner, run `stat`, `systemctl cat uniqus-orchestrator`, and `systemd-analyze security`; confirm new and existing project disks/snapshot memory files are 0600 beneath 0700 directories; verify backup ACLs, volume/backup encryption, retention, and deletion. The service still runs with its existing privileged identity and `ProtectSystem=full`, not a dedicated jailer/helper UID with `ProtectSystem=strict`; that larger privilege split is coupled to blocked F04 and must be canaried on Linux before tightening further.

## Lower-severity and informational hardening findings

These seven items are not included in the 18 primary-finding count, but are structured to the same validation standard. They are either Low/Informational or depend on a separate vulnerability/configuration before impact.

### H01 — Logout uses state-changing GET routes

**Severity:** Low  
**Confidence / status:** High; confirmed logout-CSRF weakness with availability/UX-only impact.  
**CWE / OWASP:** CWE-352 (CSRF); OWASP 2025 A01.  
**Affected surface:** WorkOS `GET /api/signout`, `GET` handler (`apps/web/app/api/signout/route.ts:3-7`); guest `GET /api/guest/signout`, `GET` handler (`apps/web/app/api/guest/signout/route.ts:12-15`).

**Technical explanation and evidence:** Both endpoints mutate session state in response to a top-level GET. SameSite=Lax cookies are normally sent on top-level cross-site navigations, so an external page can trigger logout. WorkOS performs upstream logout as well as cookie removal.

**Prerequisites / realistic abuse:** A victim is logged in and visits an attacker-controlled page containing an image/navigation/link to the signout route. The victim is unexpectedly logged out and may lose unsaved workflow state.

**Impact:** Session termination and user disruption; no account takeover or data disclosure was shown.

**Safe validation:** In a staging browser, navigate from a different origin to each endpoint and observe whether the canary session is terminated. Do not test another user's session.

**Remediation and proposed patch:** Replace GET mutation with `POST`; verify same-site `Origin`/CSRF token; make the UI submit an explicit form/fetch. A GET can render a confirmation page but must not sign out.

**Regression tests:** Cross-origin GET does not terminate a session; cross-origin POST fails; same-origin authenticated POST clears/revokes the intended session and redirects safely.

**Resolution status (2026-07-14): Fixed**

- **Files changed:** `apps/web/lib/same-origin.ts`, `apps/web/lib/same-origin.test.ts`, `apps/web/app/api/signout/route.ts`, `apps/web/app/api/guest/signout/route.ts`, `apps/web/components/SettingsView.tsx`, `apps/web/components/ProjectPicker.tsx`, `apps/web/components/Workspace.tsx`.
- **Fix:** Both logout endpoints now accept only same-origin `POST` requests. The UI uses explicit POST forms, and cross-origin or missing-origin mutation attempts are rejected before session state changes.
- **Validation:** Unit tests cover accepted same-origin POSTs and rejected cross-origin, malformed, missing-origin, and GET requests. The changed routes and forms were reviewed for POST-only behavior.
- **Remaining limitations:** Browser-level WorkOS and guest-cookie revocation still requires staging validation with real sessions; the local tests exercise the origin gate rather than the external identity-provider redirect.

### H02 — Some API paths return raw internal error text

**Severity:** Low  
**Confidence / status:** High for the disclosure pattern; no credential-bearing response was found.  
**CWE / OWASP:** CWE-209 (Generation of Error Message Containing Sensitive Information); OWASP 2025 A02.  
**Affected surface:** `main()` HTTP crash wrapper (`services/orchestrator/src/server.ts:770-780`) plus import/deployment handlers that interpolate caught exception text; guest error paths in `services/orchestrator/src/auth/guest.ts:179-215`.

**Technical explanation and evidence:** Public JSON errors can include filesystem, provider, dependency, SQL/client, or operational messages. The reviewed paths did not intentionally append secrets, but upstream exceptions can change and accidental echo is difficult to reason about globally.

**Prerequisites / realistic abuse:** An anonymous or authenticated caller repeatedly supplies malformed inputs or induces provider/import failures, collecting differences in raw messages to identify paths, services, versions, account configuration, or operational state.

**Impact:** Reconnaissance, configuration/path disclosure, account enumeration in poorly normalized branches, or future secret leakage if an upstream error includes request material.

**Safe validation:** In staging, exercise known validation/provider failures using canaries and assert public responses contain only approved codes/messages while internal logs retain a correlation ID and redacted cause.

**Remediation and proposed patch:** Centralize `publicError(err)` mapping to stable codes; generate a request/correlation ID; keep structured stack/provider details only in access-controlled logs after secret redaction. Never interpolate raw `err.message` into anonymous responses.

**Regression tests:** Snapshot the public error schema for every route class; seed exceptions containing a canary secret/path and prove it appears neither in response nor unredacted logs; preserve useful retryable/status metadata.

**Resolution status (2026-07-14): Fixed**

- **Files changed:** `services/orchestrator/src/security/publicError.ts`, `services/orchestrator/src/security/publicError.test.ts`, `services/orchestrator/src/server.ts`, `services/orchestrator/src/import.ts`, `services/orchestrator/src/deploy.ts`, `services/orchestrator/src/auth/guest.ts`.
- **Fix:** Generic crash, import, deployment, and guest failure paths now return a stable public error code plus a request ID. Internal logging records only a bounded cause class/code and correlation ID instead of reflecting raw exception text to clients.
- **Validation:** Canary tests prove a secret-bearing exception appears in neither the public payload nor the sanitized log record; targeted tests and orchestrator type-check cover the changed call sites.
- **Remaining limitations:** Intentionally authored validation errors remain specific so users can correct input. The mapping should be used by future generic catch blocks; it does not attempt to replace every safe domain validation message.

### H03 — AES-GCM records lack domain/row AAD and key-version metadata

**Severity:** Informational (cryptographic hardening; contributes to F02)  
**Confidence / status:** High  
**CWE / OWASP:** CWE-345 (Insufficient Verification of Data Authenticity), CWE-320 (Key Management Errors); OWASP 2025 A04.  
**Affected surface:** `loadKey`, `encryptToken`, and `decryptToken` (`services/orchestrator/src/auth/encrypt.ts:8-53`); callers storing OAuth/BYOK/project credential ciphertext.

**Technical explanation and evidence:** AES-256-GCM supplies confidentiality/integrity and uses random nonces, but ciphertext authenticates only bytes—not the intended table, purpose, user, provider, or row. The blob has no key/version identifier for controlled rotation. This permits cross-context ciphertext transplant wherever an attacker gains a write primitive, as in F02.

**Prerequisites / realistic abuse:** An attacker or faulty migration can copy a valid ciphertext blob between compatible records. `decryptToken` accepts it because the original logical context is not authenticated.

**Impact:** Cross-row/purpose substitution, difficult key rotation, and larger blast radius for a single key. This does not by itself reveal plaintext.

**Safe validation:** Encrypt a canary for user/provider A, copy the blob to B, and observe current decryption success; after migration the same copy must fail authentication. Never use production credentials.

**Remediation and proposed patch:** Add a versioned envelope `{v,keyId,nonce,ciphertext,tag}` and pass canonical AAD such as `gate15:<purpose>:<record-id>:<owner-id>`. Implement dual-read/single-write migration and KMS/envelope-key rotation with audit logs.

**Regression tests:** Cross-purpose/row/owner transplant fails; legacy blobs migrate once; old/new key versions decrypt during the window; unknown versions fail closed; nonce uniqueness is statistically monitored in tests.

**Resolution status (2026-07-14): Fixed**

- **Files changed:** `services/orchestrator/src/auth/encrypt.ts`, `services/orchestrator/src/auth/encrypt.test.ts`, `services/orchestrator/src/db/providerKeys.ts`, `services/orchestrator/src/db/secrets.ts`, `services/orchestrator/src/db/users.ts`, `services/orchestrator/src/auth/guest.ts`.
- **Fix:** New ciphertext uses a versioned AES-GCM envelope with an explicit key ID and canonical purpose/owner/record AAD. Callers bind provider keys, project secrets, OAuth tokens, and guest recovery credentials to their logical row context. Legacy blobs remain read-compatible during rotation, while all new writes use v2 and unknown versions or key IDs fail closed.
- **Validation:** Tests cover row/purpose transplant rejection, nonce uniqueness, legacy dual-read, active-key rotation, removed-key rejection, and unknown-version rejection; targeted tests and type-check passed.
- **Remaining limitations:** Existing legacy ciphertext migrates on the next successful write rather than through an eager bulk rewrite. Operators must retain the legacy key until those records have been rotated and must configure the keyring consistently across replicas.

### H04 — Turnstile verification does not bind the expected action and hostname

**Severity:** Low  
**Confidence / status:** High for the code gap; runtime exploitability depends on Cloudflare widget/domain configuration.  
**CWE / OWASP:** CWE-345; OWASP 2025 A07.  
**Affected surface:** `verifyTurnstile` for guest create/restore (`services/orchestrator/src/auth/turnstile.ts:48-77`); browser widget action `guest` (`apps/web/components/GuestLoginActions.tsx:187`); orchestrator guest endpoints `POST /api/guest` and `POST /api/guest/restore`.

**Technical explanation and evidence:** The server checks token success but not that Cloudflare returned the expected `action` and configured hostname. A valid token minted for another action/allowed hostname under the same widget configuration may therefore satisfy the guest gate. Cloudflare recommends checking expected fields in [server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).

**Prerequisites / realistic abuse:** The attacker can obtain a valid token for a different permitted action/hostname that the same secret accepts, then submits it to guest create/restore. Tokens remain single-use/short-lived under Cloudflare's controls, limiting reuse.

**Impact:** Weakened signup-abuse control and increased resource/spend abuse; it is not an authentication bypass into an existing user's account.

**Safe validation:** In a staging widget, mint tokens with a deliberately different action/hostname and confirm they are rejected without creating an account. Use only Cloudflare's documented test keys or owned widget.

**Remediation and proposed patch:** Parse `action` and `hostname`; require `action === "guest"` and membership in an exact configured hostname set. Add a production readiness check requiring the public site key and secret together; keep the intentional unset-secret local-dev behavior explicit.

**Regression tests:** Correct action/hostname succeeds; wrong/missing action, wrong hostname, timeout, duplicate token, and non-2xx fail closed; paired-env readiness fails on one-sided configuration.

**Resolution status (2026-07-14): Needs Manual Validation**

- **Files changed:** `services/orchestrator/src/auth/turnstile.ts`, `services/orchestrator/src/auth/turnstile.test.ts`.
- **Fix applied in source:** Verification now caps token length, requires Cloudflare's returned `action` to equal `guest`, and requires the returned hostname to match an exact configured allowlist from `TURNSTILE_ALLOWED_HOSTNAMES` or `WEB_ORIGIN`. When enforcement is enabled but no hostname can be derived, signup fails closed.
- **Validation:** Tests cover valid action/hostname, wrong or missing action, wrong hostname, missing hostname configuration, oversized and missing tokens, timeout, non-2xx, malformed JSON, and unsuccessful verification. The response-field checks follow Cloudflare's current server-side validation guidance.
- **Manual validation still required:** Verify the Vercel site key and Hetzner secret are deployed together, configure the exact production/staging hostname set, and use owned staging widgets/test keys to prove cross-action and cross-host tokens are rejected. Live Cloudflare and deployment configuration were unavailable in this run.

### H05 — No explicit application CSP and framing policy was found

**Severity:** Informational  
**Confidence / status:** Medium; absent in source, but an edge may inject headers. No exploitable XSS path was identified.  
**CWE / OWASP:** CWE-693 (Protection Mechanism Failure), CWE-1021 (Improper Restriction of Rendered UI Layers or Frames); OWASP 2025 A02.  
**Affected surface:** Next.js response configuration (`apps/web/next.config.mjs:26-46`); all web document responses unless Vercel/edge configuration supplies equivalent headers.

**Technical explanation and evidence:** Source configuration does not set CSP, `frame-ancestors`, `X-Content-Type-Options`, or a minimal Permissions-Policy. CSP is defense in depth rather than a substitute for output encoding; framing controls prevent UI redress even without XSS.

**Prerequisites / realistic abuse:** A separate script/HTML injection or third-party-script compromise is needed for CSP impact; an attacker can frame a sensitive page if no upstream frame control exists and lure clicks through an overlay.

**Impact:** Larger blast radius for a future XSS/supply-chain event and possible clickjacking. Current runtime headers were not available.

**Safe validation:** Fetch staging document responses and record headers; use a harmless external frame page to confirm denial; run CSP Report-Only and inspect only canary violations before enforcement.

**Remediation and proposed config:** Add nonce/hash-aware CSP compatible with Turnstile and required providers, `frame-ancestors 'none'` unless embedding is required, `X-Content-Type-Options: nosniff`, strict Referrer-Policy, and a minimal Permissions-Policy. Avoid broad `unsafe-inline`/wildcards; deploy Report-Only first.

**Regression tests:** Header integration tests on representative routes; frame load fails; CSP permits required WorkOS/Turnstile flows; injected inline canary script is blocked; report endpoint does not log sensitive document data.

**Resolution status (2026-07-14): Needs Manual Validation**

- **Files changed:** `apps/web/lib/security-headers.ts`, `apps/web/lib/security-headers.test.ts`, `apps/web/middleware.ts`, `apps/web/app/layout.tsx`.
- **Fix applied in source:** Middleware generates a per-request nonce, supplies it to Next and the root inline bootstrap, and emits CSP with nonce/`strict-dynamic`, `frame-ancestors 'none'`, constrained connect/frame/form sources, and no production script `unsafe-inline`/`unsafe-eval`. Responses also receive `nosniff`, DENY framing, strict referrer policy, and a minimal Permissions Policy.
- **Validation:** Two security-header tests passed, the web type-check passed, and the production Next build completed under the nonce-aware configuration.
- **Manual validation still required:** Exercise WorkOS login/logout, Turnstile, project previews, WebSockets, fonts, and worker/blob flows on an owned staging deployment while collecting CSP violations; verify real response headers and external framing denial before treating the policy as production-proven. `style-src 'unsafe-inline'` remains for the current Next/CSS stack and should be narrowed only with measured staging evidence.

### H06 — The web build process loads the repository-root environment

**Severity:** Informational  
**Confidence / status:** High for process exposure; no client-bundle secret leak was found.  
**CWE / OWASP:** CWE-200; OWASP 2025 A04/A08.  
**Affected surface:** top-level environment loading in Next configuration (`apps/web/next.config.mjs:5-23`); web build/server process, not a public endpoint.

**Technical explanation and evidence:** The web build can read all root `.env` values even when only a subset is needed. Next.js does not automatically bundle non-`NEXT_PUBLIC_` variables, and no leak was detected, but build plugins/dependencies/config changes execute with those credentials and can accidentally inline or log them.

**Prerequisites / realistic abuse:** A compromised build dependency, malicious config change, or accidental client reference reads an unrelated orchestrator/provider secret from `process.env` during build and writes it to output/logs.

**Impact:** Build-time credential exposure and a wider supply-chain blast radius; not a confirmed browser disclosure.

**Safe validation:** Build with synthetic canaries in variables the web does not need, then scan `.next`, source maps, logs, and deployment artifacts for the canaries without using real secrets.

**Remediation and proposed config:** Stop loading the root environment wholesale. Supply an explicit allowlist to the web build/runtime and keep orchestrator/provider credentials in a separate environment scope. Fail build on references to forbidden server variables from client modules.

**Regression tests:** Canary secrets absent from bundles/source maps/logs; build fails when a client module imports a server-only env helper; deployment manifest lists only approved web variables.

**Resolution status (2026-07-14): Fixed**

- **Files changed:** `apps/web/next.config.mjs`.
- **Fix:** The local repo-root `.env.local` fallback now imports only the explicit WorkOS and `NEXT_PUBLIC_*` values the web application uses; provider keys, database credentials, Firecracker settings, and other orchestrator secrets are ignored by the custom loader.
- **Validation:** Source review confirms the allowlist is applied before assignment to `process.env`; web type-check and production build passed.
- **Remaining limitations:** Vercel and invoking shells can still inject process environment directly, so deployment-level environment scoping remains operationally required. Add a synthetic bundle canary scan to CI if the web dependency/plugin surface expands.

### H07 — Tracked local coding-agent profiles grant broad workstation capability

**Severity:** Informational (developer-workstation hardening)  
**Confidence / status:** High; intentional configuration, not a production Gate 15 vulnerability.  
**CWE / OWASP:** CWE-250 (Execution with Unnecessary Privileges); OWASP 2025 A02/A08.  
**Affected surface:** Codex project config (`.codex/config.toml:1-56`, especially danger-full-access/no approvals at `:6-8` and network at `:15-56`); Claude permissions (`.claude/settings.local.json:1-50`, especially `Bash(*)`/`PowerShell(*)` at `:3-9` and broad read/web scopes).

**Technical explanation and evidence:** Once the repository is trusted, local agents can execute arbitrary shell/PowerShell and reach many domains without approval. Those powers are useful for this repository, but repository/imported prompt injection can turn them against developer credentials, source, git remotes, or deployment tooling.

**Prerequisites / realistic abuse:** A developer opens/trusts malicious content and lets an agent process it; the model follows an injected instruction that invokes broad shell/network capability. This is separate from the product's sandboxed end-user agent.

**Impact:** Developer workstation/source/credential compromise and unauthorized external actions within the developer's identity.

**Safe validation:** Use a disposable workstation/profile and a harmless canary file/domain to verify which operations occur without approval. Do not place real credentials in the test profile.

**Remediation and proposed config:** Keep broad personal overrides untracked; make repository defaults workspace-write and approval-required for shell/network/git/deploy/credential paths; reduce domain scopes; deny home credential directories; document when elevated mode is temporarily necessary.

**Regression tests/operational checks:** Fresh clone loads least-privilege defaults; canary home-file read and external POST require approval/deny; repository tests/build still run under the normal profile; elevated profile is explicit, time-bounded, and locally owned.

**Resolution status (2026-07-14): Fixed**

- **Files changed:** `.codex/config.toml`, `.gitignore`; removed tracked `.claude/settings.local.json`.
- **Fix:** Repository Codex defaults now use workspace-write with on-request approval, and the network domain allowlist was reduced to the services needed by this project. The machine-specific Claude profile granting wildcard Bash/PowerShell and broad filesystem/web access is no longer tracked and its path is ignored so elevated personal settings stay local.
- **Validation:** Configuration diff review confirms the wildcard local profile is absent and ignored while normal repository commands remain available through explicit approval.
- **Remaining limitations:** Users can still choose a personal elevated profile or bypass approvals deliberately; workstation policy cannot prevent that. A disposable fresh-clone canary remains the strongest end-to-end validation of each local agent product's current enforcement.

## Verified mitigations and false-positive dispositions

The following apparent issues were traced and **not** reported as vulnerabilities in the reviewed source:

- **WorkOS session forgery/staleness:** AuthKit validates SDK cookies; the server verifies session status, binds user/session identity, fails closed, and uses only a short positive cache.
- **Cross-site WebSocket/CORS:** CORS uses exact allowed origins; WebSocket upgrade validates Origin; project membership is rechecked on events rather than trusted forever from the initial handshake.
- **Preview-cookie theft:** Previews use an isolated origin outside the authenticated application's cookie domain.
- **OAuth login CSRF/token swapping:** OAuth state is sealed and user/session-bound, return destinations are allowlisted, and Supabase uses PKCE.
- **Generic HTTP/browser SSRF through redirects/DNS:** HTTP and browser paths validate/pin addresses and redirects; browser contexts are fresh, so no victim browser cookies are inherited. F11 is a separate PostgreSQL resolution gap.
- **Connector secret injection to arbitrary hosts:** HTTP secret injection requires HTTPS, exact owner-configured allowed hosts, and no redirect-based leakage.
- **ZIP/Git traversal:** ZIP extraction has traversal/decompression/file-count controls after initial buffering; Git import scrubs PAT data and disables symlink behavior. F07 concerns pre-inspection memory, not traversal.
- **Database-backed project-secret exposure to the model/VM:** Project secrets are encrypted, names-only/write-only in normal surfaces, and redacted; no path mounting them in the sandbox/model was found. F01 concerns deliberate deployment export.
- **Raw file traversal/symlink and SVG active content:** File operations contain containment/symlink checks and sensitive-path filtering; SVG is served as text attachment rather than active inline content. F10 concerns uncovered alternate paths.
- **New storage bucket defaults:** Creation uses private status. F15 concerns existing-bucket drift.
- **Sandbox-agent unauthenticated control:** Per-VM bearer authentication is mandatory and compared safely; rootfs is read-only with per-project disks; default seccomp is not disabled. F05 concerns pre-auth snapshot bootstrap, and F04 the host-side jailer.
- **Guessable previews/share links:** IDs/tokens have high entropy, are expiring/revocable where designed. F12 requires a leaked ID rather than guessing.
- **Organization owner deletion:** Organization routes and database triggers protect the last owner; F13 is limited to project memberships.
- **Straightforward stored XSS/raw Markdown:** No model/user-controlled raw-HTML renderer or relevant `dangerouslySetInnerHTML` path was found.
- **Direct SQL injection:** Reviewed application queries use parameterized client APIs. Shell execution is an intentional sandbox capability rather than an orchestrator shell interpolation path.
- **Committed live credentials:** High-confidence tracked-tree patterns did not identify real credentials. Generated bundles/regex fixtures produced false positives, and an early commit tracked `.next` output; a dedicated full-history secret scanner is still recommended. This report intentionally contains no secret values.
- **Production exposure of dev dependency advisories:** No evidence showed Vitest/Vite UI/dev servers exposed in production. They remain patchable supply-chain/developer risks under F17.

## Dependency and secret-scanning details

### npm dependency posture

Installed relevant versions included Next 15.5.18, Next's internal PostCSS 8.4.31, top-level PostCSS 8.5.14, `@google/genai` 2.7.0 → protobufjs 7.6.1, `tsx` → esbuild 0.27.7, Vitest 3.2.4 → Vite 7.3.3, and Turbo 2.9.6. The full audit produced seven advisory records; the production-only audit produced four and no High/Critical result. Advisory severity must therefore be paired with reachability, as done in F17, rather than treated as proof of production exploitation.

### Rust dependency posture

The Cargo lockfile contained 22 packages for the sandbox agent. An [OSV query batch](https://osv.dev/docs/#tag/vulnerability/operation/querybatch) returned no advisory. `cargo-audit` could not be built on this Windows host due to a missing GNU `dlltool.exe`, so CI/Linux should run the canonical RustSec database check as a follow-up.

### Credential review limitations

The review searched the tracked tree for high-confidence provider/cloud/token/private-key formats and did not inspect `.env.local` values. Because regex scanning is incomplete and early history included generated `.next` artifacts, run Gitleaks (or an equivalent entropy+format scanner) over **all history**, then manually validate matches without copying values into tickets/logs. If a real historical secret is found, rotate/revoke it before considering history rewriting.

## Compliance and control-gap matrix

This is a source-level readiness comparison, not a certification or legal opinion.

| Framework/control theme | Existing evidence | Principal gaps / actions |
|---|---|---|
| OWASP Top 10 2025 — A01 Broken Access Control | Project/org checks, origin checks, signed states | F01, F02, F09, F12, F13; central object/role/action authorization tests |
| A02 Security Misconfiguration | Several fail-closed API checks | F03/F04/F15/F18; CSP/headers; production config assertions and drift monitoring |
| A03 Software Supply Chain Failures | Lockfiles and versioned packages | F16 immutable verified artifacts; F17 automated advisory/SBOM/provenance gates |
| A04 Cryptographic Failures | AES-GCM, sealed sessions, HTTPS requirements | F01 deployment exposure; F02/H03 AAD/key rotation; F05 bootstrap credentials; F18 storage/snapshot encryption |
| A05 Injection | Parameterized application queries; browser/HTTP SSRF guards | Continue SQL/template/command/output-encoding checks; F08/F09/F10 address AI-mediated instruction and tool abuse |
| A06 Insecure Design | Isolated preview origin, encrypted secret model | F06 durable quotas; F07 bounded resources; F08 prompt provenance; threat-model CI |
| A07 Authentication Failures | Strong WorkOS and agent bearer validation | F05 bootstrap authentication; F14 complete logout/revocation |
| A08 Software/Data Integrity | OAuth state and authenticated ciphertext | F08 exact-hash trust; F16 signed/pinned artifacts |
| OWASP API1/API5 | Project membership and role helpers | F01/F02/F12/F13 object/function authorization gaps |
| OWASP API4/API6 | Some signup/IP limits | F06 global/per-principal admission; F07 streaming/size/concurrency limits |
| OWASP API7 SSRF | Strong HTTP/browser address validation | F03 guest egress boundary; F11 PostgreSQL DNS pinning |
| OWASP LLM01/LLM06 | Permission classifier, model/tool separation | F08 durable prompt provenance; F09 side-effect classification; F10 data boundary |
| OWASP ASVS 5.0 | Authentication/session/authorization foundations | Build a route/control inventory and automate V2/V4/V5/V8/V12-relevant checks; live configuration still required |
| NIST SSDF 1.1 | Lockfiles, tests, reviewable monorepo | Threat modeling, secure-build provenance, dependency response SLAs, release evidence, incident feedback |
| CIS Ubuntu 24.04 themes | Host setup scripts exist | Production OS not inspected; verify least privilege, firewall, logging caps, file modes, service sandboxing, patching, audit, encryption |

Reference baselines: [OWASP Top 10 2025](https://owasp.org/Top10/), [OWASP API Security Top 10 2023](https://owasp.org/API-Security/editions/2023/en/0x11-t10/), [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/), [CWE Top 25 2025](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html), [NIST SSDF 1.1](https://csrc.nist.gov/pubs/sp/800/218/final), and [CIS Ubuntu Linux Benchmark](https://www.cisecurity.org/benchmark/ubuntu_linux).

## Fixes to make in the next 24 hours

1. **Close the deployment-secret export path (F01):** require owner/admin approval and a project-bound Vercel target before any stored secret is decrypted; omit runtime secrets from build environment by default.
2. **Verify and lock BYOK storage (F02):** run catalog/grant checks, enable/force RLS, revoke `anon`/`authenticated`, and confirm the table is service-role-only. If exposure existed, review audit logs and rotate affected provider keys.
3. **Reduce easy DoS multipliers (F07):** set WebSocket `maxPayload`, lower/stream ZIP and upload handling, cap outbound response reads before buffering, and add emergency concurrency limits.
4. **Reclassify browser tools (F09):** make arbitrary URL and mutating actions approval-required; keep only current-project screenshots/assertions read-only.
5. **Invalidate imported skills trust (F08):** default imported projects to untrusted, block/flag agent writes to `.uniqus/skills.md`, and do not load changed bytes as system instructions.
6. **Protect sensitive paths end-to-end (F10):** deny sensitive rename, exclude sensitive files from persistence, and add a temporary shell-output canary/redaction guard while the full lifecycle policy is built.
7. **Keep golden snapshots disabled (F05)** and document the security gate in deployment health checks.
8. **Apply emergency host network rules (F03):** block VM→host and special/private destinations, including IPv6, while designing a controlled egress proxy.
9. **Patch dev tooling (F17):** Vitest, Vite, and Turbo to fixed versions; rerun full/production audits, typecheck, and tests.
10. **Clear both guest cookies (F14)** and switch logout mutations to POST where practical.

## 30-day remediation plan

### Week 1 — Authorization and data boundaries

- Complete F01's project-bound deployment target/secret-approval design and audit logging.
- Move BYOK storage out of the exposed schema; introduce versioned row/domain AAD and rotation tooling.
- Bind every preview operation to project ID and separate view/control tokens.
- Fix project role hierarchy/ownership transfer and add a generated authorization matrix test covering every route/role/object.
- Centralize the sensitive-path lifecycle policy across both sandbox agents, imports, sync, storage, shell output, restore, and export.

### Week 2 — Multi-tenant runtime isolation

- Deploy jailer-equivalent per-VM identities/chroots/cgroups/namespaces and a small privileged networking helper.
- Replace broad guest egress with an explicit proxy/allow policy and a continuous network-isolation matrix.
- Redesign snapshot bootstrap over vsock/private point-to-point control with instance-bound one-time authentication; keep it dark until adversarial validation passes.
- Track and harden the production systemd unit; assert file modes, service identity, kernel/rootfs ownership, snapshot/storage encryption, and backup retention.

### Week 3 — Abuse and availability controls

- Implement atomic personal/org/guest spend reservations, active-run/VM quotas, global semaphores, and fail-closed budget dependencies.
- Stream all uploads/imports; bound aggregate and concurrent bytes; add response and database row/time caps.
- Disable or bound guest serial output and enforce journald retention/rate limits.
- Add per-account/IP/tool rate controls with distributed-safe counters and clear 429/402 behavior.

### Week 4 — Supply chain, detection, and release assurance

- Pin/verify all Firecracker, kernel, Alpine, rustup, Cargo, APK, container, and Nix inputs; generate SBOM/provenance attestations.
- Add CI security gates listed below, with owners and time-bounded exceptions.
- Run the manual penetration plan against staging and then a constrained production configuration review.
- Write incident playbooks for provider-key exposure, project-secret export, prompt-injection/tool abuse, runaway spend, and VM isolation failure.

## Security checks to add to CI/CD

### Every pull request

- `npm ci`, `npm run typecheck`, orchestrator tests, production web build, and Linux `cargo test`.
- `npm audit --omit=dev --audit-level=high`; full audit with a reviewed allowlist containing owner, reason, reachability, and expiry.
- RustSec `cargo audit` and OSV/SCA scan for npm/Cargo lockfiles.
- Gitleaks over the diff and scheduled full-history scanning; redact findings in logs.
- Semgrep/CodeQL rules for route authorization, SQL/string execution, URL fetches, shell invocation, path operations, cookie configuration, and crypto misuse.
- Schema test: every table in an exposed schema has RLS enabled/forced or a documented service-only grant; no `anon`/`authenticated` access to BYOK/secrets tables.
- Generated endpoint authorization matrix: anonymous/guest/editor/admin/owner/org-role positive and negative cases, including object mismatch.
- Agent policy tests: prompt-surface hash invalidation; external/mutating browser actions require approval; sensitive-file canaries never enter model/tool/storage output.
- Resource tests: WebSocket oversize closes early, chunked bodies abort at caps, ZIP/upload aggregate limits, DB result bounds, and concurrency quota races.
- SSRF suite with IPv4/IPv6 normalization, redirects, multi-address DNS, rebinding, mapped addresses, metadata/private ranges, and actual peer verification.

### Every release / image build

- Verify checksums/signatures/provenance before privileged extraction; build with locked/frozen dependency graphs.
- Generate CycloneDX/SPDX SBOM for web/orchestrator, Rust agent, kernel/rootfs/APK, Firecracker, and base images; archive with attestations.
- Boot a clean staging host and run the host/guest network isolation matrix, jailer/process-isolation assertions, agent auth checks, and VM escape-blast-radius checks.
- Test storage bucket privacy/policies, database grants/RLS, Turnstile paired configuration, OAuth exact redirects, CSP/security headers, and TLS settings.
- Canary scan compiled web/server bundles and logs for non-public environment secrets.
- Enforce `systemd-analyze security` and filesystem owner/mode baselines; verify journald/disk quotas and backup encryption/retention.

### Scheduled

- Nightly dependency/advisory refresh and base-image scan.
- Weekly full-history secret scan and exposed-asset/domain scan.
- Monthly restore/delete/crypto-rotation drill and least-privilege review.
- Quarterly threat-model refresh and tenant-isolation/prompt-injection penetration test.

## Manual penetration-test plan

Run first in production-like staging using canary data and explicit stop conditions. No real user secrets should be used.

1. **Auth/session:** cookie tampering, revoked WorkOS sessions, user/session mismatch, guest legacy/new cookie logout, CSRF on state-changing routes, session fixation, WebSocket cookie/origin combinations.
2. **Object/function authorization:** enumerate all HTTP/WS tools with two users, two projects, personal/org ownership, guest/editor/admin/owner roles; swap every project/org/member/preview/deployment ID.
3. **Deployment secret boundary:** editor-owned deployment target, build/runtime env separation, target changes after approval, revoked integrations, logs/artifacts, and collaborator role transitions.
4. **Supabase:** Data API tests with anon/user keys, RLS/grants catalog, BYOK row transplant canaries, storage anonymous access/listing, signed URL scope/expiry, policy drift.
5. **OAuth/connectors:** state replay, user binding, return URL canonicalization, token substitution, provider revocation, HTTP allowed-host normalization, redirects, DNS rebinding, IPv6, PostgreSQL peer pinning.
6. **Agent/prompt injection:** malicious imported README/issues/logs/web pages/tool results; create/modify/rename `.uniqus/skills.md`; verify hash trust; attempt secret retrieval and external tool actions through indirect instructions.
7. **Browser tools:** arbitrary destination, URL/query exfiltration, public form submission, file upload/download, popup/redirect chains, SSRF destinations, approval UI correctness, fresh-context cookie isolation.
8. **Sensitive files:** import `.env`/PEM/cloud-config canaries; direct file APIs, shell variants, rename/case/Unicode/symlink/hardlink paths, sync/pull/snapshot/restore/export, collaborator access, model/provider traces.
9. **Parser/resource limits:** multipart and ZIP boundaries, compression ratios, file counts, concurrent uploads, slowloris/chunked bodies, large JSON, oversized/nested WS events, connector streams, huge SQL results, serial flood.
10. **VM isolation:** guest→host/private/metadata/other VM IPv4+IPv6, TAP spoofing, bridge poisoning, sandbox-agent bearer replay/timing, jailer/chroot/cgroup verification, read-only rootfs/project-disk separation, snapshot bootstrap impersonation.
11. **Quotas/business logic:** N+1 concurrent creation/run/deploy requests, reservation races, cancellation/refund, org→personal transitions, guest restore, IP/account rotation, provider failures, budget-service outage.
12. **Supply chain/operations:** checksum substitution, compromised/missing mirror behavior, frozen/offline build, systemd/capabilities/file modes, snapshot/storage/backup access, log redaction/retention, key rotation, incident evidence.

### Pentest evidence and stop conditions

- Use unique canary identifiers, not production secrets.
- Stop on cross-tenant data visibility, host/private-network reachability, unexpected external side effect, sustained service degradation, or cost beyond the agreed ceiling.
- Record request ID, principal/role, target object, expected/actual result, sanitized packet/log excerpt, and cleanup confirmation.
- Retest each fix with a negative regression and verify the compensating control cannot be bypassed through an alternate route/tool/provider.

## Residual risk and conclusion

The strongest parts of Gate 15's security design are its authenticated application sessions, explicit collaboration checks, provider/secret separation, preview-origin isolation, and mature SSRF handling in the general HTTP/browser paths. The most important next step is to extend that same explicit mediation to **every transition between collaborator, model, deployment, VM, host network, storage, and durable prompt state**.

Source review cannot establish the deployed truth for F02, F03, F15, and F18. Those four checks should be treated as a production configuration audit with recorded evidence, not closed from code changes alone. Likewise, F05 should not be enabled based only on a feature flag; the security property is a packet-level authenticated bootstrap and must be proven on the real Firecracker host.

After the 24-hour actions, the 30-day work should prioritize tenant isolation, atomic abuse controls, and exact provenance for privileged instructions/artifacts. Re-run this audit after those changes and after obtaining read-only production configuration evidence. A clean source tree plus passing unit tests is necessary, but the product's real boundary is the composition of application roles, AI tools, Vercel/Supabase configuration, Firecracker host policy, and operational controls.
