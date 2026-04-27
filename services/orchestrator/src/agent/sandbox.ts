import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import treeKill from "tree-kill";

export const sandboxEvents = new EventEmitter();

export interface Sandbox {
  rootDir: string;
}

const HALF_MAX = 8 * 1024;
const MAX_LOG = 64 * 1024;

interface ShellChoice {
  shell: string;
  prefix: string[];
  name: string;
  isUnixLike: boolean;
}

let cachedShell: ShellChoice | null = null;

function pickShell(): ShellChoice {
  if (cachedShell) return cachedShell;
  if (process.platform === "win32") {
    const candidates = [
      "C:\\Program Files\\Git\\bin\\bash.exe",
      "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
      "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    ];
    for (const c of candidates) {
      if (existsSync(c)) {
        cachedShell = { shell: c, prefix: ["-c"], name: "git-bash", isUnixLike: true };
        return cachedShell;
      }
    }
    cachedShell = { shell: "cmd.exe", prefix: ["/c"], name: "cmd.exe", isUnixLike: false };
    return cachedShell;
  }
  cachedShell = { shell: "/bin/sh", prefix: ["-c"], name: "sh", isUnixLike: true };
  return cachedShell;
}

export function shellInfo(): { name: string; isUnixLike: boolean } {
  const c = pickShell();
  return { name: c.name, isUnixLike: c.isUnixLike };
}

function resolvePath(sandbox: Sandbox, p: string): string {
  const root = path.resolve(sandbox.rootDir);
  const resolved = path.resolve(root, p);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Path escapes sandbox: ${p}`);
  }
  return resolved;
}

export async function readFile(sandbox: Sandbox, p: string): Promise<string> {
  return await fs.readFile(resolvePath(sandbox, p), "utf-8");
}

export async function writeFile(sandbox: Sandbox, p: string, content: string): Promise<void> {
  const full = resolvePath(sandbox, p);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf-8");
}

export async function editFile(
  sandbox: Sandbox,
  p: string,
  oldString: string,
  newString: string,
): Promise<void> {
  const full = resolvePath(sandbox, p);
  const content = await fs.readFile(full, "utf-8");
  const occurrences = content.split(oldString).length - 1;
  if (occurrences === 0) throw new Error(`old_string not found in ${p}`);
  if (occurrences > 1) throw new Error(`old_string is not unique in ${p} (${occurrences} matches)`);
  await fs.writeFile(full, content.replace(oldString, newString), "utf-8");
}

export async function listDir(sandbox: Sandbox, p?: string): Promise<string[]> {
  const target = p ? resolvePath(sandbox, p) : path.resolve(sandbox.rootDir);
  const entries = await fs.readdir(target, { withFileTypes: true });
  return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
}

export async function grep(sandbox: Sandbox, pattern: string, p?: string): Promise<string> {
  const target = p ? resolvePath(sandbox, p) : path.resolve(sandbox.rootDir);
  const regex = new RegExp(pattern);
  const results: string[] = [];
  const root = path.resolve(sandbox.rootDir);

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        try {
          const content = await fs.readFile(full, "utf-8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              results.push(`${path.relative(root, full)}:${i + 1}: ${lines[i].trim()}`);
            }
          }
        } catch {
          // skip binary or unreadable files
        }
      }
    }
  }

  await walk(target);
  return results.length > 0 ? results.join("\n") : "(no matches)";
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export async function runCommand(
  sandbox: Sandbox,
  command: string,
  timeoutMs = 60_000,
  signal?: AbortSignal,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const choice = pickShell();
    const child = spawn(choice.shell, [...choice.prefix, command], {
      cwd: sandbox.rootDir,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let killed = false;
    let abortedByUser = false;

    const timer = setTimeout(() => {
      killed = true;
      if (child.pid) treeKill(child.pid, "SIGKILL");
    }, timeoutMs);

    const onAbort = (): void => {
      abortedByUser = true;
      killed = true;
      if (child.pid) treeKill(child.pid, "SIGKILL");
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      if (abortedByUser) stderr += `\n[killed: aborted by user]`;
      else if (killed) stderr += `\n[killed: timeout after ${timeoutMs}ms]`;
      resolve({ stdout: truncate(stdout), stderr: truncate(stderr), exitCode: code });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve({ stdout: "", stderr: `[spawn error] ${err.message}`, exitCode: 1 });
    });
  });
}

function truncate(s: string): string {
  if (s.length <= HALF_MAX * 2) return s;
  const head = s.slice(0, HALF_MAX);
  const tail = s.slice(-HALF_MAX);
  return `${head}\n\n[... truncated ${s.length - HALF_MAX * 2} bytes ...]\n\n${tail}`;
}

export async function waitForPort(port: number, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const sock = net.createConnection({ port, host: "127.0.0.1" });
      sock.once("connect", () => {
        sock.end();
        resolve(true);
      });
      sock.once("error", () => resolve(false));
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

// ── server management ────────────────────────────────────────────────────────

export interface ServerInfo {
  id: string;
  command: string;
  port: number;
  pid: number;
  started_at: number;
}

interface ManagedServer extends ServerInfo {
  proc: ChildProcess;
  log: { value: string };
  project_id: string | null;
}

const servers = new Map<string, ManagedServer>();

export async function startServer(
  sandbox: Sandbox,
  command: string,
  port: number,
  readyTimeoutMs = 60_000,
  projectId: string | null = null,
): Promise<ServerInfo> {
  const id = `srv_${randomUUID().slice(0, 8)}`;
  const choice = pickShell();
  const proc = spawn(choice.shell, [...choice.prefix, command], {
    cwd: sandbox.rootDir,
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Attach an `error` listener IMMEDIATELY. Without it, Node treats a spawn
  // failure (binary missing, EAGAIN, ENOMEM, etc.) as an uncaught exception
  // and kills the orchestrator process — which was crashing Railway every
  // time the Run button or agent tried to start something the host couldn't
  // launch. We capture the error and surface it through the awaited promise
  // below instead.
  // Use a holder object so TS doesn't narrow the variable to `null` after
  // initialization — the listener mutates it asynchronously.
  const errorBox: { err: Error | null } = { err: null };
  proc.once("error", (err) => {
    errorBox.err = err;
  });

  if (!proc.pid) {
    // Give Node a tick to emit the deferred 'error' event so we have its
    // message rather than a generic "Failed to spawn".
    await new Promise((r) => setImmediate(r));
    throw new Error(
      `Failed to spawn server process${errorBox.err ? `: ${errorBox.err.message}` : ""}`,
    );
  }

  const log = { value: "" };
  const append = (chunk: Buffer): void => {
    log.value = (log.value + chunk.toString()).slice(-MAX_LOG);
  };
  proc.stdout?.on("data", append);
  proc.stderr?.on("data", append);

  const server: ManagedServer = {
    id,
    command,
    port,
    pid: proc.pid,
    started_at: Date.now(),
    proc,
    log,
    project_id: projectId,
  };
  servers.set(id, server);

  proc.on("exit", () => {
    if (servers.delete(id)) {
      sandboxEvents.emit("server_exit", id, projectId);
    }
  });

  const ok = await waitForPort(port, readyTimeoutMs);
  if (errorBox.err) {
    servers.delete(id);
    throw new Error(`Server spawn failed: ${errorBox.err.message}`);
  }
  if (!ok) {
    treeKill(proc.pid, "SIGKILL");
    servers.delete(id);
    throw new Error(
      `Server did not open port ${port} within ${readyTimeoutMs}ms.\nRecent log:\n${log.value.slice(-2000)}`,
    );
  }

  return { id, command, port, pid: server.pid, started_at: server.started_at };
}

export function stopServer(id: string): void {
  const server = servers.get(id);
  if (!server) throw new Error(`No server with id ${id}`);
  treeKill(server.pid, "SIGKILL");
  servers.delete(id);
}

export function listServers(projectId?: string | null): ServerInfo[] {
  const all = Array.from(servers.values());
  const filtered =
    projectId === undefined ? all : all.filter((s) => s.project_id === projectId);
  return filtered.map((s) => ({
    id: s.id,
    command: s.command,
    port: s.port,
    pid: s.pid,
    started_at: s.started_at,
  }));
}

export function getServer(
  id: string,
): { id: string; command: string; port: number; project_id: string | null } | null {
  const s = servers.get(id);
  if (!s) return null;
  return { id: s.id, command: s.command, port: s.port, project_id: s.project_id };
}

export function readServerLog(id: string, maxBytes = 8000): string {
  const server = servers.get(id);
  if (!server) throw new Error(`No server with id ${id}`);
  return server.log.value.slice(-maxBytes);
}

export function stopAllServers(): void {
  for (const s of servers.values()) {
    try {
      treeKill(s.pid, "SIGKILL");
    } catch {}
  }
  servers.clear();
}

process.on("exit", stopAllServers);
process.on("SIGINT", () => {
  stopAllServers();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stopAllServers();
  process.exit(0);
});
