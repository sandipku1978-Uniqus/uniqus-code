# Stripe subscriptions

Gate 15 uses Stripe-hosted Checkout and the Stripe Customer Portal for payment
collection. A local, integer micro-USD ledger remains authoritative for AI
allowances. WorkOS remains the identity provider; its Stripe add-on is not
required for these per-user plans and is not the source of truth for credits.

## Plans and allowances

| Plan | Monthly price | Platform AI allowance | Credential policy |
| --- | ---: | ---: | --- |
| Free | $0 | One-time $3 usage trial | Gate 15 keys only |
| BYOK | $8 | $0 | Account keys only; Anthropic is required |
| Plus | $20 | $12 usage + $2 retry/correction reserve | Account keys first, then metered Gate 15 keys |
| Max | $100-$200 in $10 steps | `0.85P - $10` usage + `0.10P` retry/correction reserve | Account keys first, then metered Gate 15 keys |

The unspent Free trial is revoked on the first paid invoice, so it cannot stack
on top of the paid plan allowance. Max retains `0.05P + $10` before Stripe
fees: $15 at $100, $17.50 at $150, and $20 at $200.

Paid usage and retry/correction grants expire at the end of the invoiced service
period; unused credits do not roll over. A bounded seven-day dunning grace can
preserve paid platform/BYOK access after a failed renewal, but it never mints a
new wallet.

The retry/correction reserve is explicit, not an automatic refund and not a
generic failed-run bucket. Only a high-confidence correction request from the
same user and chat session within 15 minutes of the prior completed run may
reserve it. Every ordinary run, including one that later fails, reserves only
the usage bucket. An eligible correction spends the reserve first and can use
ordinary usage credit only if the reserve is insufficient.

At the last safe boundary before any Gate 15-funded provider call, the
orchestrator escrows at most $5 from the user's wallet for that top-level run.
Local database, filesystem, sandbox, and key preflight failures therefore do
not reserve credit. Normal completion charges exact measured cost and returns
the unused escrow to the original grant and expiry. If the process dies, or a
started platform request ends without a trustworthy usage receipt, the bounded
escrow remains consumed so an unknown provider outcome cannot become unbilled
spend. An interrupted request that did return authoritative usage settles that
exact usage instead.
Set `BILLING_MAX_PLATFORM_RUN_USD` to change this ceiling (accepted range
$0.25-$25); keep the default at launch unless real usage data justifies a
different risk limit.

## Safety rules

- Test and live Stripe modes are separate catalogs. Never combine a test key
  with live Price, Portal, or webhook identifiers, or the reverse.
- `STRIPE_CHECKOUT_ENABLED=1` is the final go-live switch. Keep it unset or `0`
  until the database, webhook, policies, account settings, deployments, and
  end-to-end checks below are complete.
- Keep the webhook enabled even when Checkout is disabled. Renewals, failed
  payments, refunds, disputes, and cancellations still need processing.
- Do not attach coupons or discounts yet. Fulfillment refuses to mint the full
  allowance when an invoice collected less than the configured plan price.
- A paid invoice must be backed by successful Stripe PaymentIntent allocations
  for the full configured price. Dashboard "mark paid", Payment Records, and
  other out-of-band payments deliberately grant no Gate 15 access or credits.
- Launch with card payments only. Asynchronous success and failure are handled,
  but the complete customer-facing pending/failed flow for delayed payment
  methods has not been validated; do not enable them until it has.
- Stripe Price amounts are immutable. For a replacement Price with unchanged
  economics, append the retired ID to the matching comma-separated
  `STRIPE_*_HISTORICAL_PRICE_IDS` value before replacing the current ID. Existing
  Gate 15 subscriptions also retain immutable `gate15_plan` metadata, but the
  explicit history is the operator-auditable migration record.
- A real amount change is not supported by the historical-ID lists alone:
  fulfillment still validates the documented $8 BYOK, $20 Plus, and $1 Max-unit
  amounts. Version the Price-to-plan/grant contract in code or migrate every
  active subscription before changing an amount.

