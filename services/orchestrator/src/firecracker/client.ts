import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Firecracker REST API client.
 *
 * Firecracker exposes its control plane on a per-VM Unix socket (default
 * `/var/run/firecracker-<id>.sock`). We talk to it with plain HTTP over
 * that socket. The endpoint shape is stable across Firecracker 1.x —
 * see https://github.com/firecracker-microvm/firecracker/blob/main/src/firecracker/swagger/firecracker.yaml.
 *
 * This file is the lowest layer: it does not own the VM lifecycle or know
 * about TAP devices, kernels, or rootfs. Higher layers in fleet.ts compose
 * these calls.
 */

export class FirecrackerClient {
  constructor(private readonly socketPath: string) {}

  async putBootSource(opts: { kernel_image_path: string; boot_args?: string }): Promise<void> {
    await this.req("PUT", "/boot-source", opts);
  }

  async putDrive(opts: {
    drive_id: string;
    path_on_host: string;
    is_root_device: boolean;
    is_read_only: boolean;
  }): Promise<void> {
    await this.req("PUT", `/drives/${encodeURIComponent(opts.drive_id)}`, opts);
  }

  async putNetworkInterface(opts: {
    iface_id: string;
    host_dev_name: string;
    guest_mac?: string;
  }): Promise<void> {
    await this.req("PUT", `/network-interfaces/${encodeURIComponent(opts.iface_id)}`, opts);
  }

  async putVsock(opts: { guest_cid: number; uds_path: string; vsock_id?: string }): Promise<void> {
    await this.req("PUT", "/vsock", opts);
  }

  async putMachineConfig(opts: {
    vcpu_count: number;
    mem_size_mib: number;
    smt?: boolean;
    track_dirty_pages?: boolean;
  }): Promise<void> {
    await this.req("PUT", "/machine-config", opts);
  }

  async startInstance(): Promise<void> {
    await this.req("PUT", "/actions", { action_type: "InstanceStart" });
  }

  async pauseInstance(): Promise<void> {
    await this.req("PATCH", "/vm", { state: "Paused" });
  }

  async resumeInstance(): Promise<void> {
    await this.req("PATCH", "/vm", { state: "Resumed" });
  }

  async ctrlAltDel(): Promise<void> {
    // Graceful shutdown via in-guest init; works on most Linux rootfs.
    await this.req("PUT", "/actions", { action_type: "SendCtrlAltDel" });
  }

  async createSnapshot(opts: {
    snapshot_path: string;
    mem_file_path: string;
    snapshot_type?: "Full" | "Diff";
  }): Promise<void> {
    await this.req("PUT", "/snapshot/create", opts);
  }

  async loadSnapshot(opts: {
    snapshot_path: string;
    mem_backend: { backend_type: "File" | "Uffd"; backend_path: string };
    enable_diff_snapshots?: boolean;
    resume_vm?: boolean;
    /**
     * Remap a network interface's host-side TAP at restore time. The guest-side
     * config (IP/MAC) is frozen in the snapshot, so when restoring MANY clones
     * from one base snapshot we point each clone's eth0 at its own host tap.
     * (Firecracker v1.12.0+ SnapshotLoadParams.network_overrides — older
     * builds 400 on this field and the golden restore falls back to cold boot.)
     */
    network_overrides?: { iface_id: string; host_dev_name: string }[];
  }): Promise<void> {
    await this.req("PUT", "/snapshot/load", opts);
  }

  /**
   * Update a drive's backing file at runtime (Firecracker only allows patching
   * `path_on_host` + the rate limiter). NOTE: the base-snapshot restore path
   * deliberately does NOT use this — it gives each clone its own disk via a
   * RELATIVE drive path resolved against the per-VM firecracker cwd, the
   * documented bug-free clone pattern. Kept for runtime drive swaps / hot
   * resize, where the new image must match the size the guest already saw.
   */
  async patchDrive(opts: { drive_id: string; path_on_host: string }): Promise<void> {
    await this.req("PATCH", `/drives/${encodeURIComponent(opts.drive_id)}`, opts);
  }

  async getInstanceInfo(): Promise<{ state: string; vmm_version: string; app_name: string }> {
    return await this.req<{ state: string; vmm_version: string; app_name: string }>("GET", "/");
  }

  // ── transport ─────────────────────────────────────────────────────────────
  private req<T = unknown>(method: string, urlPath: string, body?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
      const req = http.request(
        {
          socketPath: this.socketPath,
          method,
          path: urlPath,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            ...(payload ? { "Content-Length": String(payload.length) } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c as Buffer));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf-8");
            if (!res.statusCode || res.statusCode >= 400) {
              reject(
                new Error(
                  `firecracker ${method} ${urlPath} → ${res.statusCode}: ${text.slice(0, 500)}`,
                ),
              );
              return;
            }
            if (!text) return resolve(undefined as T);
            try {
              resolve(JSON.parse(text) as T);
            } catch {
              resolve(text as unknown as T);
            }
          });
        },
      );
      req.once("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  }
}

