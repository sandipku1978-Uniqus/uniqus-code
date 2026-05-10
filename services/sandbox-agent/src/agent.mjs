#!/usr/bin/env node
/**
 * Uniqus in-VM sandbox agent.
 *
 * Lives inside a Firecracker microVM. Bound to vsock port 51000. The
 * orchestrator's `agentRpc.ts` is the only client; it CONNECTs to the
 * VM's vsock, sends HTTP/1.1, and we serve. Plain Node — no third-party
 * deps so the rootfs stays small.
 *
 * Endpoints (mirror agentRpc.ts):
 *   GET  /health                     → { ok: true }
 *   GET  /fs/file?path=…             → { content }
 *   PUT  /fs/file                    body: { path, content, encoding? }
 *   POST /fs/edit                    body: { path, old_string, new_string }
 *   GET  /fs/dir?path=…              → { entries }
 *   POST /fs/grep                    body: { pattern, path? } → { matches }
 *   POST /exec/run                   body: { command, timeout_ms } → { stdout, stderr, exitCode }
 *   POST /exec/start-server          body: { command, port, ready_timeout_ms } → { id, pid, port }
 *   POST /exec/stop-server           body: { id }
 *   GET  /exec/server-log?id=…       → { log }
 *
 * Cwd: /sandbox (mounted from the per-project ext4 image).
 *
 * Plan §1 calls for a Rust port; this Node version is a Phase-2 expedient.
 * Wire protocol is stable — Rust can drop in without orchestrator changes.
 */

import http from "node:http";
import net from "node:net";
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const SANDBOX_DIR = process.env.UNIQUS_SANDBOX_DIR ?? "/sandbox";
const VSOCK_PORT = Number(process.env.UNIQUS_AGENT_PORT ?? 51000);
const HALF_MAX = 8 * 1024;
const MAX_LOG = 64 * 1024;

await fs.mkdir(SANDBOX_DIR, { recursive: true });
process.chdir(SANDBOX_DIR);

// ── server table for start-server / stop-server / log tail ─────────────────
const servers = new Map();

// ── vsock listener ─────────────────────────────────────────────────────────
// Linux exposes vsock as AF_VSOCK; Node doesn't have first-class support
// but a TCP server on 0.0.0.0:VSOCK_PORT will be reached via the vsock
// device when paired with the host-side `socat VSOCK-CONNECT:CID:PORT`
// shim, OR (preferred) via the Firecracker vsock UDS handshake the
// orchestrator already speaks.
//
// For maximum portability we bind a *unix-socket-style* listener at
// /tmp/firecracker-vsock.sock and rely on the kernel's vsock-uds bridge
// the rootfs sets up (see infra/firecracker/init.sh). The orchestrator
// always speaks the same wire format on the host side, so the kernel
// handles the AF_VSOCK ↔ AF_UNIX translation transparently.

const httpServer = http.createServer((req, res) => handleRequest(req, res));

// In a Firecracker guest the easiest reliable path is: a TCP listener
// inside the VM that the rootfs's init.sh forwards to vsock via a tiny
// bash + socat. We just listen on 0.0.0.0:VSOCK_PORT.
httpServer.listen(VSOCK_PORT, "0.0.0.0", () => {
  console.log(`[uniqus-agent] listening on port ${VSOCK_PORT} (cwd=${SANDBOX_DIR})`);
});

