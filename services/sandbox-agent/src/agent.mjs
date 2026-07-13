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
 *   GET  /health                     → { ok: true, kind: "node" }
 *   POST /net/configure              body: { ip, gw, mac?, mount_sandbox?, seed?, time_ms? } → { ok: true }
 *   GET  /fs/file?path=…             → { content } (+&encoding=base64 → { content, encoding: "base64" };
 *                                       +&offset=&limit= line range; +&max_bytes= response cap;
 *                                       +&head_tail=1 retains both ends of a full read;
 *                                       text responses include total/returned bytes + truncated)
 *   PUT  /fs/file                    body: { path, content, encoding? }
 *   GET  /fs/manifest                → { files: [{ path, size, mtime_ms }] } (storage-sync exclusions applied)
 *   POST /fs/edit                    body: { path, old_string, new_string }
 *   GET  /fs/dir?path=…              → { entries }
 *   POST /fs/grep                    body: { pattern, path?, case_insensitive?, literal? } → { matches }
 *   POST /exec/run                   body: { command, timeout_ms } → { stdout, stderr, exitCode }
 *   POST /exec/start-server          body: { command, port, ready_timeout_ms } → { id, pid, port }
 *   POST /exec/stop-server           body: { id }
 *   GET  /exec/server-log?id=…       → { log }
 *
 * Cwd: /sandbox (mounted from the per-project ext4 image).
 *
 * LEGACY (Phase-2.x): the Rust port at src/main.rs is now the default agent.
 * This .mjs is kept as a fallback for build hosts without rustup + musl-tools
 * installed — see infra/firecracker/build-rootfs.sh for the switch logic.
 * Wire format here MUST stay byte-compatible with main.rs; if you add an
 * endpoint to one, mirror it in the other.
 */

import http from "node:http";
import net from "node:net";
import { createReadStream, promises as fs } from "node:fs";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { createInterface } from "node:readline";

const SANDBOX_DIR = process.env.UNIQUS_SANDBOX_DIR ?? "/sandbox";
const VSOCK_PORT = Number(process.env.UNIQUS_AGENT_PORT ?? 51000);
const HALF_MAX = 8 * 1024;
const MAX_LOG = 64 * 1024;
// Absolute read ceiling. Model calls request a smaller 30 KiB window; internal
// predeploy/diff callers retain the established 256 KiB behavior.
const MAX_TEXT_READ_BYTES = 256 * 1024;
const READ_GAP_RESERVE_BYTES = 256;
const GREP_HEAD_BYTES = 20 * 1024;
const GREP_TAIL_BYTES = 8 * 1024;
const MAX_GREP_LINE_BYTES = 7 * 1024;
let ripgrepAvailable = null;

await fs.mkdir(SANDBOX_DIR, { recursive: true });
process.chdir(SANDBOX_DIR);

// Package-manager caches must NOT land in $HOME: on a golden-snapshot clone the
// rootfs is mounted READ-ONLY (/root is a small tmpfs at best), and a RAM-backed
// cache can OOM a 1 GiB guest on a big install. Point npm/yarn/pnpm at the
// per-project /sandbox disk instead — ".cache" is excluded from storage sync,
// the VM→host pull, and /fs/manifest, so it never pollutes the project, and it
// persists across VM restarts so repeat installs get --prefer-offline hits.
// Every child we spawn (run_command, start_server) inherits this env.
// Mirrors main.rs (mirror any change into BOTH agents).
process.env.npm_config_cache ??= path.join(SANDBOX_DIR, ".cache/npm");
process.env.YARN_CACHE_FOLDER ??= path.join(SANDBOX_DIR, ".cache/yarn");
process.env.npm_config_store_dir ??= path.join(SANDBOX_DIR, ".cache/pnpm-store");

/**
 * Bring up eth0 from /proc/cmdline before listening. Many Firecracker CI
 * kernels are built without CONFIG_IP_PNP, so the kernel's `ip=` cmdline
 * is silently ignored. We pass `uniqus_ip=<addr>/<prefix>` and
 * `uniqus_gw=<addr>` instead and apply them ourselves via the iproute2
 * binaries baked into the rootfs.
 */
