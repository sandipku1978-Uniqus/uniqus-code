import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeTool } from "./loop.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("model-facing sensitive file policy", () => {
  it("allows creating and editing app env files while continuing to block reads", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "uniqus-env-write-"));
    roots.push(rootDir);
    const sandbox = { rootDir };

    await executeTool(
      sandbox,
      "write_file",
      { path: ".env.local", content: "PUBLIC_SETTING=first\n" },
      "write-1",
      null,
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      null,
    );
    await executeTool(
      sandbox,
      "edit_file",
      { path: ".env.local", old_string: "first", new_string: "second" },
      "edit-1",
      null,
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      null,
    );

    await expect(readFile(path.join(rootDir, ".env.local"), "utf8")).resolves.toBe(
      "PUBLIC_SETTING=second\n",
    );
    await expect(
      executeTool(
        sandbox,
        "read_file",
        { path: ".env.local" },
        "read-1",
        null,
        null,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        null,
      ),
    ).rejects.toThrow(/secret-bearing project paths/);
  });
});
