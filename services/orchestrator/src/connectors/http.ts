import type { ConnectorDefinition } from "./index.js";

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
          timeout_ms: { type: "number" },
        },
        required: ["url", "method"],
      },
      invoke: async (ctx, args) => {
        const url = String(args.url ?? "");
        const method = String(args.method ?? "GET").toUpperCase();
        if (!/^https?:\/\//i.test(url)) {
          throw new Error("url must be http(s)://");
        }
        const headers: Record<string, string> = {};
        if (args.headers && typeof args.headers === "object") {
          for (const [k, v] of Object.entries(args.headers as Record<string, unknown>)) {
            if (typeof v === "string") headers[k] = v;
          }
        }
        if (typeof args.auth_secret === "string" && args.auth_secret.trim()) {
          const value = await ctx.secret(args.auth_secret.trim());
          const headerName = typeof args.auth_header === "string" && args.auth_header.trim()
            ? args.auth_header.trim()
            : "Authorization";
          const format = args.auth_format === "raw" ? "raw" : "bearer";
          headers[headerName] =
            format === "bearer" && headerName.toLowerCase() === "authorization"
              ? `Bearer ${value}`
              : value;
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
          const res = await fetch(url, {
            method,
            headers,
            body,
            signal: ctrl.signal,
          });
          const text = await res.text();
          let parsedBody: unknown = text;
          const ct = res.headers.get("content-type") ?? "";
          if (ct.includes("application/json") && text) {
            try {
              parsedBody = JSON.parse(text);
            } catch {
              // leave as text
            }
          }
          // Cap body to ~32 KB so the agent context doesn't balloon.
          const truncated = typeof parsedBody === "string" && parsedBody.length > 32_000
            ? `${parsedBody.slice(0, 32_000)}\n[... truncated ${parsedBody.length - 32_000} bytes ...]`
            : parsedBody;
          return {
            status: res.status,
            ok: res.ok,
            headers: Object.fromEntries(res.headers.entries()),
            body: truncated,
          };
        } finally {
          clearTimeout(t);
        }
      },
    },
  ],
};