function configureNetwork() {
  let cmdline = "";
  try {
    cmdline = readFileSync("/proc/cmdline", "utf-8");
  } catch (err) {
    console.error("[uniqus-agent] could not read /proc/cmdline:", err.message);
    return;
  }
  const ip = (cmdline.match(/(?:^|\s)uniqus_ip=([^\s]+)/) ?? [])[1];
  const gw = (cmdline.match(/(?:^|\s)uniqus_gw=([^\s]+)/) ?? [])[1];
  if (!ip || !gw) {
    console.error(`[uniqus-agent] uniqus_ip/uniqus_gw missing from /proc/cmdline; eth0 will not be configured. cmdline=${cmdline.trim()}`);
    return;
  }
  // Cold boot keeps the Firecracker-assigned MAC (pass null).
  applyNetwork(ip, gw, null);
  console.log(`[uniqus-agent] eth0 configured from cmdline: ip=${ip} gw=${gw}`);
}

/** Run a host command synchronously, logging the outcome. */
function runSync(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf-8" });
  if (r.status !== 0) {
    console.error(`[uniqus-agent] ${cmd} ${args.join(" ")} → ${r.status} ${r.stderr?.trim() ?? ""}`);
  } else {
    console.log(`[uniqus-agent] ${cmd} ${args.join(" ")} ok`);
  }
  return r.status === 0;
}

/**
 * Apply a static config to eth0. Mirrors main.rs `apply_network`: flush first
 * (so re-stamping a restored clone converges), set MAC while DOWN, then addr +
 * default route. `mac`/`ip`/`gw` may be empty/null to skip that step.
 */
function applyNetwork(ip, gw, mac) {
  runSync("ip", ["link", "set", "eth0", "down"]);
  if (mac) runSync("ip", ["link", "set", "dev", "eth0", "address", mac]);
  runSync("ip", ["addr", "flush", "dev", "eth0"]);
  runSync("ip", ["route", "flush", "dev", "eth0"]);
  runSync("ip", ["link", "set", "lo", "up"]);
  runSync("ip", ["link", "set", "eth0", "up"]);
  if (ip) runSync("ip", ["addr", "add", ip, "dev", "eth0"]);
  if (gw) runSync("ip", ["route", "add", "default", "via", gw, "dev", "eth0"]);
  console.log(`[uniqus-agent] eth0 set: ip=${ip} gw=${gw} mac=${mac ?? "(unchanged)"}`);
}

/** Mount the per-project sandbox volume on a base-snapshot restore. */
function mountSandbox() {
  runSync("mkdir", ["-p", SANDBOX_DIR]);
  runSync("mount", ["-t", "ext4", "/dev/vdb", SANDBOX_DIR]);
}

/** Mix orchestrator-supplied entropy into the clone's RNG (base64). */
function reseedUrandom(seedB64) {
  try {
    const buf = Buffer.from(String(seedB64), "base64");
    if (buf.length) writeFileSync("/dev/urandom", buf);
  } catch (err) {
    console.error(`[uniqus-agent] reseed /dev/urandom failed: ${err.message}`);
  }
}

/** Correct the frozen guest clock from host epoch millis. */
function setClock(ms) {
  runSync("date", ["-s", `@${Math.floor(ms / 1000)}`]);
}

configureNetwork();

