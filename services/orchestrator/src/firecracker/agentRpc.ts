import http from "node:http";
import net from "node:net";
import type { VmHandle } from "./types.js";

/**
 * Orchestrator → in-VM sandbox-agent RPC client.
 *
 * Transport: vsock. Firecracker exposes a host-side AF_UNIX endpoint for
 * each guest CID; connecting to that socket and writing `CONNECT <port>\n`
 * opens a stream to the guest's vsock listener. We frame plain HTTP/1.1
 * over that stream — keeps the in-VM agent dirt-simple (it's just a tiny
 * Node http.createServer bound on vsock-ssh — see services/sandbox-agent).
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
    await rpc<{ ok: true }>(vm, "GET", "/health", undefined, { readTimeoutMs: 1500 });
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
    // The vsock-bridged unix socket uses Firecracker's "CONNECT <port>\n"
    // handshake. We open a raw socket, send the handshake, wait for the
    // VM's "OK <buf_alloc>\n" reply, then framing HTTP over it.
    const sock = net.createConnection(vm.vsockUds);
    const readTimeout = opts.readTimeoutMs ?? 30_000;

    let phase: "handshake" | "http" = "handshake";
    let buf = Buffer.alloc(0);
    const cleanup = (): void => {
      try {
        sock.destroy();
      } catch {}
    };

    const fail = (err: Error): void => {
      cleanup();
      reject(
        new Error(
          `[vm ${vm.id}] ${method} ${path}: ${err.message}`,
        ),
      );
    };

    const onAbort = (): void => fail(new Error("aborted"));
    if (opts.signal) {
      if (opts.signal.aborted) {
        onAbort();
        return;
      }
      opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    const deadline = setTimeout(() => fail(new Error(`read timeout (${readTimeout}ms)`)), readTimeout);

    sock.once("error", fail);

    sock.once("connect", () => {
      sock.write(`CONNECT ${vm.agentPort}\n`);
    });

    sock.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (phase === "handshake") {
        const nl = buf.indexOf(0x0a); // '\n'
        if (nl < 0) return;
        const line = buf.subarray(0, nl).toString("utf-8");
        buf = buf.subarray(nl + 1);
        if (!line.startsWith("OK")) {
          fail(new Error(`vsock handshake refused: ${line}`));
          return;
        }
        phase = "http";

        // Now send the HTTP request and capture response.
        const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
        const headers = [
          `${method} ${path} HTTP/1.1`,
          `Host: vm-${vm.id}`,
          `Connection: close`,
          ...(payload
            ? [`Content-Type: application/json`, `Content-Length: ${payload.length}`]
            : []),
          ``,
          ``,
        ].join("\r\n");
        sock.write(headers);
        if (payload) sock.write(payload);
        // From here, the next chunks are the HTTP response.
      } else if (phase === "http") {
        // accumulate; final assembly happens in 'end'
      }
    });

    sock.once("end", () => {
      clearTimeout(deadline);
      if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
      if (phase !== "http") return; // failed before request
      // Parse HTTP/1.1 response.
      const headerEnd = buf.indexOf("\r\n\r\n");
      if (headerEnd < 0) {
        reject(new Error(`[vm ${vm.id}] ${method} ${path}: no HTTP response`));
        return;
      }
      const headerText = buf.subarray(0, headerEnd).toString("utf-8");
      const bodyText = buf.subarray(headerEnd + 4).toString("utf-8");
      const statusLine = headerText.split("\r\n")[0] ?? "";
      const m = /^HTTP\/1\.[01] (\d{3})/.exec(statusLine);
      const status = m ? Number(m[1]) : 0;
      if (status >= 400 || status === 0) {
        reject(
          new Error(
            `[vm ${vm.id}] ${method} ${path}: HTTP ${status}: ${bodyText.slice(0, 500)}`,
          ),
        );
        return;
      }
      if (!bodyText) {
        resolve(undefined as unknown as T);
        return;
      }
      try {
        resolve(JSON.parse(bodyText) as T);
      } catch {
        resolve(bodyText as unknown as T);
      }
    });
  });
}

// Force the Node.js HTTP type into TS scope so http.* references typecheck.
// We don't actually use it at runtime — we hand-frame the request bytes
// because the vsock CONNECT handshake doesn't fit Node's http module.
void http;
