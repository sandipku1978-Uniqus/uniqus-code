import { Client } from "pg";
import type { ConnectorDefinition } from "./index.js";
import { assertPublicHost } from "./ssrfGuard.js";

/**
 * Postgres connector. Read/write SQL against a connection string stored in
 * project secrets (default secret name DATABASE_URL).
 */
export const postgresConnector: ConnectorDefinition = {
  id: "postgres",
  name: "Postgres",
  description: "Run SQL against a Postgres database via a stored connection string.",
  methods: [
    {
      name: "query",
      risk: "write",
      description: "Run a SQL statement. Returns rows + rowCount. Use parameterized queries via the params array — never concatenate user input into SQL.",
      args_schema: {
        type: "object",
        properties: {
          url_secret: {
            type: "string",
            description: "Secret name holding the connection string. Default 'DATABASE_URL'.",
          },
          sql: { type: "string" },
          params: {
            type: "array",
            description: "Parameter values for $1, $2, ... placeholders.",
          },
          row_limit: {
            type: "number",
            description: "Optional. Truncate returned rows after this many. Default 200.",
          },
        },
        required: ["sql"],
      },
      invoke: async (ctx, args) => {
        const urlSecret = typeof args.url_secret === "string" && args.url_secret
          ? args.url_secret
          : "DATABASE_URL";
        const connStr = await ctx.secret(urlSecret);
        // Reject a connection host that resolves to a private / loopback /
        // metadata / fleet-bridge address — otherwise the connection
        // success/timeout is a blind internal port-scan oracle from the
        // orchestrator's network position (M-5).
        try {
          const parsedDsn = new URL(connStr);
          // An empty hostname is NOT safe to skip: pg then defaults to
          // localhost, and a `?host=` query param (e.g.
          // `postgresql:///db?host=169.254.169.254`) overrides it entirely
          // while keeping url.hostname === "". Validate whichever pg will use.
          const queryHost = parsedDsn.searchParams.get("host");
          const dbHost = queryHost || parsedDsn.hostname || "localhost";
          await assertPublicHost(dbHost);
        } catch (err) {
          throw new Error(
            `refusing to connect: ${err instanceof Error ? err.message : "invalid connection string"}`,
          );
        }
        const sql = String(args.sql ?? "");
        if (!sql.trim()) throw new Error("sql is required");
        const params = Array.isArray(args.params) ? args.params : [];
        const limit = typeof args.row_limit === "number" ? Math.min(args.row_limit, 5000) : 200;

        // Bound connect + per-statement time so a reachable-but-unresponsive
        // (firewalled/slow) host can't hang the agent turn indefinitely (C-93).
        const client = new Client({
          connectionString: connStr,
          connectionTimeoutMillis: 10_000,
          statement_timeout: 30_000,
          query_timeout: 30_000,
        });
        await client.connect();
        try {
          const result = await client.query(sql, params);
          const rows = result.rows.slice(0, limit);
          return {
            rowCount: result.rowCount,
            truncated: result.rows.length > limit,
            fields: result.fields?.map((f) => f.name) ?? [],
            rows,
          };
        } finally {
          await client.end().catch(() => {});
        }
      },
    },
  ],
};
