import type Anthropic from "@anthropic-ai/sdk";
import { normalizeMessageHistory } from "../agent/messageHistory.js";
import {
  compactionSnapshotIdentity,
  type CompactionSnapshotIdentity,
} from "../agent/compact.js";
import { db } from "./client.js";

interface Row {
  id: number;
  role: "user" | "assistant";
  content: Anthropic.MessageParam["content"];
}

export interface CompactedHistorySnapshot {
  version: 2;
  strategy: string;
  model: string;
  messages: Anthropic.MessageParam[];
  created_at: string;
}

const COMPACTION_SNAPSHOT_VERSION = 2;
const MAX_COMPACTION_SNAPSHOT_BYTES = 2 * 1024 * 1024;
const DEFAULT_COMPACTION_SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60_000;
const MAX_MESSAGE_BATCH_ROWS = 50;
const MAX_MESSAGE_BATCH_BYTES = 1024 * 1024;
// Stay at or below PostgREST's common default row cap, then keyset-page by id.
// A single unbounded select silently stops around 1,000 rows on hosted
// Supabase projects, which used to drop the oldest/remaining conversation
// history depending on the query shape.
const MESSAGE_READ_PAGE_ROWS = 1_000;

function isMissingCompactionColumns(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "PGRST204") return true;
  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("compacted_history") ||
    message.includes("compacted_through_message_id") ||
    (message.includes("column") && message.includes("does not exist"))
  );
}

function isMessageParam(value: unknown): value is Anthropic.MessageParam {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { role?: unknown; content?: unknown };
  return (
    (candidate.role === "user" || candidate.role === "assistant") &&
    (typeof candidate.content === "string" || Array.isArray(candidate.content))
  );
}

function compactionSnapshotTtlMs(): number {
  const configured = Number(process.env.COMPACT_SNAPSHOT_TTL_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_COMPACTION_SNAPSHOT_TTL_MS;
}

export function parseCompactedHistorySnapshot(
  value: unknown,
  now = new Date(),
  expectedIdentity = compactionSnapshotIdentity(),
): CompactedHistorySnapshot | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CompactedHistorySnapshot>;
  if (
    candidate.version !== COMPACTION_SNAPSHOT_VERSION ||
    candidate.strategy !== expectedIdentity.strategy ||
    candidate.model !== expectedIdentity.model ||
    !Array.isArray(candidate.messages) ||
    !candidate.messages.every(isMessageParam)
  ) {
    return null;
  }
  const createdAt = typeof candidate.created_at === "string" ? candidate.created_at : "";
  const createdAtMs = Date.parse(createdAt);
  if (!Number.isFinite(createdAtMs) || now.getTime() - createdAtMs > compactionSnapshotTtlMs()) {
    return null;
  }
  return {
    version: COMPACTION_SNAPSHOT_VERSION,
    strategy: expectedIdentity.strategy,
    model: expectedIdentity.model,
    messages: candidate.messages,
    created_at: createdAt,
  };
}

export function createCompactedHistorySnapshot(
  messages: Anthropic.MessageParam[],
  createdAt = new Date(),
  identity = compactionSnapshotIdentity(),
): CompactedHistorySnapshot | null {
  const snapshot: CompactedHistorySnapshot = {
    version: COMPACTION_SNAPSHOT_VERSION,
    strategy: identity.strategy,
    model: identity.model,
    messages: normalizeMessageHistory(messages),
    created_at: createdAt.toISOString(),
  };
  return Buffer.byteLength(JSON.stringify(snapshot), "utf8") <= MAX_COMPACTION_SNAPSHOT_BYTES
    ? snapshot
    : null;
}

export function mergeCompactedHistory(
  snapshot: CompactedHistorySnapshot,
  tail: Anthropic.MessageParam[],
): Anthropic.MessageParam[] {
  return normalizeMessageHistory([...snapshot.messages, ...tail]);
}