The hosted Checkout flow does not load Stripe.js in the browser, so
`STRIPE_PUBLISHABLE_KEY` is not needed by the current web or orchestrator
runtime. It can remain available for a future Elements integration.

A missing catalog mapping is non-destructive: webhook processing fails and
retries without clearing a customer's existing invoice evidence. Historical
subscriptions with the same plan economics map through the explicit historical-
ID lists above or their Gate 15 plan metadata, with the documented amount and
quantity still validated. If a
nonterminal lifecycle state suspended access, replaying the same valid paid
invoice restores only the grant's recorded `suspended_microusd` and any still-
open refundable allocation. It never resets the grant to its original amount,
so already-consumed credit cannot be re-minted. Invoice invalidation tombstones
continue to block all restoration after a refund, void, credit, or dispute.

## 1. Build and verify the test-mode catalog

Do the complete purchase lifecycle in Stripe test mode before configuring live
payments. Store live credentials in a password manager while testing; do not
leave them in the local runtime file.

In the repository-root `.env.local`, use a test secret and the local web origin:

```dotenv
STRIPE_SECRET_KEY=sk_test_...
WEB_ORIGIN=http://localhost:4242
```

Run the idempotent catalog provisioner:

```powershell
node scripts/setup-stripe-catalog.mjs
```

It creates or reconciles:

- an $8/month BYOK Price;
- a $20/month Plus Price;
- a $1/month Max unit Price, used with Checkout quantity 100-200;
- a Gate 15 Customer Portal configuration.

Copy the returned test identifiers into the same local file:

```dotenv
STRIPE_BYOK_PRICE_ID=price_...
STRIPE_PLUS_PRICE_ID=price_...
STRIPE_MAX_PRICE_ID=price_...
STRIPE_PORTAL_CONFIGURATION_ID=bpc_...
TERMS_OF_SERVICE_URL=https://gate15.dev/terms
PRIVACY_POLICY_URL=https://gate15.dev/privacy
STRIPE_CHECKOUT_ENABLED=1
```

Run Stripe CLI in test mode and forward events to the local orchestrator:

```powershell
stripe listen --forward-to localhost:8787/api/billing/stripe/webhook
```

Put the CLI's temporary signing secret in `.env.local` while that listener is
running:

```dotenv
STRIPE_WEBHOOK_SECRET=whsec_...
```

The temporary secret changes when a new listener starts. Webhook verification
uses the unmodified raw request body; a proxy must not parse or transform it.

## 2. Apply and verify the production database schema

Before deploying billing-aware application code, apply
`services/orchestrator/src/db/schema.sql` in the production Supabase SQL editor.
The file creates the account, grant, atomic escrow, webhook-audit, guest-trial,
and payment-state objects used by the current code.

Do not deploy the billing routes against an unmigrated database. Confirm every
billing relation declared by the checked-in schema exists. The current core set
includes:

- `billing_accounts`
- `billing_credit_grants`
- `billing_credit_ledger`
- `billing_credit_reservations`
- `billing_credit_reservation_items`
- `billing_trial_merges`
- `billing_invoice_invalidations`
- `billing_checkout_attempts`
- `stripe_webhook_events`

Also confirm every billing RPC declared by the checked-in schema is visible to
PostgREST. The current core set includes:

- `consume_billing_credits`
- `reserve_billing_credits`
- `finalize_billing_credit_reservation`
- `convert_guest_account`
- `apply_paid_billing_invoice`
- `invalidate_billing_invoice`
- `deactivate_billing_paid_access`
- `terminate_billing_subscription`
- `acquire_billing_checkout_attempt`

Treat the checked-in `schema.sql`, not the lists above, as authoritative.
CI or an operator with a disposable Postgres database can run the executable
lifecycle checks by setting `TEST_DATABASE_URL`; without it, those tests skip
cleanly while the unit and schema-contract tests still run.
Useful SQL verification queries are:

