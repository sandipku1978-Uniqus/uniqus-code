import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  getRunningVm: vi.fn(),
  manifest: vi.fn(),
  readFileBinary: vi.fn(),
  runCommand: vi.fn(),
}));

vi.mock("./fleet.js", () => ({ getRunningVm: mocks.getRunningVm }));
vi.mock("./agentRpc.js", () => ({
  manifest: mocks.manifest,
  readFileBinary: mocks.readFileBinary,
  runCommand: mocks.runCommand,
}));

import { pullVmChangesStrict } from "./pull.js";

let sandboxDir = "";
let sequence = 0;

beforeEach(async () => {
  sequence++;
  sandboxDir = await fs.mkdtemp(path.join(tmpdir(), "uniqus-pull-test-"));
  mocks.getRunningVm.mockReset();
  mocks.manifest.mockReset();
  mocks.readFileBinary.mockReset();
  mocks.runCommand.mockReset();
  mocks.getRunningVm.mockReturnValue({
    id: `vm-${sequence}`,
    projectId: `project-${sequence}`,
  });
  mocks.manifest.mockResolvedValue([]);
  mocks.readFileBinary.mockResolvedValue(Buffer.alloc(0));
  mocks.runCommand.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
});

afterEach(async () => {
  if (sandboxDir.startsWith(tmpdir())) {
    await fs.rm(sandboxDir, { recursive: true, force: true });
  }
});

describe("VM-to-host durable pulls", () => {
  it("does not mistake equal file size for equal content on the first pull", async () => {
    await fs.writeFile(path.join(sandboxDir, "same.txt"), "old");
    mocks.manifest.mockResolvedValue([{ path: "same.txt", size: 3, mtime_ms: 2 }]);
    mocks.readFileBinary.mockResolvedValue(Buffer.from("new"));

    const result = await pullVmChangesStrict(`project-${sequence}`, sandboxDir);

    expect(result?.pulled).toEqual(["same.txt"]);
    expect(await fs.readFile(path.join(sandboxDir, "same.txt"), "utf8")).toBe("new");
  });

  it("keeps capped files dirty and drains them through bounded strict follow-up passes", async () => {
    const entries = Array.from({ length: 801 }, (_, index) => ({
      path: `file-${String(index).padStart(3, "0")}.txt`,
      size: 1,
      mtime_ms: index + 1,
    }));
    mocks.manifest.mockResolvedValue(entries);
    mocks.readFileBinary.mockResolvedValue(Buffer.from("x"));

    const result = await pullVmChangesStrict(`project-${sequence}`, sandboxDir);
    expect(result?.deferred).toBe(0);
    expect(result?.pulled).toHaveLength(801);
    expect(mocks.readFileBinary).toHaveBeenCalledTimes(801);
    expect(mocks.manifest).toHaveBeenCalledTimes(2);
    expect(await fs.readFile(path.join(sandboxDir, "file-800.txt"), "utf8")).toBe("x");
  });

  it("accepts a normal host-and-VM mirrored edit made between pulls", async () => {
    const full = path.join(sandboxDir, "mirrored.txt");
    await fs.writeFile(full, "old");
    mocks.manifest.mockResolvedValue([{ path: "mirrored.txt", size: 3, mtime_ms: 1 }]);
    mocks.readFileBinary.mockResolvedValue(Buffer.from("old"));
    await pullVmChangesStrict(`project-${sequence}`, sandboxDir);

    await fs.writeFile(full, "new");
    mocks.manifest.mockResolvedValue([{ path: "mirrored.txt", size: 3, mtime_ms: 2 }]);
    mocks.readFileBinary.mockResolvedValue(Buffer.from("new"));

    await expect(
      pullVmChangesStrict(`project-${sequence}`, sandboxDir),
    ).resolves.toMatchObject({ skipped: 0, deferred: 0 });
    expect(await fs.readFile(full, "utf8")).toBe("new");
  });

  it("runs a fresh inventory pass for a caller that arrives mid-pull", async () => {
    mocks.manifest
      .mockResolvedValueOnce([{ path: "first.txt", size: 1, mtime_ms: 1 }])
      .mockResolvedValueOnce([
        { path: "first.txt", size: 1, mtime_ms: 1 },
        { path: "second.txt", size: 1, mtime_ms: 2 },
      ]);

    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    mocks.readFileBinary.mockImplementation(async (_vm, rel: string) => {
      if (rel === "first.txt" && mocks.readFileBinary.mock.calls.length === 1) {
        markFirstStarted();
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
      return Buffer.from(rel === "first.txt" ? "1" : "2");
    });

    const first = pullVmChangesStrict(`project-${sequence}`, sandboxDir);
    await firstStarted;
    const second = pullVmChangesStrict(`project-${sequence}`, sandboxDir);
    releaseFirst();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult?.pulled.sort()).toEqual(["first.txt", "second.txt"]);
    expect(secondResult?.pulled.sort()).toEqual(["first.txt", "second.txt"]);
    expect(mocks.manifest).toHaveBeenCalledTimes(2);
    expect(await fs.readFile(path.join(sandboxDir, "second.txt"), "utf8")).toBe("2");
  });

  it("removes VM-deleted paths from the host mirror", async () => {
    await fs.writeFile(path.join(sandboxDir, "obsolete.txt"), "old");
    mocks.manifest.mockResolvedValue([]);

    const result = await pullVmChangesStrict(`project-${sequence}`, sandboxDir);

    expect(result?.deleted).toEqual(["obsolete.txt"]);
    await expect(fs.stat(path.join(sandboxDir, "obsolete.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("never overwrites a host file changed after the pull baseline snapshot", async () => {
    const full = path.join(sandboxDir, "upload.txt");
    await fs.writeFile(full, "old");
    mocks.manifest.mockResolvedValue([{ path: "upload.txt", size: 3, mtime_ms: 9 }]);
    mocks.readFileBinary.mockImplementation(async () => {
      await fs.writeFile(full, "newer-host");
      const future = new Date(Date.now() + 5_000);
      await fs.utimes(full, future, future);
      return Buffer.from("vm!");
    });

    await expect(
      pullVmChangesStrict(`project-${sequence}`, sandboxDir),
    ).rejects.toThrow("VM pull incomplete");
    expect(await fs.readFile(full, "utf8")).toBe("newer-host");
  });
});
