import { db } from "./client.js";
import type { FlowStep, FlowRunStatus, ProjectFlow } from "@uniqus/api-types";

/**
 * Saved smoke-flows (P2.4). A flow is a named, replayable list of FlowSteps (the
 * same vocabulary `interact_preview` drives). The agent records one after
 * building a feature (`save_flow`) and replays it after later changes
 * (`run_flow`); the user can also replay it one-click from the Preview (Agent)
 * tab. CRUD here mirrors the agentTasks/comments helpers; the actual replay runs
 * through `runInteractPreview` (loop.ts run_flow tool, or the UI run route).
 *
 * Best-effort like the other evidence helpers: a missing table (pre-migration)
 * degrades to an empty list rather than failing the turn.
 */

export interface CreateFlowInput {
  projectId: string;
  createdBy: string | null;
  name: string;
  description?: string | null;
  steps: FlowStep[];
  startPath?: string | null;
}

export async function listFlows(projectId: string, limit = 200): Promise<ProjectFlow[]> {
  const { data, error } = await db()
    .from("project_flows")
    .select("*")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 500)));
  if (error) {
    if (error.code === "42P01") return []; // table not migrated yet
    throw new Error(`listFlows failed: ${error.message}`);
  }
  return (data ?? []) as ProjectFlow[];
}

export async function getFlow(projectId: string, flowId: string): Promise<ProjectFlow | null> {
  const { data, error } = await db()
    .from("project_flows")
    .select("*")
    .eq("project_id", projectId)
    .eq("id", flowId)
    .maybeSingle();
  if (error) return null;
  return (data as ProjectFlow | null) ?? null;
}

export async function getFlowByName(projectId: string, name: string): Promise<ProjectFlow | null> {
  const { data, error } = await db()
    .from("project_flows")
    .select("*")
    .eq("project_id", projectId)
    .eq("name", name)
    .maybeSingle();
  if (error) return null;
  return (data as ProjectFlow | null) ?? null;
}

/**
 * Create or replace a flow by (project, name). Re-saving an existing name
 * overwrites its steps so the agent can update a flow it grew without spawning
 * duplicates (matches the `unique (project_id, name)` constraint).
 */
export async function upsertFlow(input: CreateFlowInput): Promise<ProjectFlow> {
  const { data, error } = await db()
    .from("project_flows")
    .upsert(
      {
        project_id: input.projectId,
        created_by: input.createdBy,
        name: input.name,
        description: input.description ?? null,
        steps: input.steps,
        start_path: input.startPath ?? null,
      },
      { onConflict: "project_id,name" },
    )
    .select("*")
    .single();
  if (error || !data) throw new Error(`upsertFlow failed: ${error?.message}`);
  return data as ProjectFlow;
}

export async function deleteFlow(projectId: string, flowId: string): Promise<void> {
  const { error } = await db()
    .from("project_flows")
    .delete()
    .eq("project_id", projectId)
    .eq("id", flowId);
  if (error) throw new Error(`deleteFlow failed: ${error.message}`);
}

/** Record the outcome of the most recent replay (the compact evidence card). */
export async function setFlowRunResult(
  projectId: string,
  flowId: string,
  result: { status: FlowRunStatus; summary: string; ranAt: string },
): Promise<void> {
  const { error } = await db()
    .from("project_flows")
    .update({
      last_status: result.status,
      last_summary: result.summary,
      last_run_at: result.ranAt,
    })
    .eq("project_id", projectId)
    .eq("id", flowId);
  if (error) console.error(`[flows] setFlowRunResult failed: ${error.message}`);
}
