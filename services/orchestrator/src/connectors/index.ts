import { audit } from "../db/audit.js";
import { getSecretValue } from "../db/secrets.js";

/**
 * First-party connector library (Plan §5).
 *
 * Phase-2 substrate: a thin registry the agent reaches via a single
 * `call_connector` tool. Each connector exposes a small set of methods
 * (e.g. `slack.post_message`, `postgres.query`). The agent never holds
 * secret values in its context — connector methods reference secrets by
 * name; the registry resolves and uses them server-side.
 *
 * Shipped connectors today (each a self-contained file in this folder):
 * generic HTTP, Slack, Postgres, GitHub, Supabase, and Stripe. Additional
 * sources in Plan §5 (Salesforce, Notion, Airtable, etc.) plug into the same
 * registry the same way — add a file, export a ConnectorDefinition, register
 * it in REGISTRY below. Do not advertise a connector here (or in the agent's
 * tool descriptions) before its file exists.
 *
 * Every invocation writes an audit_events row (Plan §6).
 */

export interface ConnectorMethod {
  name: string;
  description: string;
  /** JSONSchema for the method's args. */
  args_schema: Record<string, unknown>;
  /**
   * Execute the method server-side. ctx provides projectId + a `secret(name)`
   * helper so the connector resolves secrets without ever exposing values
   * to the agent.
   */
  invoke: (ctx: ConnectorCtx, args: Record<string, unknown>) => Promise<unknown>;
}

export interface ConnectorCtx {
  projectId: string;
  /**
   * The acting user (project owner), or null for non-interactive runs. Needed
   * by connectors that authenticate with a PER-USER OAuth token (e.g. Supabase)
   * rather than a project secret.
   */
  userId: string | null;
  /**
   * Resolve a secret by name. Throws if not configured. Plaintext stays
   * server-side; the agent never sees the return value.
   */
  secret: (name: string) => Promise<string>;
}

export interface ConnectorDefinition {
  id: string;
  name: string;
  description: string;
  methods: ConnectorMethod[];
}

import { httpConnector } from "./http.js";
import { slackConnector } from "./slack.js";
import { postgresConnector } from "./postgres.js";
import { githubConnector } from "./github.js";
import { supabaseConnector } from "./supabase.js";
import { stripeConnector } from "./stripe.js";

const REGISTRY: Map<string, ConnectorDefinition> = new Map([
  [httpConnector.id, httpConnector],
  [slackConnector.id, slackConnector],
  [postgresConnector.id, postgresConnector],
  [githubConnector.id, githubConnector],
  [supabaseConnector.id, supabaseConnector],
  [stripeConnector.id, stripeConnector],
]);

export function listConnectors(): ConnectorDefinition[] {
  return Array.from(REGISTRY.values());
}

export function listProjectConnectors(): Array<{
  id: string;
  name: string;
  description: string;
  methods: Array<{ name: string; description: string; args_schema: Record<string, unknown> }>;
}> {
  return listConnectors().map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    methods: c.methods.map((m) => ({
      name: m.name,
      description: m.description,
      args_schema: m.args_schema,
    })),
  }));
}

export async function callConnector(args: {
  connector: string;
  method: string;
  args: Record<string, unknown>;
  projectId: string;
  userId: string | null;
}): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const def = REGISTRY.get(args.connector);
  if (!def) {
    return { ok: false, error: `Unknown connector '${args.connector}'. Available: ${[...REGISTRY.keys()].join(", ")}` };
  }
  const method = def.methods.find((m) => m.name === args.method);
  if (!method) {
    return {
      ok: false,
      error: `Unknown method '${args.method}' on connector '${args.connector}'. Available: ${def.methods.map((m) => m.name).join(", ")}`,
    };
  }

  const ctx: ConnectorCtx = {
    projectId: args.projectId,
    userId: args.userId,
    secret: async (name: string) => {
      const v = await getSecretValue(args.projectId, name);
      if (v === null) {
        throw new Error(
          `Secret '${name}' is not configured for this project. Add it from the Secrets pane.`,
        );
      }
      // Attribute the secret_read to the connector_invoke that triggered it.
      void audit({
        project_id: args.projectId,
        user_id: args.userId,
        kind: "secret_read",
        target: name,
        metadata: { via_connector: `${args.connector}.${args.method}` },
      });
      return v;
    },
  };

  try {
    const result = await method.invoke(ctx, args.args ?? {});
    void audit({
      project_id: args.projectId,
      user_id: args.userId,
      kind: "connector_invoke",
      target: `${args.connector}.${args.method}`,
      metadata: null,
    });
    return { ok: true, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void audit({
      project_id: args.projectId,
      user_id: args.userId,
      kind: "connector_invoke_error",
      target: `${args.connector}.${args.method}`,
      metadata: { error: message },
    });
    return { ok: false, error: message };
  }
}
