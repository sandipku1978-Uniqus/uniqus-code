import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("./client.js", () => ({
  db: () => ({ from: mocks.from }),
}));

import { recordUsageEvent } from "./usage.js";

const INPUT = {
  projectId: "22222222-2222-4222-8222-222222222222",
  userId: "33333333-3333-4333-8333-333333333333",
  runId: "11111111-1111-4111-8111-111111111111",
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  inputTokens: 100,
  outputTokens: 20,
  cacheReadTokens: 300,
  cacheCreationTokens: 10,
  costUsd: 0.0123,
  elapsedMs: 50,
};

beforeEach(() => {
  mocks.from.mockReset();
  mocks.insert.mockReset();
  mocks.from.mockReturnValue({ insert: mocks.insert });
});

describe("recordUsageEvent run correlation", () => {
  it("writes the top-level run id alongside the snapshotted cost", async () => {
    mocks.insert.mockResolvedValue({ error: null });
    await recordUsageEvent(INPUT);
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        run_id: INPUT.runId,
        cache_read_tokens: 300,
        cache_creation_tokens: 10,
        cost_usd: 0.0123,
      }),
    );
  });

  it("drops only run_id when that migration has not landed yet", async () => {
    mocks.insert
      .mockResolvedValueOnce({ error: { code: "PGRST204", message: "run_id missing" } })
      .mockResolvedValueOnce({ error: null });
    await recordUsageEvent(INPUT);
    expect(mocks.insert).toHaveBeenCalledTimes(2);
    expect(mocks.insert.mock.calls[1][0]).toMatchObject({
      cache_read_tokens: 300,
      cache_creation_tokens: 10,
      cost_usd: 0.0123,
    });
    expect(mocks.insert.mock.calls[1][0]).not.toHaveProperty("run_id");
  });

  it("writes NULL user attribution for a system-created project run", async () => {
    mocks.insert.mockResolvedValue({ error: null });
    await recordUsageEvent({ ...INPUT, userId: null });
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: INPUT.projectId,
        user_id: null,
        run_id: INPUT.runId,
      }),
    );
  });
});
