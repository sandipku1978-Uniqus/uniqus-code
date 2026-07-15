import type { ConnectorDefinition } from "./index.js";
import { assertPublicUrl, readResponseTextLimited, safeFetch } from "./ssrfGuard.js";

export function isAllowedSecretDestination(hostname: string, allowedHosts: readonly string[]): boolean {
  const normalize = (host: string): string => host.trim().toLowerCase().replace(/\.$/, "");
  return allowedHosts.map(normalize).includes(normalize(hostname));
}

export function assertSecureSecretTransport(url: URL): void {
  if (url.protocol !== "https:") {
    throw new Error("project secrets may be sent only over HTTPS");
  }
}

/**
 * Generic HTTP connector. Lets the agent issue GET/POST/PUT/DELETE against
 * an arbitrary URL with optional secret-resolved bearer/header auth. The
 * escape hatch for connectors we haven't built native bindings for yet —
 * agent calls `http.request` instead of raw `fetch` so calls stay audited
 * and the credential never sits in the agent context.
 */
export const httpConnector: ConnectorDefinition = {
  id: "http",
  name: "HTTP",
  description: "Generic HTTP client with optional secret-resolved auth.",
  methods: [
    {
      name: "request",
      risk: "write",
      description:
        "Make an HTTP request. Use auth_secret to pull a value from project secrets and use it as a bearer/header without exposing it to the agent context.",
      args_schema: {
        type: "object",
        properties: {
          url: { type: "string" },
          method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
          headers: { type: "object" },
          body: { type: ["string", "object", "null"] },
          auth_secret: {
            type: "string",
            description: "Secret name. Resolved server-side and sent as 'Authorization: Bearer <value>' unless auth_header is also set.",
          },
          auth_header: {
            type: "string",
            description: "Optional. Use this header instead of Authorization (e.g. 'X-API-Key').",
          },
          auth_format: {
            type: "string",
            enum: ["bearer", "raw"],
            description: "Optional. 'bearer' wraps as 'Bearer <value>' (default); 'raw' sends the value as-is.",
          },
          auth_secret_env: {
            type: "string",
            description: "Optional environment slot for auth_secret (defaults to 'default').",
          },
          timeout_ms: { type: "number" },
        },
        required: ["url", "method"],
      },
      invoke: async (ctx, args) => {
        const url = String(args.url ?? "");
        const method = String(args.method ?? "GET").toUpperCase();
        // Reject non-http(s) and any URL that resolves to a private / loopback /
        // link-local / metadata / fleet-bridge address (C-2 SSRF). safeFetch
        // re-validates every redirect hop too.
        const parsed = await assertPublicUrl(url);
        const headers: Record<string, string> = {};
        if (args.headers && typeof args.headers === "object") {
          for (const [k, v] of Object.entries(args.headers as Record<string, unknown>)) {
            if (typeof v === "string") headers[k] = v;
          }
        }
        const usingSecret = typeof args.auth_secret === "string" && args.auth_secret.trim() !== "";
        if (usingSecret) {
          assertSecureSecretTransport(parsed);
          // Bind the secret to the destination allowlist stored by an
          // owner/admin outside model tool input. The host must match exactly;
          // redirects aren't followed while a secret is attached (below).
          // Normalize both sides (lower-case + strip a FQDN trailing dot) so a
          // valid send isn't rejected on a cosmetic 'API.Stripe.com' / trailing-
          // dot mismatch — still an equality test, so it never widens the host.
          const secret = await ctx.secretWithBinding(
            String(args.auth_secret).trim(),
            typeof args.auth_secret_env === "string" ? args.auth_secret_env : undefined,
          );
          if (secret.allowedHosts.length === 0) {
            throw new Error(
              "This secret has no approved HTTP destination. An owner/admin must add an exact allowed host in Project Secrets.",
            );
          }
          if (!isAllowedSecretDestination(parsed.hostname, secret.allowedHosts)) {
            throw new Error(
              `refusing to send secret to ${parsed.hostname}: destination is not approved for this secret`,
            );
          }
          const headerName = typeof args.auth_header === "string" && args.auth_header.trim()
            ? args.auth_header.trim()
            : "Authorization";
          const format = args.auth_format === "raw" ? "raw" : "bearer";
          headers[headerName] =
            format === "bearer" && headerName.toLowerCase() === "authorization"
              ? `Bearer ${secret.value}`
              : secret.value;
        }
        let body: string | undefined;
        if (args.body !== undefined && args.body !== null) {
          if (typeof args.body === "string") {
            body = args.body;
          } else {
            body = JSON.stringify(args.body);
            if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
          }
        }
        const timeout = typeof args.timeout_ms === "number" ? Math.min(args.timeout_ms, 60_000) : 30_000;
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeout);
        try {
          // Don't follow redirects while a secret is attached — a 30x could
          // bounce the credential to another host (H-2). Without a secret, follow
          // up to a few hops, re-validating each against the SSRF guard.
          const res = await safeFetch(
            url,
            { method, headers, body, signal: ctrl.signal },
            usingSecret ? 0 : 4,
          );
          const limited = await readResponseTextLimited(res, 32_000);
          const text = limited.text;
          let parsedBody: unknown = text;
          const ct = res.headers.get("content-type") ?? "";
          if (!limited.truncated && ct.includes("application/json") && text) {
            try {
              parsedBody = JSON.parse(text);
            } catch {
              // leave as text
            }
          }
          const bodyResult = limited.truncated
            ? `${text}\n[... response truncated at 32000 bytes ...]`
            : parsedBody;
          return {
            status: res.status,
            ok: res.ok,
            headers: Object.fromEntries(res.headers.entries()),
            body: bodyResult,
          };
        } finally {
          clearTimeout(t);
        }
      },
    },
  ],
};
