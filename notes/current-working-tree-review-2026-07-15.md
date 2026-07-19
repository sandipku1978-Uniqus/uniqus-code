# Current working-tree implementation review

Date: 2026-07-15  
Branch: `main`  
Review mode: static, strictly read-only except for this requested report

## Executive verdict

**Do not ship or enable the new paid billing flow yet.**

The patch does address the real product gap: it adds actual Stripe subscriptions, invoice-backed entitlements, a durable credit ledger, explicit platform-vs-account provider-key policy, guest-trial merging, Settings billing controls, and billing-aware error handling. The WorkOS sign-out change also targets the actual stale-cookie failure directly.

However, the implementation does **not yet deliver a trustworthy hard spend boundary**. The current agent accounting can overcharge users, refund spend that may already have reached a provider, and reuse money whose spend is unknown. Separately, a missing or replaced Stripe Price mapping can revoke a valid subscriber's paid access and leave it unable to self-heal from the same invoice. Those are launch blockers for a billing system.

The size verdict is mixed:

- The Stripe lifecycle, micro-USD ledger, invoice evidence, reversals, escrow, and idempotency work are large for legitimate reasons. This is not a five-line problem.
- The runtime budget enforcement is overengineered: the same invariant is spread across lead turns, plans, compaction, subagents, image generation, OCR, vision, classifiers, and server helpers through parallel counters and callbacks. It is still incomplete despite the added machinery.
- The two-hour account-wide billing lease duplicates much of the safety already provided by atomic escrow and creates a disproportionate availability failure.
- The homepage change is clearly overbuilt: it adds roughly 987 lines of `landing-v4` CSS while retaining roughly 1,217 unreachable lines of the old `landing-v3` system.

## Scope and method

The working tree contains no staged changes. I reviewed:

- 33 tracked modified files: **4,975 insertions and 768 deletions**.
- 26 untracked files: approximately **4,510 lines**.
- The existing July 14 audit notes only to reconstruct the intended issues; every finding below was checked against the current code.
- Current official Google documentation where model lifecycle and pricing determine whether the implementation works.

I did not run tests, builds, formatters, or package commands because this was explicitly a read-only pass and those commands may create caches, generated files, or temporary project artifacts. `git diff --check` found no patch-format errors; it only emitted the repository's existing LF-to-CRLF warnings.

## What the patch is trying to solve

The changes form five overlapping efforts:

1. Replace aspirational pricing with real Free, BYOK, Plus, and Max plans.
2. Make paid model usage bounded, metered, and invoice-backed.
3. Preserve a single lifetime Free allowance through guest-to-WorkOS conversion.
4. Fix WorkOS sign-out and make billing/auth redirects retain plan intent.
5. Redesign the homepage and update public pricing/support copy.

The first four are coherent goals. The homepage redesign is a separate product change and should not share the same review/deploy unit as the billing system.

## Blocking correctness findings

### 1. Multi-iteration turns can overcharge users at long-context rates

`estimateTurnCostUsd()` applies a premium tier based on the prompt size of **one provider request** (`packages/api-types/src/index.ts:339-346`, `507-520`). The agent loop instead accumulates usage across every model/tool iteration and repeatedly prices the aggregate as one request (`services/orchestrator/src/agent/loop.ts:1269-1273`, `1318-1322`, `1593-1605`). Subagent accounting repeats this at `loop.ts:1823` and `1862-1864`.

Example: ten separate 30k-prompt calls can be repriced as one 300k-prompt call. No individual call crossed a 200k/272k threshold, yet all prior input/output is moved into the premium band. This both drains the in-run budget early and overcharges the final wallet settlement.

Plan mode already demonstrates the correct shape by reporting and pricing each provider receipt independently (`services/orchestrator/src/agent/plan.ts:458-474`). The lead and subagent loops need the same per-request cost accumulation.

**Root-cause verdict:** the patch does not solve accurate billing while this remains.

