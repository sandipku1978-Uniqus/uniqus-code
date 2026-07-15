import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const storageMocks = vi.hoisted(() => ({
  upload: vi.fn(),
  remove: vi.fn(),
  listAll: vi.fn(),
  download: vi.fn(),
}));

vi.mock("./client.js", () => storageMocks);

import { clearTracker, getTracker } from "./sync.js";

const projectId = "11111111-1111-4111-8111-111111111111";
let sandboxDir = "";

beforeEach(async () => {
  storageMocks.upload.mockReset();
  storageMocks.remove.mockReset();
  storageMocks.listAll.mockReset();
  storageMocks.download.mockReset();
  storageMocks.remove.mockResolvedValue(undefined);
  sandboxDir = await fs.mkdtemp(path.join(tmpdir(), "uniqus-sync-test-"));
});

afterEach(async () => {
  clearTracker(projectId);
  if (sandboxDir.startsWith(tmpdir())) {
    await fs.rm(sandboxDir, { recursive: true, force: true });
  }
});

describe("ProjectSync.syncChanges", () => {
  it("never persists credential-bearing project files", async () => {
    const tracker = getTracker(projectId, sandboxDir);
    await tracker.initialize();
    await fs.writeFile(path.join(sandboxDir, ".env.production"), "TOKEN=secret");
    await fs.writeFile(path.join(sandboxDir, "safe.txt"), "safe");

    await expect(tracker.syncChanges()).resolves.toBe(1);
    expect(storageMocks.upload).toHaveBeenCalledOnce();
    expect(storageMocks.upload).toHaveBeenCalledWith(projectId, "safe.txt", expect.any(Buffer));
  });

  it("finishes the walk, advances successful files, and reports upload failures", async () => {
    const tracker = getTracker(projectId, sandboxDir);
    await tracker.initialize();
    await fs.writeFile(path.join(sandboxDir, "good.txt"), "good");
    await fs.writeFile(path.join(sandboxDir, "bad.txt"), "bad");

    storageMocks.upload.mockImplementation(
      async (_project: string, relPath: string): Promise<void> => {
        if (relPath === "bad.txt") throw new Error("storage unavailable");
      },
    );

    await expect(tracker.syncChanges()).rejects.toThrow("syncChanges failed for 1 file");
    expect(storageMocks.upload).toHaveBeenCalledTimes(2);
    expect(storageMocks.upload.mock.calls.map((call) => call[1]).sort()).toEqual([
      "bad.txt",
      "good.txt",
    ]);

    storageMocks.upload.mockClear();
    storageMocks.upload.mockResolvedValue(undefined);
    await expect(tracker.syncChanges()).resolves.toBe(1);
    expect(storageMocks.upload).toHaveBeenCalledTimes(1);
    expect(storageMocks.upload).toHaveBeenCalledWith(
      projectId,
      "bad.txt",
      expect.any(Buffer),
    );
  });

  it("coalesces concurrent callers and follows up for files created mid-walk", async () => {
    const tracker = getTracker(projectId, sandboxDir);
    await tracker.initialize();
    await fs.writeFile(path.join(sandboxDir, "first.txt"), "first");

    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    storageMocks.upload
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseFirst = resolve;
            markFirstStarted();
          }),
      )
      .mockResolvedValue(undefined);

    const first = tracker.syncChanges();
    await firstStarted;
    await fs.writeFile(path.join(sandboxDir, "second.txt"), "second");
    const second = tracker.syncChanges();
    expect(second).toBe(first);
    releaseFirst();

    await expect(Promise.all([first, second])).resolves.toEqual([2, 2]);
    expect(storageMocks.upload.mock.calls.map((call) => call[1])).toEqual([
      "first.txt",
      "second.txt",
    ]);
  });

  it("removes command-deleted files from Storage and advances the manifest", async () => {
    const tracker = getTracker(projectId, sandboxDir);
    const deleted = path.join(sandboxDir, "obsolete.txt");
    await fs.writeFile(deleted, "remove me");
    await tracker.initialize();

    await fs.rm(deleted);
    await expect(tracker.syncChanges()).resolves.toBe(1);
    expect(storageMocks.remove).toHaveBeenCalledWith(projectId, ["obsolete.txt"]);

    storageMocks.remove.mockClear();
    await expect(tracker.syncChanges()).resolves.toBe(0);
    expect(storageMocks.remove).not.toHaveBeenCalled();
  });

  it("keeps a failed Storage deletion dirty for a later retry", async () => {
    const tracker = getTracker(projectId, sandboxDir);
    const deleted = path.join(sandboxDir, "retry-delete.txt");
    await fs.writeFile(deleted, "remove me");
    await tracker.initialize();
    await fs.rm(deleted);

    storageMocks.remove.mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(tracker.syncChanges()).rejects.toThrow("syncChanges failed for 1 file");

    storageMocks.remove.mockResolvedValue(undefined);
    await expect(tracker.syncChanges()).resolves.toBe(1);
    expect(storageMocks.remove).toHaveBeenCalledTimes(2);
  });
});
