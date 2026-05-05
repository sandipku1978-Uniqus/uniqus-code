import Anthropic from "@anthropic-ai/sdk";

/**
 * Context-window compaction (Plan §3.6).
 *
 * Long agent sessions accumulate huge tool_result blocks. Without
 * compaction the next turn either 400s on the Anthropic context limit or
 * — worse — silently degrades because the model's effective attention
 * thins out long before the hard cap. Plan §3.6 calls this "the single
 * highest-priority Phase 1.x item" because today the loop simply dies at
 * ~30 turns with no recovery besides a full reset.
 *
 * Strategy:
 *   1. Cheaply estimate token count of the current message array.
 *   2. If under threshold, no-op.
 *   3. Otherwise, walk backward to find the user-message boundary that
 *      preserves at least KEEP_TOKENS of recent context.
 *   4. Send the older portion to Haiku with a "summarize, preserve file
 *      paths and decisions verbatim" prompt.
 *   5. Splice the older portion out and replace it with a synthetic
 *      [user marker, assistant summary] pair so the kept user→assistant
 *      alternation stays well-formed for Anthropic.
 *
 * The thresholds intentionally compact well before the model's hard
 * limit — Haiku itself caps at 200k input, so the older portion has to
 * fit Haiku, and we want headroom on Opus too. Override via env if
 * tuning during dogfood:
 *   COMPACT_THRESHOLD_TOKENS  (default 150_000)
 *   COMPACT_KEEP_TOKENS       (default 80_000)
 */

const COMPACT_MODEL = "claude-haiku-4-5-20251001";

const COMPACT_THRESHOLD_TOKENS = numEnv("COMPACT_THRESHOLD_TOKENS", 150_000);
const COMPACT_KEEP_TOKENS = numEnv("COMPACT_KEEP_TOKENS", 80_000);
// Char-to-token rough estimate. Anthropic averages ~3.5 chars/token across
// English code+prose; we use 4 (slightly under-estimating tokens) so the
// threshold trips a bit early — preferable to tripping late and 400ing.
const CHARS_PER_TOKEN = 4;
const MAX_SUMMARY_TOKENS = 4096;

function numEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export interface CompactionResult {
  removedMessages: number;
  beforeTokens: number;
  afterTokens: number;
}

function isToolResultBlock(block: unknown): boolean {
  return (
    typeof block === "object" &&
    block !== null &&
    (block as { type?: string }).type === "tool_result"
  );
}

function blockChars(block: unknown): number {
  if (typeof block !== "object" || block === null) return 0;
  const b = block as {
    type?: string;
    text?: unknown;
    content?: unknown;
    input?: unknown;
    name?: unknown;
  };
  if (b.type === "text" && typeof b.text === "string") return b.text.length;
  if (b.type === "tool_use") {
    const name = typeof b.name === "string" ? b.name.length : 0;
    const input = typeof b.input === "string" ? b.input.length : JSON.stringify(b.input ?? "").length;
    return name + input;
  }
  if (b.type === "tool_result") {
    if (typeof b.content === "string") return b.content.length;
    if (Array.isArray(b.content)) {
      return b.content.reduce((acc: number, child: unknown) => acc + blockChars(child), 0);
    }
    return 0;
  }
  // image / document / other multimodal blocks: small constant for the
  // wrapper. The actual image bytes don't count against the text context.
  return 64;
}

function messageChars(msg: Anthropic.MessageParam): number {
  if (typeof msg.content === "string") return msg.content.length;
  if (!Array.isArray(msg.content)) return 0;
  return msg.content.reduce((acc, b) => acc + blockChars(b), 0);
}

function estimateTokens(messages: Anthropic.MessageParam[]): number {
  let total = 0;
  for (const m of messages) total += messageChars(m);
  return Math.ceil(total / CHARS_PER_TOKEN);
}

function isRealUserMessage(msg: Anthropic.MessageParam): boolean {
  if (msg.role !== "user") return false;
  if (typeof msg.content === "string") return true;
  if (!Array.isArray(msg.content)) return false;
  // Synthetic tool_result wrappers also have role=user; we don't want to
  // split inside an assistant→tool_result→assistant cluster, so only count
  // user messages whose content is NOT a pure tool_result block list.
  return !msg.content.some(isToolResultBlock);
}

/**
 * Find the index `i` such that messages[i..] preserves at least
 * `KEEP_TOKENS` worth of context AND messages[i] is a real user message
 * (so the kept portion starts at a clean turn boundary). Returns -1 when
 * no such split exists (e.g. the current single user turn is already
 * >150k tokens — there's nothing older to compact).
 */
function findSplitIndex(messages: Anthropic.MessageParam[]): number {
  let kept = 0;
  let candidate = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    kept += Math.ceil(messageChars(messages[i]) / CHARS_PER_TOKEN);
    if (isRealUserMessage(messages[i]) && kept >= COMPACT_KEEP_TOKENS) {
      candidate = i;
      break;
    }
  }
  // Must have something to actually compact — index 0 means everything is
  // already "kept" and there's no older portion to summarize.
  if (candidate <= 0) return -1;
  return candidate;
}

