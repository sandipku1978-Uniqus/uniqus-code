/**
 * Sub-agents (the lead agent's `spawn_agents` tool).
 *
 * The main coding agent can delegate focused work to one or more *specialized*
 * sub-agents that run autonomously in the SAME project sandbox and report back.
 * Each sub-agent is a fresh `runAgentLoop` (loop.ts) with:
 *   - a specialization PERSONA prepended to the normal engineering system prompt
 *     (audit / design / frontend / backend / database / research / general),
 *   - an optional per-spawn MODEL override (any MODEL_CATALOG id or "auto") so
 *     the lead agent picks the right model for the job,
 *   - optional extra INSTRUCTIONS the lead agent writes to customize that
 *     sub-agent's prompt for the task at hand,
 *   - the full tool set EXCEPT spawning further sub-agents (depth is capped at 1
 *     so a sub-agent can never fork-bomb the orchestrator).
 *
 * Passing MULTIPLE entries runs them IN PARALLEL — that's how the lead agent
 * parallelizes independent work (e.g. audit the API while the design agent
 * restyles the landing page).
 *
 * This module is intentionally pure (no I/O): the registry, the persona builder,
 * the tool schema, and the spec/report (de)serialization. The actual nested-loop
 * execution + usage metering + file-change merging lives in loop.ts, where the
 * per-turn context (provider keys, sandbox, hooks) is in scope.
 */

import type Anthropic from "@anthropic-ai/sdk";

/** A specialized sub-agent role. `general` is the blank-slate catch-all. */
export interface SubAgentDef {
  /** Stable key used as the `type` enum value. */
  key: string;
  /** Human label shown in the persona ("… design sub-agent"). */
  label: string;
  /** One-line "what it's for", shown in the tool schema + system prompt. */
  blurb: string;
  /** The role-specific preamble injected into the sub-agent's system prompt. */
  persona: string;
}

/**
 * The built-in specializations. `general` MUST stay last so the catch-all
 * reads naturally in the schema. Add a new specialization by adding an entry
 * here — the tool enum, the system-prompt advert, and validation all derive
 * from this map, so nothing else needs editing.
 */
export const AGENT_TYPES: Record<string, SubAgentDef> = {
  audit: {
    key: "audit",
    label: "code audit",
    blurb: "review code/config for correctness bugs, security issues, and risky patterns",
    persona:
      "Your role is to REVIEW and AUDIT, not to build. Read the relevant code, config, and dependencies and report correctness bugs, security vulnerabilities, race conditions, missing error handling, and risky or non-idiomatic patterns — each with the file:line, why it's a problem, and a concrete fix. Be precise and skeptical; prefer reading and analysis over editing, and change files only if the task explicitly asks you to apply fixes.",
  },
  design: {
    key: "design",
    label: "visual/UX design",
    blurb: "craft polished UI — layout, design tokens, component styling, accessibility",
    persona:
      "Your role is VISUAL and UX DESIGN. Produce polished, on-brand UI: deliberate layout and visual hierarchy, a coherent type scale, spacing, radii and color usage, and accessible semantics (labels, focus states, contrast, reduced-motion). Reuse the project's existing design tokens and components before inventing new ones. You cannot run the preview yourself — report exactly what you changed and what to look at so the lead agent can verify it visually.",
  },
  frontend: {
    key: "frontend",
    label: "frontend",
    blurb: "implement client UI — components, state, routing, client behavior",
    persona:
      "Your role is FRONTEND implementation: components, state management, routing, forms, and client-side behavior. Wire real loading/empty/error states. You cannot run the preview or drive the browser yourself — instead describe the exact flow to exercise (routes, inputs, expected outcomes) so the lead agent can verify it in the preview. Keep changes consistent with the project's existing framework and patterns.",
  },
  backend: {
    key: "backend",
    label: "backend",
    blurb: "implement server logic — APIs, route handlers, integrations, persistence",
    persona:
      "Your role is BACKEND implementation: API routes/handlers, server logic, integrations, and serverless-safe persistence. NEVER fake persistence with the filesystem or module-level in-memory state (it breaks on Vercel) — use the project's connected database. Validate inputs, handle errors, and keep secrets server-side. Verify with predeploy_check where relevant.",
  },
  database: {
    key: "database",
    label: "database",
    blurb: "schema design, migrations, queries, and data integrity",
    persona:
      "Your role is DATA: schema design, migrations, queries, indexes, and data integrity. Use the project's connected database (inspect the existing schema before changing it); never invent a file/in-memory store. Prefer reversible, additive migrations, scope every DELETE/UPDATE with a WHERE clause, and call out any destructive change before making it.",
  },
  research: {
    key: "research",
    label: "research",
    blurb: "investigate the codebase (and web, if available) and report findings",
    persona:
      "Your role is INVESTIGATION. Explore the codebase — and the web if you have a search tool — to answer the question you were given, then report findings precisely with file:line references and citations. You are READ-ONLY by default: do not modify files unless the task explicitly asks you to.",
  },
  general: {
    key: "general",
    label: "general-purpose",
    blurb: "blank-slate agent for any task that doesn't fit a specialization",
    persona:
      "You are a general-purpose, blank-slate sub-agent. Do exactly the task you were given, using sound engineering judgment and the project's existing conventions.",
  },
};

