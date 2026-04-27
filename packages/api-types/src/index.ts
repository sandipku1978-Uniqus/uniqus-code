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

export type ClientEvent =
  | { type: "user_message"; content: string; mode: RunMode }
  | { type: "plan_approved"; plan: Plan }
  | { type: "request_tree" }
  | { type: "request_file"; path: string }
  | { type: "reset_session" }
  | { type: "abort" }
  | { type: "client_write_file"; path: string; content: string };

export interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface CurrentUser {
  id: string;
  email: string;
  display_name: string | null;
}

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