// ── request dispatch ───────────────────────────────────────────────────────
async function handleRequest(req, res) {
  try {
    const url = new URL(req.url ?? "/", "http://vm");
    const method = req.method ?? "GET";

    if (method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true });
    if (method === "GET" && url.pathname === "/fs/file") {
      const p = resolveSandbox(url.searchParams.get("path") ?? "");
      const content = await fs.readFile(p, "utf-8");
      return json(res, 200, { content });
    }
    if (method === "PUT" && url.pathname === "/fs/file") {
      const body = await readBody(req);
      const p = resolveSandbox(body.path ?? "");
      await fs.mkdir(path.dirname(p), { recursive: true });
      const buf = body.encoding === "base64"
        ? Buffer.from(String(body.content ?? ""), "base64")
        : Buffer.from(String(body.content ?? ""), "utf-8");
      await fs.writeFile(p, buf);
      return json(res, 200, { ok: true });
    }
    if (method === "POST" && url.pathname === "/fs/edit") {
      const body = await readBody(req);
      const p = resolveSandbox(body.path ?? "");
      const content = await fs.readFile(p, "utf-8");
      const occ = content.split(body.old_string).length - 1;
      if (occ === 0) return json(res, 400, { error: `old_string not found in ${body.path}` });
      if (occ > 1) return json(res, 400, { error: `old_string is not unique in ${body.path} (${occ} matches)` });
      await fs.writeFile(p, content.replace(body.old_string, body.new_string));
      return json(res, 200, { ok: true });
    }
    if (method === "GET" && url.pathname === "/fs/dir") {
      const target = url.searchParams.get("path");
      const dir = target ? resolveSandbox(target) : SANDBOX_DIR;
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return json(res, 200, {
        entries: entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)),
      });
    }
    if (method === "POST" && url.pathname === "/fs/grep") {
      const body = await readBody(req);
      const matches = await grep(body.pattern ?? "", body.path ?? null);
      return json(res, 200, { matches });
    }
    if (method === "POST" && url.pathname === "/exec/run") {
      const body = await readBody(req);
      const result = await runCommand(body.command ?? "", body.timeout_ms ?? 60_000);
      return json(res, 200, result);
    }
    if (method === "POST" && url.pathname === "/exec/start-server") {
      const body = await readBody(req);
      const r = await startServer(body.command ?? "", Number(body.port), Number(body.ready_timeout_ms ?? 60_000));
      return json(res, 200, r);
    }
    if (method === "POST" && url.pathname === "/exec/stop-server") {
      const body = await readBody(req);
      stopServer(String(body.id));
      return json(res, 200, { ok: true });
    }
    if (method === "GET" && url.pathname === "/exec/server-log") {
      const id = url.searchParams.get("id") ?? "";
      const max = Number(url.searchParams.get("max_bytes") ?? 8000);
      const s = servers.get(id);
      if (!s) return json(res, 404, { error: `no server ${id}` });
      return json(res, 200, { log: s.log.slice(-max) });
    }
    return json(res, 404, { error: "not found" });
  } catch (err) {
    return json(res, 500, { error: String(err?.message ?? err) });
  }
}

// ── helpers ────────────────────────────────────────────────────────────────
function resolveSandbox(rel) {
  const root = path.resolve(SANDBOX_DIR);
  const full = path.resolve(root, rel || ".");
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error(`path escapes sandbox: ${rel}`);
  }
  return full;
}

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const buf = Buffer.concat(chunks).toString("utf-8");
      if (!buf) return resolve({});
      try {
        resolve(JSON.parse(buf));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function truncate(s) {
  if (s.length <= HALF_MAX * 2) return s;
  return `${s.slice(0, HALF_MAX)}\n\n[... truncated ${s.length - HALF_MAX * 2} bytes ...]\n\n${s.slice(-HALF_MAX)}`;
}

async function grep(pattern, sub) {
  const target = sub ? resolveSandbox(sub) : SANDBOX_DIR;
  const re = new RegExp(pattern);
  const root = path.resolve(SANDBOX_DIR);
  const out = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
        continue;
      }
      try {
        const text = await fs.readFile(full, "utf-8");
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) {
            out.push(`${path.relative(root, full)}:${i + 1}: ${lines[i].trim()}`);
          }
        }
      } catch {
        // skip binary / unreadable
      }
    }
  }
  await walk(target);
  return out.length ? out.join("\n") : "(no matches)";
}

async function runCommand(command, timeoutMs) {
  return await new Promise((resolve) => {
    const child = spawn("/bin/sh", ["-c", command], {
      cwd: SANDBOX_DIR,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let killed = false;
    const t = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      clearTimeout(t);
      if (killed) stderr += `\n[killed: timeout after ${timeoutMs}ms]`;
      resolve({ stdout: truncate(stdout), stderr: truncate(stderr), exitCode: code });
    });
    child.on("error", (err) => {
      clearTimeout(t);
      resolve({ stdout: "", stderr: `[spawn error] ${err.message}`, exitCode: 1 });
    });
  });
}

async function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const s = net.createConnection({ port, host: "127.0.0.1" });
      s.once("connect", () => {
        s.end();
        resolve(true);
      });
      s.once("error", () => resolve(false));
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function startServer(command, port, readyTimeoutMs) {
  const id = `srv_${randomUUID().slice(0, 8)}`;
  const child = spawn("/bin/sh", ["-c", command], {
    cwd: SANDBOX_DIR,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log = { value: "" };
  child.stdout?.on("data", (d) => (log.value = (log.value + d.toString()).slice(-MAX_LOG)));
  child.stderr?.on("data", (d) => (log.value = (log.value + d.toString()).slice(-MAX_LOG)));
  servers.set(id, {
    pid: child.pid,
    port,
    proc: child,
    get log() {
      return log.value;
    },
  });
  child.on("exit", () => servers.delete(id));
  const ok = await waitForPort(port, readyTimeoutMs);
  if (!ok) {
    child.kill("SIGKILL");
    servers.delete(id);
    throw new Error(`server did not open port ${port} within ${readyTimeoutMs}ms\nrecent log:\n${log.value.slice(-1500)}`);
  }
  return { id, pid: child.pid ?? 0, port };
}

function stopServer(id) {
  const s = servers.get(id);
  if (!s) return;
  try {
    s.proc.kill("SIGKILL");
  } catch {}
  servers.delete(id);
}

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
