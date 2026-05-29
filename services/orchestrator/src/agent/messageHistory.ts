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

/** A "real" user turn (the user's words), not a batch of tool_result blocks. */
function isUserTurnMessage(msg: Anthropic.MessageParam): boolean {
  if (msg.role !== "user") return false;
  if (typeof msg.content === "string") return true;
  return (
    Array.isArray(msg.content) &&
    msg.content.some((b) => isBlock(b) && b.type === "text")
  );
}

const IMAGE_STRIP_STUB =
  "[screenshot omitted from context to save tokens — re-run the tool if you need to see it again]";

/**
 * Drop base64 image blocks from tool_results that belong to PRIOR turns,
 * keeping only the current turn's images (everything after the last real user
 * message). Screenshots/read_asset images are ~100-400 KB of base64 each;
 * without this they sit in history, get persisted, and are re-sent on every
 * one of the loop's iterations and every subsequent turn — the main driver of
 * runaway input-token usage. The agent still sees images on the turn it
 * captured them; older ones become a short text stub it can refresh on demand.
 * Mutates in place (the live history array), so the pruned form is also what
 * gets persisted.
 */
export function pruneStaleImagesInPlace(messages: Anthropic.MessageParam[]): void {
  let lastUserTurn = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isUserTurnMessage(messages[i])) {
      lastUserTurn = i;
      break;
    }
  }
  if (lastUserTurn <= 0) return; // nothing before the current turn to prune

  for (let i = 0; i < lastUserTurn; i++) {
    const msg = messages[i];
    if (!Array.isArray(msg.content)) continue;
    let changed = false;
    const content = msg.content.map((block) => {
      if (!isBlock(block) || block.type !== "tool_result") return block;
      const tr = block as Anthropic.ToolResultBlockParam;
      if (!Array.isArray(tr.content)) return block;
      if (!tr.content.some((c) => isBlock(c) && c.type === "image")) return block;
      changed = true;
      const kept = tr.content.filter((c) => !(isBlock(c) && c.type === "image"));
      return {
        ...tr,
        content: kept.length > 0 ? kept : [{ type: "text", text: IMAGE_STRIP_STUB }],
      } as Anthropic.ToolResultBlockParam;
    });
    if (changed) messages[i] = { ...msg, content } as Anthropic.MessageParam;
  }
}
