export interface PlanStep {
  description: string;
  files?: string[];
  success_criteria?: string;
}

export interface Plan {
  summary: string;
  steps: PlanStep[];
}

export type RunMode = "plan-then-execute" | "execute-only";

/** LLM providers the coding agent can run on. */
export type ModelProvider = "anthropic" | "openai" | "google";

/**
 * What model the coding agent should use for a turn.
 * - `"auto"` (the default): the orchestrator picks the strongest sensible
 *   model per role. Never resolves to a low/cheap tier.
 * - A catalog `id` ("<provider>:<model>", e.g. "openai:gpt-5.5"): an explicit
 *   override chosen via the Advanced model picker. "results may vary" applies.
 */
export type ModelChoice = "auto" | string;

/**
 * Per-turn reasoning/thinking effort for the agent. Maps to each provider's
 * native control: Anthropic extended-thinking budget, OpenAI `reasoning_effort`,
 * Gemini `thinkingConfig.thinkingBudget`. Account-wide default like the model
 * choice; also overridable per turn from the composer.
 */
export type ThinkingEffort = "low" | "medium" | "high";

/**
 * One selectable model in the Advanced picker. The curated `MODEL_CATALOG`
 * below is the single source of truth shared by the web UI (to render the
 * picker) and the orchestrator (to validate an override and route it to the
 * right provider). Deliberately excludes the lowest tiers (Claude Haiku,
 * Gemini Flash-Lite, GPT mini/nano) — those are never offered for the agent.
 */
export interface ModelOption {
  /** "<provider>:<model>" — also the value sent as a `ModelChoice`. */
  id: string;
  provider: ModelProvider;
  /** Provider-native model id passed to that provider's API. */
  model: string;
  /** Short human label for the picker, e.g. "Claude Opus 4.8". */
  label: string;
  /** One-line "what it's good at" shown under the label. */
  description: string;
  /** Coarse capability/cost tier. "frontier" = top, "high" = strong. */
  tier: "frontier" | "high";
}

export const MODEL_CATALOG: ReadonlyArray<ModelOption> = [
  // ── Anthropic ──
  {
    id: "anthropic:claude-opus-4-8",
    provider: "anthropic",
    model: "claude-opus-4-8",
    label: "Claude Opus 4.8",
    description: "Anthropic's most capable coding & agentic model.",
    tier: "frontier",
  },
  {
    id: "anthropic:claude-sonnet-4-6",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    description: "Fast, strong general coding — great cost/quality balance.",
    tier: "high",
  },
  // ── OpenAI ──
  {
    id: "openai:gpt-5.5",
    provider: "openai",
    model: "gpt-5.5",
    label: "GPT-5.5",
    description: "OpenAI's flagship for complex reasoning and coding.",
    tier: "frontier",
  },
  {
    id: "openai:gpt-5.5-pro",
    provider: "openai",
    model: "gpt-5.5-pro",
    label: "GPT-5.5 Pro",
    description: "Highest-accuracy GPT-5.5 — slower, for hard problems.",
    tier: "frontier",
  },
  {
    id: "openai:gpt-5.3-codex",
    provider: "openai",
    model: "gpt-5.3-codex",
    label: "GPT-5.3 Codex",
    description: "Agentic coding model tuned for long tool-use sessions.",
    tier: "high",
  },
  // ── Google ──
  {
    id: "google:gemini-3.1-pro-preview-customtools",
    provider: "google",
    model: "gemini-3.1-pro-preview-customtools",
    label: "Gemini 3.1 Pro Preview",
    description: "Agentic workflows & coding with a 1M-token context.",
    tier: "frontier",
  },
  {
    id: "google:gemini-3.5-flash",
    provider: "google",
    model: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    description: "Near-Pro intelligence at Flash speed; strong at code.",
    tier: "high",
  },
  {
    id: "google:gemini-2.5-pro",
    provider: "google",
    model: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    description: "High-capability reasoning & coding, 1M-token context.",
    tier: "high",
  },
];

export interface UploadedFileSummary {
  name: string;
  path: string;
  size: number;
  mime_type: string;
}

export type ClientEvent =
  | {
      type: "user_message";
      content: string;
      mode: RunMode;
      /**
       * Which model to run the agent (and plan step) on for this turn.
       * Omitted or `"auto"` ⇒ the orchestrator picks the best model per role.
       * A catalog id ("<provider>:<model>") ⇒ explicit Advanced override.
       */
      model?: ModelChoice;
      /**
       * Reasoning effort for this turn. Omitted ⇒ the orchestrator's default
       * ("medium"). Higher = more internal reasoning before answering.
       */
      thinking?: ThinkingEffort;
      attachments?: UploadedFileSummary[];
      /**
       * Sandbox-relative paths the user explicitly @-referenced in the
       * composer. The orchestrator reads each file (with size caps) and
       * inlines the contents into the agent's user message so the agent
       * doesn't have to spend a `read_file` tool round-trip.
       */
      file_refs?: string[];
    }
  | { type: "plan_approved"; plan: Plan }
  | { type: "request_tree" }
  | { type: "request_file"; path: string }
  | { type: "reset_session" }
  | { type: "abort" }
  | { type: "client_write_file"; path: string; content: string }
  | { type: "user_question_answered"; call_id: string; answer: string };

export interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  /** Optional emoji or short visual ID. Null = picker renders an auto-derived hash tile. */
  icon: string | null;
  created_at: string;
  updated_at: string;
  /** Web URL of the linked GitHub repo, if the user has clicked "Create GitHub repo". */
  github_repo_url?: string | null;
  /** "owner/name" form for compact display. */
  github_repo_full_name?: string | null;
  /** Vercel-side project name, populated after the first Vercel deploy. */
  vercel_project_name?: string | null;
}

export interface CurrentUser {
  id: string;
  email: string;
  display_name: string | null;
  /** "guest" accounts have full parity with "standard" except GitHub + deploys. */
  account_type: "standard" | "guest";
}

/**
 * Account-wide agent customization (Settings → Custom prompts & default
 * skills). `custom_prompt` is appended to the agent system prompt on every
 * turn; `default_skills` is the Skills markdown seeded into each new project's
 * `.uniqus/skills.md`. Empty string = unset.
 */
export interface AccountSettings {
  custom_prompt: string;
  default_skills: string;
}

export type DeploymentState = "QUEUED" | "BUILDING" | "READY" | "ERROR" | "CANCELED";

export type ServerEvent =
  | {
      type: "session_started";
      sandbox_dir: string;
      shell: string;
      platform: string;
      project: ProjectSummary;
      user: CurrentUser;
      /**
       * Active chat session id (Phase 2.x). The workspace dropdown uses this
       * to highlight which thread is currently bound; reconnect with
       * `?session=<id>` to switch.
       */
      chat_session?: { id: string; title: string | null };
    }
  | { type: "iteration"; iter: number }
  | { type: "text"; content: string }
  | {
      /**
       * Reasoning/thinking delta — the model's internal reasoning trace, shown
       * in a collapsible block separate from the answer text. Not every model
       * exposes it (e.g. OpenAI Chat Completions hides reasoning content).
       */
      type: "thinking";
      content: string;
    }
  | {
      /**
       * Non-agent system message — VM lifecycle, storage sync notices, etc.
       * Renders in muted/grey type so the user doesn't mistake it for agent
       * output. Don't use for anything the agent itself "said".
       */
      type: "system";
      content: string;
    }
  | { type: "tool_call"; call_id: string; name: string; input: unknown }
  | { type: "tool_result"; call_id: string; result: string; is_error: boolean }
  | { type: "plan_proposed"; plan: Plan }
  | { type: "plan_running" }
  | { type: "tree_listing"; entries: TreeEntry[] }
  | { type: "file_content"; path: string; content: string | null }
  | { type: "file_changed"; path: string }
  | { type: "server_started"; id: string; command: string; port: number }
  | { type: "server_stopped"; id: string }
  | { type: "session_reset" }
  | { type: "complete"; tool_calls: number; elapsed_ms: number; aborted?: boolean }
  | { type: "storage_synced"; at: number }
  | { type: "client_write_ack"; path: string; ok: boolean; error?: string }
  | {
      type: "deploy_state_changed";
      deployment_id: string;
      state: DeploymentState;
      vercel_url: string | null;
      error_message: string | null;
    }
  | {
      /**
       * Agent invoked the `ask_user` tool. UI renders the question + options
       * inline in the chat; the matching `user_question_answered` ClientEvent
       * resumes the agent loop.
       */
      type: "user_question_asked";
      call_id: string;
      question: string;
      options?: string[];
      allow_free_text: boolean;
    }
  | {
      /** Agent loop summarized older turns to fit the context window. */
      type: "history_compacted";
      removed_messages: number;
      before_tokens: number;
      after_tokens: number;
    }
  | {
      /**
       * Agent invoked the `todo_write` tool. UI rerenders the Tasks pane.
       * Stored per-project on the orchestrator; survives across turns.
       */
      type: "todos_updated";
      todos: TodoItem[];
    }
  | {
      /** A new checkpoint was committed to the project's shadow git (Plan §3.5). */
      type: "checkpoint_created";
      sha: string;
      short_sha: string;
      message: string;
      created_at: string;
    }
  | { type: "error"; message: string };

export interface TodoItem {
  content: string;
  activeForm: string;
  status: "pending" | "in_progress" | "completed";
}

export interface PreviewServer {
  id: string;
  command: string;
  port: number;
}

export interface TreeEntry {
  path: string;
  is_dir: boolean;
}
