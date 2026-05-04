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
  const raw = ((data ?? []) as Row[]).map((r) => ({
    role: r.role,
    content: r.content,
  } as Anthropic.MessageParam));
  return scrubToolPairs(raw);
}

/**
 * Walk the history and ensure every assistant `tool_use` block has a matching
 * `tool_result` in the next user message. If any are missing — usually the
 * fallout of an old abort path that persisted the assistant message but
 * not the synthesized results — we splice in synthetic recovery results
 * so Anthropic doesn't 400 on the next turn with
 *   `tool_use ids were found without tool_result blocks immediately after`.
 *
 * In-memory only. We don't write the repair back to the DB; the next-turn
 * append path produces well-formed messages, and rewriting old rows would
 * invite races with concurrent sessions on the same project.
 */
function scrubToolPairs(
  messages: Anthropic.MessageParam[],
): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  let pending: string[] = []; // tool_use ids waiting for a tool_result

  const recoveryResultsFor = (
    ids: readonly string[],
  ): Anthropic.ToolResultBlockParam[] =>
    ids.map((id) => ({
      type: "tool_result" as const,
      tool_use_id: id,
      content: "(no result recorded — recovered from a partially-aborted earlier turn)",
      is_error: true,
    }));

  for (const msg of messages) {
    if (msg.role === "assistant") {
      // A new assistant message arrived while tool_use ids were still pending.
      // Close them out before this message so the assistant→user→assistant
      // sequence stays valid.
      if (pending.length > 0) {
        out.push({ role: "user", content: recoveryResultsFor(pending) });
        pending = [];
      }
      out.push(msg);
      if (Array.isArray(msg.content)) {
        pending = msg.content
          .filter(
            (b): b is Extract<typeof b, { type: "tool_use" }> =>
              typeof b === "object" && b !== null && (b as { type?: string }).type === "tool_use",
          )
          .map((b) => b.id);
      }
      continue;
    }

    // role === "user"
    if (Array.isArray(msg.content) && pending.length > 0) {
      const present = new Set(
        msg.content
          .filter(
            (b): b is Anthropic.ToolResultBlockParam =>
              typeof b === "object" && b !== null && (b as { type?: string }).type === "tool_result",
          )
          .map((b) => b.tool_use_id),
      );
      const missing = pending.filter((id) => !present.has(id));
      if (missing.length > 0) {
        out.push({
          role: "user",
          content: [...msg.content, ...recoveryResultsFor(missing)],
        });
        pending = [];
        continue;
      }
    } else if (pending.length > 0) {
      // Plain string user message arrived with pending tool_use ids — inject
      // recovery results before it.
      out.push({ role: "user", content: recoveryResultsFor(pending) });
      pending = [];
    }
    out.push(msg);
  }

  // History ended with an assistant message whose tool_use blocks were never
  // answered. Append a synthetic recovery user message so the next turn
  // starts from a valid state.
  if (pending.length > 0) {
    out.push({ role: "user", content: recoveryResultsFor(pending) });
  }

  return out;
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
