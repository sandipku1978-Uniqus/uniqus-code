# Current working-tree remediation report

Review date: 2026-07-15  
Remediation completed: 2026-07-16  
Branch: `main`  
Commit/push: not performed

## Outcome

All source-level correctness and proportionality findings from
`notes/current-working-tree-review-2026-07-15.md` have been addressed. The paid
billing flow is no longer blocked by any issue found in this review pass.

The important qualification is validation scope: the implementation passes all
locally available tests, typechecks, and production builds, but it has not been
exercised against a real PostgreSQL test database, Stripe test-mode webhooks, or
an interactive browser session in this environment. Those remain release gates,
not known source defects.

## Finding-by-finding resolution

| Original finding | Resolution | Main evidence |
|---|---|---|
| 1. Aggregate long-context repricing | Fixed. Every provider receipt is priced once as its own request and recorded in a run-scoped spend meter. A later request cannot move earlier requests into a premium context tier. | `agent/runSpend.ts`, `agent/loop.ts`, `agent/plan.ts`, `agent/loop.billing.test.ts` |
| 2. Hard ceiling was not hard | Fixed. Unknown platform spend quarantines the remaining allocation; delegated child budgets are not returned after an unknown outcome; auxiliary calls have explicit provider boundaries; and account-funded work can continue independently. Compaction, search, OCR, vision, image operations, classifiers, planners, and one-shot helpers now preflight against conservative bounds. | `agent/runSpend.ts`, `agent/compact.ts`, `agent/loop.ts`, `agent/plan.ts`, `billing/anthropic.ts`, associated billing/metrics tests |
| 3. Stripe catalog mismatch revoked valid access | Fixed. Configuration/mapping failures are non-destructive, current and historical Price IDs are supported, catalog shape is validated, inactive historical Prices can map existing subscriptions, and exact invoice replay can restore entitlement after a transient mismatch. Cancellation and invoice invalidation still revoke access where there is actual negative evidence. | `billing/stripe.ts`, `db/billing.ts`, `db/schema.sql`, `billing/stripe.test.ts`, `db/schema.billing.test.ts` |
| 4. Retired image models and unsafe image pricing | Fixed. Stable Gemini image IDs are used. Platform calls fail closed without an explicit price contract, reserve the supported input/output envelope, restrict the paid request shape, and settle the authoritative modality receipt rather than a guessed fixed image fee. | `agent/imagegen.ts`, `agent/imagegen.test.ts`, `agent/loop.ts`, `agent/auxiliaryPricing.test.ts` |
| 5. Recovery reserve copy did not match behavior | Fixed by defining the product honestly around an immediate retry/correction follow-up. Admission, billing labels, and public copy now describe that behavior instead of claiming automatic recovery of the failed run itself. | `billing/service.ts`, `telemetry/correctionSignal.ts`, pricing and billing UI copy |
| 6. Exhausted helper credit stopped a BYOK lead model | Fixed. Platform helper exhaustion stops platform-funded work only; an account-funded lead provider remains usable. | `agent/loop.ts`, `agent/loop.billing.test.ts` |
| 7. Guest conversion was not atomic/target-safe | Fixed. Billing merge and project ownership transfer happen in one database transaction under advisory and row locks. Repeating the same conversion is idempotent, a different target is rejected, and a deleted stale guest is a safe completed no-op. The browser clears its guest cookie only after an explicit completed response. | `db/schema.sql`, `auth/guest.ts`, `app/api/guest/convert/route.ts`, schema/auth tests |
| 8. Free users could not remove stored keys | Fixed. Stored key metadata loads independently of billing eligibility. Free users can list and delete retained keys; only add/replace remains plan-gated. | `components/ProviderKeysCard.tsx`, `db/providerKeys.ts`, provider-key tests |
| 9. Unsupported or fictional marketing evidence | Fixed. Illustrative evidence is labeled, the unsupported VM Postgres claim and stale GLM statement are gone, provider/search limitations are qualified, and the real prompt is restored to the primary homepage flow. | `app/page.tsx`, marketing pages, blog copy |

## Additional findings resolved

- Project-name generation now marks the Anthropic network boundary only after
  local affordability succeeds. UTF-8 byte sizing covers dense CJK, emoji, and
  code prompts.
- One-shot structured Anthropic calls use the shared conservative message bound,
  including the visual-token ceiling for image blocks, and platform-funded
  helper models require an explicit price.
- Credit-exhaustion terminal responses are persisted in assistant history.
- A corrupt stored provider credential is isolated to that provider instead of
  blocking unrelated providers or silently falling back to a platform key.
- Checkout success verifies the exact returned `session_id`, including ownership
  and fulfilled entitlement. Cancel-return reconciliation is idempotent when two
  requests race Stripe from `open` to `complete` or `expired`.
- Successful Checkout attempt mappings are retained briefly so the authenticated
  browser return can still prove the exact session after the webhook wins first.
