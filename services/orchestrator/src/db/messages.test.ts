import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock } = vi.hoisted(() => ({ dbMock: vi.fn() }));

vi.mock("./client.js", () => ({ db: dbMock }));

import { compactionSnapshotIdentity } from "../agent/compact.js";
import {
  chunkMessagesForInsert,
  createCompactedHistorySnapshot,
  loadHistory,
  loadModelHistory,
  latestMessageId,
  mergeCompactedHistory,
  parseCompactedHistorySnapshot,
} from "./messages.js";

interface TestRow {
  id: number;
  role: "user" | "assistant";
  content: string;
}

function installPagedReadMock(
  rows: TestRow[],
  snapshot?: { compacted_history: unknown; compacted_through_message_id: number },
): Array<number | null> {
  const pageCursors: Array<number | null> = [];
  dbMock.mockImplementation(() => ({
    from(table: string) {
      if (table === "chat_sessions") {
        const builder: Record<string, unknown> = {};
        builder.select = () => builder;
        builder.eq = () => builder;
        builder.maybeSingle = async () => ({ data: snapshot ?? null, error: null });
        return builder;
      }
      if (table !== "messages") throw new Error(`Unexpected table: ${table}`);

      let afterId: number | null = null;
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.gt = (_column: string, value: number) => {
        afterId = value;
        return builder;
      };
      builder.order = () => builder;
      builder.limit = async (limit: number) => {
        pageCursors.push(afterId);
        return {
          data: rows.filter((row) => afterId === null || row.id > afterId).slice(0, limit),
          error: null,
        };
      };
      return builder;
    },
  }));
  return pageCursors;
}

function messageRows(firstId: number, count: number): TestRow[] {
  return Array.from({ length: count }, (_, index) => {
    const id = firstId + index;
    return {
      id,
      role: id % 2 === 1 ? "user" : "assistant",
      content: `message-${id}`,
    };
  });
}

beforeEach(() => {
  dbMock.mockReset();
});

describe("message cursor lookup", () => {
  it("returns the latest persisted id for manual compaction snapshots", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: 42 }, error: null });
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.order = () => builder;
    builder.limit = () => builder;
    builder.maybeSingle = maybeSingle;
    dbMock.mockReturnValue({ from: () => builder });

    await expect(latestMessageId("project-1", "session-1")).resolves.toBe(42);
    expect(maybeSingle).toHaveBeenCalledOnce();
  });
});

describe("batched message persistence", () => {
  it("preserves order while bounding rows and approximate payload bytes", () => {
    const messages = ["aa", "bb", "cc", "dd", "ee"].map(
      (content) => ({ role: "user" as const, content }),
    );
    const chunks = chunkMessagesForInsert(messages, 2, 10_000);
    expect(chunks.map((chunk) => chunk.length)).toEqual([2, 2, 1]);
    expect(chunks.flat()).toEqual(messages);

    const byteChunks = chunkMessagesForInsert(messages, 50, 65);
    expect(byteChunks.length).toBeGreaterThan(1);
    expect(byteChunks.flat()).toEqual(messages);
  });

  it("keeps an oversized single message as an explicit one-row batch", () => {
    const message = { role: "assistant" as const, content: "x".repeat(100) };
    expect(chunkMessagesForInsert([message], 50, 1)).toEqual([[message]]);
  });

  it("never splits an assistant tool_use from its following tool_result", () => {
    const toolUse = {
      role: "assistant" as const,
      content: [{ type: "tool_use" as const, id: "call-1", name: "read_file", input: {} }],
    };
    const toolResult = {
      role: "user" as const,
      content: [{ type: "tool_result" as const, tool_use_id: "call-1", content: "ok" }],
    };
    const chunks = chunkMessagesForInsert(
      [{ role: "user", content: "start" }, toolUse, toolResult, { role: "assistant", content: "done" }],
      2,
      1,
    );
    expect(chunks).toEqual([
      [{ role: "user", content: "start" }],
      [toolUse, toolResult],
      [{ role: "assistant", content: "done" }],
    ]);
  });
});

