import { db } from "./client.js";
import type { AgentTask, AgentTaskStatus } from "@gate15/api-types";

/**
 * Durable agent-task queue (P8.1). Unlike the in-memory background-shell-job Map
 * (which is wiped on orchestrator exit), these rows survive a restart so a
 * queued/running/done task is a real product concept the UI can show and a
 * worker can pick up. Branch-per-task + review-packet (P8.3) hang off this row.
 */

export interface CreateAgentTaskInput {
  projectId: string;
  orgId?: string | null;
  createdBy: string;
  title: string;
  prompt: string;
  branch?: string | null;
  acceptanceCriteria?: string | null;
}

export async function createAgentTask(input: CreateAgentTaskInput): Promise<AgentTask> {
  const { data, error } = await db()
    .from("agent_tasks")
    .insert({
      project_id: input.projectId,
      org_id: input.orgId ?? null,
      created_by: input.createdBy,
      title: input.title,
      prompt: input.prompt,
      branch: input.branch ?? null,
      acceptance_criteria: input.acceptanceCriteria ?? null,
      status: "queued",
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`createAgentTask failed: ${error?.message}`);
  return data as AgentTask;
}

export async function listAgentTasks(projectId: string, limit = 100): Promise<AgentTask[]> {
  const { data, error } = await db()
    .from("agent_tasks")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 500)));
  if (error) {
    if (error.code === "42P01") return [];
    throw new Error(`listAgentTasks failed: ${error.message}`);
  }
  return (data ?? []) as AgentTask[];
}

export async function getAgentTask(id: string): Promise<AgentTask | null> {
  const { data, error } = await db().from("agent_tasks").select("*").eq("id", id).maybeSingle();
  if (error) return null;
  return (data as AgentTask | null) ?? null;
}

export async function updateAgentTask(
  id: string,
  patch: Partial<{
    status: AgentTaskStatus;
    branch: string | null;
    result_summary: string | null;
    error: string | null;
  }>,
): Promise<void> {
  const { error } = await db().from("agent_tasks").update(patch).eq("id", id);
  if (error) throw new Error(`updateAgentTask failed: ${error.message}`);
}

/** Revoke queued/running work created by a user who lost project access. */
export async function cancelTasksForUserInProject(
  projectId: string,
  userId: string,
): Promise<void> {
  const { error } = await db()
    .from("agent_tasks")
    .update({ status: "canceled", error: "project access revoked" })
    .eq("project_id", projectId)
    .eq("created_by", userId)
    .in("status", ["queued", "running"]);
  if (error) throw new Error(`cancelTasksForUserInProject failed: ${error.message}`);
}

/** Claim the oldest queued task atomically-ish (best-effort; single worker). */
export async function claimNextQueuedTask(): Promise<AgentTask | null> {
  const { data, error } = await db()
    .from("agent_tasks")
    .select("*")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const task = data as AgentTask;
  const upd = await db()
    .from("agent_tasks")
    .update({ status: "running" })
    .eq("id", task.id)
    .eq("status", "queued")
    .select("id");
  // If another worker grabbed it first, the conditional update affects 0 rows.
  if (upd.error || !upd.data || upd.data.length === 0) return null;
  return { ...task, status: "running" };
}
