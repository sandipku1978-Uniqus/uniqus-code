import type Anthropic from "@anthropic-ai/sdk";

/**
 * Anthropic's server-side web search tool. The model calls it; Anthropic
 * runs the search and injects results into the response — we don't execute
 * anything on our side. Billed per search by Anthropic.
 */
export const WEB_SEARCH_TOOL = {
  type: "web_search_20250305",
  name: "web_search",
  max_uses: 10,
} as const;

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "read_file",
    description: "Read the contents of a file in the sandbox.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to sandbox root." },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description:
      "Write full content to a file in the sandbox. Creates parent directories. Overwrites existing files. Prefer this over edit_file when creating or fully rewriting a file.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description:
      "Replace an exact string in an existing file. old_string must appear exactly once in the file. Use for surgical edits only.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_string: { type: "string" },
        new_string: { type: "string" },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  {
    name: "run_command",
    description:
      "Execute a shell command in the sandbox (cwd is sandbox root). Returns exit code, stdout, and stderr (each truncated to 8KB head + 8KB tail). Default timeout 60s. stdin is closed — use --yes/-y/--no-interactive flags for any CLI that prompts. Each invocation is a fresh shell — chain with && or use absolute paths; cd does not persist between calls. For long-running dev servers use start_server, NOT run_command.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeout_ms: {
          type: "number",
          description: "Optional, default 60000. Use 120000–300000 for installs/builds.",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "list_dir",
    description:
      "List contents of a directory in the sandbox. Directories are suffixed with /.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Optional. Defaults to sandbox root." },
      },
    },
  },
  {
    name: "grep",
    description:
      "Search for a regex pattern in files (skips node_modules and dot-dirs). Returns matching path:line: text triples.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string", description: "Optional sub-path to scope search." },
      },
      required: ["pattern"],
    },
  },
  {
    name: "wait_for_port",
    description:
      "Wait for a TCP port on localhost (127.0.0.1) to start accepting connections. Default timeout 30s.",
    input_schema: {
      type: "object",
      properties: {
        port: { type: "number" },
        timeout_ms: { type: "number", description: "Optional, default 30000." },
      },
      required: ["port"],
    },
  },
  {
    name: "start_server",
    description:
      "Start a long-running dev server (e.g. `npm run dev`, `python app.py`, `node server.js`) in the background. Returns when the server has opened the given port, or errors with the recent log if it never opens. The user gets a live preview of the running server. Use this instead of run_command for anything that doesn't terminate on its own.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The command to run, e.g. `npm run dev`." },
        port: {
          type: "number",
          description: "The TCP port the server should listen on. The tool waits for this port to open.",
        },
        ready_timeout_ms: {
          type: "number",
          description: "Optional, default 60000. How long to wait for the port before giving up.",
        },
      },
      required: ["command", "port"],
    },
  },
  {
    name: "stop_server",
    description: "Stop a previously started server by id (kills the entire process tree).",
    input_schema: {
      type: "object",
      properties: {
        server_id: { type: "string" },
      },
      required: ["server_id"],
    },
  },
  {
    name: "list_servers",
    description: "List currently running servers (id, command, port, pid).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "read_server_log",
    description:
      "Read recent stdout/stderr from a running server (last 8KB by default). Useful for debugging when a request fails or behavior is unexpected.",
    input_schema: {
      type: "object",
      properties: {
        server_id: { type: "string" },
        max_bytes: { type: "number", description: "Optional, default 8000." },
      },
      required: ["server_id"],
    },
  },
  {
    name: "ask_user",
    description:
      "Pause execution and ask the user a clarifying question. Use ONLY when intent is genuinely ambiguous and the answer materially changes what you'll build (e.g. \"Should this run on a schedule, on demand, or both?\", \"Postgres or SQLite?\"). Do NOT use for trivial confirmations, status updates, or anything you can decide yourself by reading the code or running a command. Provide structured options when the answer is one of a small set; allow_free_text=true (the default) lets the user type something else if their answer doesn't fit. Returns the user's answer as a string. The loop blocks until they respond; do not call this tool more than once per turn.",
    input_schema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The question to ask. One sentence. Plain text — no markdown.",
        },
        options: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional. Up to ~5 short option labels rendered as buttons. Omit when the answer is open-ended.",
        },
        allow_free_text: {
          type: "boolean",
          description:
            "Optional, default true. When false, the user can ONLY pick one of the options. Do not set false unless the options truly cover the answer space.",
        },
      },
      required: ["question"],
    },
  },
];
