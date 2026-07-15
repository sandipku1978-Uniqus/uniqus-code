import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { buildProjectZip } from "./export.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("project export credential boundary", () => {
  it("omits every sensitive path family from handoff archives", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "gate15-export-security-"));
    roots.push(root);
    await fs.mkdir(path.join(root, "certs"), { recursive: true });
    await fs.writeFile(path.join(root, "index.ts"), "export {};");
    await fs.writeFile(path.join(root, ".env.production"), "TOKEN=canary");
    await fs.writeFile(path.join(root, "certs", "client.pem"), "canary-key");

    const zip = new AdmZip(await buildProjectZip(root));
    expect(zip.getEntries().map((entry) => entry.entryName)).toEqual(["index.ts"]);
  });
});
