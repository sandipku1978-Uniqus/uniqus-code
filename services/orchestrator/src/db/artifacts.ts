import { db } from "./client.js";
import type { ArtifactKind, CheckpointArtifact } from "@gate15/api-types";

/**
 * Checkpoint / interaction artifacts (P2.3). Persists the evidence captured
 * during a turn (interact_preview runs, screenshots, console/network/a11y
 * findings) keyed to the project + session so a checkpoint can be reopened with
 * its proof attached, and so PR bundles (P1.3) / review packets (P8.3) can cite it.
 *
 * Best-effort: a write failure is logged, never thrown — losing an evidence row
 * must not fail the agent turn that produced it.
 */

export interface RecordArtifactInput {
  projectId: string;
  sessionId: string | null;
  checkpointSha?: string | null;
  kind: ArtifactKind;
  summary?: string | null;
  data: Record<string, unknown>;
}

export async function recordArtifact(input: RecordArtifactInput): Promise<void> {
  try {
    const { error } = await db().from("checkpoint_artifacts").insert({
      project_id: input.projectId,
      session_id: input.sessionId,
      checkpoint_sha: input.checkpointSha ?? null,
      kind: input.kind,
      summary: input.summary ?? null,
      data: input.data,
    });
    if (error) console.error(`[artifacts] insert failed: ${error.message}`);
  } catch (err) {
    console.error("[artifacts] threw:", err);
  }
}

export async function listArtifacts(projectId: string, limit = 100): Promise<CheckpointArtifact[]> {
  const { data, error } = await db()
    .from("checkpoint_artifacts")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 500)));
  if (error) {
    if (error.code === "42P01") return []; // table not applied yet
    throw new Error(`listArtifacts failed: ${error.message}`);
  }
  return (data ?? []) as CheckpointArtifact[];
}
