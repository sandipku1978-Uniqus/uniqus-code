import { promises as fs } from "node:fs";
import path from "node:path";
import { listSecrets, getSecretValue } from "./db/secrets.js";
import { audit } from "./db/audit.js";

/**
 * Agent-facing secret helpers.
 *
 * The agent never sees plaintext secret values. The `get_secret` tool's
 * job is to plumb a value from the encrypted store into a sandbox .env file
 * so generated code (server.js, app.py, etc.) can read it from
 * `process.env.X` / `os.environ["X"]` at runtime. The plaintext flows
 * server-only; the agent's tool result reports just the env-var name and
 * a confirmation.
 *
 * Every read writes an audit event (Plan §6 — "every connector invocation
 * emits a tenant-scoped audit event").
 */

const SECRET_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;

export async function listProjectSecrets(projectId: string): Promise<
  Array<{ name: string; description: string | null }>
> {
  const rows = await listSecrets(projectId);
  return rows.map((r) => ({ name: r.name, description: r.description }));
}

export async function plumbSecretToEnvFile(args: {
  sandboxDir: string;
  projectId: string;
  userId: string | null;
  name: string;
  envFile?: string;
}): Promise<{ env_var: string; env_file: string }> {
  if (!SECRET_NAME_RE.test(args.name)) {
    throw new Error(
      `Invalid secret name '${args.name}'. Names must match [A-Z_][A-Z0-9_]* — same constraints as POSIX env vars.`,
    );
  }
  const value = await getSecretValue(args.projectId, args.name);
  if (value === null) {
    throw new Error(
      `Secret '${args.name}' is not set for this project. Add it from the Secrets pane in the topbar.`,
    );
  }
  const envFile = (args.envFile && args.envFile.trim()) || ".env";
  if (envFile.includes("..") || envFile.startsWith("/")) {
    throw new Error(`env_file must be a sandbox-relative path, got '${envFile}'`);
  }
  const full = path.resolve(args.sandboxDir, envFile);
  if (!full.startsWith(path.resolve(args.sandboxDir) + path.sep)) {
    throw new Error("env_file escapes sandbox");
  }
  await fs.mkdir(path.dirname(full), { recursive: true });
  let existing = "";
  try {
    existing = await fs.readFile(full, "utf-8");
  } catch {
    // file doesn't exist yet — fine.
  }
  // Replace existing line for this key, or append. Match KEY=anything at
  // start-of-line (no spaces around =, which is the convention dotenv parses).
  const line = `${args.name}=${escapeForEnv(value)}`;
  const lineRe = new RegExp(`(^|\\n)${args.name}=[^\\n]*`, "g");
  const next = lineRe.test(existing)
    ? existing.replace(lineRe, (_, lead) => `${lead}${line}`)
    : (existing.endsWith("\n") || !existing ? existing : `${existing}\n`) + line + "\n";
  await fs.writeFile(full, next, "utf-8");

  // Make sure the env file is gitignored. Best-effort — if .gitignore is
  // missing or unreadable, log and continue.
  try {
    const gitignore = path.resolve(args.sandboxDir, ".gitignore");
    let body = "";
    try {
      body = await fs.readFile(gitignore, "utf-8");
    } catch {}
    const lines = body.split(/\r?\n/);
    if (!gitignoreCovers(lines, envFile)) {
      const append = body.endsWith("\n") || !body ? `${envFile}\n` : `\n${envFile}\n`;
      await fs.writeFile(gitignore, body + append, "utf-8");
    }
  } catch {}

  void audit({
    project_id: args.projectId,
    user_id: args.userId,
    kind: "secret_read",
    target: args.name,
    metadata: { env_file: envFile },
  });

  return { env_var: args.name, env_file: envFile };
}

function escapeForEnv(v: string): string {
  // Wrap in double-quotes if value contains whitespace, =, # or quote chars.
  if (/[\s"'#=]/.test(v)) {
    return `"${v
      .replaceAll("\\", "\\\\")
      .replaceAll("\r", "\\r")
      .replaceAll("\n", "\\n")
      .replaceAll('"', '\\"')}"`;
  }
  return v;
}

function gitignoreCovers(lines: string[], envFile: string): boolean {
  const normalized = envFile.replaceAll("\\", "/");
  return lines.some((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return false;
    if (trimmed === normalized) return true;
    if (trimmed === ".env" && normalized === ".env") return true;
    if (trimmed === ".env*" && normalized.startsWith(".env")) return true;
    if (trimmed === "*.env" && normalized.endsWith(".env")) return true;
    if (trimmed === "*.env*" && normalized.includes(".env")) return true;
    return false;
  });
}
