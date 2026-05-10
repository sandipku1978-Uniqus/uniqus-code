import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Slash commands (Plan §5).
 *
 * `/review`, `/deploy`, `/explain` are built-ins; `.uniqus/commands/<name>.md`
 * defines user-defined ones (mirror of Claude Code's `.claude/commands/`).
 *
 * A slash command is a prompt template the user invokes by typing
 * `/<name> [free-form args]` as the first token of a chat message. The
 * orchestrator expands it to the underlying prompt before handing it to the
 * agent loop. The agent never sees the literal `/<name>` form — it sees the
 * expanded prompt, which can include the user's free-form args via the
 * `{args}` placeholder in user-defined commands.
 *
 * Built-ins keep the user's args verbatim and append them to a fixed prompt.
 */

const COMMANDS_DIR = ".uniqus/commands";
const MAX_FILE_BYTES = 64 * 1024;

interface BuiltinCommand {
  name: string;
  summary: string;
  expand: (args: string) => string;
}

const BUILTINS: BuiltinCommand[] = [
  {
    name: "review",
    summary: "Audit recent changes for bugs, missing handling, and quick wins.",
    expand: (args) =>
      `Run a review on the project. Walk the file tree (or focus on the area I describe), then surface concrete issues — bugs, missing error handling, unsafe defaults, accessibility regressions, type problems, or quick wins. For each issue: file:line, what's wrong, the smallest fix. Don't make changes — produce a punchlist.${args ? `\n\nFocus area: ${args}` : ""}`,
  },
  {
    name: "deploy",
    summary: "Pre-deploy checklist: fail fast on the obvious blockers.",
    expand: (args) =>
      `Pre-deploy check. Read the project's package.json / requirements.txt / Dockerfile. Verify: (1) build script exists and looks correct, (2) start command exists and binds 0.0.0.0 in production, (3) no obvious env vars referenced in code that aren't documented, (4) no test fixtures or .env files committed, (5) any TODO/FIXME on critical paths. Surface issues as a checklist; don't deploy yourself — the user has a deploy button. ${args ? `Extra context: ${args}` : ""}`,
  },
  {
    name: "explain",
    summary: "Explain the requested file/path/symbol in plain language.",
    expand: (args) =>
      args
        ? `Explain ${args}: what it does, who calls it, the non-obvious parts, any rough edges. Keep it concrete — quote line numbers, name the callers. Don't change code.`
        : `Explain the project: what it does, the entry point, the major moving parts, where state lives. Keep it concrete and short — name files. Don't change code.`,
  },
  {
    name: "test",
    summary: "Run the project's test suite and surface failures.",
    expand: (args) =>
      `Run the project's tests. Detect the framework (npm test, pytest, go test, cargo test, etc.) and use run_in_background for long suites — poll with read_background_log. When done, summarize: total/passed/failed, the first 5 failures with file:line, and a one-line root cause guess for each. ${args ? `Scope: ${args}` : ""}`,
  },
];

const BUILTIN_BY_NAME: Map<string, BuiltinCommand> = new Map(
  BUILTINS.map((c) => [c.name, c]),
);

export interface SlashCommandSummary {
  name: string;
  summary: string;
  source: "builtin" | "project";
}

export async function listSlashCommands(sandboxDir: string): Promise<SlashCommandSummary[]> {
  const items: SlashCommandSummary[] = BUILTINS.map((c) => ({
    name: c.name,
    summary: c.summary,
    source: "builtin" as const,
  }));
  try {
    const dir = path.resolve(sandboxDir, COMMANDS_DIR);
    if (!dir.startsWith(path.resolve(sandboxDir) + path.sep)) return items;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile()) continue;
      if (!e.name.endsWith(".md")) continue;
      const name = e.name.slice(0, -3).toLowerCase();
      if (!/^[a-z0-9_-]+$/.test(name)) continue;
      const summary = await readFirstSummary(path.join(dir, e.name));
      const existing = items.find((i) => i.name === name);
      if (existing) {
        // Project override of a builtin name. Keep the builtin entry but
        // mark it project so the UI shows "overrides built-in".
        existing.source = "project";
        if (summary) existing.summary = summary;
      } else {
        items.push({ name, summary: summary ?? "(no description)", source: "project" });
      }
    }
  } catch {
    // .uniqus/commands/ doesn't exist — that's fine.
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

async function readFirstSummary(file: string): Promise<string | null> {
  try {
    const stat = await fs.stat(file);
    if (stat.size > MAX_FILE_BYTES) return null;
    const buf = await fs.readFile(file, "utf-8");
    // Take the first non-empty, non-heading line that's reasonably short.
    for (const line of buf.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      if (t.startsWith("#")) continue;
      return t.slice(0, 160);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * If `userMessage` starts with a `/` slash command, expand it. Returns the
 * expanded message + the matched command name (for telemetry/UI). If the
 * message doesn't begin with a `/<name>` token, returns the message as-is.
 */
export async function expandSlashCommand(
  sandboxDir: string,
  userMessage: string,
): Promise<{ expanded: string; matched: string | null }> {
  const text = userMessage.trimStart();
  if (!text.startsWith("/")) return { expanded: userMessage, matched: null };
  const m = text.match(/^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
  if (!m) return { expanded: userMessage, matched: null };
  const name = m[1].toLowerCase();
  const args = (m[2] ?? "").trim();

  // Project-defined commands take precedence (Plan §5 — same shape as Claude Code).
  const projectExpanded = await tryExpandProjectCommand(sandboxDir, name, args);
  if (projectExpanded !== null) return { expanded: projectExpanded, matched: name };

  const builtin = BUILTIN_BY_NAME.get(name);
  if (!builtin) return { expanded: userMessage, matched: null };
  return { expanded: builtin.expand(args), matched: name };
}

async function tryExpandProjectCommand(
  sandboxDir: string,
  name: string,
  args: string,
): Promise<string | null> {
  if (!/^[a-z0-9_-]+$/.test(name)) return null;
  const file = path.resolve(sandboxDir, COMMANDS_DIR, `${name}.md`);
  if (!file.startsWith(path.resolve(sandboxDir) + path.sep)) return null;
  let content: string;
  try {
    const stat = await fs.stat(file);
    if (stat.size > MAX_FILE_BYTES) return null;
    content = await fs.readFile(file, "utf-8");
  } catch {
    return null;
  }
  // Substitute {args}; if not present, append the args at the end.
  if (content.includes("{args}")) {
    return content.replaceAll("{args}", args);
  }
  return args ? `${content.trimEnd()}\n\nUser-supplied args: ${args}` : content;
}
