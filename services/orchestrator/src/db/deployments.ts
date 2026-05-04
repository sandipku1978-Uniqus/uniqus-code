import { db } from "./client.js";

export type DeploymentState = "QUEUED" | "BUILDING" | "READY" | "ERROR" | "CANCELED";

export interface DeploymentRecord {
  id: string;
  project_id: string;
  user_id: string;
  vercel_deployment_id: string;
  vercel_url: string | null;
  state: DeploymentState;
  error_message: string | null;
  target: "production" | "preview";
  created_at: string;
  updated_at: string;
}

export async function insertDeployment(input: {
  project_id: string;
  user_id: string;
  vercel_deployment_id: string;
  vercel_url: string | null;
  state: DeploymentState;
  target: "production" | "preview";
}): Promise<DeploymentRecord> {
  const { data, error } = await db()
    .from("deployments")
    .insert({
      project_id: input.project_id,
      user_id: input.user_id,
      vercel_deployment_id: input.vercel_deployment_id,
      vercel_url: input.vercel_url,
      state: input.state,
      target: input.target,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`insertDeployment failed: ${error?.message}`);
  return data as DeploymentRecord;
}

export async function updateDeploymentState(
  id: string,
  patch: { state: DeploymentState; vercel_url?: string | null; error_message?: string | null },
): Promise<void> {
  const { error } = await db()
    .from("deployments")
    .update({
      state: patch.state,
      ...(patch.vercel_url !== undefined ? { vercel_url: patch.vercel_url } : {}),
      ...(patch.error_message !== undefined ? { error_message: patch.error_message } : {}),
    })
    .eq("id", id);
  if (error) throw new Error(`updateDeploymentState failed: ${error.message}`);
}

export async function listDeployments(
  projectId: string,
  limit = 20,
): Promise<DeploymentRecord[]> {
  const { data, error } = await db()
    .from("deployments")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listDeployments failed: ${error.message}`);
  return (data ?? []) as DeploymentRecord[];
}

export async function getDeployment(id: string): Promise<DeploymentRecord | null> {
  const { data, error } = await db()
    .from("deployments")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getDeployment failed: ${error.message}`);
  return (data ?? null) as DeploymentRecord | null;
}
