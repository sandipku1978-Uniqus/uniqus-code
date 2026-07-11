import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  events: [] as string[],
  snapshotError: null as { message: string } | null,
  deleteError: null as { message: string } | null,
}));

vi.mock("./client.js", () => ({ db: () => ({ from: mocks.from }) }));

import { clearHistory } from "./messages.js";

function eqChain(event: string, result: () => unknown) {
  return {
    eq: vi.fn(() => ({
      eq: vi.fn(async () => {
        mocks.events.push(event);
        return result();
      }),
    })),
  };
}

beforeEach(() => {
  mocks.events.length = 0;
  mocks.snapshotError = null;
  mocks.deleteError = null;
  mocks.from.mockReset();
  mocks.from.mockImplementation((table: string) => {
    if (table === "chat_sessions") {
      return {
        update: vi.fn(() =>
          eqChain("snapshot-cleared", () => ({ error: mocks.snapshotError })),
        ),
      };
    }
    if (table === "messages") {
      return {
        delete: vi.fn(() =>
          eqChain("raw-deleted", () => ({ error: mocks.deleteError })),
        ),
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
});

describe("clearHistory persistence ordering", () => {
  it("invalidates compacted context before deleting the raw transcript", async () => {
    await expect(clearHistory("project", "session")).resolves.toBeUndefined();
    expect(mocks.events).toEqual(["snapshot-cleared", "raw-deleted"]);
  });

  it("does not delete raw history when snapshot invalidation fails", async () => {
    mocks.snapshotError = { message: "database unavailable" };
    await expect(clearHistory("project", "session")).rejects.toThrow(
      "clearHistory compaction reset failed",
    );
    expect(mocks.events).toEqual(["snapshot-cleared"]);
  });

  it("leaves the already-cleared snapshot safe when raw deletion fails", async () => {
    mocks.deleteError = { message: "delete failed" };
    await expect(clearHistory("project", "session")).rejects.toThrow("clearHistory failed");
    expect(mocks.events).toEqual(["snapshot-cleared", "raw-deleted"]);
  });
});
