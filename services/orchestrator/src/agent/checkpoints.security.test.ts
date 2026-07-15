import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { commitCheckpoint } from "./checkpoints.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => {
    // Checkpoint GC is intentionally fire-and-forget; on Windows git can retain
    // its cwd handle for a few milliseconds after the assertion completes.
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        await fs.rm(root, { recursive: true, force: true });
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EBUSY" || attempt === 19) throw error;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  }));
});

describe("checkpoint credential exclusions", () => {
  it("never commits sensitive project paths", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "gate15-checkpoint-security-"));
    roots.push(root);
    const projectId = "security-project";
    const sandbox = path.join(root, projectId);
    await fs.mkdir(sandbox, { recursive: true });
    await fs.writeFile(path.join(sandbox, "safe.txt"), "safe");
    await fs.writeFile(path.join(sandbox, ".npmrc"), "token=canary-secret");

    await expect(commitCheckpoint(sandbox, projectId, "security test")).resolves.toBeTruthy();
    const gitDir = path.join(root, `${projectId}.checkpoints`, ".git");
    const { stdout } = await execFileAsync(
      "git",
      ["--git-dir", gitDir, "ls-tree", "-r", "--name-only", "HEAD"],
      { cwd: sandbox },
    );
    expect(stdout).toContain("safe.txt");
    expect(stdout).not.toContain(".npmrc");
  });
});
