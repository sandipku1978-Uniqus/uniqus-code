#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import Stripe from "stripe";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(repoRoot, ".env.local") });

const secret = process.env.STRIPE_SECRET_KEY;
if (!secret) throw new Error("STRIPE_SECRET_KEY is missing from .env.local");
const mode = secret.startsWith("sk_live_") ? "live" : secret.startsWith("sk_test_") ? "test" : "unknown";
if (mode === "unknown") {
  throw new Error("STRIPE_SECRET_KEY must be a standard sk_test_ or sk_live_ key");
}
const webOrigin = validatedWebOrigin(mode, process.env.WEB_ORIGIN);
const stripe = new Stripe(secret, { maxNetworkRetries: 2 });
const version = "2026-07-v1";
const versionLookupKey = version.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const definitions = [
  {
    plan: "byok",
    name: "Gate 15 BYOK",
    description: "Full Gate 15 platform access using customer-provided AI provider keys.",
    unitAmount: 800,
    lookupKey: `gate15_byok_monthly_${versionLookupKey}`,
  },
  {
    plan: "plus",
    name: "Gate 15 Plus",
    description: "Gate 15 Plus with monthly platform AI usage and reliability credits.",
    unitAmount: 2_000,
    lookupKey: `gate15_plus_monthly_${versionLookupKey}`,
  },
  {
    plan: "max",
    name: "Gate 15 Max",
    description: "Configurable Gate 15 Max subscription, billed per $1 monthly unit.",
    unitAmount: 100,
    lookupKey: `gate15_max_monthly_unit_${versionLookupKey}`,
  },
];

const products = (await stripe.products.list({ active: true, limit: 100 })).data;
const result = { mode, catalog_version: version, plans: {} };

for (const definition of definitions) {
  let product = products.find(
    (candidate) =>
      candidate.metadata?.gate15_catalog_version === version &&
      candidate.metadata?.gate15_plan === definition.plan,
  );
  let productCreated = false;
  if (!product) {
    product = await stripe.products.create(
      {
        name: definition.name,
        description: definition.description,
        metadata: {
          gate15_catalog_version: version,
          gate15_plan: definition.plan,
        },
      },
      { idempotencyKey: `gate15-product-${definition.plan}-${version}` },
    );
    productCreated = true;
  }

  const prices = (await stripe.prices.list({ product: product.id, active: true, limit: 100 })).data;
  let price = prices.find(
    (candidate) =>
      candidate.currency === "usd" &&
      candidate.unit_amount === definition.unitAmount &&
      candidate.recurring?.interval === "month" &&
      candidate.recurring?.interval_count === 1 &&
      candidate.recurring?.usage_type === "licensed" &&
      candidate.type === "recurring",
  );
  let priceCreated = false;
  let priceUpdated = false;
  if (!price) {
    price = await stripe.prices.create(
      {
        product: product.id,
        currency: "usd",
        unit_amount: definition.unitAmount,
        recurring: { interval: "month" },
        lookup_key: definition.lookupKey,
        metadata: {
          gate15_catalog_version: version,
          gate15_plan: definition.plan,
        },
      },
      { idempotencyKey: `gate15-price-${definition.plan}-${version}` },
    );
    priceCreated = true;
  } else if (
    price.lookup_key !== definition.lookupKey ||
    price.metadata?.gate15_catalog_version !== version ||
    price.metadata?.gate15_plan !== definition.plan
  ) {
    price = await stripe.prices.update(price.id, {
      lookup_key: definition.lookupKey,
      metadata: {
        gate15_catalog_version: version,
        gate15_plan: definition.plan,
      },
    });
    priceUpdated = true;
  }

  result.plans[definition.plan] = {
    product_id: product.id,
    price_id: price.id,
    product_created: productCreated,
    price_created: priceCreated,
    price_updated: priceUpdated,
  };
}

