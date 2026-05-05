import type Anthropic from "@anthropic-ai/sdk";

function isBlock(value: unknown): value is { type?: string } {
  return typeof value === "object" && value !== null;
}

function isToolUseBlock(
  block: unknown,
): block is Extract<Anthropic.ContentBlockParam, { type: "tool_use" }> & { id: string } {
  return isBlock(block) && block.type === "tool_use" && typeof (block as { id?: unknown }).id === "string";
}

function isToolResultBlock(block: unknown): block is Anthropic.ToolResultBlockParam {
  return (
    isBlock(block) &&
    block.type === "tool_result" &&
    typeof (block as { tool_use_id?: unknown }).tool_use_id === "string"
  );
}

function recoveryResult(id: string): Anthropic.ToolResultBlockParam {
  return {
    type: "tool_result",
    tool_use_id: id,
    content: "(no result recorded - recovered from a partially-aborted earlier turn)",
    is_error: true,
  };
}

function toolUseIds(content: Anthropic.MessageParam["content"]): string[] {
  if (!Array.isArray(content)) return [];
  return content.filter(isToolUseBlock).map((block) => block.id);
}

/**
 * Anthropic requires every assistant tool_use to be followed immediately by
 * user tool_result blocks. A single missing result poisons all future turns, so
 * normalize both loaded history and in-memory history before API calls.
 */
export function normalizeMessageHistory(
  messages: Anthropic.MessageParam[],
): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  let pending: string[] = [];

  for (const msg of messages) {
    if (msg.role === "assistant") {
      if (pending.length > 0) {
        out.push({ role: "user", content: pending.map(recoveryResult) });
        pending = [];
      }
      out.push(msg);
      pending = toolUseIds(msg.content);
      continue;
    }

    if (pending.length === 0) {
      if (Array.isArray(msg.content)) {
        const withoutOrphanResults = msg.content.filter((block) => !isToolResultBlock(block));
        if (withoutOrphanResults.length === 0) continue;
        out.push({ ...msg, content: withoutOrphanResults });
      } else {
        out.push(msg);
      }
      continue;
    }

    if (!Array.isArray(msg.content)) {
      out.push({ role: "user", content: pending.map(recoveryResult) });
      pending = [];
      out.push(msg);
      continue;
    }

    const byId = new Map<string, Anthropic.ToolResultBlockParam>();
    const otherBlocks: Exclude<typeof msg.content, string> = [];
    for (const block of msg.content) {
      if (isToolResultBlock(block)) {
        if (pending.includes(block.tool_use_id) && !byId.has(block.tool_use_id)) {
          byId.set(block.tool_use_id, block);
        }
      } else {
        otherBlocks.push(block);
      }
    }

    out.push({
      role: "user",
      content: [
        ...pending.map((id) => byId.get(id) ?? recoveryResult(id)),
        ...otherBlocks,
      ],
    });
    pending = [];
  }

  if (pending.length > 0) {
    out.push({ role: "user", content: pending.map(recoveryResult) });
  }

  return out;
}

export function normalizeMessageHistoryInPlace(messages: Anthropic.MessageParam[]): void {
  const normalized = normalizeMessageHistory(messages);
  messages.splice(0, messages.length, ...normalized);
}