function renderMessageForSummary(msg: Anthropic.MessageParam, idx: number): string {
  const role = msg.role.toUpperCase();
  if (typeof msg.content === "string") {
    return `[${idx}] ${role}: ${truncate(msg.content, 4000)}`;
  }
  if (!Array.isArray(msg.content)) return `[${idx}] ${role}: <empty>`;
  const parts: string[] = [];
  for (const block of msg.content) {
    if (typeof block !== "object" || block === null) continue;
    const b = block as {
      type?: string;
      text?: unknown;
      name?: unknown;
      input?: unknown;
      tool_use_id?: unknown;
      content?: unknown;
      is_error?: unknown;
    };
    if (b.type === "text" && typeof b.text === "string") {
      parts.push(truncate(b.text, 2000));
    } else if (b.type === "tool_use") {
      const inputStr = typeof b.input === "string" ? b.input : JSON.stringify(b.input ?? {});
      parts.push(`<tool_use name=${String(b.name ?? "?")}>${truncate(inputStr, 800)}</tool_use>`);
    } else if (b.type === "tool_result") {
      const out =
        typeof b.content === "string"
          ? b.content
          : Array.isArray(b.content)
            ? b.content
                .map((c: unknown) =>
                  typeof c === "object" && c !== null && (c as { type?: string }).type === "text"
                    ? String((c as { text?: unknown }).text ?? "")
                    : "",
                )
                .join("")
            : "";
      const errFlag = b.is_error ? " is_error=true" : "";
      parts.push(`<tool_result${errFlag}>${truncate(out, 1500)}</tool_result>`);
    }
  }
  return `[${idx}] ${role}: ${parts.join(" ") || "<empty>"}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = Math.floor(max * 0.7);
  const tail = max - head - 16;
  return `${s.slice(0, head)}\n…[${s.length - max} chars trimmed]…\n${s.slice(-tail)}`;
}

const SUMMARY_SYSTEM_PROMPT =
  "You are a context-compaction assistant for an AI software engineer's working session. " +
  "You are NOT the engineer. You produce a terse, structured summary of older conversation " +
  "turns that the engineer will read INSTEAD OF the original turns to keep working coherently.";

const SUMMARY_USER_PROMPT_PREFIX = `Summarize the following AI engineer conversation. The summary replaces these turns in the engineer's context, so it must preserve EVERYTHING the engineer might still need:

Required sections (use these literal headings):
## Goal
One-line restatement of what the user is building / asking for.

## Files touched
Bullet list of every file path that was created, edited, read, or referenced. Verbatim paths only — no paraphrasing. Mark created/modified with [created]/[edited]; mark inspected-only with [read].

## Key decisions
Bullet list of design / framework / library decisions made and why.

## Commands run
Bullet list of run_command and start_server invocations and their outcome (succeeded / failed with reason). Skip trivial reads.

## Open issues
Anything unresolved: failing tests, broken builds, errors the user surfaced, things the engineer paused on.

## User-stated preferences
Anything the user said about how they want the work done (style, scope, constraints).

Be terse. Do NOT add commentary, do NOT roleplay, do NOT add markdown beyond the headings above.

<conversation>
`;

const SUMMARY_USER_PROMPT_SUFFIX = "\n</conversation>";

async function summarizeOlderPortion(
  older: Anthropic.MessageParam[],
  apiKey: string,
  signal?: AbortSignal,
): Promise<string> {
  const transcript = older.map((m, i) => renderMessageForSummary(m, i)).join("\n\n");
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create(
    {
      model: COMPACT_MODEL,
      max_tokens: MAX_SUMMARY_TOKENS,
      system: SUMMARY_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: SUMMARY_USER_PROMPT_PREFIX + transcript + SUMMARY_USER_PROMPT_SUFFIX,
        },
      ],
    },
    signal ? { signal } : undefined,
  );
  const text = response.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
  if (!text) {
    throw new Error("compaction summarizer returned empty content");
  }
  return text;
}

/**
 * Compact `messages` in place if the estimated token count exceeds the
 * configured threshold. No-op otherwise. Returns null on no-op, or a
 * `CompactionResult` describing what was removed when compaction ran.
 *
 * The caller (the agent loop) should run this AFTER history normalization
 * but BEFORE the next Anthropic call, so the messages array sent to the
 * API is already shrunken and the same compact form is what gets persisted
 * for future iterations of THIS session. The DB still holds the full
 * unsummarized history, which is fine — next session loads + re-compacts.
 */
export async function maybeCompact(
  messages: Anthropic.MessageParam[],
  apiKey: string,
  signal?: AbortSignal,
): Promise<CompactionResult | null> {
  const beforeTokens = estimateTokens(messages);
  if (beforeTokens < COMPACT_THRESHOLD_TOKENS) return null;

  const splitIdx = findSplitIndex(messages);
  if (splitIdx <= 0) return null;

  const older = messages.slice(0, splitIdx);
  let summary: string;
  try {
    summary = await summarizeOlderPortion(older, apiKey, signal);
  } catch (err) {
    if (signal?.aborted) return null;
    // Don't crash the turn over a summarizer hiccup — the agent will hit
    // the API limit on its own next iteration if we genuinely can't
    // recover. Log and continue without compacting.
    console.error("compaction failed, continuing without compacting:", err);
    return null;
  }
  if (signal?.aborted) return null;

  const synthetic: Anthropic.MessageParam[] = [
    {
      role: "user",
      content:
        "[Earlier turns in this session have been summarized for context-window compaction. " +
        "The summary below is your only record of them — treat it as ground truth.]",
    },
    {
      role: "assistant",
      content: summary,
    },
  ];
  messages.splice(0, splitIdx, ...synthetic);
  const afterTokens = estimateTokens(messages);
  return { removedMessages: splitIdx, beforeTokens, afterTokens };
}