async function loadMessageRows(
  projectId: string,
  sessionId: string,
  afterId: number | null,
  errorPrefix: string,
): Promise<Row[]> {
  const rows: Row[] = [];
  let cursor = afterId;

  for (;;) {
    let query = db()
      .from("messages")
      .select("id, role, content")
      .eq("project_id", projectId)
      .eq("session_id", sessionId);
    if (cursor !== null) query = query.gt("id", cursor);

    const { data, error } = await query
      .order("id", { ascending: true })
      .limit(MESSAGE_READ_PAGE_ROWS);
    if (error) throw new Error(`${errorPrefix}: ${error.message}`);

    const page = (data ?? []) as Row[];
    if (page.length === 0) break;
    const lastId = Number(page[page.length - 1]?.id);
    if (!Number.isSafeInteger(lastId) || (cursor !== null && lastId <= cursor)) {
      throw new Error(`${errorPrefix}: message ids were not monotonically increasing`);
    }
    rows.push(...page);
    cursor = lastId;
    if (page.length < MESSAGE_READ_PAGE_ROWS) break;
  }

  return rows;
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
  const rows = await loadMessageRows(projectId, sessionId, null, "loadHistory failed");
  const raw = rows.map((r) => ({
    role: r.role,
    content: r.content,
  } as Anthropic.MessageParam));
  return normalizeMessageHistory(raw);
}

/**
 * Load the compact model-facing history while leaving {@link loadHistory}
 * unchanged for full transcript replay in the UI. Raw messages remain in the
 * database; a snapshot only replaces the already-summarized prefix for model
 * inference and appends every message written after its cursor.
 */
