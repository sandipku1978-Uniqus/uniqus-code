import http from "node:http";
import type { VmHandle } from "./types.js";

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
 * NOTE: today the agent is Node-based for ergonomic reasons (rootfs already
 * carries Node, wire format is plain JSON). Plan §1 calls for a Rust port
 * once the substrate is hot — wire protocol stays identical, only the
 * binary swaps.
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
  try {
    // Short timeout: while the VM is still booting, the kernel will RST
    // (fast fail) or the route will timeout. Either way we want to retry
    // quickly rather than blocking the boot loop on a dead probe.
    await rpc<{ ok: true }>(vm, "GET", "/health", undefined, { readTimeoutMs: 500 });
    return true;
  } catch {
    return false;
  }
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
      },
      timeout: readTimeout,
    });

    const fail = (err: Error): void => {
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
