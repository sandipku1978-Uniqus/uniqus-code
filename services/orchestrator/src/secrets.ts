import { listSecrets } from "./db/secrets.js";
import {
  listDir as sandboxListDir,
  readFile as sandboxReadFile,
  writeFile as sandboxWriteFile,
  type Sandbox,
} from "./agent/sandbox.js";
import { isModelVisibleProjectConfig } from "./security/projectSecretPolicy.js";

/** Model-facing metadata only. Plaintext is resolved solely by trusted connectors/deploy. */
export async function listProjectSecrets(
  projectId: string,
  env?: string | null,
): Promise<Array<{
  name: string;
  env: string;
  description: string | null;
  allowed_hosts: string[];
}>> {
  const rows = await listSecrets(projectId, env);
  return rows.map((row) => ({
    name: row.name,
    env: row.env,
    description: row.description,
    allowed_hosts: row.allowed_hosts,
  }));
}

/**
 * Remove lines written by the retired plaintext-materialization design. This
 * only deletes the named assignment from top-level .env files; it never reads
 * or writes the secret value itself.
 */
export async function removeLegacyMaterializedSecret(args: {
  sandbox: Sandbox;
  name: string;
  /** Keep connector-declared public app config during routine hardening cleanup. */
  preservePublicConfig?: boolean;
}): Promise<void> {
  // Supabase's URL + anon key are intentionally public app configuration and
  // are still materialized by the agent. Never remove them as legacy secret
  // leakage; doing so breaks the generated client on its next turn.
  if (args.preservePublicConfig && isModelVisibleProjectConfig(args.name)) return;
  if (!/^[A-Z_][A-Z0-9_]*$/.test(args.name)) return;
  const entries = await sandboxListDir(args.sandbox).catch(() => [] as string[]);
  const envFiles = entries.filter(
    (entry) => !entry.endsWith("/") && (entry === ".env" || entry.startsWith(".env.")) && entry !== ".env.example",
  );
  const matcher = new RegExp(`^\\s*#?\\s*${escapeRegex(args.name)}\\s*=`);
  for (const envFile of envFiles) {
    const existing = await sandboxReadFile(args.sandbox, envFile).catch(() => null);
    if (existing === null) continue;
    const lines = existing.split("\n");
    const kept = lines.filter((line) => !matcher.test(line));
    if (kept.length !== lines.length) {
      await sandboxWriteFile(args.sandbox, envFile, kept.join("\n"));
    }
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
