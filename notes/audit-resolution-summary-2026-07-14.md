# Gate 15 audit resolution summary — 2026-07-14

## Outcome

Every finding in the three supplied audit reports was re-checked against the final implementation and given one of the required dispositions. The bug audit count includes its 44 numbered bugs, 6 performance/maintainability rows, and 3 dependency findings.

| Audit | Reviewed | Fixed | Already Resolved | False Positive | Blocked | Needs Manual Validation |
|---|---:|---:|---:|---:|---:|---:|
| Security | 25 | 14 | 0 | 0 | 4 | 7 |
| UI/UX | 46 | 39 | 0 | 1 | 2 | 4 |
| Bug/reliability | 53 | 49 | 0 | 1 | 0 | 3 |
| **Total** | **124** | **102** | **0** | **2** | **6** | **14** |

The source reports contain the authoritative per-finding files changed, fix description, checks, and remaining limitations:

- `notes/security-audit-2026-07-14.md`
- `notes/ui-ux-audit-report.md`
- `notes/bug-audit-report-2026-07-14.md`

## Main fixes delivered

- Added fail-closed authorization and secret handling for deployments, forced RLS and row-bound versioned encryption for private credentials, same-origin POST logout, provider/hostname-bound Turnstile checks, nonce-based CSP, stable public error codes, SSRF connection pinning, sensitive-path enforcement, resource caps, and tracked CI/security gates.
- Added durable task leases, per-project mutation serialization, guest lifecycle claims, deletion cleanup outboxes, restart-safe deployment intents/reconciliation, OAuth refresh compare-and-set, idempotent Supabase provisioning recovery, transactional per-file uploads, collision-safe persistent Firecracker IPAM, fail-closed VM network checks, guest process-tree cancellation, strict mount/hydration verification, and bounded host/connector I/O.
- Preserved editor buffers and attachments across asynchronous navigation/retry paths; fixed role-aware action gating, truthful task/integration/deploy/budget states, durable dashboard URLs, remote Vercel teardown, accessible focus/keyboard/modal semantics, responsive navigation/reflow, contrast/focus/touch targets, and first-turn prompt transfer without putting confidential text in the URL.
- Updated vulnerable dependency paths to Next 15.5.20, PostCSS 8.5.19, `@google/genai` 2.11.0 / protobufjs 7.6.5, and esbuild 0.28.1.

## Final validation

- Full orchestrator suite: **73 test files passed; 565 tests passed; 1 intentionally skipped**.
- Full web unit suite: **9 test files passed; 24 tests passed**.
- Monorepo `npm run typecheck`: passed for all workspaces with typecheck scripts.
- Web production build: passed, including Next's lint/type validation phase; all **33** static pages generated. The repository defines no separate lint script.
- Rust sandbox agent: `cargo fmt --check` passed and `cargo check --locked --target x86_64-unknown-linux-gnu` passed. The target-appropriate compile emits one existing non-fatal dead-field warning for `ManagedServer.port`.
- A Linux-target `cargo test --no-run` compile reached the linker but could not link on this Windows host because the Linux cross-linker `cc` is not installed; WSL is present but has no Rust toolchain. The tracked Ubuntu CI job runs `cargo test --locked`, and live cross-implementation coverage remains P06 `Needs Manual Validation`.
- Node sandbox agent: `node --check services/sandbox-agent/src/agent.mjs` passed.
- Firecracker scripts: `bash -n` passed for `host-net.sh`, `host-setup.sh`, `build-rootfs.sh`, and `install-rust-toolchain.sh`.
- Dependency reproducibility/security: clean `npm ci` passed; `npm audit --json` reports **0 vulnerabilities at every severity**; the resolved dependency tree contains only the patched versions listed above.
- Repository hygiene: `git diff --check` passed (Windows line-ending notices only).
- Report integrity: all expected IDs were found exactly once in the resolution registers — security 25, UI/UX 46, bug/reliability 53 — and the computed total is 124.

## Blocked findings

These six items cannot be safely completed from repository access alone:

- Security F04: migrating raw Firecracker launches to jailer needs production UID/GID, chroot/device/cgroup design and Linux host validation.
- Security F05: golden-clone bootstrap needs a host-local authenticated, one-time per-clone protocol and hostile-L2 validation; golden restore remains default-off.
- Security F06: durable global VM/model admission and quota enforcement needs approved product limits, refund semantics, capacity policy, and production data-plane access.
- Security F16: full immutable OS-package provenance needs an Alpine snapshot/package manifest or equivalent repository freeze, SBOM policy, and Linux build verification. Other downloaded artifacts are now pinned and checksum-verified.
- UI/UX F03: hosted authentication branding must be changed and checked in the external WorkOS dashboard.
- UI/UX F07: real Privacy, Terms, abuse-reporting, and social destinations require approved content and destination ownership; fake placeholder links were removed.

## Manual validation still required

Fourteen findings have source fixes or bounded dispositions but need evidence unavailable in this local run:

- Security: F02 production DB grants/RLS and credential rotation; F03 effective Linux egress/isolation matrix; F10 hostile shell/path persistence exercises; F15 live Supabase bucket policy/canary; F18 production file modes/systemd/encryption/backups; H04 live Turnstile hostname/action behavior; H05 live CSP/WorkOS/preview compatibility.
- UI/UX: F10 representative App/Code/Review usability validation; F41 project findability at realistic scale; F42 mobile/tablet first-paint and Web Vitals; F46 longitudinal review/history/command-layer validation.
- Bug/reliability: B15 Linux network-namespace/iptables fault injection; B20 real Firecracker mount/hydration/cap failure injection; P06 one protocol contract suite against both live Rust and Node sandbox agents.

## Remaining risk

- Schema changes, key rotation, production service/file permissions, host networking, and external control-plane configuration must be deployed and verified before their corresponding manual items can be closed.
- No destructive production Vercel/Supabase/Firecracker test or credentialed provider canary was run. External side-effect crash windows are covered by durable intents and tests, but production fault injection remains valuable.
- Browser E2E, real assistive-technology/device testing, multi-user race exercises, usability studies, and production load/performance traces remain thinner than the unit/type/build coverage.
- No commit, push, deployment, or external account mutation was performed as part of this resolution pass.