### 2. The hard spend ceiling is not actually hard

The patch represents uncertain spend as a boolean, `unknownPlatformSpend`, but does not quarantine the allocation that may have been consumed:

- `currentPlatformSpendUsd()` omits unknown spend (`loop.ts:1593-1605`).
- A successful provider response with no authoritative usage receipt sets the flag but can continue into more calls (`loop.ts:2174-2178`).
- An unknown-spend subagent propagates the boolean, then unconditionally returns its delegated budget in `finally` (`loop.ts:1823-1825`, `1877-1881`). A child can therefore use an unknown $2.50, return that allocation, and allow the parent to spend the full $5 escrow afterward.

Paid auxiliary calls also lack a consistent provider boundary:

- Compaction calls Anthropic before cost is reported and swallows failures (`agent/compact.ts:411-432`, `469-491`; `agent/loop.ts:1979-2005`).
- Manual compaction can therefore settle at zero and refund its escrow (`server.ts:5087-5116`, `5183-5188`).
- Image generation reports cost only after a successful image is parsed and saved (`agent/imagegen.ts:141-180`; `agent/loop.ts:3432-3461`).
- OCR and the vision bridge have the same post-success-only accounting (`loop.ts:3754-3805`, `3816-3890`).

If a request reached a provider but the connection, parsing, refusal handling, or asset write failed, Gate 15 can record zero and then continue spending. Final settlement retaining one $5 escrow does not fix reuse that already happened inside the run.

Further preflight holes reinforce the same conclusion:

- GLM OCR calculates a capped output allowance but does not pass or enforce it (`loop.ts:3754`).
- Plan-mode paid web-search fees are added after the response but omitted from affordability (`plan.ts:476-493`, `623-641`).
- Compaction can consume the entire remaining wallet, down to a one-token summary, without preserving an answer reserve (`compact.ts:386-433`; `loop.ts:2003`).
- Character-based token estimates are reasonable analytics, not a contractual hard bound for token-dense code, CJK, emoji, or images (`compact.ts:37`, `152`).

**Root-cause verdict:** the new escrow protects the database balance from ordinary concurrency, but the provider-call layer does not yet enforce the product's promised maximum exposure.

### 3. A Stripe catalog mismatch can revoke valid paid access and cannot self-heal

The webhook route is enabled when only the Stripe key and webhook secret exist (`services/orchestrator/src/billing/stripe.ts:76-81`). Subscription processing later requires the current three Price IDs (`stripe.ts:634-659`, `865-880`). If a Price ID is missing, wrong, or was replaced, `subscriptionMapping()` throws and `syncFromStripeSubscription()` immediately calls `deactivateBillingPaidAccess()` (`stripe.ts:598-604`).

That database function zeroes all paid grants and clears `last_valid_invoice_id` and `entitled_through` (`services/orchestrator/src/db/schema.sql:831-866`). Correcting the environment and retrying the subscription event only restores subscription metadata (`services/orchestrator/src/db/billing.ts:128-151`), not invoice evidence or credits. Even retrying the same `invoice.paid` cannot restore zeroed grants because the invoice source keys already exist and the SQL uses `ON CONFLICT DO NOTHING` (`schema.sql:685-704`).

The setup guide explicitly says to create replacement Prices when amounts change and points the environment at the new IDs (`docs/stripe-subscriptions.md:55-58`, `190-200`). Existing subscriptions on the previous Price then look unmapped and are destructively deactivated.

**Root-cause verdict:** fail-closed access is appropriate, but configuration/mapping inability must not be treated as proof that the customer's paid entitlement is invalid. Active and historical catalog versions need an explicit migration/reconciliation path.

### 4. The default image-generation path uses models that are already shut down