```sql
select schemaname, tablename
from pg_tables
where schemaname = 'public'
  and (tablename like 'billing_%' or tablename = 'stripe_webhook_events')
order by tablename;

select n.nspname as schema_name, p.proname, pg_get_function_identity_arguments(p.oid)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (p.proname like '%billing%' or p.proname like '%stripe%')
order by p.proname;
```

After applying DDL, wait for or reload the PostgREST schema cache and verify the
RPCs through the service-role client. Existing tables alone are not sufficient.

## 3. Provision and record the live catalog

Use a live secret only with the canonical production origin:

```dotenv
STRIPE_SECRET_KEY=sk_live_...
WEB_ORIGIN=https://app.gate15.dev
```

Then run:

```powershell
node scripts/setup-stripe-catalog.mjs
```

For a live key, the script fails before making Stripe requests when
`WEB_ORIGIN` is missing, non-HTTPS, or local. Re-running reconciles the existing
Portal return URL, headline, supported customer actions, cancellation mode, and
catalog metadata. Lookup keys include the complete catalog version so a later
version can create replacement Prices without colliding with the old catalog.
This does not, by itself, make a grandfathered amount compatible with the
runtime contract.

Securely copy the returned live identifiers into the Hetzner repository-root
runtime file at `/opt/uniqus-code/.env.local`:

```dotenv
STRIPE_SECRET_KEY=sk_live_...
STRIPE_BYOK_PRICE_ID=price_...
STRIPE_PLUS_PRICE_ID=price_...
STRIPE_MAX_PRICE_ID=price_...
STRIPE_PORTAL_CONFIGURATION_ID=bpc_...
# Comma-separated retired IDs, only when a catalog Price has been replaced:
STRIPE_BYOK_HISTORICAL_PRICE_IDS=
STRIPE_PLUS_HISTORICAL_PRICE_IDS=
STRIPE_MAX_HISTORICAL_PRICE_IDS=
TERMS_OF_SERVICE_URL=https://gate15.dev/terms
PRIVACY_POLICY_URL=https://gate15.dev/privacy
BILLING_MAX_PLATFORM_RUN_USD=5
WEB_ORIGIN=https://app.gate15.dev
STRIPE_CHECKOUT_ENABLED=0
```

Restrict the file to the service operator, keep it out of Git, and do not put
the secret key in Vercel. The web application needs its existing
`NEXT_PUBLIC_ORCHESTRATOR_URL`; it does not need Stripe credentials for hosted
Checkout. Set the same reviewed policy destinations on Vercel so the login and
footer surfaces can link to the documents the orchestrator requires:

```dotenv
NEXT_PUBLIC_TERMS_OF_SERVICE_URL=https://gate15.dev/terms
NEXT_PUBLIC_PRIVACY_POLICY_URL=https://gate15.dev/privacy
```

## 4. Deploy the backend dark

Use this production order so the public UI cannot outrun fulfillment:

1. Pass the test-mode matrix in section 8.
2. Apply and verify the production database schema and all schema-defined RPCs.
3. Provision/reconcile the live catalog and install its IDs on Hetzner with
   `STRIPE_CHECKOUT_ENABLED=0`.
4. Deploy `services/orchestrator` to Hetzner using the normal
   `/deploy-hetzner` workflow. Do not rebuild the Firecracker rootfs for these
   orchestrator-only changes.
5. Create and verify the live webhook in section 5.
6. Configure the Stripe account, policies, dunning, disputes, and payment
   methods in section 6.
7. Deploy `apps/web` to Vercel from `main`. The UI should still report Checkout
   unavailable while the switch is off.
8. Perform the preflight in section 7, then enable Checkout as the final step.

## 5. Create the live webhook

In the Stripe Dashboard, select live mode and add a webhook endpoint for events
on the Gate 15 account. Use a **snapshot** event destination pinned to Stripe API
version **`2026-06-24.dahlia`**. The handler parses the invoice shapes from that
version; an older endpoint version is not safe.

Endpoint URL:

```text
https://api.gate15.dev/api/billing/stripe/webhook
```