export type AgentTypeKey = keyof typeof AGENT_TYPES;

/** The valid `type` values, in declaration order. */
export const AGENT_TYPE_KEYS: string[] = Object.keys(AGENT_TYPES);

/** One sub-agent to spawn, after parsing/validation. */
export interface SubAgentSpec {
  type: string;
  /** The work for the sub-agent (its initial user message). */
  task: string;
  /** Per-spawn model override (a MODEL_CATALOG id or "auto"); undefined ⇒ auto. */
  model?: string;
  /** Extra system-prompt customization the lead agent wrote for this sub-agent. */
  instructions?: string;
}

/**
 * Build the system-prompt PREAMBLE for a sub-agent. Prepended (in loop.ts) to
 * the normal engineering prompt so the sub-agent keeps all the sandbox / tool /
 * serverless rules but adopts the specialization's mindset and the lead agent's
 * extra instructions.
 */
export function buildSubAgentPreamble(def: SubAgentDef, instructions?: string): string {
  const extra =
    instructions && instructions.trim()
      ? `\n\nAdditional instructions from the lead agent (follow these for this task):\n${instructions.trim()}`
      : "";
  return (
    `You are a specialized "${def.label}" sub-agent, spawned by the lead engineer to handle one focused task autonomously and then report back. ${def.persona}\n\n` +
    `You operate in the SAME project sandbox as the lead agent and share its files and connectors. Two hard limits apply to you: (1) you CANNOT spawn further sub-agents; (2) you do NOT own the preview — the dev-server and browser tools (start_server, stop_server, screenshot_preview, interact_preview, run_flow, save_flow) are DISABLED for you. NEVER try to start a dev server or drive the browser; the lead agent owns the single preview and runs + visually verifies the app after you report back. Concentrate on reading and editing files; verify your changes by re-reading the code you wrote, not by previewing. You may be running CONCURRENTLY with the lead agent and other sub-agents in this same sandbox, so stay strictly within the files your task names and do not touch unrelated files. Work the task end-to-end and finish with a CONCISE report: what you did, what you found, every file you changed, and anything the lead agent must know (follow-ups, blockers, decisions you made). You report to the lead agent, NOT to the end user — do not address the user or ask them questions; make a reasonable decision and note it instead.${extra}`
  );
}

/**
 * The `spawn_agents` tool. One entry ⇒ a single sub-agent; multiple entries ⇒
 * they run in PARALLEL. The schema's `type` enum and description are derived
 * from {@link AGENT_TYPES} so they never drift from the registry.
 */