// F1/P0.2: per-VM bearer token required on every request except /health. Cold &
// rehydrated VMs read it from `uniqus_token=` on the cmdline (with uniqus_auth=1
// always present now). A golden-snapshot clone resumes WITHOUT uniqus_auth on
// its frozen cmdline, so this starts null and is (re)provisioned at restore via
// POST /net/configure — hence a mutable `let`, not a `const`. Mirrors
// main.rs::read_required_token + the dynamic /net/configure provisioning.
let enforcedToken = (() => {
  let cmdline = "";
  try {
    cmdline = readFileSync("/proc/cmdline", "utf-8");
  } catch {
    return null;
  }
  if (!/(?:^|\s)uniqus_auth=1(?:\s|$)/.test(cmdline)) return null;
  return (cmdline.match(/(?:^|\s)uniqus_token=([^\s]+)/) ?? [])[1] ?? null;
})();
if (enforcedToken) {
  console.error("[uniqus-agent] request auth ENFORCED (per-VM bearer token)");
}

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

    // F1: enforce the per-VM bearer token on every endpoint except /health.
    // C-115: constant-time compare so response timing can't leak the token.
    if (url.pathname !== "/health" && enforcedToken) {
      const authz = req.headers["authorization"];
      if (!constantTimeEqual(authz, `Bearer ${enforcedToken}`)) {
        return json(res, 401, { error: "unauthorized" });
      }
    }

    if (method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true, kind: "node" });
    if (method === "POST" && url.pathname === "/net/configure") {
      const body = await readBody(req);
      // C-113: validate ip+gw FIRST and 400 before any side effects, mirroring
      // main.rs require_str (present + a string). Otherwise mountSandbox/reseed/
      // setClock would run and then applyNetwork("","",…) would down eth0, flush
      // its address, and re-up it with NO IP — bricking the VM until reboot.
      if (typeof body.ip !== "string") {
        return json(res, 400, { error: "'ip' is required and must be a string" });
      }
      if (typeof body.gw !== "string") {
        return json(res, 400, { error: "'gw' is required and must be a string" });
      }
      const ip = body.ip;
      const gw = body.gw;
      const mac = body.mac ? String(body.mac) : null;
      // P0.2: (re)provision + ENFORCE this clone's per-project bearer token. A
      // golden clone resumed unauthenticated; this is where it adopts the same
      // token a cold-booted VM would have had from boot. After this, every later
      // request (incl. a retry of THIS call) must carry it — finalizeRestore
      // sends it as a Bearer. Mirrors main.rs.
      if (body.uniqus_auth === true && typeof body.auth_token === "string" && body.auth_token) {
        enforcedToken = body.auth_token;
        console.error("[uniqus-agent] request auth ENFORCED via /net/configure (golden restore)");
      }
      // Base-snapshot restore. Safe-now steps: mount this project's sandbox drive
      // (golden left it unmounted) and de-correlate clock + RNG. Mirrors main.rs.
      if (body.mount_sandbox) mountSandbox();
      if (body.seed) reseedUrandom(body.seed);
      if (typeof body.time_ms === "number") setClock(body.time_ms);
      // Re-stamp eth0 only AFTER this reply is flushed — applyNetwork drops the
      // link + changes the MAC, killing the bootstrap connection we answer over.
      // 50ms is plenty for a sub-ms L2 hop to drain the reply; this delay sits
      // on every golden-restore boot (under the orchestrator's bootstrap lock),
      // so the old 250ms was a fifth of a second added to every reopen.
      setTimeout(() => applyNetwork(ip, gw, mac), 50);
      return json(res, 200, { ok: true, restamp: "scheduled" });
    }
    if (method === "GET" && url.pathname === "/fs/file") {
      const p = resolveSandbox(url.searchParams.get("path") ?? "");
      // Binary-safe read for the VM→host pull (C-18). The `encoding` echo in
      // the response is the capability signal: an agent without this support
      // ignores the param and replies without it, telling the orchestrator to
      // use the exec-based fallback instead of mojibake-ing a binary.
      if (url.searchParams.get("encoding") === "base64") {
        const buf = await fs.readFile(p);
        return json(res, 200, { content: buf.toString("base64"), encoding: "base64" });
      }
      const offsetRaw = url.searchParams.get("offset");
      const limitRaw = url.searchParams.get("limit");
      const capRaw = url.searchParams.get("max_bytes");
      const requestedCap = capRaw === null || capRaw.trim() === "" ? NaN : Number(capRaw);
      const responseCap = Number.isSafeInteger(requestedCap)
        ? Math.min(MAX_TEXT_READ_BYTES, Math.max(1, requestedCap))
        : MAX_TEXT_READ_BYTES;
      const headTail = ["1", "true"].includes((url.searchParams.get("head_tail") ?? "").toLowerCase());
      if (url.searchParams.get("allow_sensitive") !== "1" && isSensitiveProjectPath(path.relative(SANDBOX_DIR, p))) {
        throw new Error("access to secret-bearing project paths is blocked");
      }
      if (offsetRaw !== null || limitRaw !== null) {
        const start = Math.max(1, parseInt(offsetRaw ?? "1", 10) || 1);
        const count = Math.max(1, parseInt(limitRaw ?? "2000", 10) || 2000);
        const range = await readBoundedLineRange(p, start, count, responseCap);
        return json(res, 200, {
          content: range.content,
          total_lines: range.totalLines,
          known_lines: range.knownLines,
          has_more: range.hasMore,
          total_bytes: range.totalBytes,
          returned_bytes: range.returnedBytes,
          selected_bytes: range.selectedBytes,
          truncated: range.truncated,
          range_start: start,
          range_end: range.returnedEndLine,
          requested_end: range.requestedEndLine,
        });
      }
      // Default reads are capped in-guest. Binary storage-sync reads use the
      // base64 branch above and deliberately remain complete.
      const read = await readTextWindow(p, responseCap, headTail);
      return json(res, 200, {
        content: read.content,
        total_bytes: read.totalBytes,
        returned_bytes: read.returnedBytes,
        head_bytes: read.headBytes,
        tail_bytes: read.tailBytes,
        omitted_bytes: read.omittedBytes,
        truncated: read.truncated,
      });
    }
    if (method === "GET" && url.pathname === "/fs/manifest") {
      return json(res, 200, { files: await buildManifest() });
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
      // C-114: reject an empty old_string, matching main.rs. With "" Node's
      // split("") yields occ === content.length-1 (1 for a 2-char file), which
      // slips past both guards and replace("", …) inserts at index 0 — mutating
      // the file where Rust's matches("").count() (len+1) 400s as "not unique".
      if (typeof body.old_string !== "string" || body.old_string === "") {
        return json(res, 400, { error: "'old_string' is required and must be a string" });
      }
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
      const matches = await grep(body.pattern ?? "", body.path ?? null, {
        caseInsensitive: body.case_insensitive === true,
        literal: body.literal === true,
      });
      return json(res, 200, {
        matches: matches.matches,
        total_matches: matches.totalMatches,
        returned_matches: matches.returnedMatches,
        omitted_matches: matches.omittedMatches,
        head_matches: matches.headMatches,
        tail_matches: matches.tailMatches,
        truncated: matches.truncated,
        line_truncations: matches.lineTruncations,
      });
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
  const lexicalRoot = path.resolve(SANDBOX_DIR);
  const root = existsSync(lexicalRoot) ? realpathSync(lexicalRoot) : lexicalRoot;
  const lexical = path.resolve(lexicalRoot, rel || ".");
  const full = existsSync(lexical) ? realpathSync(lexical) : lexical;
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

/**
 * C-115: constant-time string compare via crypto.timingSafeEqual. It throws on
 * unequal-length buffers, so we length-guard first — and when lengths differ we
 * still run a timingSafeEqual against a same-length dummy so a wrong-length token
 * isn't trivially distinguishable by an early return. `presented` may be
 * undefined/non-string (missing header) → treated as a mismatch.
 */
function constantTimeEqual(presented, expected) {
  const exp = Buffer.from(String(expected), "utf-8");
  const got = Buffer.from(typeof presented === "string" ? presented : "", "utf-8");
  if (got.length !== exp.length) {
    // Compare expected against itself to keep the work (and timing) similar
    // without leaking via an early return; the result is forced to false.
    timingSafeEqual(exp, exp);
    return false;
  }
  return timingSafeEqual(got, exp);
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

function isSensitiveProjectPath(rel) {
  const parts = String(rel).replaceAll("\\", "/").replace(/^\.\//, "").split("/").filter(Boolean);
  const lower = parts.map((part) => part.toLowerCase());
  const base = lower.at(-1) ?? "";
  if (lower.includes(".ssh")) return true;
  if (lower.includes(".aws") && base === "credentials") return true;
  if (lower.includes(".config") && lower.includes("gcloud")) return true;
  if (base === ".env" || base.startsWith(".env.")) return true;
  if ([".npmrc", ".pypirc", ".netrc", ".git-credentials"].includes(base)) return true;
  if (/^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/.test(base)) return true;
  return /\.(?:key|pem|p12|pfx|crt|cer)$/.test(base);
}

/** Return a UTF-8 prefix no larger than maxBytes without splitting a codepoint. */
function utf8Head(text, maxBytes) {
  const buf = Buffer.from(text);
  if (buf.length <= maxBytes) return text;
  let end = maxBytes;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString("utf-8");
}

/** Bounded full read: model calls keep head+tail; internal calls keep legacy head-only. */
async function readTextWindow(filePath, cap, headTail) {
  const stat = await fs.stat(filePath);
  const useHeadTail = headTail && stat.size > cap && cap >= READ_GAP_RESERVE_BYTES * 2;
  const dataBudget = useHeadTail ? cap - READ_GAP_RESERVE_BYTES : cap;
  const headBudget = useHeadTail ? Math.floor((dataBudget * 2) / 3) : dataBudget;
  const tailBudget = useHeadTail ? dataBudget - headBudget : 0;
  const headBuffer = Buffer.alloc(Math.min(stat.size, headBudget + 3));
  const handle = await fs.open(filePath, "r");
  try {
    const { bytesRead: headRead } = await handle.read(
      headBuffer,
      0,
      headBuffer.length,
      0,
    );
    let headEnd = Math.min(headRead, headBudget);
    while (
      headEnd > 0 &&
      headEnd < headRead &&
      (headBuffer[headEnd] & 0xc0) === 0x80
    ) {
      headEnd--;
    }
    const head = headBuffer.subarray(0, headEnd).toString("utf-8");
    const headBytes = Buffer.byteLength(head);
    if (!useHeadTail) {
      return {
        content: head,
        totalBytes: stat.size,
        returnedBytes: headBytes,
        headBytes,
        tailBytes: 0,
        omittedBytes: Math.max(0, stat.size - headEnd),
        truncated: stat.size > headEnd,
      };
    }

    const tailBuffer = Buffer.alloc(tailBudget);
    const tailOffset = Math.max(0, stat.size - tailBudget);
    const { bytesRead: tailRead } = await handle.read(
      tailBuffer,
      0,
      tailBuffer.length,
      tailOffset,
    );
    let tailStart = 0;
    while (tailStart < tailRead && (tailBuffer[tailStart] & 0xc0) === 0x80) tailStart++;
    const tail = tailBuffer.subarray(tailStart, tailRead).toString("utf-8");
    const tailBytes = Buffer.byteLength(tail);
    const omittedBytes = Math.max(0, stat.size - headEnd - (tailRead - tailStart));
    const marker = `\n\n[... ${omittedBytes} bytes omitted from the middle ...]\n\n`;
    const content = `${head}${marker}${tail}`;
    return {
      content,
      totalBytes: stat.size,
      returnedBytes: Buffer.byteLength(content),
      headBytes,
      tailBytes,
      omittedBytes,
      truncated: omittedBytes > 0,
    };
  } finally {
    await handle.close();
  }
}

/** Stream a 1-based line window, stopping once the window or byte cap is resolved. */
async function readBoundedLineRange(filePath, start, count, cap) {
  const desiredEndLine = Math.min(Number.MAX_SAFE_INTEGER, start + Math.max(0, count - 1));
  const storeLimit = cap + 3;
  const stored = Buffer.alloc(storeLimit);
  const stat = await fs.stat(filePath);
  let selectedBytes = 0;
  let storedBytes = 0;
  let lineNo = 1;
  let stoppedEarly = false;

  const appendSelected = (chunk, from, to) => {
    if (to <= from) return;
    const length = to - from;
    selectedBytes += length;
    if (storedBytes >= storeLimit) return;
    const keep = Math.min(length, storeLimit - storedBytes);
    chunk.copy(stored, storedBytes, from, from + keep);
    storedBytes += keep;
  };

  scan: for await (const chunk of createReadStream(filePath)) {
    let pos = 0;
    while (pos < chunk.length) {
      const newline = chunk.indexOf(0x0a, pos);
      const end = newline === -1 ? chunk.length : newline;
      if (lineNo >= start && lineNo <= desiredEndLine) {
        appendSelected(chunk, pos, end);
        if (storedBytes >= storeLimit) {
          stoppedEarly = true;
          break scan;
        }
      }
      if (newline === -1) break;
      if (lineNo >= start && lineNo < desiredEndLine) {
        appendSelected(chunk, newline, newline + 1);
        if (storedBytes >= storeLimit) {
          stoppedEarly = true;
          break scan;
        }
      }
      const completedLine = lineNo;
      lineNo++;
      pos = newline + 1;
      if (completedLine >= desiredEndLine) {
        stoppedEarly = true;
        break scan;
      }
    }
  }

  const totalLines = stoppedEarly ? null : lineNo;
  const knownLines = lineNo;
  const requestedEndLine = totalLines === null
    ? desiredEndLine
    : start > totalLines
      ? null
      : Math.min(totalLines, desiredEndLine);
  let sourceEnd = Math.min(cap, storedBytes);
  while (sourceEnd > 0 && sourceEnd < storedBytes && (stored[sourceEnd] & 0xc0) === 0x80) {
    sourceEnd--;
  }
  const content = stored.subarray(0, sourceEnd).toString("utf-8");
  let returnedEndLine = null;
  if (requestedEndLine !== null) {
    let returnedNewlines = 0;
    for (let i = 0; i < sourceEnd; i++) {
      if (stored[i] === 0x0a) returnedNewlines++;
    }
    returnedEndLine = Math.min(requestedEndLine, start + returnedNewlines);
  }
  const returnedBytes = Buffer.byteLength(content);
  return {
    content,
    totalBytes: stat.size,
    totalLines,
    knownLines,
    hasMore: stoppedEarly,
    selectedBytes,
    returnedBytes,
    returnedEndLine,
    requestedEndLine,
    truncated: selectedBytes > sourceEnd,
  };
}

/**
 * /fs/manifest walk (C-18 VM→host pull). The skip list mirrors the
 * orchestrator's storage-sync exclusions (storage/sync.ts SKIP_DIRS) so the
 * pull diff and the Storage push agree on what counts as project state.
 * Mirrors build_manifest in main.rs — wire format must stay identical.
 */
const MANIFEST_SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", ".turbo", ".cache", "dist", "build", "out",
  "coverage", "__pycache__", ".pytest_cache", "target", "vendor", ".venv", "venv",
]);
const MANIFEST_MAX_FILES = 20000;

async function buildManifest() {
  const root = path.resolve(SANDBOX_DIR);
  const files = [];
  async function walkDir(dir) {
    if (files.length >= MANIFEST_MAX_FILES) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (files.length >= MANIFEST_MAX_FILES) return;
      if (MANIFEST_SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walkDir(full);
      } else if (e.isFile()) {
        try {
          const st = await fs.stat(full);
          files.push({
            path: path.relative(root, full).split(path.sep).join("/"),
            size: st.size,
            mtime_ms: Math.round(st.mtimeMs),
          });
        } catch {}
      }
    }
  }
  await walkDir(root);
  return files;
}

