import type { ConnectorDefinition } from "./index.js";
import { safeFetch, validatePathComponent } from "./ssrfGuard.js";

/**
 * Stripe connector (P6.1). Server-side, audited access to Stripe so generated
 * apps don't hand-roll secret plumbing: checkout/portal session creation,
 * customers, and read access to any resource. The API key is resolved from
 * project secrets (default STRIPE_API_KEY) and never enters the agent context.
 *
 * All calls go to the fixed host api.stripe.com via safeFetch with maxRedirects=0
 * (the key is attached, so a redirect must never bounce it elsewhere — H-2).
 * Stripe takes application/x-www-form-urlencoded with PHP-style bracket nesting;
 * `toForm` flattens a JSON object/array into that shape so the agent can pass
 * natural nested params.
 */

const STRIPE_BASE = "https://api.stripe.com/v1";

/** Flatten a nested object/array into Stripe's bracketed form-encoding. */
function toForm(obj: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item === undefined || item === null) return; // skip holes, don't emit "null"
        if (typeof item === "object") {
          out.push(...toForm(item as Record<string, unknown>, `${key}[${i}]`));
        } else {
          out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof v === "object") {
      out.push(...toForm(v as Record<string, unknown>, key));
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return out;
}

async function stripeRequest(
  apiKey: string,
  method: "GET" | "POST",
  pathAndQuery: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  const init: { method: string; headers: Record<string, string>; body?: string } = { method, headers };
  if (method === "POST" && body) init.body = toForm(body).join("&");
  // maxRedirects=0: the key is attached, never let a 30x carry it off-host.
  const res = await safeFetch(`${STRIPE_BASE}${pathAndQuery}`, init, 0);
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* leave as text */
  }
  if (!res.ok) {
    const msg =
      parsed && typeof parsed === "object" && "error" in parsed
        ? JSON.stringify((parsed as { error: unknown }).error)
        : String(text).slice(0, 500);
    throw new Error(`Stripe ${res.status}: ${msg}`);
  }
  return parsed;
}

const apiKeyArg = {
  api_key_secret: {
    type: "string",
    description: "Secret name holding the Stripe secret key. Defaults to 'STRIPE_API_KEY'.",
  },
};

async function resolveKey(ctx: { secret: (n: string) => Promise<string> }, args: Record<string, unknown>): Promise<string> {
  const name = typeof args.api_key_secret === "string" && args.api_key_secret.trim() ? args.api_key_secret.trim() : "STRIPE_API_KEY";
  return ctx.secret(name);
}

