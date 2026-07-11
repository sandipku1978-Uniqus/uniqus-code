import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectRunConfig } from "./runConfig.js";

async function detectForScript(script: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "uniqus-run-config-"));
  try {
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ scripts: { dev: script } }),
    );
    return await detectRunConfig(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("detectRunConfig", () => {
  it("uses Vite's host flag and default port", async () => {
    await expect(detectForScript("vite")).resolves.toEqual({
      command: "npm run dev -- --host 0.0.0.0",
      port: 5173,
      source: "detected",
    });
  });

  it("uses Next's distinct -H flag", async () => {
    await expect(detectForScript("next dev")).resolves.toEqual({
      command: "npm run dev -- -H 0.0.0.0",
      port: 3000,
      source: "detected",
    });
  });

  it("preserves explicit host and port arguments", async () => {
    await expect(detectForScript("vite --host 127.0.0.1 --port 4400")).resolves.toEqual({
      command: "npm run dev",
      port: 4400,
      source: "detected",
    });
  });

  it("does not append framework flags to generic Node scripts", async () => {
    await expect(detectForScript("node server.js")).resolves.toEqual({
      command: "npm run dev",
      port: 3000,
      source: "detected",
    });
  });
});
