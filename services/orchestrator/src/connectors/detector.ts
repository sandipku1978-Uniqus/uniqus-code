import { db } from "../db/client.js";
import { listSecrets } from "../db/secrets.js";

/**
 * Which integrations are actually active/provisioned for a project. Injected
 * into the system prompt every turn (like the running-servers snapshot) so the
 * agent knows what's connected instead of assuming a database exists — the gap
 * that let it invent an ephemeral file-based store when nothing was connected.
 *
 * Conservative on purpose: advertising a half-provisioned connector is worse
 * than "none". Supabase counts as ready only when the project is linked AND its
 * keys are written as secrets (a linked-but-still-provisioning project has the
 * ref but no usable connection yet). Other connectors are detected from their
 * required secret across all envs. Never throws — returns [] on error so the
 * agent sees "no integrations" rather than crashing.
 */
export async function detectActiveConnectors(
  projectId: string,
): Promise<{ id: string; name: string; status: string }[]> {
  const connectors: { id: string; name: string; status: string }[] = [];
  try {
    const { data: project } = await db()
      .from("projects")
      .select("supabase_project_ref")
      .eq("id", projectId)
      .maybeSingle();

    // env=null → look across every env, not just the default one.
    const secrets = await listSecrets(projectId, null);
    const names = new Set(secrets.map((s) => s.name.toUpperCase()));
    const has = (...keys: string[]) => keys.some((k) => names.has(k));

    // Supabase: linked AND its keys present (not just provisioning).
    const supabaseReady =
      !!project?.supabase_project_ref &&
      has("DATABASE_URL", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_ANON_KEY");
    if (supabaseReady) {
      connectors.push({ id: "supabase", name: "Supabase (Postgres database + auth)", status: "ready" });
    }

    if (has("DATABASE_URL") && !connectors.some((c) => c.id === "supabase")) {
      connectors.push({ id: "postgres", name: "Postgres database (external DATABASE_URL)", status: "configured" });
    }
    if (has("STRIPE_API_KEY", "STRIPE_SECRET_KEY")) {
      connectors.push({ id: "stripe", name: "Stripe (payments)", status: "configured" });
    }
    if (has("SLACK_BOT_TOKEN", "SLACK_WEBHOOK_URL")) {
      connectors.push({ id: "slack", name: "Slack", status: "configured" });
    }
  } catch (err) {
    console.error("detectActiveConnectors failed:", err);
  }
  return connectors;
}
