import { promises as fs } from "node:fs";
import path from "node:path";
import { listSecrets, getSecretValue, normalizeEnv, DEFAULT_ENV } from "./db/secrets.js";
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

export async function listProjectSecrets(
  projectId: string,
  env?: string | null,
): Promise<Array<{ name: string; env: string; description: string | null }>> {
  // Pass `env: null` to fetch every env at once; otherwise filter to one.
  // Default behavior (no arg) shows only the `default` env so the agent
  // sees the same view it always saw on a single-env project.
  const rows = await listSecrets(projectId, env);
  return rows.map((r) => ({ name: r.name, env: r.env, description: r.description }));
}

export async function plumbSecretToEnvFile(args: {
  sandboxDir: string;
  projectId: string;
  userId: string | null;
  name: string;
  envFile?: string;
  /** Which env's secret to plumb. Defaults to the `default` env. */
  env?: string | null;
}): Promise<{ env_var: string; env_file: string; env: string }> {
  if (!SECRET_NAME_RE.test(args.name)) {
    throw new Error(
      `Invalid secret name '${args.name}'. Names must match [A-Z_][A-Z0-9_]* — same constraints as POSIX env vars.`,
    );
  }
  const env = normalizeEnv(args.env);
  const value = await getSecretValue(args.projectId, args.name, env);
  if (value === null) {
    const envHint = env === DEFAULT_ENV ? "" : ` (env '${env}')`;
    throw new Error(
      `Secret '${args.name}'${envHint} is not set for this project. Add it from the Secrets pane in the topbar.`,
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
  // Replace existing line(s) for this key, or append.
  //
  // The previous one-line regex `(^|\n)NAME=[^\n]*` only matched the key at
  // column 0 of a line, which meant indented entries (`  NAME=…`) and
  // commented-out stale versions (`# NAME=…`) were left in place. The
  // freshly-written canonical line was then appended below them, so dotenv
  // parsers that take the *last* assignment would see the new value but the
  // file would still carry a misleading commented entry above it — and an
  // indented duplicate would actually take precedence in some parsers.
  //
  // Walk the file line-by-line instead: any line whose first non-whitespace
  // token (with an optional leading `#`) is `NAME=` gets replaced once, and
  // any further occurrences are dropped to canonicalise the file.
  const line = `${args.name}=${escapeForEnv(value)}`;
  const next = upsertEnvLine(existing, args.name, line);
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
    metadata: { env_file: envFile, env },
  });

  return { env_var: args.name, env_file: envFile, env };
}

/**
 * Replace the first assignment of `NAME` in `existing` with `replacement`,
 * dropping any later duplicates and any commented-out copies (`# NAME=…`).
 * If `NAME` is not present, append `replacement` on its own line.
 *
 * Recognises optional leading whitespace and an optional `#` (plus whitespace)
 * before `NAME=`, matching how dotenv parsers tolerate indented / commented
 * lines. Lines whose key matches `NAME` exactly become the canonical
 * replacement; everything else is preserved verbatim.
 */
function upsertEnvLine(existing: string, name: string, replacement: string): string {
  const lines = existing.split("\n");
  const matcher = new RegExp(`^\\s*#?\\s*${escapeRegex(name)}\\s*=`);
  const out: string[] = [];
  let replaced = false;
  for (const ln of lines) {
    if (!matcher.test(ln)) {
      out.push(ln);
      continue;
    }
    if (!replaced) {
      out.push(replacement);
      replaced = true;
    }
    // Drop later duplicates / commented stragglers.
  }
  if (!replaced) {
    // Ensure a trailing newline before the appended line so we never produce
    // `…value\nNAME=…` jammed together.
    if (out.length > 0 && out[out.length - 1] !== "") {
      out.push(replacement);
    } else if (out.length === 0) {
      out.push(replacement);
    } else {
      out[out.length - 1] = replacement;
    }
    // Trailing blank line for POSIX-friendly newline-terminated files.
    out.push("");
  }
  return out.join("\n");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
