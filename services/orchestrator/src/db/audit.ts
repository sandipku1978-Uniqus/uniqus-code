import { db } from "./client.js";

/**
 * Audit log for credential access + connector invocations (Plan §1.6, §6).
 *
 * Best-effort: a write failure is logged but never throws — losing an audit
 * line is far preferable to failing the underlying user request, and the
 * upstream operation already has its own error path.
 */

export type AuditKind =
  | "secret_read"
  | "secret_write"
  | "secret_delete"
  | "connector_invoke"
  | "connector_invoke_error"
  | "checkpoint_create"
  | "checkpoint_restore";

export interface AuditEntryInput {
  project_id: string | null;
  user_id: string | null;
  kind: AuditKind;
  target: string;
  metadata?: Record<string, unknown> | null;
}

export async function audit(entry: AuditEntryInput): Promise<void> {
  try {
    const { error } = await db()
      .from("audit_events")
      .insert({
        project_id: entry.project_id,
        user_id: entry.user_id,
        kind: entry.kind,
        target: entry.target,
        metadata: entry.metadata ?? null,
      });
    if (error) console.error(`[audit] insert failed: ${error.message}`);
  } catch (err) {
    console.error("[audit] threw:", err);
  }
}

export interface AuditRow {
  id: number;
  project_id: string | null;
  user_id: string | null;
  kind: AuditKind;
  target: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export async function listAudit(
  projectId: string,
  limit = 100,
): Promise<AuditRow[]> {
  const { data, error } = await db()
    .from("audit_events")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 1000)));
  if (error) throw new Error(`listAudit failed: ${error.message}`);
  return (data ?? []) as AuditRow[];
}