async function grep(pattern, sub, opts = {}) {
  const target = sub ? resolveSandbox(sub) : SANDBOX_DIR;
  const root = resolveSandbox("");
  // A literal request — or a pattern that won't compile as a regex (e.g. it
  // contains literal parens/brackets the model meant verbatim) — degrades to a
  // case-aware substring test rather than erroring, matching shell grep.
  const ci = opts.caseInsensitive === true;
  let fellBack = false;
  let re = null;
  if (!opts.literal) {
    try {
      re = new RegExp(pattern, ci ? "i" : "");
    } catch {
      fellBack = true;
    }
  }
  const needle = ci ? pattern.toLowerCase() : pattern;
  const test = re
    ? (line) => re.test(line)
    : (line) => (ci ? line.toLowerCase() : line).includes(needle);

  // Prefer rg when an image happens to provide it, but the rootfs does not
  // depend on it. Any spawn/parse/regex incompatibility uses this same bounded
  // streaming fallback instead.
  let bounded = await grepWithRipgrep(pattern, target, root, ci, !re);
  if (!bounded) {
    bounded = createBoundedMatches();
    await walkForGrep(target, root, test, bounded);
  }
  return finishBoundedMatches(bounded, fellBack);
}

function createBoundedMatches() {
  return {
    head: [],
    tail: [],
    headBytes: 0,
    tailBytes: 0,
    collectingHead: true,
    totalMatches: 0,
    lineTruncations: 0,
  };
}