Subscribe to:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- `invoice.paid`
- `invoice.payment_failed`
- `invoice.payment_action_required`
- `invoice.voided`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.subscription.paused`
- `customer.subscription.resumed`
- `credit_note.created`
- `credit_note.updated`
- `refund.created`
- `refund.updated`
- `charge.refunded`
- `charge.dispute.created`

Reveal the endpoint signing secret once and add it to
`/opt/uniqus-code/.env.local`, leaving Checkout disabled:

```dotenv
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_CHECKOUT_ENABLED=0
```

Restart the orchestrator:

```sh
sudo systemctl restart uniqus-orchestrator
sudo journalctl -u uniqus-orchestrator -n 100 --no-pager
```

Send a Dashboard test delivery and confirm a `2xx` response and no processing
error in the service journal. Keep the endpoint and signing secret installed
from this point onward, including during a Checkout pause.

## 6. Configure Stripe account behavior

### Customer Portal

The setup script enables payment-method updates, invoice history, customer
details, and cancellation at period end. Subscription Price and Max quantity
updates remain disabled because exact proration credit deltas are not yet
implemented.

To change tier or Max commitment, a customer must cancel at period end, retain
access through the paid period, and return to Gate 15 after the subscription
ends to start the new plan. Do not tell customers they can switch tiers directly
inside the Portal.

### Business, support, and policies

Before enabling Checkout, configure:

- **Settings -> Branding**: Gate 15 logo, icon, primary color, and accent color;
- **Settings -> Business**: legal business name, address, support email, support
  URL, phone, and statement descriptor;
- public Terms of Service and Privacy Policy URLs;
- a public cancellation and refund policy consistent with the Portal behavior;
- **Billing -> Subscriptions and emails**: successful-payment, failed-payment,
  renewal, cancellation, expiring-card, and receipt emails.

Do not enable payments while the site says formal policies are pending.

### Failed payments and disputes

In Stripe Revenue Recovery, choose a bounded Smart Retry/dunning window and a
terminal action. After retries, set the subscription to `unpaid` or cancel it;
do not leave it `past_due` indefinitely because Gate 15 deliberately permits a
short dunning grace period without minting new credits.

Enable automatic subscription cancellation after a full dispute. Verify the
configured dispute behavior with a test-mode lifecycle before relying on it.

### Payment methods and tax

Launch with cards only. Delayed payment methods require the additional
asynchronous-failure event and customer-facing pending/failed states before
they are enabled.

Stripe Tax is not automatically enabled by this implementation. Determine where
Gate 15 must register and configure tax with qualified tax advice before
collecting in those jurisdictions.

### WorkOS

No WorkOS Stripe add-on action is required for these plans. Gate 15 subscriptions
are per user, while WorkOS's Stripe entitlements and seat sync are organization
features. Keep the local Stripe-to-user mapping and credit ledger authoritative.
If organization billing is added later, explicitly attach the Gate 15-created
Stripe Customer ID to the corresponding WorkOS organization as a separate
project.

## 7. Production preflight and final enable

Before enabling Checkout:

1. Confirm every production billing table and RPC exists.
2. Confirm the live Price IDs are active, USD, monthly, and belong to the same
   live Stripe account as the secret key.
3. Confirm the Portal default return URL is
   `https://app.gate15.dev/settings` and subscription updates are disabled.
4. Confirm the live webhook endpoint is enabled, pinned to
   `2026-06-24.dahlia`, and its most recent test delivery returned `2xx`.
5. Confirm `TERMS_OF_SERVICE_URL` and `PRIVACY_POLICY_URL` are published HTTPS
   pages. Checkout remains unavailable when either is absent or invalid. Set the
   same destinations in Vercel as `NEXT_PUBLIC_TERMS_OF_SERVICE_URL` and
   `NEXT_PUBLIC_PRIVACY_POLICY_URL`, then verify the login and footer links.
   Confirm cancellation/refund policy, support contact,
   branding, emails, dunning terminal action, dispute cancellation, card-only
   payment methods, and tax decision.
