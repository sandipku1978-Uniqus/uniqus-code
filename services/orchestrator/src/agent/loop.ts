import Anthropic from "@anthropic-ai/sdk";
import { TOOLS, WEB_SEARCH_TOOL } from "./tools.js";
import * as sb from "./sandbox.js";
import type { Sandbox } from "./sandbox.js";

const MODEL = "claude-sonnet-4-6";
const MAX_ITERATIONS = 75;
const MAX_TOKENS = 16384;

function buildSystemPrompt(): string {
  const { name: shellName, isUnixLike } = sb.shellInfo();
  const platform = process.platform;

  const platformWarning = isUnixLike
    ? `Shell: ${shellName} (Unix-like — head, tail, grep, sed, awk are available).`
    : `Shell: ${shellName}. IMPORTANT: this is NOT a Unix shell. Tools like tail, head, grep, sed, awk are NOT available. Avoid pipes to those utilities. Use Node one-liners (\`node -e\`) or PowerShell when you need text processing.`;

  return `You are an AI software engineer building applications inside a sandboxed environment.

Environment:
- OS platform: ${platform}
- ${platformWarning}
- Node.js, npm, npx are available. Other languages depend on what's installed locally.
- All paths are relative to the sandbox root.
- The sandbox is shared with the user — files persist across your turns.

Tools you have:
- read_file / write_file / edit_file / list_dir / grep — file ops in the sandbox.
- run_command — short-lived shell commands (default timeout 60s; use 120000–300000 ms for installs/builds). stdin is closed.
- start_server / stop_server / list_servers / read_server_log — long-running dev servers (Next.js, Flask, Express, etc.). The user sees a live preview when you start one.
- wait_for_port — wait for a TCP port on localhost.
- web_search — search the web for current info, recent docs, library versions, error messages, or anything you don't already know. Use sparingly (each call is billed); prefer it over guessing when you need facts that may have changed since training.

Conventions:
1. Use write_file (full content) when creating new files. Use edit_file only for surgical changes to existing files; old_string must be unique.
2. Each run_command invocation is a fresh shell — cd, env vars, and background jobs do NOT persist. Chain with && in a single command, or pass absolute paths.
3. For long-running dev servers: ALWAYS use start_server, never run_command. start_server backgrounds the process, waits for the port, and surfaces the preview to the user. Bind dev servers to 0.0.0.0 (not the default 127.0.0.1) so previews work from any device on the LAN — e.g. \`next dev -H 0.0.0.0\`, \`flask run --host=0.0.0.0\`, \`uvicorn main:app --host 0.0.0.0\`, \`app.listen(port, '0.0.0.0')\` for express.
4. For interactive scaffolders (create-next-app, create-vite, etc.): always pass non-interactive flags (--yes, -y, --typescript, --tailwind, --no-git, --use-npm). stdin is closed in the sandbox — any prompt will block until timeout. If a scaffolder is too prompt-heavy, write the project files yourself with write_file.
5. Use longer timeout_ms (120000–300000) for npm/yarn/pnpm install, builds, and Docker pulls.
6. After a non-zero exit, read the error and fix the root cause before retrying. Do not retry blindly — if the same command fails twice, change your approach.
7. Use list_dir or grep to verify state when you're unsure (e.g., after a scaffold) instead of guessing paths.
8. When the task is complete, briefly summarize what you built, the URL/port to access it, and how to use it. If you started a server, mention its port so the user knows where to look.
9. File size: write_file content is part of your output token budget (~16k tokens). For files larger than ~500 lines, write a smaller version first then grow it with edit_file or additional write_file calls — do NOT try to dump 1000+ lines in a single tool call, the response will be truncated and the tool input will arrive without the content field. If that happens you'll see "write_file requires 'content' as a string" — split the work and retry.`;
}

export interface LoopHooks {
  onText?: (text: string) => void;
  onToolCall?: (callId: string, name: string, input: unknown) => void;
  onToolResult?: (
    callId: string,
    name: string,
    input: unknown,
    result: string,
    isError: boolean,
  ) => void;
  onIteration?: (iter: number) => void;
}

export interface LoopOptions extends LoopHooks {
  sandbox: Sandbox;
  apiKey: string;
  projectId?: string | null;
  /**
   * Conversation history. The loop appends to this array (mutates in place).
   * Caller retains the reference to use across multiple turns.
   */
  messages?: Anthropic.MessageParam[];
}