function capGrepLine(line) {
  if (Buffer.byteLength(line) <= MAX_GREP_LINE_BYTES) return { line, shortened: false };
  const marker = " ... [matching line truncated]";
  return {
    line: `${utf8Head(line, MAX_GREP_LINE_BYTES - Buffer.byteLength(marker))}${marker}`,
    shortened: true,
  };
}

function pushBoundedMatch(bounded, rawLine) {
  bounded.totalMatches++;
  const { line, shortened } = capGrepLine(rawLine);
  if (shortened) bounded.lineTruncations++;
  const storedBytes = Buffer.byteLength(line) + 1;
  if (bounded.collectingHead && bounded.headBytes + storedBytes <= GREP_HEAD_BYTES) {
    bounded.head.push(line);
    bounded.headBytes += storedBytes;
    return;
  }

  bounded.collectingHead = false;
  while (bounded.tail.length && bounded.tailBytes + storedBytes > GREP_TAIL_BYTES) {
    const dropped = bounded.tail.shift();
    bounded.tailBytes -= Buffer.byteLength(dropped) + 1;
  }
  if (storedBytes <= GREP_TAIL_BYTES) {
    bounded.tail.push(line);
    bounded.tailBytes += storedBytes;
  }
}

function finishBoundedMatches(bounded, fellBack) {
  const headMatches = bounded.head.length;
  const tailMatches = bounded.tail.length;
  const returnedMatches = headMatches + tailMatches;
  const omittedMatches = Math.max(0, bounded.totalMatches - returnedMatches);
  const chunks = [];
  if (bounded.totalMatches === 0) {
    chunks.push("(no matches)");
  } else {
    if (bounded.head.length) chunks.push(bounded.head.join("\n"));
    if (omittedMatches > 0) {
      chunks.push(`[... ${omittedMatches} middle matches omitted from the bounded guest response ...]`);
    }
    if (bounded.tail.length) chunks.push(bounded.tail.join("\n"));
  }
  let body = chunks.join("\n");
  if (omittedMatches > 0) {
    body += `\n\n[search truncated: showing first ${headMatches} and last ${tailMatches} of ${bounded.totalMatches} matches (${omittedMatches} omitted). Narrow the pattern or path.]`;
  }
  if (bounded.lineTruncations > 0) {
    body += `\n\n[${bounded.lineTruncations} matching line(s) shortened to ${MAX_GREP_LINE_BYTES} bytes each.]`;
  }
  const prefix = fellBack
    ? "[pattern is not a valid regex — searched as a literal substring]\n"
    : "";
  return {
    matches: `${prefix}${body}`,
    totalMatches: bounded.totalMatches,
    returnedMatches,
    omittedMatches,
    headMatches,
    tailMatches,
    truncated: omittedMatches > 0 || bounded.lineTruncations > 0,
    lineTruncations: bounded.lineTruncations,
  };
}