export const SPAWN_AGENTS_TOOL: Anthropic.Tool = {
  name: "spawn_agents",
  description:
    "Delegate focused work to one or more specialized sub-agents that run autonomously in THIS sandbox and report back. Pass MULTIPLE entries to run them IN PARALLEL — use this to parallelize INDEPENDENT work (e.g. audit the API while a design agent restyles the landing page). FAN OUT by default for any multi-part build: when the user asks for several new pages, a batch of components, or independent sections, scaffold the shared parts FIRST (routing, nav, layout, design tokens) then spawn one sub-agent per page/section in parallel instead of building them all yourself serially — under-using this for big independent builds is the most common mistake. " +
    "ASYNCHRONOUS: this call returns IMMEDIATELY (it does NOT wait for the sub-agents) — they run in the background while you keep working. After spawning you can: (a) do other INDEPENDENT work yourself (but do NOT edit files a sub-agent is touching — you'd clobber each other), then call await_subagents to collect their reports before you integrate/verify; or (b) just end your turn — you'll be automatically resumed with each sub-agent's report as it finishes. " +
    "Each sub-agent has the same tools you do (read/write files, run commands, connectors) EXCEPT it cannot spawn further sub-agents AND it cannot start dev servers or drive the browser (you, the lead, own the single preview). So once your sub-agents finish, it's YOUR job to run the app and visually verify the combined result. Do NOT use sub-agents for trivial steps you can just do yourself, and do NOT spawn agents whose tasks edit the SAME files at the same time. Types: " +
    AGENT_TYPE_KEYS.map((k) => `${k} (${AGENT_TYPES[k].blurb})`).join("; ") +
    ".",
  input_schema: {
    type: "object",
    properties: {
      agents: {
        type: "array",
        description:
          "The sub-agents to run. One entry = one sub-agent; multiple entries run concurrently (independent tasks only).",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: AGENT_TYPE_KEYS,
              description:
                "The specialization. Use 'general' (blank slate) for anything that doesn't fit one of the others.",
            },
            task: {
              type: "string",
              description:
                "A complete, self-contained description of the work for this sub-agent — it does NOT see your conversation, so include all the context, files, and acceptance criteria it needs.",
            },
            model: {
              type: "string",
              description:
                "Optional. Which model this sub-agent runs on — a MODEL_CATALOG id (e.g. 'anthropic:claude-opus-4-8', 'zai:glm-5.2') or 'auto'. Omit for 'auto'.",
            },
            instructions: {
              type: "string",
              description:
                "Optional. Extra system-prompt guidance you want this sub-agent to follow for this task (tone, constraints, what to avoid). Appended to its specialization prompt.",
            },
          },
          required: ["type", "task"],
        },
      },
    },
    required: ["agents"],
  },
};

/**
 * Block until previously-spawned background sub-agents finish, then return their
 * reports. The lead agent calls this when it needs the delegated results before
 * continuing (e.g. it scaffolded the shared parts, fanned out one sub-agent per
 * page, and now wants to wire them together + verify). With no `ids` it waits
 * for ALL still-running sub-agents from this turn.
 */
export const AWAIT_SUBAGENTS_TOOL: Anthropic.Tool = {
  name: "await_subagents",
  description:
    "Wait for sub-agents you started with spawn_agents to finish, then get their reports. spawn_agents returns immediately and the sub-agents run in the background; call this when you need their results before you continue (e.g. to integrate their work and verify the whole app). Returns each finished sub-agent's report. With no arguments it waits for ALL of this turn's still-running sub-agents. (You can instead just end your turn — you'll be resumed automatically as each finishes — but await_subagents is the way to BLOCK here and collect them mid-turn.)",
  input_schema: {
    type: "object",
    properties: {
      ids: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional. The specific sub-agent ids to wait for (as returned by spawn_agents). Omit to wait for all still-running sub-agents from this turn.",
      },
    },
    required: [],
  },
};

/** Max sub-agents per spawn_agents call — bounds parallel fan-out + cost. */
export const MAX_SUB_AGENTS_PER_CALL = 6;

