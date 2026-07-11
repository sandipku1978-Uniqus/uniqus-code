import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  select: vi.fn(),
}));

vi.mock("./client.js", () => ({
  db: () => ({
    from: () => ({
      insert: mocks.insert,
    }),
  }),
}));

import { appendMessages } from "./messages.js";

beforeEach(() => {
  mocks.insert.mockReset();
  mocks.select.mockReset();
  mocks.insert.mockImplementation(() => ({ select: mocks.select }));
});

describe("appendMessages cursor integrity", () => {
  it("rejects an incomplete returned-id set instead of saving an unsafe cursor", async () => {
    mocks.select.mockResolvedValue({ data: [{ id: 10 }], error: null });
    await expect(
      appendMessages("project", "session", [
        { role: "user", content: "one" },
        { role: "assistant", content: "two" },
      ]),
    ).rejects.toThrow("expected 2 returned ids, received 1");
  });

  it("returns the greatest id across bounded batches", async () => {
    const messages = Array.from({ length: 51 }, (_, index) => ({
      role: (index % 2 ? "assistant" : "user") as "assistant" | "user",
      content: `message-${index}`,
    }));
    mocks.select
      .mockResolvedValueOnce({
        data: Array.from({ length: 50 }, (_, index) => ({ id: index + 1 })),
        error: null,
      })
      .mockResolvedValueOnce({ data: [{ id: 99 }], error: null });
    await expect(appendMessages("project", "session", messages)).resolves.toBe(99);
    expect(mocks.select).toHaveBeenCalledTimes(2);
  });
});
