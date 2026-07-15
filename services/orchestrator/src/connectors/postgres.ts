import net, { type LookupFunction } from "node:net";
import type { LookupAddress, LookupOptions } from "node:dns";
import { Client, Query, type QueryResult, type QueryResultRow } from "pg";
import type { ConnectorDefinition } from "./index.js";
import { resolvePublicHost, type ResolvedPublicAddress } from "./ssrfGuard.js";

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address?: string | LookupAddress[],
  family?: number,
) => void;

/** A dns.lookup-compatible function that can only return one pre-validated IP. */
export function createPinnedPostgresLookup(target: ResolvedPublicAddress): LookupFunction {
  return ((
    _hostname: string,
    options: LookupOptions | LookupCallback,
    callback?: LookupCallback,
  ) => {
    const cb = typeof options === "function" ? options : callback;
    if (!cb) return;
    if (typeof options !== "function" && options.all) {
      cb(null, [target]);
      return;
    }
    cb(null, target.address, target.family);
  }) as unknown as LookupFunction;
}

function pinnedSocket(target: ResolvedPublicAddress): net.Socket {
  const socket = new net.Socket();
  const connect = socket.connect.bind(socket);
  const lookup = createPinnedPostgresLookup(target);
  // node-postgres calls stream.connect(port, originalHostname). Preserve the
  // hostname for TLS SNI/certificate verification, but force the kernel dial
  // through a lookup function that can return only the address we validated.
  socket.connect = ((port: number, host?: string, callback?: () => void) =>
    connect({ port, host, lookup }, callback)) as typeof socket.connect;
  return socket;
}

function samePeer(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  if (actual === expected) return true;
  return net.isIPv4(expected) && actual.toLowerCase() === `::ffff:${expected}`;
}

async function queryWithRowLimit(
  client: Client,
  text: string,
  values: unknown[],
  limit: number,
): Promise<{ rowCount: number | null; truncated: boolean; fields: string[]; rows: QueryResultRow[] }> {
  return new Promise((resolve, reject) => {
    const rows: QueryResultRow[] = [];
    let seen = 0;
    const query = new Query({ text, values });
    query.on("row", (row: QueryResultRow) => {
      seen += 1;
      if (rows.length < limit) rows.push(row);
    });
    query.once("error", reject);
    query.once("end", (result: QueryResult | QueryResult[]) => {
      const terminal = Array.isArray(result) ? result.at(-1) : result;
      resolve({
        rowCount: terminal?.rowCount ?? seen,
        truncated: seen > limit,
        fields: terminal?.fields.map((field) => field.name) ?? [],
        rows,
      });
    });
    client.query(query);
  });
}

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
        let target: ResolvedPublicAddress;
        try {
          const parsedDsn = new URL(connStr);
          // An empty hostname is NOT safe to skip: pg then defaults to
          // localhost, and a `?host=` query param (e.g.
          // `postgresql:///db?host=169.254.169.254`) overrides it entirely
          // while keeping url.hostname === "". Validate whichever pg will use.
          const queryHost = parsedDsn.searchParams.get("host");
          const dbHost = queryHost || parsedDsn.hostname || "localhost";
          const addresses = await resolvePublicHost(dbHost);
          target = addresses[0];
        } catch (err) {
          throw new Error(
            `refusing to connect: ${err instanceof Error ? err.message : "invalid connection string"}`,
          );
        }
        const sql = String(args.sql ?? "");
        if (!sql.trim()) throw new Error("sql is required");
        const params = Array.isArray(args.params) ? args.params : [];
        const limit = typeof args.row_limit === "number"
          ? Math.max(1, Math.min(Math.floor(args.row_limit), 5000))
          : 200;

        // Bound connect + per-statement time so a reachable-but-unresponsive
        // (firewalled/slow) host can't hang the agent turn indefinitely (C-93).
        let socket: net.Socket | undefined;
        const client = new Client({
          connectionString: connStr,
          connectionTimeoutMillis: 10_000,
          statement_timeout: 30_000,
          query_timeout: 30_000,
          stream: () => {
            socket = pinnedSocket(target);
            return socket;
          },
        });
        await client.connect();
        try {
          if (!samePeer(socket?.remoteAddress, target.address)) {
            throw new Error("refusing to connect: PostgreSQL peer did not match the validated address");
          }
          return await queryWithRowLimit(client, sql, params, limit);
        } finally {
          await client.end().catch(() => {});
        }
      },
    },
  ],
};