`services/orchestrator/src/agent/imagegen.ts:23-29` maps the default names to `gemini-3.1-flash-image-preview` and `gemini-3-pro-image-preview`. Google deprecated those preview IDs and shut them down on **2026-06-25**; the stable IDs are `gemini-3.1-flash-image` and `gemini-3-pro-image`. See Google's [release notes](https://ai.google.dev/gemini-api/docs/changelog) and [current Flash Image model card](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-image).

This mapping predates part of the current diff, but the new billing preflight and settlement now rely on it. Updating only the IDs is insufficient: the price map is keyed by the retired IDs, so the stable Pro ID would fall through to the cheaper Flash default.

The new debit also treats a documented approximation as authoritative. The code itself says 4K is materially more expensive (`imagegen.ts:34-53`), while preflight reserves one fixed image (`loop.ts:2473-2485`) and settlement omits prompt/input-image, text/thinking, resolution, and any extra returned images. Google's [current pricing](https://ai.google.dev/gemini-api/docs/pricing) lists Flash output from $0.045 at 0.5K through $0.151 at 4K, plus input and text/thinking output.

**Root-cause verdict:** default image generation will fail today, and its metering is not a safe hard-bound implementation.

### 5. The advertised recovery reserve is not implemented as advertised

Pricing says the reserve is for Gate 15's **automatic attempts to recover from failed work** (`apps/web/app/(marketing)/pricing/page.tsx:100-103`). In code, reliability access is selected before a run only when the user's next message matches a small “try again / still broken” text heuristic within 15 minutes (`server.ts:683-739`). That heuristic can select the reliability bucket even if the previous run technically succeeded.

Conversely, a normal run that actually fails has already reserved from the usage bucket (`billing/service.ts:223-249`). `chargeAiUsage.failed` does not reselect a bucket for an existing reservation; it matters only on the rolling-deploy fallback path (`service.ts:342-374`). Therefore an actual failed run normally charges build credit, while a later user-authored correction may charge recovery credit.

**Root-cause verdict:** either the product definition or the implementation must change. Today the named wallet does not fund what the public copy promises.

## High-priority correctness findings

### 6. Platform helper exhaustion incorrectly stops an account-funded lead model

When a Plus/Max user supplies their own key for the lead provider, that lead call costs Gate 15 nothing. Nevertheless, if platform-funded auxiliary work consumed the remaining wallet, `loop.ts:2029-2049` sets `providerMaxTokens = 0` and ends the entire turn.

This contradicts the pricing promise that Plus/Max BYOK work can continue at $0. Platform-funded helpers should stop; an account-funded lead should remain usable when its required account-funded helpers are available.

### 7. Guest conversion is retryable but not atomic across billing and projects

`merge_billing_free_trial()` treats any existing merge marker for a guest as a successful no-op without checking that it targets the same WorkOS account (`db/schema.sql:1395-1401`). `handleGuestMerge()` ignores the boolean result, then reassigns projects and marks conversion in separate operations (`auth/guest.ts:253-260`).

If billing merges into account A and project reassignment fails, a later retry while signed into account B can move the guest projects to B while the remaining trial belongs to A. The account-wide leases do not make these database steps one transaction.

The single-$3 merge arithmetic itself is careful and justified. The flaw is the transaction boundary around the larger conversion.

### 8. Free users cannot remove provider secrets they previously stored

`ProviderKeysCard` skips loading keys when `byok_enabled` is false (`apps/web/components/ProviderKeysCard.tsx:59-62`) and returns an upgrade card before rendering management controls (`ProviderKeysCard.tsx:126-139`). The remove button only exists inside the paid UI (`ProviderKeysCard.tsx:227-236`).

The backend deliberately permits deletion for Free users. Paid entitlement should gate adding or using BYOK, not the user's ability to delete a retained secret.

### 9. Several marketing claims are unsupported or presented as real evidence

The redesigned homepage invites visitors to “Inspect a real build” (`apps/web/app/page.tsx:54-56`), but the build IDs, timestamps, test counts, file deltas, and device checks are hard-coded illustrative values (`page.tsx:202-229`, `286-299`, `360-365`). The page's central positioning is accountable evidence, so unlabeled fictional evidence undermines the exact trust claim it is trying to establish.

