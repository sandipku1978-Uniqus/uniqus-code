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
  }): Promise<void> {
    await this.req("PUT", "/snapshot/load", opts);
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
}): Promise<{ pid: number; close: () => void }> {
  const { spawn } = await import("node:child_process");
  await fs.mkdir(path.dirname(opts.socketPath), { recursive: true }).catch(() => {});
  // Stale socket from a crashed prior run — remove so firecracker doesn't EADDRINUSE.
  await fs.rm(opts.socketPath, { force: true }).catch(() => {});

  const args = ["--api-sock", opts.socketPath];
  if (opts.logFifo) args.push("--log-path", opts.logFifo);

  const proc = spawn(opts.binaryPath ?? process.env.FIRECRACKER_BIN ?? "firecracker", args, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!proc.pid) {
    throw new Error("failed to spawn firecracker (binary not found?)");
  }

  // Wait for the socket to exist + accept connections.
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
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

  return {
    pid: proc.pid,
    close: () => {
      try {
        proc.kill("SIGTERM");
      } catch {}
    },
  };
}
