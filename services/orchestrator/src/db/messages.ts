import type Anthropic from "@anthropic-ai/sdk";
import { normalizeMessageHistory } from "../agent/messageHistory.js";
import { db } from "./client.js";

interface Row {
  id: number;
  role: "user" | "assistant";
  content: Anthropic.MessageParam["content"];
}

/**
 * Multi-session persistence (Phase 2.x). Every read/write is keyed by both
 * project_id AND session_id so different chat threads in the same project
 * stay isolated. Pre-2.x callers that only know project_id should call
 * `ensureDefaultSession` first to resolve the session id.
 */

export async function loadHistory(
  projectId: string,
  sessionId: string,
): Promise<Anthropic.MessageParam[]> {
  const { data, error } = await db()
    .from("messages")
    .select("id, role, content")
    .eq("project_id", projectId)
    .eq("session_id", sessionId)
    .order("id", { ascending: true });
  if (error) throw new Error(`loadHistory failed: ${error.message}`);
  const raw = ((data ?? []) as Row[]).map((r) => ({
    role: r.role,
    content: r.content,
  } as Anthropic.MessageParam));
  return normalizeMessageHistory(raw);
}

export async function appendMessage(
  projectId: string,
  sessionId: string,
  message: Anthropic.MessageParam,
): Promise<void> {
  const { error } = await db().from("messages").insert({
    project_id: projectId,
    session_id: sessionId,
    role: message.role,
    content: message.content,
  });
  if (error) throw new Error(`appendMessage failed: ${error.message}`);
}

/**
 * Wipe the history of one chat session. Doesn't delete the session row
 * itself — the dropdown still shows it (now empty). Use `deleteSession`
 * from chatSessions.ts for full removal.
 */
export async function clearHistory(projectId: string, sessionId: string): Promise<void> {
  const { error } = await db()
    .from("messages")
    .delete()
    .eq("project_id", projectId)
    .eq("session_id", sessionId);
  if (error) throw new Error(`clearHistory failed: ${error.message}`);
}