/**
 * Tools a SUB-AGENT may not use. The lead agent owns the single preview, so a
 * sub-agent never starts/stops a dev server or drives the browser — otherwise N
 * concurrent sub-agents would each spin up a dev server and saturate the
 * sandbox/host (the exact failure this guards against). Read-only inspection
 * tools (list_servers, read_server_log, list_flows) stay available. The loop
 * filters these out of a sub-agent's tool list (allowSubAgents === false).
 */
export const SUBAGENT_BLOCKED_TOOLS: ReadonlySet<string> = new Set([
  "start_server",
  "stop_server",
  "screenshot_preview",
  "interact_preview",
  "run_flow",
  "save_flow",
]);

/**
 * A one-line, human summary of a sub-agent's current tool call, for the live
 * "subagent #n — <action>" widget. Mirrors the web's describeTool for the common
 * tools; unknown tools fall back to the bare name. Pure (no I/O).
 */
export function summarizeToolCall(name: string, input: unknown): string {
  const a = (input ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const path = str(a.path) || str(a.file) || str(a.file_path);
  switch (name) {
    case "write_file":
      return path ? `Writing ${path}` : "Writing a file";
    case "edit_file":
      return path ? `Editing ${path}` : "Editing a file";
    case "read_file":
      return path ? `Reading ${path}` : "Reading a file";
    case "list_dir":
      return path ? `Listing ${path}` : "Listing files";
    case "grep":
      return a.pattern ? `Searching for "${str(a.pattern)}"` : "Searching files";
    case "run_command": {
      const cmd = str(a.command);
      return cmd ? `Running \`${cmd.slice(0, 60)}\`` : "Running a command";
    }
    case "analyze_image":
    case "ui_screenshot_to_code":
    case "extract_text_from_image":
    case "diagnose_screenshot":
      return "Analyzing an image";
    case "call_connector":
      return a.connector ? `Using the ${str(a.connector)} connector` : "Using a connector";
    case "web_search":
      return "Searching the web";
    case "knowledge_search":
      return "Searching the knowledge library";
    case "todo_write":
      return "Updating its task list";
    default:
      return name.replace(/_/g, " ");
  }
}

/**
 * The tool-result string for a non-blocking spawn_agents call — confirms the
 * sub-agents started in the background and tells the lead how to collect them.
 */
export function formatSpawnAck(
  started: { id: string; index: number; type: string; task: string; model: string }[],
  requested: number,
): string {
  const cappedNote =
    requested > started.length
      ? ` (you requested ${requested}; the cap is ${MAX_SUB_AGENTS_PER_CALL} per call, so only ${started.length} started)`
      : "";
  const lines = started.map(
    (s) => `  • ${s.id} — [${s.index}] ${s.type} · model ${s.model}: ${s.task.slice(0, 100)}`,
  );
  return (
    `Started ${started.length} sub-agent${started.length === 1 ? "" : "s"} in the background${cappedNote}. They are running now:\n` +
    `${lines.join("\n")}\n\n` +
    `You can keep working on INDEPENDENT parts (don't edit files they're touching), then call await_subagents to collect their reports before integrating — or just end your turn and you'll be resumed as each one finishes.`
  );
}

/**
 * The message injected when the lead agent ended its turn while sub-agents were
 * still running and one or more have now finished (the "resumed via
 * notification" path). Surfaces the freshly-finished reports and notes any still
 * pending, so the lead can react.
 */
export function formatSubAgentCompletionNotice(
  ready: SubAgentRunReport[],
  stillPending: { id: string; index: number; type: string }[],
): string {
  const header =
    ready.length === 1
      ? "A sub-agent you spawned just finished."
      : `${ready.length} sub-agents you spawned just finished.`;
  const sections = ready.map((r) => {
    const label = AGENT_TYPES[r.type]?.label ?? r.type;
    const status = r.error ? " — FAILED" : r.aborted ? " — ABORTED" : "";
    const body = r.error ? `ERROR: ${r.error}` : r.report || "(the sub-agent produced no textual report)";
    return `── [${r.index}] ${r.type} (${label}) · model ${r.model}${status} ──\nTask: ${r.task}\n\n${body}`;
  });
  const pendingNote =
    stillPending.length > 0
      ? `\n\n${stillPending.length} sub-agent${stillPending.length === 1 ? " is" : "s are"} still running (${stillPending
          .map((s) => s.id)
          .join(", ")}). Integrate what just finished if you can, then end your turn again (or call await_subagents) to wait for the rest.`
      : `\n\nAll sub-agents are now done. Integrate their work, then run + verify the app before reporting back to the user.`;
  return `${header} Their report${ready.length === 1 ? "" : "s"}:\n\n${sections.join("\n\n")}${pendingNote}`;
}

/**
 * Parse + validate the raw `agents` tool input into concrete specs. Coerces an
 * unknown/missing `type` to "general" (the blank slate) rather than failing the
 * whole call, drops a `model` that isn't resolvable, and requires a non-empty
 * `task`. Throws (a clear tool error) only when nothing usable remains.
 * `isValidModel` is injected so this stays free of the router import.
 */
export function parseAgentSpecs(
  raw: unknown,
  isValidModel: (m: string) => boolean,
): SubAgentSpec[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(
      "spawn_agents requires 'agents' as a non-empty array of { type, task, model?, instructions? }.",
    );
  }
  const specs: SubAgentSpec[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const task = typeof e.task === "string" ? e.task.trim() : "";
    if (!task) continue; // a sub-agent with no task is meaningless — skip it
    const typeRaw = typeof e.type === "string" ? e.type.trim() : "";
    const type = typeRaw && AGENT_TYPES[typeRaw] ? typeRaw : "general";
    const modelRaw = typeof e.model === "string" ? e.model.trim() : "";
    const model = modelRaw && modelRaw !== "auto" && isValidModel(modelRaw) ? modelRaw : undefined;
    const instructions =
      typeof e.instructions === "string" && e.instructions.trim()
        ? e.instructions.trim()
        : undefined;
    specs.push({ type, task, model, instructions });
  }
  if (specs.length === 0) {
    throw new Error(
      "spawn_agents: every entry needs a non-empty 'task'. Provide at least one { type, task }.",
    );
  }
  return specs.slice(0, MAX_SUB_AGENTS_PER_CALL);
}