It also advertises `Postgres 16` inside the project VM (`page.tsx:321`), while the Firecracker rootfs package list does not install Postgres (`infra/firecracker/build-rootfs.sh:88-92`). The Enterprise page still says Z.ai/GLM BYOK is not wired (`apps/web/app/(marketing)/enterprise/page.tsx:207-210`) even though the changed Settings implementation supports it.

The real `LandingPrompt` was also moved from the hero to the bottom of the long page (`page.tsx:176-188`). This is a product-conversion regression rather than a code failure, but it weakens the primary “start from a brief” workflow the previous hero directly exposed.

## Proportionality and overengineering assessment

| Area | Does it address the real issue? | Complexity verdict |
|---|---|---|
| Stripe invoice evidence, reversals, tombstones, checkout lock | Yes, structurally | Large but justified; money and webhook reordering require durable state. Blocked by destructive catalog-mismatch behavior. |
| Micro-USD grants, reservation items, FIFO refund/settlement | Yes | Justified. Integer accounting and atomic SQL are appropriate. |
| Runtime spend enforcement across lead/plan/helpers/subagents | Not reliably | Overengineered and incomplete. One run-scoped metering boundary would be smaller and safer than parallel counters/callbacks. |
| Two-hour account-wide run lease + heartbeat | Partly | Disproportionate. Atomic reservations already remove spendable credit; a crash can block every project for two hours. Use escrow-only concurrency or a much shorter lease if single-run policy is intentional. |
| Guest trial merge | Mostly | The SQL arithmetic is justified; the surrounding dual-account leases add machinery without making conversion atomic. |
| WorkOS sign-out | Yes | Proportionate: a 24-line cookie-scope helper plus focused tests directly fixes the stale domain-cookie root cause. |
| Billing card / auth intent preservation | Mostly | The state space is real, so ~415 lines is not automatically excessive. The checkout-return polling should be isolated and should verify the returned session rather than treating any `billing=success` on an already-paid account as the attempted checkout's confirmation. |
| API error parsing and billing-specific actions | Yes | Small and proportional. |
| Homepage redesign | Partly | Overbuilt and mixed into the wrong change set. |

### The clearest “100 lines instead of a few” cases

1. **Duplicate homepage systems:** `globals.css:11418-12634` retains the unused `landing-v3`/`lv3-*` block while `globals.css:12636-13622` adds `landing-v4`/`br-*`. No current TSX uses `landing-v3` or `lv3-*`. The patch should replace the obsolete system, not keep two complete implementations.
2. **Billing lease/heartbeat:** the SQL lease, renew/release accessors, heartbeat, server lifecycle, and dual-account conversion locking duplicate most of atomic escrow's correctness while adding a two-hour stale-lock failure.
3. **Scattered runtime meter:** affordability binary searches and spend counters exist independently in `loop.ts`, `plan.ts`, `compact.ts`, and `billing/anthropic.ts`. A single run meter with `reserve`, `settle receipt`, `quarantine unknown`, and `delegate/return` operations would make the invariant explicit and eliminate several current bugs.

There are also smaller removable surfaces: deprecated entitlement-clearing wrappers and direct grant/revoke helpers in `db/billing.ts`, plus the unused account-first resolver in `db/providerKeys.ts`, create compatibility paths that the new explicit billing policy is trying to eliminate.

## Additional medium-priority issues

