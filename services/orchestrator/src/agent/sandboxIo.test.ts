import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile as readHostFile, rm, symlink, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {
  commandResultText,
  editFile,
  grep,
  grepResult,
  getServer,
  isSandboxTextResult,
  listDir,
  readFile,
  readFileResult,
  runCommand,
  startServer,
  stopServer,
  sandboxTextWasTruncated,
  waitForPort,
  writeFile as sandboxWriteFile,
  type Sandbox,
} from "./sandbox.js";
import * as fcAgent from "../firecracker/agentRpc.js";
import type { VmHandle } from "../firecracker/types.js";

const roots: string[] = [];

async function makeSandbox(): Promise<Sandbox> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "uniqus-sandbox-io-"));
  roots.push(rootDir);
  return { rootDir };
}

function fakeVm(port = 51000): VmHandle {
  return {
    id: `vm-io-${port}`,
    projectId: `project-io-${port}`,
    rootImagePath: "",
    guestCid: 3,
    agentPort: port,
    apiSocket: "",
    vsockUds: "",
    tapDevice: "",
    ip: "127.0.0.1",
    gatewayIp: "127.0.0.1",
    guestMac: "02:00:00:00:00:02",
    state: "running",
    lastUsedAt: Date.now(),
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("bounded sandbox reads", () => {
  it("blocks model-facing reads of secret-bearing paths while retaining trusted cleanup access", async () => {
    const sandbox = await makeSandbox();
    await writeFile(path.join(sandbox.rootDir, ".env"), "TOKEN=secret", "utf-8");
    await expect(readFileResult(sandbox, ".env", {})).rejects.toThrow(/secret-bearing/);
    await expect(readFile(sandbox, ".env")).resolves.toBe("TOKEN=secret");
  });

  it("caps a default read before returning and exposes explicit truncation metadata", async () => {
    const sandbox = await makeSandbox();
    await writeFile(
      path.join(sandbox.rootDir, "large.txt"),
      `HEAD\n${"x".repeat(40 * 1024)}\nTAIL`,
      "utf-8",
    );

    // Tool calls supply an options object even without a range; internal
    // callers omit it and keep the wider 256 KiB predeploy window.
    const wrapped = await readFileResult(sandbox, "large.txt", {});
    const result = wrapped.text;

    expect(isSandboxTextResult(wrapped)).toBe(true);
    expect(sandboxTextWasTruncated(wrapped)).toBe(true);
    expect(Object.keys(wrapped)).toEqual(["text"]);
    expect(JSON.parse(JSON.stringify(wrapped))).toEqual({ text: result });
    expect(result).toMatch(/^HEAD\n/);
    expect(result).toContain("file truncated in the sandbox");
    expect(result).toContain("bytes total, showing the first");
    expect(result).toContain("and last");
    expect(result).toContain("bytes omitted from the middle");
    expect(result).toContain("TAIL");
    expect(Buffer.byteLength(result)).toBeLessThan(32 * 1024);

    const internal = await readFile(sandbox, "large.txt");
    expect(internal).toContain("TAIL");
    expect(internal).not.toContain("file truncated in the sandbox");
  });

  it("keeps range reads line-addressable and reports when a large range is byte-capped", async () => {
    const sandbox = await makeSandbox();
    const lines = Array.from(
      { length: 100 },
      (_, index) =>
        `line-${String(index + 1).padStart(3, "0")}-${"x".repeat(1000)}`,
    );
    await writeFile(
      path.join(sandbox.rootDir, "lines.txt"),
      lines.join("\n"),
      "utf-8",
    );

    const cappedResult = await readFileResult(sandbox, "lines.txt", {
      offset: 1,
      limit: 100,
    });
    const capped = cappedResult.text;
    expect(sandboxTextWasTruncated(cappedResult)).toBe(true);
    expect(capped).toMatch(/^\[lines 1–\d+ of at least \d+\]\nline-001-/);
    expect(capped).toContain("selected range truncated in the sandbox");
    expect(Buffer.byteLength(capped)).toBeLessThan(32 * 1024);

    const later = await readFile(sandbox, "lines.txt", {
      offset: 90,
      limit: 3,
    });
    expect(later).toMatch(/^\[lines 90–92 of at least 93\]\nline-090-/);
    expect(later).toContain("line-092-");
    expect(later).not.toContain("selected range truncated");

    const throughEof = await readFile(sandbox, "lines.txt", {
      offset: 99,
      limit: 5,
    });
    expect(throughEof).toMatch(/^\[lines 99–100 of 100\]\nline-099-/);
  });
});

describe("bounded sandbox grep", () => {
  it("retains first and tail matches while reporting omitted middle matches", async () => {
    const sandbox = await makeSandbox();
    const lines = Array.from(
      { length: 120 },
      (_, index) => `hit-${String(index).padStart(3, "0")}-${"x".repeat(300)}`,
    );
    await writeFile(
      path.join(sandbox.rootDir, "matches.txt"),
      lines.join("\n"),
      "utf-8",
    );

    const wrapped = await grepResult(sandbox, "hit-");
    const result = wrapped.text;

    expect(sandboxTextWasTruncated(wrapped)).toBe(true);
    expect(result).toContain("hit-000-");
    expect(result).toContain("hit-119-");
    expect(result).not.toContain("hit-070-");
    expect(result).toContain("middle matches omitted");
    expect(result).toContain("search truncated: showing first");
    expect(Buffer.byteLength(result)).toBeLessThan(32 * 1024);
  });

  it("preserves literal fallback and the dotfile/node_modules ignore policy", async () => {
    const sandbox = await makeSandbox();
    await mkdir(path.join(sandbox.rootDir, "node_modules"), {
      recursive: true,
    });
    await mkdir(path.join(sandbox.rootDir, ".hidden"), { recursive: true });
    await writeFile(
      path.join(sandbox.rootDir, "visible.txt"),
      "literal [ marker",
      "utf-8",
    );
    await writeFile(
      path.join(sandbox.rootDir, "node_modules", "ignored.txt"),
      "literal [ marker",
      "utf-8",
    );
    await writeFile(
      path.join(sandbox.rootDir, ".hidden", "ignored.txt"),
      "literal [ marker",
      "utf-8",
    );

    const result = await grep(sandbox, "[");

    expect(result).toContain("pattern is not a valid regex");
    expect(result).toContain("visible.txt:1: literal [ marker");
    expect(result).not.toContain("ignored.txt");

    const singleFile = await grep(sandbox, "literal", "visible.txt");
    expect(singleFile).toBe("visible.txt:1: literal [ marker");
  });
});

describe("sandbox I/O safety", () => {
  it("rejects a missing child beneath a symlinked parent", async () => {
    const sandbox = await makeSandbox();
    const outside = await mkdtemp(path.join(os.tmpdir(), "uniqus-sandbox-outside-"));
    roots.push(outside);
    await symlink(
      outside,
      path.join(sandbox.rootDir, "escape"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(sandboxWriteFile(sandbox, "escape/missing/new.txt", "secret")).rejects.toThrow(
      /escapes sandbox through a symlink/i,
    );
    await expect(readHostFile(path.join(outside, "missing", "new.txt"), "utf-8")).rejects.toThrow();
  });

  it("binds preview control handles to the project that started them", async () => {
    const sandbox = await makeSandbox();
    sandbox.vm = fakeVm();
    vi.spyOn(fcAgent, "startServer").mockResolvedValue({
      id: "vm-server",
      port: 4242,
      pid: 123,
    });
    vi.spyOn(fcAgent, "stopServer").mockResolvedValue(undefined);

    const started = await startServer(sandbox, "npm run dev", 4242, 1000, "project-a");
    expect(getServer("project-a", started.id)).not.toBeNull();
    expect(getServer("project-b", started.id)).toBeNull();
    await expect(stopServer("project-b", started.id)).rejects.toThrow(/No server/);
    expect(getServer("project-a", started.id)).not.toBeNull();

    await stopServer("project-a", started.id);
    expect(getServer("project-a", started.id)).toBeNull();
  });

  it("removes each abort listener after a normal waitForPort poll", async () => {
    const server = http.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing test port");
    await new Promise<void>((resolve) => server.close(() => resolve()));

    const controller = new AbortController();
    const added = vi.spyOn(controller.signal, "addEventListener");
    const removed = vi.spyOn(controller.signal, "removeEventListener");

    await expect(waitForPort(address.port, 550, controller.signal)).resolves.toBe(false);
    expect(added.mock.calls.filter(([type]) => type === "abort")).not.toHaveLength(0);
    expect(removed.mock.calls.filter(([type]) => type === "abort")).toHaveLength(
      added.mock.calls.filter(([type]) => type === "abort").length,
    );
  });

  it("preserves local command-output truncation as non-serializing metadata", async () => {
    const sandbox = await makeSandbox();
    const previous = process.env.UNIQUS_ALLOW_HOST_SANDBOX;
    process.env.UNIQUS_ALLOW_HOST_SANDBOX = "1";
    const result = await runCommand(sandbox, `node -e "process.stdout.write('x'.repeat(2000000))"`)
      .finally(() => {
        if (previous === undefined) delete process.env.UNIQUS_ALLOW_HOST_SANDBOX;
        else process.env.UNIQUS_ALLOW_HOST_SANDBOX = previous;
      });
    const wrapped = commandResultText(result);

    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.stdout)).toBeLessThan(20_000);
    expect(sandboxTextWasTruncated(wrapped)).toBe(true);
    expect(wrapped.text).toContain("[... truncated ");
    expect(JSON.parse(JSON.stringify(wrapped))).toEqual({ text: wrapped.text });
  });

  it("recovers Firecracker command truncation from the stable wire marker", async () => {
    const sandbox = await makeSandbox();
    sandbox.vm = fakeVm();
    vi.spyOn(fcAgent, "runCommand").mockResolvedValue({
      stdout: "head\n[... truncated 99 bytes ...]\ntail",
      stderr: "",
      exitCode: 0,
    });

    const result = await runCommand(sandbox, "large-output");
    expect(result.truncated).toBe(true);
    expect(sandboxTextWasTruncated(commandResultText(result))).toBe(true);
  });

  it("does not replace the host mirror with text after a transient binary RPC failure", async () => {
    const sandbox = await makeSandbox();
    sandbox.vm = fakeVm();
    const full = path.join(sandbox.rootDir, "mirror.txt");
    await writeFile(full, "stale-host-copy", "utf-8");

    vi.spyOn(fcAgent, "editFile").mockResolvedValue(undefined);
    vi.spyOn(fcAgent, "readFileBinary").mockRejectedValue(new Error("ECONNRESET"));
    const textFallback = vi.spyOn(fcAgent, "readFile").mockResolvedValue("capped-response");
    vi.spyOn(console, "error").mockImplementation(() => {});

    await editFile(sandbox, "mirror.txt", "remote-only-text", "updated");

    expect(await readHostFile(full, "utf-8")).toBe("stale-host-copy");
    expect(textFallback).not.toHaveBeenCalled();
  });

  it("shares an eight-permit sandbox semaphore and weights grep as two permits", async () => {
    let active = 0;
    let peak = 0;
    const server = http.createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        active++;
        peak = Math.max(peak, active);
        setTimeout(() => {
          active--;
          res.writeHead(200, { "Content-Type": "application/json" });
          if (req.url?.startsWith("/fs/grep")) {
            res.end(JSON.stringify({ matches: "(no matches)", truncated: false }));
          } else {
            res.end(JSON.stringify({ entries: [] }));
          }
        }, 30);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const sandbox = await makeSandbox();
    sandbox.vm = fakeVm(port);

    try {
      await Promise.all(Array.from({ length: 24 }, () => listDir(sandbox)));
      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThanOrEqual(8);

      peak = 0;
      await Promise.all(Array.from({ length: 12 }, () => grep(sandbox, "needle")));
      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThanOrEqual(4);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
