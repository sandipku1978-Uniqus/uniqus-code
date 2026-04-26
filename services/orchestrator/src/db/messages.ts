import type Anthropic from "@anthropic-ai/sdk";
import { db } from "./client.js";

interface Row {
  id: number;
  role: "user" | "assistant";
  content: Anthropic.MessageParam["content"];
}

export async function loadHistory(
  projectId: string,
): Promise<Anthropic.MessageParam[]> {
  const { data, error } = await db()
    .from("messages")
    .select("id, role, content")
    .eq("project_id", projectId)
    .order("id", { ascending: true });
  if (error) throw new Error(`loadHistory failed: ${error.message}`);
  return ((data ?? []) as Row[]).map((r) => ({
    role: r.role,
    content: r.content,
  }));
}

export async function appendMessage(
  projectId: string,
  message: Anthropic.MessageParam,
): Promise<void> {
  const { error } = await db().from("messages").insert({
    project_id: projectId,
    role: message.role,
    content: message.content,
  });
  if (error) throw new Error(`appendMessage failed: ${error.message}`);
}

export async function clearHistory(projectId: string): Promise<void> {
  const { error } = await db().from("messages").delete().eq("project_id", projectId);
  if (error) throw new Error(`clearHistory failed: ${error.message}`);
}