export async function runAgentLoop(userMessage: string, opts: LoopOptions): Promise<void> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const systemPrompt = buildSystemPrompt();
  const messages = opts.messages ?? [];
  messages.push({ role: "user", content: userMessage });

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    opts.onIteration?.(iter);

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      tools: [...TOOLS, WEB_SEARCH_TOOL] as Anthropic.MessageCreateParams["tools"],
      messages,
    });

    const toolCalls: Array<{ id: string; name: string; input: unknown }> = [];
    for (const block of response.content) {
      if (block.type === "text") {
        opts.onText?.(block.text);
      } else if (block.type === "tool_use") {
        toolCalls.push({ id: block.id, name: block.name, input: block.input });
        opts.onToolCall?.(block.id, block.name, block.input);
      } else {
        // Server-side tool blocks (web_search). Anthropic ran the search;
        // we just surface the activity in the UI — no execution needed.
        const b = block as unknown as {
          type: string;
          id?: string;
          name?: string;
          input?: unknown;
          tool_use_id?: string;
          content?: unknown;
        };
        if (b.type === "server_tool_use") {
          opts.onToolCall?.(b.id ?? "", b.name ?? "web_search", b.input);
        } else if (b.type === "web_search_tool_result") {
          opts.onToolResult?.(
            b.tool_use_id ?? "",
            "web_search",
            undefined,
            formatWebSearchResults(b.content),
            false,
          );
        }
      }
    }

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn" || toolCalls.length === 0) {
      return;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const call of toolCalls) {
      try {
        const result = await executeTool(
          opts.sandbox,
          call.name,
          call.input,
          opts.projectId ?? null,
        );
        opts.onToolResult?.(call.id, call.name, call.input, result, false);
        toolResults.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: result || "(no output)",
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        opts.onToolResult?.(call.id, call.name, call.input, msg, true);
        toolResults.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: `Error: ${msg}`,
          is_error: true,
        });
      }
    }

    messages.push({ role: "user", content: toolResults });
  }

  throw new Error(
    `Loop exceeded max iterations (${MAX_ITERATIONS}). Send a follow-up message to continue — the sandbox state is preserved.`,
  );
}

async function executeTool(
  sandbox: Sandbox,
  name: string,
  input: unknown,
  projectId: string | null,
): Promise<string> {
  const args = input as Record<string, any>;
  switch (name) {
    case "read_file":
      if (typeof args.path !== "string") {
        throw new Error("read_file requires 'path' as a string");
      }
      return await sb.readFile(sandbox, args.path);
    case "write_file":
      if (typeof args.path !== "string") {
        throw new Error("write_file requires 'path' as a string");
      }
      if (typeof args.content !== "string") {
        throw new Error(
          "write_file requires 'content' as a string. This usually means your previous response hit the max output tokens (~16k) — the file you tried to write was too large for one tool call. Split it: write a smaller initial version, then grow it with edit_file or additional write_file calls.",
        );
      }
      await sb.writeFile(sandbox, args.path, args.content);
      return `Wrote ${args.content.length} bytes to ${args.path}`;
    case "edit_file":
      if (
        typeof args.path !== "string" ||
        typeof args.old_string !== "string" ||
        typeof args.new_string !== "string"
      ) {
        throw new Error(
          "edit_file requires 'path', 'old_string', and 'new_string' as strings (any may have been truncated by max_tokens)",
        );
      }
      await sb.editFile(sandbox, args.path, args.old_string, args.new_string);
      return `Edited ${args.path}`;
    case "run_command": {
      const r = await sb.runCommand(sandbox, args.command, args.timeout_ms);
      return `exit_code: ${r.exitCode}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`;
    }
    case "list_dir": {
      const entries = await sb.listDir(sandbox, args.path);
      return entries.length > 0 ? entries.join("\n") : "(empty)";
    }
    case "grep":
      return await sb.grep(sandbox, args.pattern, args.path);
    case "wait_for_port": {
      const ok = await sb.waitForPort(args.port, args.timeout_ms);
      return ok ? `port ${args.port} is open` : `timeout waiting for port ${args.port}`;
    }
    case "start_server": {
      const info = await sb.startServer(
        sandbox,
        args.command,
        args.port,
        args.ready_timeout_ms,
        projectId,
      );
      return JSON.stringify({
        server_id: info.id,
        port: info.port,
        pid: info.pid,
        url: `http://localhost:${info.port}`,
      });
    }
    case "stop_server":
      sb.stopServer(args.server_id);
      return `stopped ${args.server_id}`;
    case "list_servers": {
      const list = sb.listServers(projectId);
      return list.length === 0 ? "(no servers running)" : JSON.stringify(list, null, 2);
    }
    case "read_server_log":
      return sb.readServerLog(args.server_id, args.max_bytes);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function formatWebSearchResults(content: unknown): string {
  if (!Array.isArray(content)) return JSON.stringify(content ?? null);
  const lines: string[] = [];
  content.forEach((r, i) => {
    const item = r as { type?: string; title?: string; url?: string; error_code?: string };
    if (item.type === "web_search_result") {
      lines.push(`${i + 1}. ${item.title ?? "(no title)"}\n   ${item.url ?? ""}`);
    } else if (item.error_code) {
      lines.push(`${i + 1}. [error] ${item.error_code}`);
    }
  });
  return lines.length > 0 ? lines.join("\n") : "(no results)";
}
