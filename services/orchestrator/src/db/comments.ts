import { db } from "./client.js";
import type { Comment, CommentTargetKind } from "@uniqus/api-types";

/**
 * Comments (P3.4). A teammate can comment on a preview element (target_ref = the
 * selectedElement selector/descriptor), a file, a checkpoint, a PR, or the
 * project at large. Addressable by the agent as review context.
 */

export interface CreateCommentInput {
  projectId: string;
  userId: string | null;
  targetKind: CommentTargetKind;
  targetRef?: string | null;
  body: string;
}

export async function createComment(input: CreateCommentInput): Promise<Comment> {
  const { data, error } = await db()
    .from("comments")
    .insert({
      project_id: input.projectId,
      user_id: input.userId,
      target_kind: input.targetKind,
      target_ref: input.targetRef ?? null,
      body: input.body,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`createComment failed: ${error?.message}`);
  return data as Comment;
}

export async function listComments(projectId: string, limit = 200): Promise<Comment[]> {
  const { data, error } = await db()
    .from("comments")
    .select("*, users(email, display_name)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 500)));
  if (error) {
    if (error.code === "42P01") return [];
    throw new Error(`listComments failed: ${error.message}`);
  }
  return ((data ?? []) as Array<Record<string, unknown> & { users?: { email: string | null; display_name: string | null } | null }>).map(
    (r) => {
      const { users, ...rest } = r;
      return {
        ...(rest as unknown as Comment),
        author_email: users?.email ?? null,
        author_name: users?.display_name ?? null,
      };
    },
  );
}

export async function setCommentResolved(id: string, projectId: string, resolved: boolean): Promise<void> {
  const { error } = await db()
    .from("comments")
    .update({ resolved })
    .eq("id", id)
    .eq("project_id", projectId);
  if (error) throw new Error(`setCommentResolved failed: ${error.message}`);
}