/**
 * Spawn a Firecracker process bound to a fresh Unix socket and wait for the
 * socket to become connectable. Returns the pid + socket path so the fleet
 * manager can configure the VM.
 *
 * Important: the firecracker binary must be in PATH (or pointed at by
 * FIRECRACKER_BIN). This call doesn't supervise the process — that's the
 * fleet manager's job.
 */
export async function spawnFirecracker(opts: {
  socketPath: string;
  logFifo?: string;
  binaryPath?: string;
  /**
   * Working directory for the firecracker process. Drives configured with a
   * RELATIVE `path_on_host` resolve against this dir — both when a snapshot is
   * taken and when it's loaded — which is how one base snapshot fans out to many
   * clones each backed by their own per-project disk (Firecracker's documented
   * "relative paths + per-sandbox cwd" pattern). Absolute drive paths (the
   * shared read-only rootfs) are unaffected.
   */
  cwd?: string;
}): Promise<{ pid: number; close: () => void }> {
  const { spawn } = await import("node:child_process");
  await fs.mkdir(path.dirname(opts.socketPath), { recursive: true }).catch(() => {});
  // Stale socket from a crashed prior run — remove so firecracker doesn't EADDRINUSE.
  await fs.rm(opts.socketPath, { force: true }).catch(() => {});

  const args = ["--api-sock", opts.socketPath];
  if (opts.logFifo) args.push("--log-path", opts.logFifo);

  const binaryPath = opts.binaryPath ?? process.env.FIRECRACKER_BIN ?? "firecracker";
  if (opts.cwd) await fs.mkdir(opts.cwd, { recursive: true }).catch(() => {});
  const proc = spawn(binaryPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    cwd: opts.cwd,
  });
  // Capture spawn errors (most commonly ENOENT when the binary isn't on PATH
  // for systemd's stripped environment). Without this listener, the error
  // lands as an uncaughtException AFTER our pid check passes, and the caller
  // hangs waiting for a socket that will never appear.
  const errorBox: { err: Error | null } = { err: null };
  proc.once("error", (err) => {
    errorBox.err = err;
    console.error(`[firecracker] spawn '${binaryPath}' failed:`, err.message);
  });
  // Pipe firecracker's stdout/stderr to the orchestrator's journal with a
  // [fc:<pid>] tag. With `console=ttyS0` in the kernel boot args, this
  // includes the entire guest serial console: kernel boot, OpenRC startup,
  // and the in-VM agent's stdout. Critical for diagnosing boot hangs.
  let stderrTail = "";
  const tag = `[fc:${proc.pid ?? "?"}]`;
  const MAX_SERIAL_LINES = 2000;
  const MAX_SERIAL_LINE_CHARS = 2000;
  let serialLines = 0;
  let serialSuppressionLogged = false;
  const logSerial = (line: string, stderr: boolean): void => {
    if (!line) return;
    if (serialLines >= MAX_SERIAL_LINES) {
      if (!serialSuppressionLogged) {
        serialSuppressionLogged = true;
        console.error(`${tag} serial output suppressed after ${MAX_SERIAL_LINES} lines`);
      }
      return;
    }
    serialLines += 1;
    const bounded = line.length > MAX_SERIAL_LINE_CHARS
      ? `${line.slice(0, MAX_SERIAL_LINE_CHARS)}...`
      : line;
    if (stderr) console.error(`${tag} ${bounded}`);
    else console.log(`${tag} ${bounded}`);
  };
  proc.stdout?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      logSerial(line, false);
    }
  });
  proc.stderr?.on("data", (chunk: Buffer) => {
    const s = chunk.toString();
    stderrTail = (stderrTail + s).slice(-2000);
    for (const line of s.split(/\r?\n/)) {
      logSerial(line, true);
    }
  });

  if (!proc.pid) {
    throw new Error(`failed to spawn firecracker (binary='${binaryPath}', err=${errorBox.err?.message ?? "unknown"})`);
  }

  // Wait for the socket to exist + accept connections.
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (errorBox.err) {
      throw new Error(
        `firecracker spawn errored after pid was assigned: ${errorBox.err.message}. ` +
          `If this says ENOENT, '${binaryPath}' is not in PATH for systemd. ` +
          `Add: Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin to the unit override.`,
      );
    }
    try {
      await fs.access(opts.socketPath);
      const ok = await new Promise<boolean>((resolve) => {
        const c = http.request(
          { socketPath: opts.socketPath, method: "GET", path: "/" },
          (res) => {
            res.resume();
            resolve(true);
          },
        );
        c.once("error", () => resolve(false));
        c.end();
      });
      if (ok) break;
    } catch {
      // not yet
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  if (errorBox.err) {
    throw new Error(`firecracker spawn errored: ${errorBox.err.message}`);
  }
  // If the socket never appeared but no error fired, the binary started but
  // exited fast (kernel/rootfs missing, --api-sock arg invalid, etc.).
  // Surface stderr so the user sees the actual reason.
  try {
    await fs.access(opts.socketPath);
  } catch {
    throw new Error(
      `firecracker did not create API socket at ${opts.socketPath} within 5s.\n` +
        `firecracker stderr: ${stderrTail || "(empty)"}`,
    );
  }

  return {
    pid: proc.pid,
    close: () => {
      try {
        proc.kill("SIGTERM");
      } catch {}
    },
  };
}
