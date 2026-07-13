import { randomBytes } from "node:crypto";
import type { ConnectorCtx, ConnectorDefinition } from "./index.js";
import { supabaseFetch } from "../supabase.js";
import { db } from "../db/client.js";
import { setSupabaseProject } from "../db/projects.js";
import { upsertSecret } from "../db/secrets.js";
import { audit } from "../db/audit.js";

/**
 * P5.2: classify a SQL statement as destructive so run_sql can require explicit
 * confirmation (and surface an impact preview) before it runs. Conservative on
 * purpose — DROP/TRUNCATE/DELETE and `ALTER ... DROP`/REVOKE gate; additive DDL
 * (CREATE, ALTER ADD COLUMN) and SELECT/INSERT/UPDATE flow straight through.
 */
function classifyDestructiveSql(sql: string): { destructive: boolean; op?: string; impactQuery?: string } {
  const s = sql.trim();
  const truncate = s.match(/\btruncate\s+(?:table\s+)?([a-zA-Z0-9_."]+)/i);
  if (truncate) return { destructive: true, op: "TRUNCATE", impactQuery: `select count(*) as rows from ${truncate[1]}` };
  const dropTable = s.match(/\bdrop\s+(?:table|view|materialized\s+view)\s+(?:if\s+exists\s+)?([a-zA-Z0-9_."]+)/i);
  if (dropTable) return { destructive: true, op: "DROP", impactQuery: `select count(*) as rows from ${dropTable[1]}` };
  if (/\bdrop\s+(schema|database)\b/i.test(s)) return { destructive: true, op: "DROP" };
  const del = s.match(/\bdelete\s+from\s+([a-zA-Z0-9_."]+)([\s\S]*)$/i);
  if (del) {
    const where = del[2].match(/\bwhere\b[\s\S]*$/i);
    const impact = `select count(*) as rows from ${del[1]} ${where ? where[0].replace(/;\s*$/, "") : ""}`.trim();
    return { destructive: true, op: "DELETE", impactQuery: impact };
  }
  if (/\balter\s+table\b[\s\S]*\bdrop\b/i.test(s)) return { destructive: true, op: "ALTER ... DROP" };
  if (/\brevoke\b/i.test(s)) return { destructive: true, op: "REVOKE" };
  return { destructive: false };
}

/**
 * Supabase connector — lets the agent provision and operate a real Postgres
 * database per project.
 *
 * Unlike the other connectors (which read an API key from project secrets),
 * Supabase authenticates with the user's account-level OAuth token, resolved
 * via ctx.userId (supabase.ts handles refresh). On `provision_database` the
 * connector creates the project, waits for it to come up, fetches the keys, and
 * writes the connection details into project_secrets — so the agent never sees
 * the service_role key or db password; it only gets back the PUBLIC URL + anon
 * key to wire into the client.
 */

const DEFAULT_REGION = "us-east-1";
const POLL_INTERVAL_MS = 5_000;
const POLL_MAX_MS = 150_000;

function requireUser(ctx: ConnectorCtx): string {
  if (!ctx.userId) {
    throw new Error("Supabase needs an interactive user session (no userId on this run).");
  }
  return ctx.userId;
}

/** Strong, URL-safe Postgres password (base64url has no +/ that break a DSN). */
function genDbPass(): string {
  return randomBytes(24).toString("base64url");
}

/** Read the Supabase project ref already linked to this Gate 15 project, if any. */
async function linkedRef(projectId: string): Promise<string | null> {
  const { data } = await db()
    .from("projects")
    .select("supabase_project_ref")
    .eq("id", projectId)
    .maybeSingle();
  return (data?.supabase_project_ref as string | null) ?? null;
}

/**
 * A Supabase project ref is a 20-char lowercase alphanumeric id. Validate it
 * before it gets interpolated raw into `/projects/${ref}/...` Management-API
 * paths — otherwise an agent-supplied (or prompt-injected) ref could smuggle
 * `/` / `..` segments to traverse to other Management-API endpoints, or target
 * an arbitrary user-owned project (cross-project SQL / key exfil). Mirrors the
 * github connector's validatePathComponent guard.
 */
function assertValidRef(ref: string): string {
  if (!/^[a-z0-9]{20}$/.test(ref)) {
    throw new Error(`invalid Supabase project_ref: ${ref}`);
  }
  return ref;
}

/** Resolve the project ref from an explicit arg or the linked project. */
async function resolveRef(ctx: ConnectorCtx, args: Record<string, unknown>): Promise<string> {
  const explicit = typeof args.project_ref === "string" && args.project_ref.trim();
  const ref = explicit || (await linkedRef(ctx.projectId));
  if (!ref) {
    throw new Error(
      "No Supabase project linked. Call supabase.provision_database first, or pass project_ref.",
    );
  }
  return assertValidRef(ref);
}

interface ProjectStatus {
  ref?: string;
  name?: string;
  status?: string;
  region?: string;
  organization_id?: string;
}

/** Current API: [{ name, api_key }]. Older: { anon_key, service_role_key }. Handle both. */
function parseApiKeys(data: unknown): { anon: string | null; serviceRole: string | null } {
  if (Array.isArray(data)) {
    let anon: string | null = null;
    let serviceRole: string | null = null;
    for (const k of data) {
      if (!k || typeof k !== "object") continue;
      const rec = k as { name?: unknown; api_key?: unknown; apiKey?: unknown };
      const name = String(rec.name ?? "");
      const key = (rec.api_key ?? rec.apiKey ?? null) as string | null;
      if (name === "anon") anon = key;
      else if (name === "service_role") serviceRole = key;
    }
    return { anon, serviceRole };
  }
  if (data && typeof data === "object") {
    const o = data as { anon_key?: unknown; service_role_key?: unknown };
    return {
      anon: typeof o.anon_key === "string" ? o.anon_key : null,
      serviceRole: typeof o.service_role_key === "string" ? o.service_role_key : null,
    };
  }
  return { anon: null, serviceRole: null };
}

/**
 * Fetch the project's keys and write SUPABASE_URL / SUPABASE_ANON_KEY /
 * SUPABASE_SERVICE_ROLE_KEY / DATABASE_URL into project_secrets. Returns ONLY
 * the public values (url + anon key) — secrets stay server-side.
 */
async function writeProjectConfig(
  ctx: ConnectorCtx,
  ref: string,
  dbPass: string,
): Promise<{ url: string; anon_key: string | null; secrets_written: string[] }> {
  const keys = await supabaseFetch(ctx.userId, `/projects/${ref}/api-keys`);
  const { anon, serviceRole } = parseApiKeys(keys);
  const url = `https://${ref}.supabase.co`;
  const dbUrl = `postgresql://postgres:${encodeURIComponent(dbPass)}@db.${ref}.supabase.co:5432/postgres`;

  const written: string[] = [];
  await upsertSecret({ project_id: ctx.projectId, name: "SUPABASE_URL", value: url, description: "Supabase project URL" });
  written.push("SUPABASE_URL");
  if (anon) {
    await upsertSecret({ project_id: ctx.projectId, name: "SUPABASE_ANON_KEY", value: anon, description: "Supabase anon (public) key" });
    written.push("SUPABASE_ANON_KEY");
  }
  if (serviceRole) {
    await upsertSecret({ project_id: ctx.projectId, name: "SUPABASE_SERVICE_ROLE_KEY", value: serviceRole, description: "Supabase service_role key — server-only, bypasses RLS" });
    written.push("SUPABASE_SERVICE_ROLE_KEY");
  }
  await upsertSecret({ project_id: ctx.projectId, name: "DATABASE_URL", value: dbUrl, description: "Supabase Postgres connection string" });
  written.push("DATABASE_URL");

  return { url, anon_key: anon, secrets_written: written };
}

const PROVISION_READY_NOTE =
  "Database ready. SUPABASE_SERVICE_ROLE_KEY + DATABASE_URL + SUPABASE_DB_PASSWORD are stored as project " +
  "secrets (not shown). Write SUPABASE_URL and SUPABASE_ANON_KEY into the app's .env(.local) for the client; " +
  "use DATABASE_URL / the service role server-side. Use supabase.run_sql to create tables.";

/**
 * Poll a project until ACTIVE_HEALTHY (capped at POLL_MAX_MS), then wire its
 * keys into project_secrets. On timeout, returns a "still provisioning" status
 * — the caller can re-run provision_database (which resumes) or get_database to
 * finish later. Shared by the fresh-create and resume paths.
 */
async function pollAndFinish(
  ctx: ConnectorCtx,
  userId: string,
  ref: string,
  name: string,
  dbPass: string,
  initialStatus: string,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + POLL_MAX_MS;
  let status = initialStatus;
  while (status !== "ACTIVE_HEALTHY" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const cur = (await supabaseFetch(userId, `/projects/${ref}`)) as ProjectStatus;
    status = cur.status ?? status;
  }
  if (status !== "ACTIVE_HEALTHY") {
    return {
      ref,
      project_name: name,
      status,
      note:
        "Still provisioning (this can take a few minutes). The DB is linked and its password is stored. " +
        "Call supabase.provision_database again later — it RESUMES this same project (no duplicate is created) " +
        "and finishes wiring the keys — or call supabase.get_database once it reads ACTIVE_HEALTHY.",
    };
  }
  const config = await writeProjectConfig(ctx, ref, dbPass);
  return {
    ref,
    project_name: name,
    status,
    url: config.url,
    anon_key: config.anon_key,
    secrets_written: config.secrets_written,
    note: PROVISION_READY_NOTE,
  };
}

export const supabaseConnector: ConnectorDefinition = {
  id: "supabase",
  name: "Supabase",
  description:
    "Provision and operate a Supabase Postgres database for this project using the user's connected Supabase account. provision_database creates the DB and stores its keys as project secrets; run_sql applies schema/queries.",
  methods: [
    {
      name: "list_organizations",
      risk: "read",
      description: "List the Supabase organizations the connected account can create projects in.",
      args_schema: { type: "object", properties: {} },
      invoke: async (ctx) => {
        requireUser(ctx);
        return await supabaseFetch(ctx.userId, "/organizations");
      },
    },
    {
      name: "list_projects",
      risk: "read",
      description: "List the connected account's existing Supabase projects (ref, name, region, status).",
      args_schema: { type: "object", properties: {} },
      invoke: async (ctx) => {
        requireUser(ctx);
        return await supabaseFetch(ctx.userId, "/projects");
      },
    },
    {
      name: "provision_database",
      risk: "write",
      description:
        "Create a new Supabase Postgres project, wait until it's healthy, and store its URL + anon/service_role keys + DATABASE_URL as project secrets. Returns the PUBLIC url + anon key to wire into the app (write SUPABASE_URL + SUPABASE_ANON_KEY into .env). Creating a project provisions real infra and counts against the org's free-project quota (2 free per org).",
      args_schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Project name. Defaults to a Gate 15-derived name." },
          organization_id: { type: "string", description: "Org to create under. Defaults to the connected account's org if it has exactly one." },
          region: { type: "string", description: `Region slug (default ${DEFAULT_REGION}).` },
          plan: { type: "string", enum: ["free", "pro"], description: "Defaults to free." },
        },
      },
      invoke: async (ctx, args) => {
        const userId = requireUser(ctx);

        // Idempotent resume: if this project already has a linked Supabase
        // project (e.g. a previous call timed out mid-provision), finish THAT
        // one instead of creating a duplicate that burns the org's free quota.
        const existingRef = await linkedRef(ctx.projectId);
        if (existingRef) {
          let dbPass: string;
          try {
            dbPass = await ctx.secret("SUPABASE_DB_PASSWORD");
          } catch {
            throw new Error(
              `This project is already linked to Supabase project '${existingRef}', but its stored DB ` +
                `password (SUPABASE_DB_PASSWORD) is missing — cannot finish setup. Use supabase.run_sql ` +
                `against it, or set that secret manually.`,
            );
          }
          const cur = (await supabaseFetch(userId, `/projects/${existingRef}`)) as ProjectStatus;
          return await pollAndFinish(
            ctx,
            userId,
            existingRef,
            cur.name ?? existingRef,
            dbPass,
            cur.status ?? "INITIAL_PROVISIONING",
          );
        }

        // Resolve the org.
        let organizationId = typeof args.organization_id === "string" ? args.organization_id : "";
        if (!organizationId) {
          const orgs = (await supabaseFetch(userId, "/organizations")) as Array<{ id?: string; name?: string }>;
          if (Array.isArray(orgs) && orgs.length === 1 && orgs[0].id) {
            organizationId = orgs[0].id;
          } else {
            throw new Error(
              `organization_id is required (the account has ${Array.isArray(orgs) ? orgs.length : 0} orgs). ` +
                `Available: ${JSON.stringify(orgs)}. Pass one as organization_id.`,
            );
          }
        }

        const name = (typeof args.name === "string" && args.name.trim()) || `gate15-${ctx.projectId.slice(0, 8)}`;
        const region = (typeof args.region === "string" && args.region.trim()) || DEFAULT_REGION;
        const plan = args.plan === "pro" ? "pro" : "free";
        const dbPass = genDbPass();

        // Create. Response carries the project ref we use for everything after.
        const created = (await supabaseFetch(userId, "/projects", {
          method: "POST",
          body: { name, organization_id: organizationId, region, db_pass: dbPass, plan },
        })) as ProjectStatus;
        const ref = created.ref;
        if (!ref) {
          throw new Error(`Supabase create returned no project ref: ${JSON.stringify(created)}`);
        }

        // Persist the db password + link the project IMMEDIATELY so nothing is
        // lost (and a re-call RESUMES) if polling times out — db_pass is not
        // retrievable from Supabase later.
        await upsertSecret({ project_id: ctx.projectId, name: "SUPABASE_DB_PASSWORD", value: dbPass, description: "Supabase Postgres password (write-only on Supabase's side)" });
        await setSupabaseProject(ctx.projectId, userId, { ref, name, orgId: organizationId });

        return await pollAndFinish(ctx, userId, ref, name, dbPass, created.status ?? "INITIAL_PROVISIONING");
      },
    },
    {
      name: "get_database",
      risk: "write",
      description:
        "Check the linked Supabase project's status and, once ACTIVE_HEALTHY, ensure its keys are stored as project secrets. Returns the public url + anon key.",
      args_schema: {
        type: "object",
        properties: { project_ref: { type: "string", description: "Defaults to the project's linked ref." } },
      },
      invoke: async (ctx, args) => {
        const userId = requireUser(ctx);
        const ref = await resolveRef(ctx, args);
        const cur = (await supabaseFetch(userId, `/projects/${ref}`)) as ProjectStatus;
        if (cur.status !== "ACTIVE_HEALTHY") {
          return { ref, status: cur.status ?? "unknown", note: "Not ready yet — try again shortly." };
        }
        // Finish wiring keys (idempotent). db_pass was stored at create time.
        let dbPass: string;
        try {
          dbPass = await ctx.secret("SUPABASE_DB_PASSWORD");
        } catch {
          throw new Error(
            "Project is healthy but SUPABASE_DB_PASSWORD secret is missing — cannot rebuild DATABASE_URL. " +
              "Re-provision or set the password secret manually.",
          );
        }
        const config = await writeProjectConfig(ctx, ref, dbPass);
        return { ref, status: cur.status, url: config.url, anon_key: config.anon_key, secrets_written: config.secrets_written };
      },
    },
    {
      name: "run_sql",
      risk: "write",
      description:
        "Run a SQL statement against the linked Supabase project's database (create tables, apply a migration, query). Uses the Management API query endpoint. DESTRUCTIVE statements (DROP, TRUNCATE, DELETE, ALTER ... DROP, REVOKE) are NOT executed unless you pass confirm:true — the first call returns an impact preview (e.g. row count affected) so you can confirm with the user in plain language what will be lost, then re-run with confirm:true.",
      args_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The SQL to execute." },
          project_ref: { type: "string", description: "Defaults to the project's linked ref." },
          confirm: {
            type: "boolean",
            description: "Required (true) to actually run a destructive statement. Only set this AFTER the user has approved the impact in plain language.",
          },
        },
        required: ["query"],
      },
      invoke: async (ctx, args) => {
        const userId = requireUser(ctx);
        if (typeof args.query !== "string" || !args.query.trim()) {
          throw new Error("run_sql requires a non-empty 'query'.");
        }
        const ref = await resolveRef(ctx, args);
        const cls = classifyDestructiveSql(args.query);
        const confirmed = args.confirm === true;
        if (cls.destructive && !confirmed) {
          // P5.2: don't execute — return an impact preview + a clear instruction
          // to confirm in plain language first. Never mutate the user's SQL.
          let impact: unknown = null;
          if (cls.impactQuery) {
            try {
              impact = await supabaseFetch(userId, `/projects/${ref}/database/query`, {
                method: "POST",
                body: { query: cls.impactQuery },
              });
            } catch {
              /* impact preview is best-effort */
            }
          }
          return {
            blocked: true,
            destructive: true,
            operation: cls.op,
            impact_preview: impact,
            message:
              `This statement is destructive (${cls.op}) and was NOT executed. Tell the user in plain language ` +
              `what will be permanently lost (use the impact_preview row count above if present), get their ` +
              `approval, then re-run run_sql with the same query and confirm:true.`,
          };
        }
        const result = await supabaseFetch(userId, `/projects/${ref}/database/query`, {
          method: "POST",
          body: { query: args.query },
        });
        if (cls.destructive) {
          void audit({
            project_id: ctx.projectId,
            user_id: ctx.userId,
            kind: "db_lifecycle",
            target: `run_sql:${cls.op}`,
            metadata: { ref },
          });
        }
        return result;
      },
    },
    {
      name: "get_schema",
      risk: "read",
      description:
        "Inspect the linked Supabase database: returns every public-schema table with its columns (name, type, nullable, default, primary-key flag). Call this before writing migrations or the add-login recipe so you build on the real schema instead of guessing.",
      args_schema: {
        type: "object",
        properties: { project_ref: { type: "string", description: "Defaults to the project's linked ref." } },
      },
      invoke: async (ctx, args) => {
        const userId = requireUser(ctx);
        const ref = await resolveRef(ctx, args);
        const query =
          "select c.table_name, c.column_name, c.data_type, c.is_nullable, c.column_default, " +
          "exists (select 1 from information_schema.table_constraints tc " +
          "join information_schema.key_column_usage kcu on tc.constraint_name = kcu.constraint_name " +
          "where tc.constraint_type = 'PRIMARY KEY' and tc.table_name = c.table_name " +
          "and kcu.column_name = c.column_name and tc.table_schema = 'public') as is_pk " +
          "from information_schema.columns c where c.table_schema = 'public' " +
          "order by c.table_name, c.ordinal_position";
        return await supabaseFetch(userId, `/projects/${ref}/database/query`, {
          method: "POST",
          body: { query },
        });
      },
    },
  ],
};
