import { db } from "./client.js";

export type CleanupKind = "project" | "knowledge";

export interface CleanupJob {
  id: string;
  kind: CleanupKind;
  resource_id: string;
  owner_id: string | null;
  storage_paths: string[];
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
}

const COLS = "id, kind, resource_id, owner_id, storage_paths, attempts, next_attempt_at, last_error";

/** Persist the retry key before deleting the user-visible ownership row. */
export async function ensureCleanupJob(input: {
  kind: CleanupKind;
  resourceId: string;
  ownerId: string | null;
  storagePaths?: string[];
}): Promise<CleanupJob> {
  const { data, error } = await db()
    .from("cleanup_jobs")
    .upsert({
      kind: input.kind,
      resource_id: input.resourceId,
      owner_id: input.ownerId,
      storage_paths: input.storagePaths ?? [],
      next_attempt_at: new Date().toISOString(),
    }, { onConflict: "kind,resource_id", ignoreDuplicates: false })
    .select(COLS)
    .single();
  if (error || !data) throw new Error(`ensureCleanupJob failed: ${error?.message ?? "no row"}`);
  return data as CleanupJob;
}

export async function listDueCleanupJobs(limit = 25): Promise<CleanupJob[]> {
  const { data, error } = await db()
    .from("cleanup_jobs")
    .select(COLS)
    .lte("next_attempt_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`listDueCleanupJobs failed: ${error.message}`);
  return (data ?? []) as CleanupJob[];
}

export async function completeCleanupJob(id: string): Promise<void> {
  const { error } = await db().from("cleanup_jobs").delete().eq("id", id);
  if (error) throw new Error(`completeCleanupJob failed: ${error.message}`);
}

export async function deferCleanupJob(job: CleanupJob, error: unknown): Promise<void> {
  const attempts = job.attempts + 1;
  const delayMs = Math.min(60 * 60_000, 5_000 * 2 ** Math.min(attempts, 10));
  const detail = error instanceof Error ? error.message : String(error);
  const { error: updateError } = await db()
    .from("cleanup_jobs")
    .update({
      attempts,
      last_error: detail.slice(0, 2_000),
      next_attempt_at: new Date(Date.now() + delayMs).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);
  if (updateError) throw new Error(`deferCleanupJob failed: ${updateError.message}`);
}