async function grepWithRipgrep(pattern, target, root, ci, literal) {
  if (ripgrepAvailable === false) return null;
  const targetArg = path.relative(root, target) || ".";
  // The walker skips hidden/node_modules entries, but still searches an
  // explicitly selected target beneath one. rg globs would hide that target,
  // so preserve the legacy policy by using the fallback for this rare case.
  if (
    targetArg
      .split(path.sep)
      .some((part) => part !== "." && (part === "node_modules" || part.startsWith(".")))
  ) {
    return null;
  }
  const args = [
    "--json",
    "--no-config",
    "--no-ignore",
    "--hidden",
    "--glob", "!**/node_modules",
    "--glob", "!**/node_modules/**",
    "--glob", "!**/.*",
    "--glob", "!**/.*/**",
    "--color=never",
  ];
  if (ci) args.push("--ignore-case");
  if (literal) args.push("--fixed-strings");
  args.push("--", pattern, targetArg);

  let child;
  try {
    child = spawn("rg", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
  const completion = new Promise((resolve) => {
    child.once("spawn", () => {
      ripgrepAvailable = true;
    });
    child.once("error", (err) => {
      if (err?.code === "ENOENT") ripgrepAvailable = false;
      resolve(null);
    });
    child.once("close", (code) => resolve(code));
  });
  const bounded = createBoundedMatches();
  let parseFailed = false;
  try {
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    for await (const line of lines) {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        parseFailed = true;
        break;
      }
      if (event?.type !== "match") continue;
      const rel = event?.data?.path?.text;
      const lineNo = event?.data?.line_number;
      const source = event?.data?.lines?.text;
      if (typeof rel !== "string" || typeof lineNo !== "number" || typeof source !== "string") {
        parseFailed = true;
        break;
      }
      if (isSensitiveProjectPath(rel)) continue;
      pushBoundedMatch(
        bounded,
        `${rel.startsWith("./") ? rel.slice(2) : rel}:${lineNo}: ${source.trim()}`,
      );
    }
  } catch {
    parseFailed = true;
  }
  if (parseFailed && child.exitCode === null) child.kill("SIGKILL");
  const code = await completion;
  if (parseFailed || (code !== 0 && code !== 1)) return null;
  return bounded;
}

async function walkForGrep(target, root, test, bounded) {
  async function scanFile(full) {
    try {
      const resolved = await fs.realpath(full);
      if (resolved !== root && !resolved.startsWith(root + path.sep)) return;
      const rel = path.relative(root, resolved);
      if (isSensitiveProjectPath(rel)) return;
      const lines = createInterface({ input: createReadStream(resolved), crlfDelay: Infinity });
      let lineNo = 0;
      for await (const line of lines) {
        lineNo++;
        if (test(line)) {
          pushBoundedMatch(bounded, `${rel}:${lineNo}: ${line.trim()}`);
        }
      }
    } catch {
      // skip binary / unreadable
    }
  }

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
      await scanFile(full);
    }
  }
  let targetStat;
  try {
    targetStat = await fs.stat(target);
  } catch {
    return;
  }
  if (targetStat.isFile()) await scanFile(target);
  else if (targetStat.isDirectory()) await walk(target);
}