export async function loadModelHistory(
  projectId: string,
  sessionId: string,
): Promise<Anthropic.MessageParam[]> {
  const snapshotQuery = await db()
    .from("chat_sessions")
    .select("compacted_history, compacted_through_message_id")
    .eq("project_id", projectId)
    .eq("id", sessionId)
    .maybeSingle();

  if (snapshotQuery.error) {
    if (isMissingCompactionColumns(snapshotQuery.error)) return await loadHistory(projectId, sessionId);
    throw new Error(`loadModelHistory snapshot failed: ${snapshotQuery.error.message}`);
  }

  const row = snapshotQuery.data as {
    compacted_history?: unknown;
    compacted_through_message_id?: number | null;
  } | null;
  const snapshot = parseCompactedHistorySnapshot(row?.compacted_history);
  const through = Number(row?.compacted_through_message_id ?? 0);
  if (!snapshot || !Number.isSafeInteger(through) || through <= 0) {
    return await loadHistory(projectId, sessionId);
  }

  const tailRows = await loadMessageRows(
    projectId,
    sessionId,
    through,
    "loadModelHistory tail failed",
  );
  const tail = tailRows.map(
    (message) => ({ role: message.role, content: message.content }) as Anthropic.MessageParam,
  );
  return mergeCompactedHistory(snapshot, tail);
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
 * Bound persistence payloads while retaining most of the roundtrip reduction.
 * An unusually large single message remains its own chunk rather than being
 * dropped; the database/API can then return the authoritative size error.
 */
export function chunkMessagesForInsert(
  messages: readonly Anthropic.MessageParam[],
  maxRows = MAX_MESSAGE_BATCH_ROWS,
  maxBytes = MAX_MESSAGE_BATCH_BYTES,
): Anthropic.MessageParam[][] {
  const rowLimit = Math.max(1, Math.floor(maxRows));
  const byteLimit = Math.max(1, Math.floor(maxBytes));
  const chunks: Anthropic.MessageParam[][] = [];
  let current: Anthropic.MessageParam[] = [];
  let currentBytes = 0;
  const endsWithPendingToolUse = (): boolean => {
    const last = current[current.length - 1];
    return !!(
      last?.role === "assistant" &&
      Array.isArray(last.content) &&
      last.content.some(
        (block) =>
          typeof block === "object" &&
          block !== null &&
          (block as { type?: unknown }).type === "tool_use",
      )
    );
  };
  for (const message of messages) {
    const bytes = Buffer.byteLength(JSON.stringify(message), "utf8");
    if (
      current.length > 0 &&
      !endsWithPendingToolUse() &&
      (current.length >= rowLimit || currentBytes + bytes > byteLimit)
    ) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(message);
    currentBytes += bytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Insert one turn in bounded batches and return its greatest persisted id. */
export async function appendMessages(
  projectId: string,
  sessionId: string,
  messages: Anthropic.MessageParam[],
): Promise<number | null> {
  if (messages.length === 0) return null;
  let lastId: number | null = null;
  for (const batch of chunkMessagesForInsert(messages)) {
    const rows = batch.map((message) => ({
      project_id: projectId,
      session_id: sessionId,
      role: message.role,
      content: message.content,
    }));
    const { data, error } = await db().from("messages").insert(rows).select("id");
    if (error) throw new Error(`appendMessages failed: ${error.message}`);
    const persistedIds: number[] = [];
    for (const row of data ?? []) {
      const id = Number((row as { id?: unknown }).id);
      if (Number.isSafeInteger(id)) persistedIds.push(id);
    }
    if (persistedIds.length !== batch.length || new Set(persistedIds).size !== batch.length) {
      throw new Error(
        `appendMessages failed: expected ${batch.length} returned ids, received ${persistedIds.length}`,
      );
    }
    for (const id of persistedIds) {
      if (lastId === null || id > lastId) lastId = id;
    }
  }
  return lastId;
}

/** Persist a compacted model prefix without deleting the raw transcript. */
export async function saveCompactedHistory(
  projectId: string,
  sessionId: string,
  messages: Anthropic.MessageParam[],
  throughMessageId: number,
  identity?: CompactionSnapshotIdentity,
): Promise<boolean> {
  if (!Number.isSafeInteger(throughMessageId) || throughMessageId <= 0) return false;
  const snapshot = createCompactedHistorySnapshot(messages, new Date(), identity);
  if (!snapshot) {
    console.warn("saveCompactedHistory skipped: compacted prefix exceeded 2 MiB hard cap");
    return false;
  }
  const { error } = await db()
    .from("chat_sessions")
    .update({
      compacted_history: snapshot,
      compacted_through_message_id: throughMessageId,
    })
    .eq("project_id", projectId)
    .eq("id", sessionId);
  if (error) {
    if (isMissingCompactionColumns(error)) {
      console.warn("saveCompactedHistory skipped: compaction columns are not migrated yet");
      return false;
    }
    throw new Error(`saveCompactedHistory failed: ${error.message}`);
  }
  return true;
}

/** Invalidate only the lossy model snapshot; the full raw transcript remains. */
export async function invalidateCompactedHistory(
  projectId: string,
  sessionId: string,
): Promise<boolean> {
  const { error } = await db()
    .from("chat_sessions")
    .update({ compacted_history: null, compacted_through_message_id: null })
    .eq("project_id", projectId)
    .eq("id", sessionId);
  if (error) {
    if (isMissingCompactionColumns(error)) return false;
    throw new Error(`invalidateCompactedHistory failed: ${error.message}`);
  }
  return true;
}

/**
 * Wipe the history of one chat session. Doesn't delete the session row
 * itself — the dropdown still shows it (now empty). Use `deleteSession`
 * from chatSessions.ts for full removal.
 */
export async function clearHistory(projectId: string, sessionId: string): Promise<void> {
  // Invalidate the model-facing snapshot first. If raw deletion then fails, a
  // retry sees the still-intact raw transcript; the inverse order could leave
  // an empty UI transcript while resurrecting stale compacted context.
  const cleared = await db()
    .from("chat_sessions")
    .update({ compacted_history: null, compacted_through_message_id: null })
    .eq("project_id", projectId)
    .eq("id", sessionId);
  if (cleared.error && !isMissingCompactionColumns(cleared.error)) {
    throw new Error(`clearHistory compaction reset failed: ${cleared.error.message}`);
  }
  const { error } = await db()
    .from("messages")
    .delete()
    .eq("project_id", projectId)
    .eq("session_id", sessionId);
  if (error) throw new Error(`clearHistory failed: ${error.message}`);
}
