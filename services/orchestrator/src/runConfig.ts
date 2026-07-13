import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Per-project run configuration. Persisted as `.gate15-run.json` in the
 * sandbox so it survives redeploys via the same Storage sync that carries the
 * rest of the user's files.
 *
 * Rebrand note (spec §8): this file sits at the root of the user's sandbox and
 * `listDir` does not hide dotfiles, so it shows up in the file explorer — it is
 * user-visible and therefore in scope for the rename. It is NOT covered by the
 * §8b exemption: that exemption exists because `.uniqus/skills.md` is pinned by
 * `db/schema.sql` and by UI copy that prints the path, neither of which is true
 * here. The migration is instead carried in this module:
 *
 *   - READ  prefers {@link RUN_CONFIG_FILE} and falls back to
 *     {@link LEGACY_RUN_CONFIG_FILE}, so a project created before the rebrand
 *     (whose old file hydrates back out of Storage) keeps its Run config.
 *   - WRITE emits the new name and removes the legacy file, so a sandbox never
 *     carries both. The stale Storage object is reconciled away by the sync
 *     walk, which deletes remote files that no longer exist locally.
 *
 * Net effect: no project loses its Run config, and the old name disappears from
 * the file tree on the first write.
 */
export interface RunConfig {
  command: string;
  port: number;
  /** Where the config came from. Useful for telemetry / debugging only. */
  source?: "agent" | "user" | "detected";
}

/**
 * Current on-disk name, relative to the sandbox root. Exported so callers that
 * need to push it to Storage (`ProjectSync.syncFile`) reference the constant
 * rather than re-typing the literal and drifting from it.
 */
export const RUN_CONFIG_FILE = ".gate15-run.json";

/** Pre-rebrand name. Still read when the new file is absent; never written. */
export const LEGACY_RUN_CONFIG_FILE = ".uniqus-run.json";

async function readConfigFile(
  sandboxDir: string,
  file: string,
): Promise<RunConfig | null> {
  try {
    const raw = await fs.readFile(path.join(sandboxDir, file), "utf-8");
    const parsed = JSON.parse(raw) as Partial<RunConfig>;
    if (typeof parsed.command !== "string" || typeof parsed.port !== "number") {
      return null;
    }
    return {
      command: parsed.command,
      port: parsed.port,
      source: parsed.source,
    };
  } catch {
    return null;
  }
}

export async function readRunConfig(sandboxDir: string): Promise<RunConfig | null> {
  return (
    (await readConfigFile(sandboxDir, RUN_CONFIG_FILE)) ??
    (await readConfigFile(sandboxDir, LEGACY_RUN_CONFIG_FILE))
  );
}

export async function writeRunConfig(
  sandboxDir: string,
  config: RunConfig,
): Promise<void> {
  await fs.writeFile(
    path.join(sandboxDir, RUN_CONFIG_FILE),
    JSON.stringify(config, null, 2) + "\n",
    "utf-8",
  );
  // Retire the pre-rebrand file once the new one is safely on disk, so the
  // sandbox never shows both. Best effort: it is absent on any project created
  // after the rebrand, and a failure to unlink is harmless because reads prefer
  // the new name.
  await fs
    .rm(path.join(sandboxDir, LEGACY_RUN_CONFIG_FILE), { force: true })
    .catch(() => {});
}

/**
 * Best-effort guess at how to run this project. Looks at common entry points;
 * returns null if it can't make a confident call.
 *
 * The agent's start_server tool will overwrite this anyway as soon as it runs,
 * so we only need to be right for the "user clicked Run before the agent
 * scaffolded a runnable project" case — for empty or partially-set-up
 * projects, returning null is the right answer.
 */
export async function detectRunConfig(sandboxDir: string): Promise<RunConfig | null> {
  // Node project — package.json with a `dev` or `start` script.
  try {
    const raw = await fs.readFile(path.join(sandboxDir, "package.json"), "utf-8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts ?? {};
    // Prefer `dev` (Next/Vite), then `start` (Express, plain Node).
    const scriptName = scripts.dev ? "dev" : scripts.start ? "start" : null;
    if (scriptName) {
      const script = scripts[scriptName];
      const framework = detectNodeFramework(script);
      const hostArgs = framework0HostFlags(script) ? "" : framework.hostArgs;
      const command = `npm run ${scriptName}${hostArgs}`;
      const port = guessPortFromScript(script) ?? framework.defaultPort;
      return { command, port, source: "detected" };
    }
  } catch {
    // No package.json or unparseable — fall through.
  }

  // Python project — Flask/FastAPI hint.
  try {
    await fs.access(path.join(sandboxDir, "requirements.txt"));
    if (await exists(path.join(sandboxDir, "app.py"))) {
      return { command: "python -u app.py", port: 5000, source: "detected" };
    }
    if (await exists(path.join(sandboxDir, "main.py"))) {
      return {
        command: "uvicorn main:app --host 0.0.0.0 --port 8000",
        port: 8000,
        source: "detected",
      };
    }
  } catch {
    // No requirements.txt — fall through.
  }

  return null;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * If a dev script already includes a host/bind flag, preserve the user's
 * intent instead of appending a framework default. Cheap heuristic.
 */
function framework0HostFlags(script: string | undefined): boolean {
  if (!script) return false;
  return /(?:^|\s)(?:--host|-H|--bind|-b)(?:\s|=|$)/.test(script);
}

interface NodeFrameworkDefaults {
  /** npm argument suffix, including the leading space. */
  hostArgs: string;
  defaultPort: number;
}

function detectNodeFramework(script: string | undefined): NodeFrameworkDefaults {
  const command = script ?? "";
  // Next uses -H; Vite and the other common dev CLIs use --host. A generic
  // `node server.js`/Express script gets no invented CLI flag because Node
  // would reject it and the application owns its bind address.
  if (/\bnext(?:\.js)?\b/i.test(command)) {
    return { hostArgs: " -- -H 0.0.0.0", defaultPort: 3000 };
  }
  if (/\bastro\b/i.test(command)) {
    return { hostArgs: " -- --host 0.0.0.0", defaultPort: 4321 };
  }
  if (/\b(?:vite|svelte-kit)\b/i.test(command)) {
    return { hostArgs: " -- --host 0.0.0.0", defaultPort: 5173 };
  }
  if (/\b(?:nuxt|nuxi)\b/i.test(command)) {
    return { hostArgs: " -- --host 0.0.0.0", defaultPort: 3000 };
  }
  return { hostArgs: "", defaultPort: 3000 };
}

function guessPortFromScript(script: string | undefined): number | null {
  if (!script) return null;
  const m = script.match(/(?:--port[ =]|:|-p[ =]|PORT=)(\d{2,5})/i);
  return m ? Number(m[1]) : null;
}
