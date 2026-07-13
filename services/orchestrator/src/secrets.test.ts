import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { removeLegacyMaterializedSecret } from "./secrets.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("legacy materialized-secret cleanup", () => {
  it("retains connector-declared public Supabase config and removes privileged values", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "uniqus-secret-cleanup-"));
    roots.push(rootDir);
    const envPath = path.join(rootDir, ".env.local");
    await writeFile(
      envPath,
      "SUPABASE_URL=https://example.supabase.co\nSUPABASE_ANON_KEY=public\nSUPABASE_SERVICE_ROLE_KEY=private\n",
      "utf8",
    );

    await removeLegacyMaterializedSecret({
      sandbox: { rootDir },
      name: "SUPABASE_URL",
      preservePublicConfig: true,
    });
    await removeLegacyMaterializedSecret({
      sandbox: { rootDir },
      name: "SUPABASE_ANON_KEY",
      preservePublicConfig: true,
    });
    await removeLegacyMaterializedSecret({
      sandbox: { rootDir },
      name: "SUPABASE_SERVICE_ROLE_KEY",
    });

    const result = await readFile(envPath, "utf8");
    expect(result).toContain("SUPABASE_URL=https://example.supabase.co");
    expect(result).toContain("SUPABASE_ANON_KEY=public");
    expect(result).not.toContain("SUPABASE_SERVICE_ROLE_KEY");

    // Explicit secret deletion uses the default and still removes stale public
    // config; only routine loop/upsert cleanup opts into preservation.
    await removeLegacyMaterializedSecret({ sandbox: { rootDir }, name: "SUPABASE_URL" });
    await expect(readFile(envPath, "utf8")).resolves.not.toContain("SUPABASE_URL=");
  });
});