6. Confirm both orchestrator and web deployments contain the same reviewed
   billing implementation.

Enable Checkout only now by changing the Hetzner runtime file:

```dotenv
STRIPE_CHECKOUT_ENABLED=1
```

Restart `uniqus-orchestrator`, sign in with an internal production account, and
verify `/api/billing/status` reports `checkout_available: true`. Complete one
controlled live purchase, verify the invoice, subscription, local plan, and
exact grant, then cancel/refund it according to the documented policy and verify
the corresponding webhook state.

## 8. End-to-end test matrix

Use fresh test users and Stripe's successful test card
`4242 4242 4242 4242`. Verify:

1. Free begins with exactly $3, receives that trial only once, and cannot
   configure account provider keys.
2. BYOK activates only from validated paid state, displays $0 credits, requires
   Anthropic, and never falls back to Gate 15 credentials.
3. Plus grants exactly $12 usage and $2 reliability for a full-price paid cycle.
4. Max $100 grants $75 usage + $10 reliability; $150 grants $117.50 + $15; and
   $200 grants $160 + $20.
5. Max rejects values outside $100-$200 and values not in $10 increments.
6. Replaying `invoice.paid` does not duplicate either grant.
7. A discounted, zero-paid, failed, or action-required invoice grants nothing.
   A manually marked-paid or PaymentRecord-backed invoice also grants nothing.
8. `past_due` receives no new credits and reaches the configured terminal state
   after the bounded dunning window.
9. Cancellation at period end keeps access and credits only through the paid
   period; immediate cancellation removes paid entitlement.
10. Refund, credit note, void, or dispute revokes unused paid grants and paid
    entitlement as designed. A partial refund currently revokes the entire
    remaining invoice allowance.
11. Delivering invalidation events before a delayed `invoice.paid` cannot
    resurrect credits.
12. Concurrent or differently configured Checkout requests cannot create two
    nonterminal subscriptions for one Gate 15 account.
13. A guest who converts to WorkOS retains at most one lifetime $3 trial.
14. Two simultaneous platform-funded runs on one account cannot spend the same
    final credit balance.
15. Checkout return polling never grants access from the success URL alone; it
    waits for webhook-backed billing state.
16. Returning with Stripe's cancel button expires the exact open Checkout and
    releases its database lock, so the user can retry immediately.
17. A local failure before the provider boundary reserves nothing. A normal run
    refunds unused escrow to its original grant; a simulated orchestrator crash
    or no-receipt provider abort consumes no more than the configured per-run
    ceiling, a receipt-backed abort settles exact usage, and the same reserved
    balance cannot be spent by a concurrent run.

## Emergency: stop new Checkout without disabling fulfillment

Set this in `/opt/uniqus-code/.env.local` and restart the orchestrator:

```dotenv
STRIPE_CHECKOUT_ENABLED=0
```

This removes new Checkout availability while leaving the Stripe secret, Price
IDs, Portal ID, webhook signing secret, and webhook endpoint intact. Existing
subscriptions can still renew, cancel, fail, refund, or dispute, and those events
continue updating Gate 15. Do not remove `STRIPE_WEBHOOK_SECRET` as a kill
switch; doing so would disable fulfillment for customers who already paid.

## Official references

- [Stripe subscription Checkout](https://docs.stripe.com/payments/subscriptions)
- [Checkout fulfillment and success pages](https://docs.stripe.com/checkout/fulfillment)
- [Webhook signatures and raw request bodies](https://docs.stripe.com/webhooks/signature)
- [Webhook endpoint versioning](https://docs.stripe.com/webhooks/versioning)
- [Stripe Customer Portal](https://docs.stripe.com/customer-management/integrate-customer-portal)
- [Revenue Recovery](https://docs.stripe.com/billing/revenue-recovery)
- [Stripe Tax](https://docs.stripe.com/tax)
- [WorkOS Stripe add-on](https://workos.com/docs/authkit/add-ons/stripe)
