import { Client } from "pg";
import type { ConnectorDefinition } from "./index.js";

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
        const sql = String(args.sql ?? "");
        if (!sql.trim()) throw new Error("sql is required");
        const params = Array.isArray(args.params) ? args.params : [];
        const limit = typeof args.row_limit === "number" ? Math.min(args.row_limit, 5000) : 200;

        const client = new Client({ connectionString: connStr });
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