describe("compacted model-history snapshots", () => {
  it("round-trips a versioned, normalized snapshot", () => {
    const createdAt = new Date("2026-07-11T12:00:00.000Z");
    const snapshot = createCompactedHistorySnapshot(
      [
        { role: "user", content: "old request" },
        { role: "assistant", content: "old answer" },
      ],
      createdAt,
    );

    expect(snapshot).not.toBeNull();
    expect(parseCompactedHistorySnapshot(snapshot, createdAt)).toEqual({
      version: 2,
      ...compactionSnapshotIdentity(),
      messages: [
        { role: "user", content: "old request" },
        { role: "assistant", content: "old answer" },
      ],
      created_at: createdAt.toISOString(),
    });
  });

  it("rejects unknown versions and malformed model messages", () => {
    expect(parseCompactedHistorySnapshot({ version: 2, messages: [], created_at: "" })).toBeNull();
    expect(
      parseCompactedHistorySnapshot({ version: 1, messages: [{ role: "system", content: "x" }] }),
    ).toBeNull();
    expect(parseCompactedHistorySnapshot({ version: 1, messages: [null] })).toBeNull();
  });

  it("invalidates stale snapshots and summaries from another recipe/model", () => {
    const createdAt = new Date("2026-07-11T12:00:00.000Z");
    const snapshot = createCompactedHistorySnapshot(
      [{ role: "user", content: "old request" }],
      createdAt,
    )!;
    expect(
      parseCompactedHistorySnapshot(snapshot, new Date("2026-07-19T12:00:00.000Z")),
    ).toBeNull();
    expect(
      parseCompactedHistorySnapshot(
        { ...snapshot, strategy: "different-recipe" },
        createdAt,
      ),
    ).toBeNull();
    expect(
      parseCompactedHistorySnapshot({ ...snapshot, model: "different-model" }, createdAt),
    ).toBeNull();
  });

  it("merges only the post-cursor tail and repairs tool exchange boundaries", () => {
    const snapshot = createCompactedHistorySnapshot([
      { role: "user", content: "summarized prefix" },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "call-1", name: "read_file", input: { path: "a.ts" } }],
      },
    ]);
    expect(snapshot).not.toBeNull();

    const merged = mergeCompactedHistory(snapshot!, [
      { role: "user", content: "tail request" },
      { role: "assistant", content: "tail answer" },
    ]);
    expect(merged).toHaveLength(5);
    expect(merged[2]).toMatchObject({ role: "user" });
    expect(JSON.stringify(merged[2])).toContain("no result recorded");
    expect(merged.slice(-2)).toEqual([
      { role: "user", content: "tail request" },
      { role: "assistant", content: "tail answer" },
    ]);
  });

  it("refuses snapshots above the hard storage cap", () => {
    const snapshot = createCompactedHistorySnapshot([
      { role: "user", content: "x".repeat(2 * 1024 * 1024 + 1) },
    ]);
    expect(snapshot).toBeNull();
  });
});

describe("paged message history reads", () => {
  it("loads a full transcript beyond PostgREST's default row cap in id order", async () => {
    const rows = messageRows(1, 2_005);
    const cursors = installPagedReadMock(rows);

    const history = await loadHistory("project-1", "session-1");

    expect(history).toHaveLength(2_005);
    expect(history[0]).toEqual({ role: "user", content: "message-1" });
    expect(history.at(-1)).toEqual({ role: "user", content: "message-2005" });
    expect(cursors).toEqual([null, 1_000, 2_000]);
  });

  it("keyset-pages every post-snapshot tail row without replaying the prefix", async () => {
    const through = 42;
    const rows = messageRows(through + 1, 2_005);
    const compacted = createCompactedHistorySnapshot([
      { role: "assistant", content: "compacted-prefix" },
    ]);
    expect(compacted).not.toBeNull();
    const cursors = installPagedReadMock(rows, {
      compacted_history: compacted,
      compacted_through_message_id: through,
    });

    const history = await loadModelHistory("project-1", "session-1");

    expect(history).toHaveLength(2_006);
    expect(history[0]).toEqual({ role: "assistant", content: "compacted-prefix" });
    expect(history[1]).toEqual({ role: "user", content: "message-43" });
    expect(history.at(-1)).toEqual({ role: "user", content: "message-2047" });
    expect(cursors).toEqual([42, 1_042, 2_042]);
  });
});
