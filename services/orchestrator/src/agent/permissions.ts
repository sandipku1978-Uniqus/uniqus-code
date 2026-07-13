import type { PermissionMode, ToolRiskCategory } from "@uniqus/api-types";
import { connectorMethodRisk } from "../connectors/index.js";

/**
 * Permission gating for the agent loop. Given a tool call and the user's
 * current permission mode, decide whether to run it or pause for approval.
 *
 * The mode meanings (see PermissionMode in api-types):
 *  - bypass      → run everything, never pause.
 *  - acceptEdits → edits + routine commands run; pause only for dangerous ops.
 *  - default     → pause for any edit, command, or dangerous op ("ask before edits").
 *  - plan        → handled by the pre-loop planner; if a user switches INTO plan
 *                  mid-turn it behaves like `default` for the rest of the loop.
 *
 * Read-only tools never pause in any mode — they're the agent's senses, and
 * gating them would make every mode unusable.
 */

/** Like the public ToolRiskCategory, plus `read` (never surfaces to the client). */
export type RiskCategory = "read" | ToolRiskCategory;

export interface ToolRisk {
  category: RiskCategory;
  /** One-line human description of the action, for the approval card. */
  summary: string;
  /** Why this is being gated, shown under the summary. */
  reason: string;
}

/** Tools that only observe — files, listings, screenshots, the vision bridge,
 *  and the meta/interactive tools that are themselves user-facing pauses. They
 *  never trigger an approval prompt regardless of mode. */
const READ_ONLY_TOOLS = new Set<string>([
  "read_file",
  "list_dir",
  "grep",
  "wait_for_port",
  "list_servers",
  "read_server_log",
  "list_flows",
  "list_connectors",
  "list_secrets",
  "knowledge_search",
  "load_skill",
  "list_assets",
  "read_asset",
  "list_background",
  "read_background_log",
  "todo_write",
  "load_capabilities",
  "screenshot_preview",
  // Vision bridge (reads an image, asks a vision model) — part of the verify
  // loop; low cost and would be maddening to gate per screenshot.
  "analyze_image",
  "extract_text_from_image",
  "ui_screenshot_to_code",
  "diagnose_screenshot",
  "understand_diagram",
  "analyze_chart",
  "compare_ui",
  // Meta/interactive: these ARE the pause; never double-gate them.
  "enter_plan_mode",
  "ask_user",
]);

/** File-mutating tools. */
const EDIT_TOOLS = new Set<string>(["write_file", "edit_file"]);

/** Routine, reversible execution — shell commands, dev servers, flow replays. */
const EXECUTE_TOOLS = new Set<string>([
  "start_server",
  "stop_server",
  "kill_background",
  "save_flow",
  "run_flow",
  "predeploy_check",
]);

/** Tools that are always money/data-spending or irreversible, regardless of args. */
const ALWAYS_DANGEROUS_TOOLS = new Set<string>([
  "generate_image", // paid image generation
  "spawn_agents", // spins up sub-agent loops — expensive
  "interact_preview", // can submit forms, click destructive actions, and navigate
  "run_flow", // replays stored browser mutations
]);

/**
 * Shell snippets that are irreversible or system-level. Matched against
 * run_command / run_in_background. Deliberately conservative: a false "ask" is
 * a cheap extra click; a false "allow" runs `rm -rf` unprompted. The patterns
 * cover destructive filesystem ops, history-rewriting / publishing git, privilege
 * escalation, piping the internet into a shell, deploys, and DB drops.
 */
const DESTRUCTIVE_COMMAND_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-z]*\s+)*-[a-z]*[rf]/i, // rm -rf / rm -r / rm -f (any flag order)
  /\brmdir\s+\/s/i,
  /\bgit\s+push\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-z]*f/i,
  /\bgit\s+checkout\s+--\s/i, // discards working-tree changes
  /\bgit\s+branch\s+-D\b/i,
  /\b(sudo|doas)\b/i,
  /\bchown\s+-R\b/i,
  /\bchmod\s+-R\b/i,
  /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(sh|bash|zsh|python\d?)\b/i, // curl … | sh
  /\bdd\s+if=/i,
  /\bmkfs\b/i,
  />\s*\/dev\/(sd|nvme|disk)/i,
  /\b(shutdown|reboot|halt|poweroff)\b/i,
  /\b(pkill|killall)\b/i,
  /\bkill\s+-9\b/i,
  /\bnpm\s+publish\b/i,
  /\b(yarn|pnpm)\s+publish\b/i,
  /\bnpx?\s+vercel\b/i,
  /\bvercel\s+(deploy|--prod)/i,
  /\bnetlify\s+deploy\b/i,
  /\bgh\s+release\s+create\b/i,
  /\bnpm\s+run\s+deploy\b/i,
  /\bdocker\s+system\s+prune\b/i,
  /\bdrop\s+(table|database|schema)\b/i, // psql/mysql -c "DROP …"
  /\btruncate\s+table\b/i,
  /:\(\)\s*\{\s*:\s*\|\s*:/, // fork bomb
];

