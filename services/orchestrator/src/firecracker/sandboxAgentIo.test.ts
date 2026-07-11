import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const roots: string[] = [];
const children: ChildProcess[] = [];

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function startNodeAgent(rootDir: string): Promise<string> {
  const port = await freePort();
  const here = path.dirname(fileURLToPath(import.meta.url));
  const agentPath = path.resolve(here, "../../../sandbox-agent/src/agent.mjs");
  const child = spawn(process.execPath, [agentPath], {
    env: {
      ...process.env,
      // Force the no-ripgrep path so the dependency-free fallback is covered.
      PATH: "",
      UNIQUS_SANDBOX_DIR: rootDir,
      UNIQUS_AGENT_PORT: String(port),
    },
    stdio: "ignore",
  });
  children.push(child);
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`Node sandbox agent exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return base;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for Node sandbox agent");
}

afterEach(async () => {
  await Promise.all(
    children.splice(0).map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null) return resolve();
          child.once("exit", () => resolve());
          child.kill("SIGKILL");
        }),
    ),
  );
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Node fallback sandbox-agent bounded I/O wire contract", () => {
  it("caps text reads in-guest and returns range/truncation metadata", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "uniqus-node-agent-"));
    roots.push(root);
    const lines = Array.from(
      { length: 100 },
      (_, index) =>
        `line-${String(index + 1).padStart(3, "0")}-${"x".repeat(1000)}`,
    );
    await writeFile(path.join(root, "large.txt"), lines.join("\n"), "utf-8");
    const base = await startNodeAgent(root);

    const full = (await (
      await fetch(`${base}/fs/file?path=large.txt&max_bytes=${30 * 1024}&head_tail=1`)
    ).json()) as any;
    expect(full.truncated).toBe(true);
    expect(full.total_bytes).toBeGreaterThan(full.returned_bytes);
    expect(Buffer.byteLength(full.content)).toBe(full.returned_bytes);
    expect(full.returned_bytes).toBeLessThanOrEqual(30 * 1024);
    expect(full.head_bytes).toBeGreaterThan(full.tail_bytes);
    expect(full.tail_bytes).toBeGreaterThan(0);
    expect(full.omitted_bytes).toBeGreaterThan(0);
    expect(full.content).toContain("line-001-");
    expect(full.content).toContain("line-100-");
    expect(full.content).toContain("bytes omitted from the middle");

    const internal = (await (
      await fetch(`${base}/fs/file?path=large.txt`)
    ).json()) as any;
    expect(internal.truncated).toBe(false);
    expect(internal.returned_bytes).toBe(internal.total_bytes);

    const range = (await (
      await fetch(
        `${base}/fs/file?path=large.txt&offset=1&limit=100&max_bytes=${30 * 1024}`,
      )
    ).json()) as any;
    expect(range.total_lines).toBeNull();
    expect(range.known_lines).toBeGreaterThanOrEqual(1);
    expect(range.known_lines).toBeLessThan(100);
    expect(range.has_more).toBe(true);
    expect(range.range_start).toBe(1);
    expect(range.requested_end).toBe(100);
    expect(range.range_end).toBeLessThan(100);
    expect(range.truncated).toBe(true);
    expect(range.selected_bytes).toBeGreaterThan(range.returned_bytes);

    const throughEof = (await (
      await fetch(
        `${base}/fs/file?path=large.txt&offset=99&limit=5&max_bytes=${30 * 1024}`,
      )
    ).json()) as any;
    expect(throughEof.total_lines).toBe(100);
    expect(throughEof.known_lines).toBe(100);
    expect(throughEof.has_more).toBe(false);
    expect(throughEof.requested_end).toBe(100);
  });

  it("bounds fallback grep with first+tail results and explicit omission counts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "uniqus-node-agent-"));
    roots.push(root);
    const lines = Array.from(
      { length: 120 },
      (_, index) => `hit-${String(index).padStart(3, "0")}-${"x".repeat(300)}`,
    );
    await writeFile(path.join(root, "matches.txt"), lines.join("\n"), "utf-8");
    await mkdir(path.join(root, "node_modules"));
    await mkdir(path.join(root, ".hidden"));
    await writeFile(
      path.join(root, "node_modules", "ignored.txt"),
      "hit-ignored",
      "utf-8",
    );
    await writeFile(
      path.join(root, ".hidden", "ignored.txt"),
      "hit-ignored",
      "utf-8",
    );
    await writeFile(
      path.join(root, "literal.txt"),
      "literal [ marker",
      "utf-8",
    );
    const base = await startNodeAgent(root);

    const response = await fetch(`${base}/fs/grep`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pattern: "hit-" }),
    });
    const result = (await response.json()) as any;

    expect(result.total_matches).toBe(120);
    expect(result.returned_matches + result.omitted_matches).toBe(120);
    expect(result.omitted_matches).toBeGreaterThan(0);
    expect(result.truncated).toBe(true);
    expect(result.matches).toContain("hit-000-");
    expect(result.matches).toContain("hit-119-");
    expect(result.matches).toContain("middle matches omitted");
    expect(result.matches).not.toContain("ignored.txt");
    expect(Buffer.byteLength(result.matches)).toBeLessThan(32 * 1024);

    const singleFileResponse = await fetch(`${base}/fs/grep`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pattern: "hit-119", path: "matches.txt" }),
    });
    const singleFile = (await singleFileResponse.json()) as any;
    expect(singleFile.total_matches).toBe(1);
    expect(singleFile.matches).toContain("matches.txt:120: hit-119-");

    const literalResponse = await fetch(`${base}/fs/grep`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pattern: "[" }),
    });
    const literal = (await literalResponse.json()) as any;
    expect(literal.matches).toContain("pattern is not a valid regex");
    expect(literal.matches).toContain("literal.txt:1: literal [ marker");
    expect(literal.matches).not.toContain("ignored.txt");

    const explicitHiddenResponse = await fetch(`${base}/fs/grep`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pattern: "hit-ignored", path: ".hidden" }),
    });
    const explicitHidden = (await explicitHiddenResponse.json()) as any;
    expect(explicitHidden.total_matches).toBe(1);
    expect(explicitHidden.matches).toContain(".hidden");
  });
});
