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

/**
 * True for an assistant message Anthropic would reject as empty content: an
 * empty content array or an empty/whitespace string. The OpenAI/Gemini adapters
 * can produce content:[] on a refusal / all-thinking / blocked turn (C-9). The
 * loop now guards new turns, but older sessions persisted before that fix still
 * carry the poison block; repairing it here lets those bricked sessions replay.
 */
function isEmptyAssistantContent(content: Anthropic.MessageParam["content"]): boolean {
  if (Array.isArray(content)) return content.length === 0;
  return typeof content === "string" && content.trim().length === 0;
}

const EMPTY_ASSISTANT_PLACEHOLDER: Anthropic.MessageParam["content"] = [
  { type: "text", text: "(no response)" },
];

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
      // Repair an empty-content assistant message (C-9). Anthropic 400s on a
      // non-final empty-content assistant turn, so one persisted by an older
      // session would brick every subsequent replay; substitute a placeholder.
      if (isEmptyAssistantContent(msg.content)) {
        out.push({ ...msg, content: EMPTY_ASSISTANT_PLACEHOLDER });
        pending = [];
        continue;
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

/**
 * Index of the last REAL user turn, or -1 if there is none. This is the boundary
 * between "the turn in progress" and everything before it — the same line that
 * decides which images survive (pruneStaleImagesInPlace, below) and which OpenAI
 * reasoning items are worth replaying (providers/openai.ts toResponsesInput).
 * Anything at an index ABOVE this belongs to the current turn.
 */
export function lastRealUserTurnIndex(messages: Anthropic.MessageParam[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isUserTurnMessage(messages[i])) return i;
  }
  return -1;
}

const IMAGE_STRIP_STUB =
  "[screenshot omitted from context to save tokens — re-run the tool if you need to see it again]";

/**
 * Return a shallow-cloned message with base64 image blocks removed only from
 * tool results. Text blocks are retained verbatim because they carry the
 * sandbox asset path used by transcript replay and future targeted reads.
 */
function withoutToolResultImages(
  message: Anthropic.MessageParam,
): Anthropic.MessageParam {
  if (!Array.isArray(message.content)) return message;
  let changed = false;
  const content = message.content.map((block) => {
    if (!isToolResultBlock(block) || !Array.isArray(block.content)) return block;
    if (!block.content.some((item) => isBlock(item) && item.type === "image")) {
      return block;
    }
    changed = true;
    const kept = block.content.filter(
      (item) => !(isBlock(item) && item.type === "image"),
    );
    return {
      ...block,
      content: kept.length > 0 ? kept : [{ type: "text", text: IMAGE_STRIP_STUB }],
    } as Anthropic.ToolResultBlockParam;
  });
  return changed
    ? ({ ...message, content } as Anthropic.MessageParam)
    : message;
}

/**
 * Build the DB representation after a live turn without mutating the model's
 * in-memory history. The active model keeps current screenshots for visual
 * reasoning; durable chat rows keep only replay-relevant text/path metadata.
 */
export function sanitizeMessagesForPersistence(
  messages: readonly Anthropic.MessageParam[],
): Anthropic.MessageParam[] {
  return messages.map(withoutToolResultImages);
}

/**
 * Drop base64 image blocks from tool_results that belong to PRIOR turns,
 * keeping only the current turn's images (everything after the last real user
 * message). Screenshots/read_asset images are ~100-400 KB of base64 each;
 * without this they are re-sent on every one of the loop's iterations and every
 * subsequent turn — the main driver of runaway input-token usage. The agent
 * still sees images on the turn it captured them; older ones become a short
 * text stub it can refresh on demand. DB persistence is sanitized separately by
 * sanitizeMessagesForPersistence so current-turn visual context stays intact.
 */
export function pruneStaleImagesInPlace(messages: Anthropic.MessageParam[]): void {
  const lastUserTurn = lastRealUserTurnIndex(messages);
  if (lastUserTurn <= 0) return; // nothing before the current turn to prune

  for (let i = 0; i < lastUserTurn; i++) {
    const msg = messages[i];
    const sanitized = withoutToolResultImages(msg);
    if (sanitized !== msg) messages[i] = sanitized;
  }
}