const portalReturnUrl = `${webOrigin}/settings`;
const portalFeatures = {
  customer_update: {
    enabled: true,
    allowed_updates: ["email", "name", "address", "tax_id"],
  },
  invoice_history: { enabled: true },
  payment_method_update: { enabled: true },
  subscription_cancel: {
    enabled: true,
    mode: "at_period_end",
    cancellation_reason: {
      enabled: true,
      options: ["too_expensive", "unused", "missing_features", "other"],
    },
  },
  // Quantity/plan changes need paid-proration credit deltas. Keep them in
  // Gate 15's authenticated flow until that settlement path exists.
  subscription_update: { enabled: false },
};
const portalParams = {
  name: "Gate 15 subscriptions",
  default_return_url: portalReturnUrl,
  business_profile: { headline: "Manage your Gate 15 subscription" },
  features: portalFeatures,
  metadata: { gate15_catalog_version: version },
};
const portalConfigurations = (
  await stripe.billingPortal.configurations.list({ active: true, limit: 100 })
).data;
let portalConfiguration = portalConfigurations.find(
  (candidate) => candidate.metadata?.gate15_catalog_version === version,
);
let portalConfigurationCreated = false;
let portalConfigurationUpdated = false;
if (!portalConfiguration) {
  portalConfiguration = await stripe.billingPortal.configurations.create(
    portalParams,
    { idempotencyKey: `gate15-portal-${version}` },
  );
  portalConfigurationCreated = true;
} else if (!portalConfigurationMatches(portalConfiguration, portalParams)) {
  portalConfiguration = await stripe.billingPortal.configurations.update(
    portalConfiguration.id,
    portalParams,
  );
  portalConfigurationUpdated = true;
}
result.portal = {
  configuration_id: portalConfiguration.id,
  configuration_created: portalConfigurationCreated,
  configuration_updated: portalConfigurationUpdated,
  default_return_url: portalConfiguration.default_return_url,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

function validatedWebOrigin(stripeMode, rawValue) {
  const configured = rawValue?.split(",")[0]?.trim();
  if (!configured) {
    if (stripeMode === "live") {
      throw new Error("WEB_ORIGIN is required when provisioning the live Stripe catalog");
    }
    return "http://localhost:4242";
  }

  let parsed;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error("WEB_ORIGIN must be an absolute http(s) origin");
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    (parsed.protocol !== "http:" && parsed.protocol !== "https:")
  ) {
    throw new Error("WEB_ORIGIN must contain only an http(s) origin, without a path, query, or credentials");
  }

  const hostname = parsed.hostname
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^\[|\]$/g, "");
  const isLocal =
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname) ||
    hostname === "::1";
  if (stripeMode === "live" && (parsed.protocol !== "https:" || isLocal)) {
    throw new Error("Live Stripe catalog setup requires a non-local HTTPS WEB_ORIGIN");
  }
  return parsed.origin;
}

function portalConfigurationMatches(configuration, desired) {
  const actualFeatures = configuration.features;
  const desiredFeatures = desired.features;
  return (
    configuration.active &&
    configuration.name === desired.name &&
    configuration.default_return_url === desired.default_return_url &&
    configuration.business_profile?.headline === desired.business_profile.headline &&
    actualFeatures.customer_update.enabled === desiredFeatures.customer_update.enabled &&
    sameStrings(actualFeatures.customer_update.allowed_updates, desiredFeatures.customer_update.allowed_updates) &&
    actualFeatures.invoice_history.enabled === desiredFeatures.invoice_history.enabled &&
    actualFeatures.payment_method_update.enabled === desiredFeatures.payment_method_update.enabled &&
    actualFeatures.subscription_cancel.enabled === desiredFeatures.subscription_cancel.enabled &&
    actualFeatures.subscription_cancel.mode === desiredFeatures.subscription_cancel.mode &&
    actualFeatures.subscription_cancel.cancellation_reason.enabled ===
      desiredFeatures.subscription_cancel.cancellation_reason.enabled &&
    sameStrings(
      actualFeatures.subscription_cancel.cancellation_reason.options,
      desiredFeatures.subscription_cancel.cancellation_reason.options,
    ) &&
    actualFeatures.subscription_update.enabled === desiredFeatures.subscription_update.enabled &&
    configuration.metadata?.gate15_catalog_version === version
  );
}

function sameStrings(left = [], right = []) {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.length === sortedRight.length &&
    sortedLeft.every((value, index) => value === sortedRight[index]);
}