- Generic billing intent survives authentication even when no plan was selected.
- Paid Checkout fails closed unless HTTPS Terms and Privacy URLs are configured;
  local, loopback, credentialed, and malformed policy URLs are rejected.
- Mobile evidence labels use the existing 10px token instead of a raw 9px size.
- WorkOS sign-out expires the exact cookie scopes while preserving upstream
  logout, with focused tests.
- Provider-key fallback copy now says platform credits are used only while the
  account remains eligible.
- Support and blog copy no longer describe obsolete seats, teammates, provider
  support, or search availability.

## Complexity reductions

The implementation was simplified where the review found machinery without a
corresponding invariant:

- Removed the two-hour account-wide billing lease and heartbeat. Atomic escrow
  and database locks remain the concurrency boundary.
- Replaced parallel spend counters with one `RunPlatformSpend` abstraction for
  receipt settlement, unknown-spend quarantine, and child allocation.
- Removed the duplicate server-side Auto classifier; one classifier in the agent
  loop owns routing.
- Deleted the unused `landing-v3` / `lv3-*` CSS instead of retaining two complete
  homepage systems.
- Removed obsolete grant/revoke, project-reassignment, conversion-preclaim, and
  account-first compatibility wrappers.
- Kept read-only tool batching, but made provider/auxiliary calls singleton
  barriers so concurrency cannot obscure spend ordering.

The remaining large SQL and Stripe surfaces are proportionate to the problem:
integer credit accounting, invoice evidence, reversal tombstones, webhook
reordering, checkout ownership, and idempotency cannot safely be collapsed into
a few-line implementation.

## Final validation

| Check | Result |
|---|---|
| Focused Anthropic budget regression tests | 7/7 passed |
| Full orchestrator suite | 87 files passed, 1 skipped; 668 tests passed, 4 skipped |
| Web library suite | 14 files passed; 42 tests passed |
| Monorepo typecheck | Passed after the web build completed; 2/2 workspaces with typecheck scripts succeeded |
| Orchestrator production build | Passed |
| Web production build | Passed; 33 static pages generated |
| `git diff --check` | Passed; only line-ending conversion warnings |
| Independent runtime billing audit | Clean; no remaining source-level billing blocker |
| Independent web/auth/checkout audit | Clean; no remaining source-level correctness or overengineering finding |
| Stale implementation searches | No billing lease, old landing CSS, retired image ID, obsolete conversion helper, or stale marketing-claim matches |

The four skipped orchestrator tests are three opt-in PostgreSQL billing lifecycle
tests (no `TEST_DATABASE_URL` was available) and one platform-specific dependency
test. They are skips, not failures.

## Release gates that require an external environment

1. Run `src/db/billing.integration.test.ts` against a disposable PostgreSQL
   database via `TEST_DATABASE_URL`.
2. Exercise Stripe test mode end to end: Checkout, signed webhooks, delayed and
   reordered events, duplicate cancel returns, paid invoice replay, refunds,
   disputes, credit notes, portal cancellation, and historical Price migration.
3. Run the authenticated browser journey from pricing through WorkOS, guest
   conversion, Settings, Stripe return, stored-key deletion, and sign-out.
   The in-app browser backend was unavailable in this session, so no visual or
   interactive confirmation is claimed.
4. Publish real HTTPS Terms and Privacy pages and configure both policy URLs
   before enabling Checkout.

The Stripe cancel-race assertions currently combine executable helper tests with
source-contract checks; a live or fully mocked asynchronous Stripe run is still
the release proof for the race itself. Adding a new component/browser harness
only for this patch would be disproportionate; use the product browser/E2E path
once that environment is available.

## Documentation checked for time-sensitive provider behavior

- Google Gemini 3.1 Flash Image model:
  https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-image
- Google Gemini API pricing:
  https://ai.google.dev/gemini-api/docs/pricing
- Google Gemini API changelog:
  https://ai.google.dev/gemini-api/docs/changelog
- Google document processing limits:
  https://ai.google.dev/gemini-api/docs/document-processing
- Google media-resolution behavior:
  https://ai.google.dev/gemini-api/docs/generate-content/media-resolution
- Anthropic web-search limits and `max_uses`:
  https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool

## Final verdict

1. **Will the implementation solve the actual issue?** Yes at the source level.
   Subscription entitlement, hard platform-spend boundaries, BYOK isolation,
   guest conversion, key management, sign-out, and public claims now agree with
   their intended behavior. Production readiness still depends on the external
   release gates above.
2. **Is the solution overengineered?** The clearest excess machinery was removed.
   The remaining size is concentrated in the financial ledger, Stripe lifecycle,
   runtime provider boundaries, and tests, where the complexity protects real
   money or cross-system consistency.

## Stripe setup guide

The complete operator runbook, including the test/live catalog, Customer Portal,
webhook events, environment variables, deployment order, end-to-end matrix, and
emergency Checkout switch, is maintained in `docs/stripe-subscriptions.md`.
