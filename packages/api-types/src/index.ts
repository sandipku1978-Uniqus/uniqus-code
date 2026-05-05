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
}

export interface CurrentUser {
  id: string;
  email: string;
  display_name: string | null;
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
    }
  | { type: "iteration"; iter: number }
  | { type: "text"; content: string }
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
  | { type: "error"; message: string };

export interface PreviewServer {
  id: string;
  command: string;
  port: number;
}

export interface TreeEntry {
  path: string;
  is_dir: boolean;
}
