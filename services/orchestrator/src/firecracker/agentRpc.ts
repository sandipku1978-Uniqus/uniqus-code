import http from "node:http";
import type { VmHandle } from "./types.js";
import { touch as touchVm } from "./fleet.js";

/**
 * Orchestrator → in-VM sandbox-agent RPC client.
 *
 * Transport: plain HTTP/1.1 over the per-VM TAP network. Each VM gets a
 * static IP on the fcbr0 bridge (assigned at boot via the kernel `ip=`
 * cmdline); the in-VM agent listens on `0.0.0.0:agentPort`. The host
 * routes to that IP through the bridge — no vsock, no Unix socket, no
 * bridge daemon inside the VM.
 *
 * (Earlier revisions tried Firecracker's vsock CONNECT handshake to talk
 * to a UDS on the host. That requires a vsock<->TCP shim inside the VM
 * which we never wired up. TAP networking is simpler and we already have
 * it — the fleet manager allocates an IP per project and stamps it on
 * the VmHandle.)
 *
 * Every method here returns a clean Error on transport failure with the
 * VM id + RPC name so fleet-manager logs are immediately useful.
 *
 * The in-VM agent is the Rust binary at services/sandbox-agent/src/main.rs
 * (Plan §1). The legacy Node impl at src/agent.mjs remains as a build-time
 * fallback when the host has no Rust toolchain. Wire format is identical
 * across both — every change here must be mirrored in both implementations.
 */

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export async function readFile(vm: VmHandle, p: string): Promise<string> {
  const r = await rpc<{ content: string }>(vm, "GET", `/fs/file?path=${encodeURIComponent(p)}`);
  return r.content;
}

export async function writeFile(vm: VmHandle, p: string, content: string): Promise<void> {
  await rpc(vm, "PUT", "/fs/file", { path: p, content });
}

export async function editFile(
  vm: VmHandle,
  p: string,
  oldString: string,
  newString: string,
): Promise<void> {
  await rpc(vm, "POST", "/fs/edit", { path: p, old_string: oldString, new_string: newString });
}

export async function listDir(vm: VmHandle, p?: string): Promise<string[]> {
  const r = await rpc<{ entries: string[] }>(
    vm,
    "GET",
    `/fs/dir?path=${encodeURIComponent(p ?? "")}`,
  );
  return r.entries;
}

export async function grep(vm: VmHandle, pattern: string, p?: string): Promise<string> {
  const r = await rpc<{ matches: string }>(
    vm,
    "POST",
    "/fs/grep",
    { pattern, path: p ?? null },
  );
  return r.matches;
}