// Per-stream byte cap for /exec/run (C-61). Keep consuming the stream past
// this so the child doesn't block on a full pipe, but stop storing bytes —
// otherwise `cat /dev/zero` grows the string without bound and OOMs the 1 GiB
// VM. Mirrors RUN_OUTPUT_CAP in main.rs.
const RUN_OUTPUT_CAP = 4 * 1024 * 1024;

async function runCommand(command, timeoutMs) {
  return await new Promise((resolve) => {
    // C-60: detached → the child leads its own process group, so a timeout can
    // SIGKILL the whole group (kill(-pid)) instead of just /bin/sh. Otherwise a
    // daemonized grandchild survives and keeps the stdout/stderr pipes open.
    const child = spawn("/bin/sh", ["-c", command], {
      cwd: SANDBOX_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let stdout = "";
    let stderr = "";
    let stdoutCapped = false;
    let stderrCapped = false;
    let killed = false;
    const t = setTimeout(() => {
      killed = true;
      // Negative pid → signal the whole process group. Fall back to the bare
      // child if the group send fails (e.g. it already exited).
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {}
      }
    }, timeoutMs);
    child.stdout?.on("data", (d) => {
      if (stdoutCapped) return; // keep draining, drop the bytes
      stdout += d.toString();
      if (stdout.length >= RUN_OUTPUT_CAP) {
        stdout = stdout.slice(0, RUN_OUTPUT_CAP);
        stdoutCapped = true;
      }
    });
    child.stderr?.on("data", (d) => {
      if (stderrCapped) return;
      stderr += d.toString();
      if (stderr.length >= RUN_OUTPUT_CAP) {
        stderr = stderr.slice(0, RUN_OUTPUT_CAP);
        stderrCapped = true;
      }
    });
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

/** Is anyone accepting connections on this port right now? */
function isPortBound(port) {
  return new Promise((resolve) => {
    const s = net.createConnection({ port, host: "127.0.0.1" });
    s.once("connect", () => {
      s.end();
      resolve(true);
    });
    s.once("error", () => resolve(false));
  });
}

/**
 * Free a TCP port before we (re)bind it. A prior dev server can be left holding
 * the port — e.g. a zombie orphaned before the process-group fix, or one started
 * via run_command. ss (iproute2, in the rootfs) reports the holding pid; kill it
 * and wait for the socket to release so the new server doesn't hit EADDRINUSE.
 * Without this, the new process can't bind and the OLD one keeps answering — the
 * "restart did nothing / stale code" failure.
 */
async function clearPort(port) {
  if (!(await isPortBound(port))) return;
  try {
    spawnSync("/bin/sh", [
      "-c",
      `for pid in $(ss -tlnpH "sport = :${port}" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u); do kill -9 "$pid" 2>/dev/null || true; done`,
    ]);
  } catch {}
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && (await isPortBound(port))) {
    await new Promise((r) => setTimeout(r, 150));
  }
}

/**
 * Kill a server's WHOLE process tree, not just the `/bin/sh` we spawned. Because
 * we spawn detached (own process group, pgid == child pid), `kill(-pid)` signals
 * sh + npm + the node it spawned. Killing just the sh pid (the old behavior)
 * orphaned the grandchild `node`, which kept holding the port and serving stale
 * code. Falls back to a single-pid kill if the group signal fails.
 */
function killServerTree(child) {
  try {
    if (child.pid) process.kill(-child.pid, "SIGKILL");
    return;
  } catch {}
  try {
    child.kill("SIGKILL");
  } catch {}
}

async function startServer(command, port, readyTimeoutMs) {
  const id = `srv_${randomUUID().slice(0, 8)}`;
  // Clear any process still holding the target port so we truly take it over.
  await clearPort(port);
  const child = spawn("/bin/sh", ["-c", command], {
    cwd: SANDBOX_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    // Lead our own process group so stop_server can kill the whole tree
    // (sh → npm → node), not just sh. Mirrors the run_command path.
    detached: true,
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
    killServerTree(child);
    servers.delete(id);
    throw new Error(`server did not open port ${port} within ${readyTimeoutMs}ms\nrecent log:\n${log.value.slice(-1500)}`);
  }
  return { id, pid: child.pid ?? 0, port };
}

function stopServer(id) {
  const s = servers.get(id);
  if (!s) return;
  killServerTree(s.proc);
  servers.delete(id);
}

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
