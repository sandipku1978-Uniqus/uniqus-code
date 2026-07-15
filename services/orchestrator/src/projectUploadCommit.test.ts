import { describe, expect, it, vi } from "vitest";
import { commitProjectUpload, type ProjectUploadOperations } from "./projectUploadCommit.js";

function operations(fail?: "host" | "vm" | "storage" | "rollback-storage") {
  const calls: string[] = [];
  const action = (name: string) => vi.fn(async () => {
    calls.push(name);
    if (fail === name) throw new Error(`${name} failed`);
  });
  const ops: ProjectUploadOperations = {
    writeHost: action("host"),
    writeVm: action("vm"),
    syncStorage: action("storage"),
    removeStorage: action("rollback-storage"),
    removeVm: action("rollback-vm"),
    removeHost: action("rollback-host"),
  };
  return { calls, ops };
}

describe("commitProjectUpload", () => {
  it("commits host, VM, and Storage in order", async () => {
    const { calls, ops } = operations();
    await expect(commitProjectUpload(ops)).resolves.toEqual({ ok: true });
    expect(calls).toEqual(["host", "vm", "storage"]);
  });

  it.each([
    ["host", ["host", "rollback-host"]],
    ["vm", ["host", "vm", "rollback-vm", "rollback-host"]],
    ["storage", ["host", "vm", "storage", "rollback-storage", "rollback-vm", "rollback-host"]],
  ] as const)("rolls back every attempted copy after a %s failure", async (stage, expected) => {
    const { calls, ops } = operations(stage);
    const result = await commitProjectUpload(ops);
    expect(result).toMatchObject({ ok: false, failedStage: stage, rollbackComplete: true });
    expect(calls).toEqual(expected);
  });

  it("reports incomplete rollback instead of hiding residual state", async () => {
    const { ops } = operations("storage");
    ops.removeStorage = vi.fn(async () => {
      throw new Error("cleanup unavailable");
    });
    const result = await commitProjectUpload(ops);
    expect(result).toMatchObject({
      ok: false,
      failedStage: "storage",
      rollbackComplete: false,
      rollbackErrors: ["storage: cleanup unavailable"],
    });
  });
});
