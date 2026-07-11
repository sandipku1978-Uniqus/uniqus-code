import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pages: [] as Array<{ data: unknown[]; error: null | { message: string } }>,
  select: vi.fn(),
}));

vi.mock("./client.js", () => ({
  db: () => ({
    from: () => {
      const query: Record<string, unknown> = {
        select: mocks.select,
        eq: vi.fn(),
        order: vi.fn(),
        range: vi.fn(),
        gte: vi.fn(),
        then: (
          resolve: (value: { data: unknown[]; error: null | { message: string } }) => unknown,
          reject: (reason: unknown) => unknown,
        ) => Promise.resolve(mocks.pages.shift() ?? { data: [], error: null }).then(resolve, reject),
      };
      for (const method of ["select", "eq", "order", "range", "gte"] as const) {
        (query[method] as ReturnType<typeof vi.fn>).mockReturnValue(query);
      }
      return query;
    },
  }),
}));

import { getDailyUsageByModel, getUsageByProjectByModel } from "./usage.js";

beforeEach(() => {
  mocks.pages.length = 0;
  mocks.select.mockReset();
});

describe("usage breakdown sweeps", () => {
  it("uses snapshotted cost so non-token charges and historical prices survive", async () => {
    mocks.pages.push({
      data: [
        {
          model: "test-model",
          input_tokens: 0,
          output_tokens: 0,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
          cost_usd: 0.25,
          created_at: new Date().toISOString(),
        },
      ],
      error: null,
    });

    const rows = await getDailyUsageByModel("user-1", 30);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.cost_usd).toBe(0.25);
    expect(mocks.select).toHaveBeenCalledWith(expect.stringContaining("cost_usd"));
  });

  it("retains run identities so project totals can deduplicate multi-model runs", async () => {
    mocks.pages.push({
      data: [
        {
          run_id: "run-1",
          project_id: "project-1",
          provider: "anthropic",
          model: "model-a",
          input_tokens: 10,
          output_tokens: 1,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
          cost_usd: 0.1,
          created_at: "2026-07-11T00:00:00.000Z",
          projects: { name: "Project" },
        },
        {
          run_id: "run-1",
          project_id: "project-1",
          provider: "google",
          model: "model-b",
          input_tokens: 20,
          output_tokens: 2,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
          cost_usd: 0.2,
          created_at: "2026-07-11T00:00:01.000Z",
          projects: { name: "Project" },
        },
        {
          run_id: null,
          project_id: "project-1",
          provider: "anthropic",
          model: "model-a",
          input_tokens: 5,
          output_tokens: 1,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
          cost_usd: 0.05,
          created_at: "2026-07-11T00:00:02.000Z",
          projects: { name: "Project" },
        },
      ],
      error: null,
    });

    const rows = await getUsageByProjectByModel("user-1");

    expect(rows).toHaveLength(2);
    const modelA = rows.find((row) => row.model === "model-a");
    expect(modelA).toMatchObject({
      turns: 2,
      run_ids: ["run-1"],
      legacy_turns: 1,
    });
    expect(modelA?.cost_usd).toBeCloseTo(0.15);
    expect(rows.find((row) => row.model === "model-b")).toMatchObject({
      turns: 1,
      run_ids: ["run-1"],
      legacy_turns: 0,
      cost_usd: 0.2,
    });
  });
});