- `server.ts:8612-8615` marks project-name generation as having crossed the Anthropic boundary **before** a local affordability check. A local rejection can therefore retain escrow although no provider call started. `forceStructured` already shows the correct ordering. This is a genuine few-line fix.
- Credit exhaustion is streamed to the client but not recorded as an assistant history message (`loop.ts:2045-2050`), so reconnect/history can show a completed turn with no final response.
- `getAccountProviderKeys()` decrypts every stored provider key (`db/providerKeys.ts:61-86`). One corrupt unused key can block an otherwise valid run on another provider. Failure should be isolated to the provider actually required.
- Checkout success polling ignores the returned `session_id` (`apps/web/components/SettingsView.tsx:261-313`). It does not grant unauthorized entitlement because the backend remains authoritative, but it makes the confirmation UI unable to prove which checkout completed.
- A guest choosing “Create your account” from generic billing Settings without preselecting a plan returns to Projects instead of billing (`settings/page.tsx:28-29`; `billing-display.ts:73-85`).
- Mobile homepage evidence labels drop to 9px (`globals.css:13591-13597`), which is too small for meaningful status information.
- Formal Terms and Privacy are still explicitly “pending publication” on the login and footer surfaces while paid checkout can be enabled. Treat this as a launch prerequisite, not a cosmetic follow-up.

## What is sound and should be preserved

- Raw-body Stripe webhook signature verification.
- PaymentIntent-backed, full-price invoice evidence before minting credits.
- Invoice invalidation tombstones for refunds, disputes, voids, and credit notes.
- Integer micro-USD accounting and atomic advisory-lock settlement.
- One-open-Checkout protection and hosted URL allowlisting.
- Explicit `platform-only`, `account-only`, and `account-first` key policies.
- Invoice-backed activation polling rather than trusting the Stripe return URL.
- Revoking the Free grant on paid activation and deduplicating guest/target trial use.
- Clear billing-specific UI errors and direct actions.
- Explicit WorkOS cookie expiration while preserving the upstream WorkOS logout.

These are not gratuitous complexity; they solve real failure and abuse modes.

## Validation gaps

The new tests do not currently prove the highest-risk behavior:

- `db/schema.billing.test.ts` reads SQL as text and asserts regex patterns; it never executes the functions against Postgres.
- Stripe tests cover pure mapping/readiness helpers, not `applyStripeWebhook`, retry ordering, catalog replacement, destructive deactivation, or recovery.
- Loop tests cover aborts with and without a usage receipt, but not cumulative long-context repricing, unknown child spend followed by parent spend, failed auxiliary calls, OCR/search overflow, or account-key continuation after platform exhaustion.
- There are no component/browser tests for BillingCard state transitions or the pricing -> WorkOS -> guest merge -> Settings -> Stripe return journey.
- The deployment guide correctly calls for test-mode and controlled live end-to-end validation; that work is still a required gate, not evidence already supplied by this patch.

## Recommended sequence before implementation resumes

1. Centralize provider-boundary metering and settle cost per individual provider receipt.
2. Quarantine unknown allocations and stop further platform-funded calls once spend is unknowable.
3. Make Stripe catalog/configuration failures non-destructive and support active historical Price IDs.
4. Correct the image model IDs and make image pricing/reservation match the supported request shape.
5. Define recovery-reserve semantics once, then align admission, settlement, UI copy, and tests.
6. Preserve account-funded lead work when only platform helpers are exhausted.
7. Make guest billing/project conversion target-consistent and transactional.
8. Fix provider-key deletion access and remove unsupported public claims.
9. Delete the dead `landing-v3` CSS and split the homepage redesign from the billing change set.
10. Run executable Postgres, Stripe test-mode, runtime budget, typecheck, and browser journey validation.

## Final answer to the two review questions

1. **Will the implementation solve the actual issue?** Partially. It creates the right subscription and ledger foundation and fixes sign-out correctly, but it does not yet solve trustworthy metered billing or a guaranteed hard spending ceiling. It should not be considered production-ready.
2. **Is it overengineered?** The financial ledger is not. The runtime metering layer, two-hour lease system, and duplicate homepage CSS are. Those areas have more machinery than their invariants require, and the extra machinery is actively obscuring correctness gaps.
