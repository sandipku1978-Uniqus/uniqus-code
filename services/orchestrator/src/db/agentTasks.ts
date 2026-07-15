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

/** Cancel only work that has not already reached a terminal state. */
export async function cancelAgentTask(id: string, projectId: string): Promise<boolean> {
  const { data, error } = await db()
    .from("agent_tasks")
    .update({
      status: "canceled",
      worker_id: null,
      lease_expires_at: null,
      heartbeat_at: null,
    })
    .eq("id", id)
    .eq("project_id", projectId)
    .in("status", ["queued", "running"])
    .select("id");
  if (error) throw new Error(`cancelAgentTask failed: ${error.message}`);
  return Array.isArray(data) && data.length === 1;
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

/** Claim or reclaim one task atomically across worker processes. */
export async function claimNextQueuedTask(
  workerId: string,
  leaseSeconds: number,
): Promise<AgentTask | null> {
  const { data, error } = await db().rpc("claim_next_agent_task", {
    p_worker_id: workerId,
    p_lease_seconds: Math.max(30, Math.min(Math.floor(leaseSeconds), 3600)),
  });
  if (error) {
    // Fail closed when the lease migration has not been applied. Falling back
    // to the old select/update pair would reintroduce duplicate execution.
    console.error(`claimNextQueuedTask failed: ${error.message}`);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return (row as AgentTask | null) ?? null;
}

export async function renewAgentTaskLease(
  id: string,
  workerId: string,
  leaseSeconds: number,
): Promise<boolean> {
  const leaseExpiresAt = new Date(
    Date.now() + Math.max(30, Math.min(Math.floor(leaseSeconds), 3600)) * 1000,
  ).toISOString();
  const { data, error } = await db()
    .from("agent_tasks")
    .update({ heartbeat_at: new Date().toISOString(), lease_expires_at: leaseExpiresAt })
    .eq("id", id)
    .eq("status", "running")
    .eq("worker_id", workerId)
    .select("id");
  return !error && Array.isArray(data) && data.length === 1;
}

export async function finishAgentTask(
  id: string,
  workerId: string,
  patch: Pick<
    Parameters<typeof updateAgentTask>[1],
    "status" | "result_summary" | "error"
  >,
): Promise<boolean> {
  const { data, error } = await db()
    .from("agent_tasks")
    .update({
      ...patch,
      worker_id: null,
      lease_expires_at: null,
      heartbeat_at: null,
    })
    .eq("id", id)
    .eq("status", "running")
    .eq("worker_id", workerId)
    .select("id");
  if (error) throw new Error(`finishAgentTask failed: ${error.message}`);
  return Array.isArray(data) && data.length === 1;
}

export async function requeueAgentTask(id: string, workerId: string): Promise<void> {
  const { error } = await db()
    .from("agent_tasks")
    .update({
      status: "queued",
      worker_id: null,
      lease_expires_at: null,
      heartbeat_at: null,
    })
    .eq("id", id)
    .eq("status", "running")
    .eq("worker_id", workerId);
  if (error) throw new Error(`requeueAgentTask failed: ${error.message}`);
}