export function isDestructiveCommand(command: string): boolean {
  return DESTRUCTIVE_COMMAND_PATTERNS.some((re) => re.test(command));
}

function truncate(s: string, n = 100): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > n ? `${oneLine.slice(0, n - 1)}…` : oneLine;
}

/**
 * Classify a tool call into a risk category plus human-readable summary/reason.
 * Pure — no I/O — so the loop can call it cheaply on every tool call.
 */
export function classifyToolRisk(name: string, input: unknown): ToolRisk {
  const args = (input ?? {}) as Record<string, unknown>;

  if (READ_ONLY_TOOLS.has(name)) {
    return { category: "read", summary: name, reason: "read-only" };
  }

  if (EDIT_TOOLS.has(name)) {
    const path = typeof args.path === "string" ? args.path : "a file";
    return {
      category: "edit",
      summary: name === "write_file" ? `Write ${path}` : `Edit ${path}`,
      reason: "File change — paused because the current mode asks before edits.",
    };
  }

  if (ALWAYS_DANGEROUS_TOOLS.has(name)) {
    return {
      category: "dangerous",
      summary: name === "generate_image"
        ? "Generate an image (paid)"
        : name === "spawn_agents"
          ? "Spawn sub-agents (extra model usage)"
          : name === "run_flow"
            ? "Replay an interactive browser flow"
            : "Interact with the live preview",
      reason: name === "interact_preview" || name === "run_flow"
        ? "This browser action can submit forms or mutate external state — paused for confirmation."
        : "This spends additional model/credits — paused for confirmation.",
    };
  }

  if (name === "run_command" || name === "run_in_background") {
    const command = typeof args.command === "string" ? args.command : "";
    if (isDestructiveCommand(command)) {
      return {
        category: "dangerous",
        summary: `Run: ${truncate(command)}`,
        reason:
          "This command looks destructive or irreversible (file deletion, push/reset, deploy, privilege escalation, or DB drop).",
      };
    }
    return {
      category: "execute",
      summary: `Run: ${truncate(command)}`,
      reason: "Shell command — paused because the current mode asks before running commands.",
    };
  }

  if (name === "call_connector") {
    const connector = typeof args.connector === "string" ? args.connector : "connector";
    const method = typeof args.method === "string" ? args.method : "";
    if (method && connectorMethodRisk(connector, method) === "read") {
      return { category: "read", summary: `${connector}.${method}`, reason: "read-only" };
    }
    return {
      category: "dangerous",
      summary: `${connector}.${method || "call"}`,
      reason:
        "Backend integration call (database write, payment, or provisioning) — paused for confirmation.",
    };
  }

  if (EXECUTE_TOOLS.has(name)) {
    return {
      category: "execute",
      summary: name.replace(/_/g, " "),
      reason: "Paused because the current mode asks before running commands.",
    };
  }

  // Unknown / future tool: gate it as a command so a new capability can't slip
  // past the permission system silently. (Better an extra click than a hole.)
  return {
    category: "execute",
    summary: name.replace(/_/g, " "),
    reason: "Paused for confirmation.",
  };
}

/**
 * "Approve for this run" is intentionally scoped to the exact normalized
 * action. A changed path, command, connector destination, method, or argument
 * produces a different key and therefore another approval prompt.
 */
export function approvalScopeKey(tool: string, input: unknown): string {
  return `${tool}:${stableJson(input)}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

/**
 * Decide whether a tool of the given risk category may run under `mode`, or must
 * pause for approval. Read-only always runs. See the module header for the policy.
 */
export function decidePermission(
  mode: PermissionMode,
  category: RiskCategory,
): "allow" | "ask" {
  if (category === "read") return "allow";
  if (mode === "bypass") return "allow";
  if (mode === "acceptEdits") return category === "dangerous" ? "ask" : "allow";
  // "default" and a mid-turn switch to "plan" both ask on everything non-read.
  return "ask";
}
