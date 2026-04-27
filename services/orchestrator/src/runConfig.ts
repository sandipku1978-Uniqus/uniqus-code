import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Per-project run configuration. Persisted as `.uniqus-run.json` in the
 * sandbox so it survives Railway redeploys via the same Storage sync that
 * carries the rest of the user's files.
 */
export interface RunConfig {
  command: string;
  port: number;
  /** Where the config came from. Useful for telemetry / debugging only. */
  source?: "agent" | "user" | "detected";
}

const CONFIG_FILE = ".uniqus-run.json";

export async function readRunConfig(sandboxDir: string): Promise<RunConfig | null> {
  try {
    const raw = await fs.readFile(path.join(sandboxDir, CONFIG_FILE), "utf-8");
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

export async function writeRunConfig(
  sandboxDir: string,
  config: RunConfig,
): Promise<void> {
  await fs.writeFile(
    path.join(sandboxDir, CONFIG_FILE),
    JSON.stringify(config, null, 2) + "\n",
    "utf-8",
  );
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
      const command = framework0HostFlags(scripts[scriptName])
        ? `npm run ${scriptName}`
        : // Append a sensible host flag so the proxy can reach it. Most
          // dev tools take `--` to forward extra args to the underlying CLI.
          `npm run ${scriptName} -- -H 0.0.0.0`;
      const port = guessPortFromScript(scripts[scriptName]) ?? 3000;
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
 * If a dev script already includes a host/port flag, we don't want to clobber
 * the user's intent by appending `-- -H 0.0.0.0`. Cheap heuristic.
 */
function framework0HostFlags(script: string | undefined): boolean {
  if (!script) return false;
  return /\b(--host|-H|--bind|-b)\b/.test(script);
}

function guessPortFromScript(script: string | undefined): number | null {
  if (!script) return null;
  const m = script.match(/(?:--port[ =]|:|-p[ =]|PORT=)(\d{2,5})/i);
  return m ? Number(m[1]) : null;
}