export async function runCommand(
  vm: VmHandle,
  command: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<CommandResult> {
  // The in-VM agent honors the timeout itself; we set our HTTP read deadline
  // a touch higher so a clean timeout returns CommandResult instead of an
  // exception. AbortSignal short-circuits the request.
  return await rpc<CommandResult>(
    vm,
    "POST",
    "/exec/run",
    { command, timeout_ms: timeoutMs },
    { signal, readTimeoutMs: timeoutMs + 5_000 },
  );
}

export async function startServer(
  vm: VmHandle,
  command: string,
  port: number,
  readyTimeoutMs: number,
  signal?: AbortSignal,
): Promise<{ id: string; pid: number; port: number }> {
  return await rpc<{ id: string; pid: number; port: number }>(
    vm,
    "POST",
    "/exec/start-server",
    { command, port, ready_timeout_ms: readyTimeoutMs },
    { signal, readTimeoutMs: readyTimeoutMs + 5_000 },
  );
}

export async function stopServer(vm: VmHandle, id: string): Promise<void> {
  await rpc(vm, "POST", "/exec/stop-server", { id });
}

export async function readServerLog(vm: VmHandle, id: string, maxBytes: number): Promise<string> {
  const r = await rpc<{ log: string }>(
    vm,
    "GET",
    `/exec/server-log?id=${encodeURIComponent(id)}&max_bytes=${maxBytes}`,
  );
  return r.log;
}

export async function ping(vm: VmHandle): Promise<boolean> {
  return (await pingAgent(vm)) !== null;
}

/**
 * Like `ping` but returns the agent's self-reported `kind` ("rust" | "node")
 * on success, or null on transport failure. The fleet manager uses this on
 * boot so it can stamp the VmHandle with which implementation answered.
 */
export async function pingAgent(
  vm: VmHandle,
): Promise<"rust" | "node" | "unknown" | null> {
  try {
    // Short timeout: while the VM is still booting, the kernel will RST
    // (fast fail) or the route will timeout. Either way we want to retry
    // quickly rather than blocking the boot loop on a dead probe.
    const r = await rpc<{ ok: true; kind?: string }>(
      vm,
      "GET",
      "/health",
      undefined,
      { readTimeoutMs: 500 },
    );
    if (r.kind === "rust" || r.kind === "node") return r.kind;
    // An older agent without the `kind` field still passes /health; treat
    // it as unknown rather than returning null, so boot succeeds.
    return "unknown";
  } catch {
    return null;
  }
}

/** One row of the in-VM file inventory (GET /fs/manifest). */
export interface VmFileEntry {
  path: string;
  size: number;
  mtime_ms: number;
}

/**
 * Inventory of every file under /sandbox (storage-sync exclusions applied
 * in-guest). Powers the VM→host pull (C-18). Throws HTTP 404 on agents that
 * predate the endpoint — callers fall back to an exec-based walk.
 */
export async function manifest(vm: VmHandle): Promise<VmFileEntry[]> {
  const r = await rpc<{ files: VmFileEntry[] }>(vm, "GET", "/fs/manifest", undefined, {
    readTimeoutMs: 20_000,
  });
  return Array.isArray(r.files) ? r.files : [];
}

/**
 * Binary-safe file read. Returns null when the agent predates base64 reads —
 * an old agent ignores the query param and replies without `encoding`, and
 * treating that UTF-8-mangled text as file content would corrupt binaries.
 * Callers fall back to a chunked in-guest `dd | base64` exec read.
 */
export async function readFileBinary(vm: VmHandle, p: string): Promise<Buffer | null> {
  const r = await rpc<{ content: string; encoding?: string }>(
    vm,
    "GET",
    `/fs/file?path=${encodeURIComponent(p)}&encoding=base64`,
  );
  if (r.encoding !== "base64") return null;
  return Buffer.from(r.content, "base64");
}

/**
 * Push a file into the VM during boot-time hydration. Used by the fleet
 * manager to seed the project files into the guest before handing the
 * sandbox to the agent loop.
 */
export async function pushFile(
  vm: VmHandle,
  relPath: string,
  content: Buffer | string,
): Promise<void> {
  const body =
    typeof content === "string" ? content : content.toString("base64");
  const isBinary = typeof content !== "string";
  await rpc(vm, "PUT", "/fs/file", {
    path: relPath,
    content: body,
    encoding: isBinary ? "base64" : "utf-8",
  });
}

/**
 * One-off control call to an agent at an EXPLICIT ip:port (not a VmHandle).
 *
 * A base-snapshot clone resumes holding the golden image's frozen "bootstrap"
 * identity (a fixed IP + MAC, identical on every clone). The orchestrator
 * reaches the clone on that bootstrap IP and calls `/net/configure` to stamp
 * THIS project's real MAC + IP + default route, mount its sandbox drive, and
 * de-correlate the clock/RNG — after which the clone lives under its own unique
 * identity and all further RPC uses the normal per-project `vm.ip` path.
 *
 * Because the bootstrap identity is shared, callers must hold the fleet's global
 * bootstrap lock around resume→finalize so only one clone wears it at a time.
 */
export async function finalizeRestore(
  bootstrapIp: string,
  port: number,
  body: {
    /** Per-project address as "addr/prefix", e.g. "172.16.3.4/16". */
    ip: string;
    gw: string;
    /** Per-project locally-administered MAC. */
    mac: string;
    /** Mount the (just-repointed) sandbox drive at /sandbox. */
    mount_sandbox: boolean;
    /** Base64 entropy mixed into the clone's /dev/urandom. */
    seed: string;
    /** Host wall-clock (epoch millis) to correct the frozen guest clock. */
    time_ms: number;
  },
  readTimeoutMs = 4_000,
): Promise<void> {
  await rawRequest(bootstrapIp, port, "POST", "/net/configure", body, readTimeoutMs);
}

/** Probe an agent at an explicit ip:port (used while waiting on a restored clone). */
export async function pingAt(ip: string, port: number, readTimeoutMs = 500): Promise<boolean> {
  try {
    await rawRequest(ip, port, "GET", "/health", undefined, readTimeoutMs);
    return true;
  } catch {
    return false;
  }
}

/** Minimal HTTP helper for VM-handle-less control calls (no idle-touch). */
function rawRequest(
  host: string,
  port: number,
  method: string,
  urlPath: string,
  body: unknown,
  readTimeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        host,
        port,
        method,
        path: urlPath,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": String(payload.length) } : {}),
        },
        timeout: readTimeoutMs,
      },
      (res) => {
        res.resume();
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          if (status >= 400 || status === 0) {
            reject(new Error(`${method} ${host}:${port}${urlPath} → HTTP ${status}`));
          } else {
            resolve();
          }
        });
      },
    );
    req.once("timeout", () => {
      req.destroy();
      reject(new Error(`${method} ${host}:${port}${urlPath} read timeout (${readTimeoutMs}ms)`));
    });
    req.once("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── transport ──────────────────────────────────────────────────────────────

interface RpcOpts {
  signal?: AbortSignal;
  /** Hard cap on the time we'll wait for response bytes. */
  readTimeoutMs?: number;
}

function rpc<T = void>(
  vm: VmHandle,
  method: string,
  path: string,
  body?: unknown,
  opts: RpcOpts = {},
): Promise<T> {
  // Mark this VM as recently active so the idle sweeper can't pause it
  // mid-tool-call. Without this, only `user_message` arrival counted as
  // "active", so a long npm install (which is many run_command RPCs but
  // a single user message) would lose its VM at the 5-min mark and
  // every subsequent RPC would EHOSTUNREACH.
  touchVm(vm.projectId);
  return new Promise<T>((resolve, reject) => {
    const readTimeout = opts.readTimeoutMs ?? 30_000;
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: vm.ip,
      port: vm.agentPort,
      method,
      path,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(payload ? { "Content-Length": String(payload.length) } : {}),
        // F1: authenticate to the in-VM agent so a peer VM on the shared bridge
        // can't drive it. Always sent when provisioned; the agent only ENFORCES
        // once FIRECRACKER_AGENT_AUTH=1 (dark-launch safe).
        ...(vm.authToken ? { Authorization: `Bearer ${vm.authToken}` } : {}),
      },
      timeout: readTimeout,
    });

    const fail = (err: Error): void => {
      // Always remove the abort listener — otherwise we leak one per RPC
      // and trip MaxListenersExceededWarning after ~11 parallel calls.
      if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
      try {
        req.destroy();
      } catch {}
      reject(new Error(`[vm ${vm.id}] ${method} ${path}: ${err.message}`));
    };

    const onAbort = (): void => fail(new Error("aborted"));
    if (opts.signal) {
      if (opts.signal.aborted) {
        onAbort();
        return;
      }
      opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    req.once("timeout", () => fail(new Error(`read timeout (${readTimeout}ms)`)));
    req.once("error", fail);

    req.once("response", (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      // Without this, a mid-body stream error never settles the promise and
      // the abort listener leaks (the data/end path never runs).
      res.on("error", (err) => fail(err));
      res.on("end", () => {
        if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
        const text = Buffer.concat(chunks).toString("utf-8");
        const status = res.statusCode ?? 0;
        if (status >= 400 || status === 0) {
          reject(
            new Error(`[vm ${vm.id}] ${method} ${path}: HTTP ${status}: ${text.slice(0, 500)}`),
          );
          return;
        }
        if (!text) {
          resolve(undefined as unknown as T);
          return;
        }
        try {
          resolve(JSON.parse(text) as T);
        } catch {
          resolve(text as unknown as T);
        }
      });
    });

    if (payload) req.write(payload);
    req.end();
  });
}
