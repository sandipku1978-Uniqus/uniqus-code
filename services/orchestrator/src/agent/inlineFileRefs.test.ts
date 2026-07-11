import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inlineFileRefs, type InlineFileRefOptions } from "./inlineFileRefs.js";

const tempDirs: string[] = [];

async function makeSandbox(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "uniqus-inline-refs-"));
  tempDirs.push(root);
  await Promise.all(
    Object.entries(files).map(async ([name, content]) => {
      const full = path.join(root, name);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content, "utf8");
    }),
  );
  return root;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("inlineFileRefs", () => {
  it("reads independent refs with bounded concurrency but renders original order", async () => {
    const files = Object.fromEntries(
      Array.from({ length: 8 }, (_, index) => [`file-${index}.txt`, `content-${index}`]),
    );
    const root = await makeSandbox(files);
    let active = 0;
    let maxActive = 0;
    const resolvePath: InlineFileRefOptions["resolvePath"] = async (rootDir, ref) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      // Finish in a deliberately different order from the input.
      await new Promise((resolve) => setTimeout(resolve, (8 - Number(ref.match(/\d+/)?.[0])) * 2));
      active -= 1;
      return await fs.realpath(path.join(rootDir, ref));
    };

    const rendered = await inlineFileRefs("inspect", Object.keys(files), root, {
      resolvePath,
      concurrency: 4,
    });

    expect(maxActive).toBe(4);
    const positions = Object.keys(files).map((name) => rendered.indexOf(`<file path="${name}">`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("uses a bounded UTF-8 prefix without emitting a split code point", async () => {
    const root = await makeSandbox({ "unicode.txt": "abc😀tail" });

    const rendered = await inlineFileRefs("inspect", ["unicode.txt"], root, {
      resolvePath: async (rootDir, ref) => await fs.realpath(path.join(rootDir, ref)),
      perFileByteLimit: 5,
    });

    expect(rendered).toContain("<file path=\"unicode.txt\">\nabc\n[... truncated ...]");
    expect(rendered).not.toContain("😀");
    expect(rendered).not.toContain("�");
  });

  it("applies the aggregate limit in bytes and stops after a partial earlier ref", async () => {
    const root = await makeSandbox({
      "first.txt": "abcd",
      "second.txt": "ééé",
      "third.txt": "later-content",
    });

    const rendered = await inlineFileRefs(
      "inspect",
      ["first.txt", "second.txt", "third.txt"],
      root,
      {
        resolvePath: async (rootDir, ref) => await fs.realpath(path.join(rootDir, ref)),
        perFileByteLimit: 100,
        totalByteLimit: 7,
      },
    );

    expect(rendered).toContain("<file path=\"first.txt\">\nabcd\n</file>");
    expect(rendered).toContain("<file path=\"second.txt\">\né\n[... truncated ...]");
    expect(rendered).not.toContain("third.txt");
    expect(rendered).not.toContain("�");
  });
});