export const stripeConnector: ConnectorDefinition = {
  id: "stripe",
  name: "Stripe",
  description:
    "Create Stripe checkout/customer-portal sessions and customers, and read any Stripe resource. The secret key is resolved server-side (default STRIPE_API_KEY) and never exposed. Use test-mode keys until the user has reviewed the flow.",
  methods: [
    {
      name: "create_checkout_session",
      risk: "write",
      description:
        "Create a Checkout Session and return its `url` (redirect the customer there). Pass mode ('subscription' | 'payment'), line_items (e.g. [{ price: 'price_123', quantity: 1 }]), success_url and cancel_url. Optionally customer or customer_email.",
      args_schema: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["subscription", "payment"], description: "subscription or one-time payment." },
          line_items: { type: "array", description: "[{ price: 'price_...', quantity: n }] — Stripe Price IDs." },
          success_url: { type: "string" },
          cancel_url: { type: "string" },
          customer: { type: "string", description: "Existing Stripe customer id (cus_...). Optional." },
          customer_email: { type: "string", description: "Prefill email for a new customer. Optional." },
          metadata: { type: "object", description: "Optional key/value metadata." },
          ...apiKeyArg,
        },
        required: ["mode", "line_items", "success_url", "cancel_url"],
      },
      invoke: async (ctx, args) => {
        const apiKey = await resolveKey(ctx, args);
        const body: Record<string, unknown> = {
          mode: args.mode,
          line_items: args.line_items,
          success_url: args.success_url,
          cancel_url: args.cancel_url,
        };
        if (args.customer) body.customer = args.customer;
        if (args.customer_email) body.customer_email = args.customer_email;
        if (args.metadata) body.metadata = args.metadata;
        return await stripeRequest(apiKey, "POST", "/checkout/sessions", body);
      },
    },
    {
      name: "create_customer",
      risk: "write",
      description: "Create a Stripe customer. Returns the customer object (id is cus_...).",
      args_schema: {
        type: "object",
        properties: {
          email: { type: "string" },
          name: { type: "string" },
          metadata: { type: "object" },
          ...apiKeyArg,
        },
      },
      invoke: async (ctx, args) => {
        const apiKey = await resolveKey(ctx, args);
        const body: Record<string, unknown> = {};
        if (args.email) body.email = args.email;
        if (args.name) body.name = args.name;
        if (args.metadata) body.metadata = args.metadata;
        return await stripeRequest(apiKey, "POST", "/customers", body);
      },
    },
    {
      name: "create_portal_session",
      risk: "write",
      description:
        "Create a Billing Customer Portal session for a customer to manage their subscription/payment methods. Returns its `url`. Requires customer (cus_...) and return_url.",
      args_schema: {
        type: "object",
        properties: {
          customer: { type: "string", description: "Stripe customer id (cus_...)." },
          return_url: { type: "string" },
          ...apiKeyArg,
        },
        required: ["customer", "return_url"],
      },
      invoke: async (ctx, args) => {
        const apiKey = await resolveKey(ctx, args);
        return await stripeRequest(apiKey, "POST", "/billing_portal/sessions", {
          customer: args.customer,
          return_url: args.return_url,
        });
      },
    },
    {
      name: "retrieve",
      risk: "read",
      description:
        "Retrieve a single Stripe object by id. resource is the API collection (e.g. 'customers', 'subscriptions', 'checkout/sessions', 'invoices', 'prices', 'products').",
      args_schema: {
        type: "object",
        properties: {
          resource: { type: "string", description: "Collection name, e.g. 'customers' or 'subscriptions'." },
          id: { type: "string", description: "The object id (e.g. 'cus_...', 'sub_...')." },
          ...apiKeyArg,
        },
        required: ["resource", "id"],
      },
      invoke: async (ctx, args) => {
        const apiKey = await resolveKey(ctx, args);
        const resource = String(args.resource ?? "")
          .split("/")
          .map((seg) => validatePathComponent(seg, "resource segment"))
          .join("/");
        const id = validatePathComponent(String(args.id ?? ""), "id");
        return await stripeRequest(apiKey, "GET", `/${resource}/${id}`);
      },
    },
    {
      name: "list",
      risk: "read",
      description:
        "List Stripe objects in a collection (e.g. 'customers', 'subscriptions', 'invoices'). Optional limit (max 100) and filters (e.g. { customer: 'cus_...' }).",
      args_schema: {
        type: "object",
        properties: {
          resource: { type: "string", description: "Collection name." },
          limit: { type: "number", description: "Max 100. Default 10." },
          filters: { type: "object", description: "Optional query filters, e.g. { customer: 'cus_...', status: 'active' }." },
          ...apiKeyArg,
        },
        required: ["resource"],
      },
      invoke: async (ctx, args) => {
        const apiKey = await resolveKey(ctx, args);
        const resource = String(args.resource ?? "")
          .split("/")
          .map((seg) => validatePathComponent(seg, "resource segment"))
          .join("/");
        const params = new URLSearchParams();
        const limit = typeof args.limit === "number" ? Math.min(Math.max(1, args.limit), 100) : 10;
        params.set("limit", String(limit));
        if (args.filters && typeof args.filters === "object") {
          for (const [k, v] of Object.entries(args.filters as Record<string, unknown>)) {
            if (v !== undefined && v !== null) params.set(k, String(v));
          }
        }
        return await stripeRequest(apiKey, "GET", `/${resource}?${params.toString()}`);
      },
    },
  ],
};
