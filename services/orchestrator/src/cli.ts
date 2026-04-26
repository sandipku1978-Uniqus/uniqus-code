import "./env.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAgentLoop } from "./agent/loop.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";

async function main(): Promise<void> {
  const userMessage = process.argv.slice(2).join(" ").trim();
  if (!userMessage) {
    console.error("Usage: npm run agent -- \"<your request>\"");
    console.error("       (or: npx tsx services/orchestrator/src/cli.ts \"<your request>\")");
    process.exit(1);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(`${RED}Error: ANTHROPIC_API_KEY environment variable is not set.${RESET}`);
    console.error(`Set it with:  set ANTHROPIC_API_KEY=sk-ant-...   (Windows cmd)`);
    console.error(`              $env:ANTHROPIC_API_KEY="sk-ant-..." (PowerShell)`);
    process.exit(1);
  }

  const sandboxDir = path.resolve(REPO_ROOT, ".sandbox");
  await fs.mkdir(sandboxDir, { recursive: true });

  console.log(`${DIM}sandbox: ${sandboxDir}${RESET}`);
  console.log(`${CYAN}user:${RESET} ${userMessage}\n`);

  const start = Date.now();
  let toolCalls = 0;

  await runAgentLoop(userMessage, {
    sandbox: { rootDir: sandboxDir },
    apiKey,
    onText: (t) => process.stdout.write(t),
    onToolCall: (_id, name, input) => {
      toolCalls++;
      const summary = summarizeInput(name, input);
      process.stdout.write(`\n\n${YELLOW}[${name}]${RESET} ${summary}\n`);
    },
    onToolResult: (_id, _name, _input, result, isError) => {
      const tag = isError ? `${RED}[error]${RESET}` : `${GREEN}[ok]${RESET}`;
      const truncated =
        result.length > 600 ? result.slice(0, 600) + ` ${DIM}... (${result.length - 600} more bytes)${RESET}` : result;
      process.stdout.write(`${tag} ${DIM}${truncated}${RESET}\n`);
    },
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n\n${DIM}── done in ${elapsed}s, ${toolCalls} tool calls${RESET}`);
}

function summarizeInput(name: string, input: unknown): string {
  const a = input as Record<string, any>;
  switch (name) {
    case "read_file":
    case "list_dir":
      return a.path ?? "";
    case "write_file":
      return `${a.path} (${(a.content?.length ?? 0)} bytes)`;
    case "edit_file":
      return a.path;
    case "run_command":
      return `\`${a.command}\``;
    case "grep":
      return `/${a.pattern}/${a.path ? ` in ${a.path}` : ""}`;
    case "wait_for_port":
      return `port ${a.port}`;
    case "screenshot_preview":
      return a.url;
    default:
      return "";
  }
}

main().catch((err) => {
  console.error(`\n${RED}fatal:${RESET} ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