/** The outcome of one sub-agent run, for formatting back to the lead agent. */
export interface SubAgentRunReport {
  /** 1-based position in the spawn batch. */
  index: number;
  type: string;
  task: string;
  /** The provider-native model the sub-agent actually ran on. */
  model: string;
  /** The sub-agent's final textual report (or an error/notice). */
  report: string;
  aborted: boolean;
  /** Set when the sub-agent run threw before producing a report. */
  error?: string;
}

/**
 * Render every sub-agent's report into the single tool-result string the lead
 * agent reads. `requested` is the count the model asked for, so we can note when
 * the batch was capped at {@link MAX_SUB_AGENTS_PER_CALL}.
 */
export function formatSubAgentReports(
  reports: SubAgentRunReport[],
  requested: number,
): string {
  const header =
    reports.length === 1
      ? "Sub-agent finished. Its report:"
      : `${reports.length} sub-agents finished. Their reports:`;
  const cappedNote =
    requested > reports.length
      ? `\n\n(Note: you requested ${requested} sub-agents; only the first ${reports.length} ran — the cap is ${MAX_SUB_AGENTS_PER_CALL} per spawn_agents call.)`
      : "";
  const sections = reports.map((r) => {
    const label = AGENT_TYPES[r.type]?.label ?? r.type;
    const status = r.error
      ? " — FAILED"
      : r.aborted
        ? " — ABORTED"
        : "";
    const body = r.error ? `ERROR: ${r.error}` : r.report || "(the sub-agent produced no textual report)";
    return (
      `── [${r.index}] ${r.type} (${label}) · model ${r.model}${status} ──\n` +
      `Task: ${r.task}\n\n${body}`
    );
  });
  return `${header}${cappedNote}\n\n${sections.join("\n\n")}`;
}
