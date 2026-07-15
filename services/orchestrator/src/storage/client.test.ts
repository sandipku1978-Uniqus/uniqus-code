import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  listBuckets: vi.fn(),
  createBucket: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    storage: {
      listBuckets: mocks.listBuckets,
      createBucket: mocks.createBucket,
      from: () => ({ list: mocks.list }),
    },
  }),
}));

import { ensureBucket, listAll } from "./client.js";

beforeEach(() => {
  mocks.list.mockReset();
  mocks.listBuckets.mockReset();
  mocks.createBucket.mockReset();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
});

describe("storage ensureBucket", () => {
  it("accepts an existing explicitly private bucket", async () => {
    mocks.listBuckets.mockResolvedValue({
      data: [{ name: "project_files", public: false }],
      error: null,
    });
    await expect(ensureBucket()).resolves.toBeUndefined();
    expect(mocks.createBucket).not.toHaveBeenCalled();
  });

  it("fails closed when an existing project bucket is public", async () => {
    mocks.listBuckets.mockResolvedValue({
      data: [{ name: "project_files", public: true }],
      error: null,
    });
    await expect(ensureBucket()).rejects.toThrow("must be private");
  });

  it("creates a missing bucket as private", async () => {
    mocks.listBuckets.mockResolvedValue({ data: [], error: null });
    mocks.createBucket.mockResolvedValue({ error: null });
    await ensureBucket();
    expect(mocks.createBucket).toHaveBeenCalledWith("project_files", { public: false });
  });

  it("rechecks privacy when another process creates the bucket concurrently", async () => {
    mocks.listBuckets
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [{ name: "project_files", public: true }], error: null });
    mocks.createBucket.mockResolvedValue({ error: { message: "Bucket already exists" } });

    await expect(ensureBucket()).rejects.toThrow("must exist and be private");
    expect(mocks.listBuckets).toHaveBeenCalledTimes(2);
  });
});

describe("storage listAll", () => {
  it("paginates every directory instead of truncating at 1,000 siblings", async () => {
    const firstPage = Array.from({ length: 1000 }, (_, i) => ({
      id: `file-${i}`,
      name: `file-${String(i).padStart(4, "0")}.txt`,
    }));
    mocks.list.mockImplementation(async (prefix: string, options: { offset?: number }) => {
      if (prefix === "project" && options.offset === 0) {
        return { data: firstPage, error: null };
      }
      if (prefix === "project" && options.offset === 1000) {
        return { data: [{ id: "file-1000", name: "file-1000.txt" }], error: null };
      }
      return { data: [], error: null };
    });

    const files = await listAll("project");

    expect(files).toHaveLength(1001);
    expect(files.at(-1)).toBe("file-1000.txt");
    expect(mocks.list).toHaveBeenNthCalledWith(
      2,
      "project",
      expect.objectContaining({ limit: 1000, offset: 1000 }),
    );
  });

  it("paginates nested prefixes and decodes stored path segments", async () => {
    const nestedFirstPage = Array.from({ length: 1000 }, (_, i) => ({
      id: `nested-${i}`,
      name: `part-${String(i).padStart(4, "0")}.txt`,
    }));
    mocks.list.mockImplementation(async (prefix: string, options: { offset?: number }) => {
      if (prefix === "project") {
        return options.offset === 0
          ? { data: [{ id: null, name: "app" }], error: null }
          : { data: [], error: null };
      }
      if (prefix === "project/app") {
        return options.offset === 0
          ? { data: nestedFirstPage, error: null }
          : { data: [{ id: "dynamic", name: "%5Bslug%5D.tsx" }], error: null };
      }
      return { data: [], error: null };
    });

    const files = await listAll("project");

    expect(files).toHaveLength(1001);
    expect(files).toContain("app/[slug].tsx");
    expect(mocks.list).toHaveBeenCalledWith(
      "project/app",
      expect.objectContaining({ offset: 1000 }),
    );
  });
});
