import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import treeKill from "tree-kill";
import { safeChildEnv } from "../safeEnv.js";
import * as fcAgent from "../firecracker/agentRpc.js";
import type { Sandbox } from "./sandbox.js";

/**
 * `run_in_background` (Plan §3.2) — distinct from `run_command` and from the
 * Phase-3 scheduled-job runner.
 *
 * - run_command: short-lived, blocks the tool loop until exit.
 * - start_server: long-lived, dev-server-shaped, ports + previews.
 * - run_in_background: long-lived, NOT a server (no port wait). Builds, test
 *   suites, install steps. Returns immediately with a job id; the agent
 *   polls with read_background_log / list_background / kill_background.
 *
 * Use case: the agent needs to kick off `npm run build` and continue working
 * (write tests, edit source) without blocking the tool loop for 60-300s.
 */

const MAX_LOG = 64 * 1024;
/**
 * Hard cap for VM-backed background jobs. In Firecracker mode we run the job
 * as a single in-VM run_command RPC (no streaming-job RPC exists), so we need
 * an upper bound — installs/builds/tests all finish well inside 10 min.
 */
const VM_JOB_TIMEOUT_MS = 10 * 60_000;

interface ManagedJob {
  id: string;
  command: string;
  /** null for VM-backed jobs (no host child process). */
  proc: ChildProcess | null;
  log: { value: string };
  exit_code: number | null;
  started_at: number;
  finished_at: number | null;
  project_id: string | null;
}

const jobs = new Map<string, ManagedJob>();

// Finished jobs were never removed from the map (only killAllJobs at process
// exit cleared it), so each run_in_background left an entry holding up to
// MAX_LOG of captured log forever — a slow unbounded leak on the long-lived
// orchestrator (C-85/C-86). Evict jobs that finished more than this long ago;
// callers poll status/log within seconds of completion, so a few minutes is
// ample retention. Swept lazily on each new job start (no extra timer).
const FINISHED_JOB_TTL_MS = 5 * 60 * 1000;
function evictFinishedJobs(): void {
  const cutoff = Date.now() - FINISHED_JOB_TTL_MS;
  for (const [id, j] of jobs) {
    if (j.finished_at !== null && j.finished_at < cutoff) jobs.delete(id);
  }
}

interface ShellChoice {
  shell: string;
  prefix: string[];
}

function pickShell(): ShellChoice {
  if (process.platform === "win32") {
    for (const c of [
      "C:\\Program Files\\Git\\bin\\bash.exe",
      "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
      "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    ]) {
      if (existsSync(c)) return { shell: c, prefix: ["-c"] };
    }
    return { shell: "cmd.exe", prefix: ["/c"] };
  }
  return { shell: "/bin/sh", prefix: ["-c"] };
}

export interface BackgroundJobInfo {
  id: string;
  command: string;
  status: "running" | "exited";
  exit_code: number | null;
  started_at: number;
  finished_at: number | null;
}

export function startBackgroundJob(
  sandbox: Sandbox,
  command: string,
  projectId: string | null = null,
): BackgroundJobInfo {
  evictFinishedJobs();
  const id = `job_${randomUUID().slice(0, 8)}`;
  const log = { value: "" };
  const job: ManagedJob = {
    id,
    command,
    proc: null,
    log,
    exit_code: null,
    started_at: Date.now(),
    finished_at: null,
    project_id: projectId,
  };
  jobs.set(id, job);

  if (sandbox.vm) {
    // Firecracker mode: every other exec tool (run_command, start_server)
    // runs INSIDE the VM, so a background job MUST too. Otherwise an
    // `npm install` here installs into the orchestrator host's filesystem
    // while the dev server runs in the VM — and the freshly-installed
    // node_modules is invisible at run time (the "node_modules disappeared"
    // bug). The in-VM agent has no streaming-job RPC, so we fire a single
    // run_command RPC and record its result when it resolves: the log isn't
    // incremental, but the job semantics (poll status / exit code) hold.
    const vm = sandbox.vm;
    fcAgent
      .runCommand(vm, command, VM_JOB_TIMEOUT_MS)
      .then((r) => {
        job.log.value = `${r.stdout}${r.stderr ? `\n${r.stderr}` : ""}`.slice(-MAX_LOG);
        job.exit_code = r.exitCode;
        job.finished_at = Date.now();
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        job.log.value = `${job.log.value}\n[vm error] ${msg}`.slice(-MAX_LOG);
        job.exit_code = 1;
        job.finished_at = Date.now();
      });
    return toInfo(job);
  }

  // Process backend: spawn on the host (cwd = sandbox root).
  const choice = pickShell();
  const proc = spawn(choice.shell, [...choice.prefix, command], {
    cwd: sandbox.rootDir,
    env: safeChildEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  job.proc = proc;
  const append = (chunk: Buffer): void => {
    job.log.value = (job.log.value + chunk.toString()).slice(-MAX_LOG);
  };
  proc.stdout?.on("data", append);
  proc.stderr?.on("data", append);
  // Crucially: spawn errors must not crash the orchestrator. `error` fires
  // before `exit` for things like ENOENT.
  proc.once("error", (err) => {
    job.log.value = `${job.log.value}\n[spawn error] ${err.message}`.slice(-MAX_LOG);
    job.exit_code = 1;
    job.finished_at = Date.now();
  });
  proc.on("exit", (code) => {
    job.exit_code = code;
    job.finished_at = Date.now();
  });
  return toInfo(job);
}

export function readJobLog(id: string, maxBytes = 8000): {
  log: string;
  status: "running" | "exited";
  exit_code: number | null;
} {
  const job = jobs.get(id);
  if (!job) throw new Error(`No background job with id ${id}`);
  return {
    log: job.log.value.slice(-maxBytes),
    status: job.finished_at === null ? "running" : "exited",
    exit_code: job.exit_code,
  };
}

export function listJobs(projectId?: string | null): BackgroundJobInfo[] {
  const all = Array.from(jobs.values());
  const filtered = projectId === undefined ? all : all.filter((j) => j.project_id === projectId);
  return filtered.map(toInfo);
}

export function killJob(id: string): void {
  const job = jobs.get(id);
  if (!job) throw new Error(`No background job with id ${id}`);
  // VM-backed jobs (proc === null) run inside the guest via a single
  // run_command RPC — there's no kill RPC, so we can only stop tracking it
  // here; it exits on its own or hits VM_JOB_TIMEOUT_MS inside the VM.
  if (job.proc?.pid) treeKill(job.proc.pid, "SIGKILL");
  job.exit_code = job.exit_code ?? -1;
  job.finished_at = job.finished_at ?? Date.now();
}

function toInfo(j: ManagedJob): BackgroundJobInfo {
  return {
    id: j.id,
    command: j.command,
    status: j.finished_at === null ? "running" : "exited",
    exit_code: j.exit_code,
    started_at: j.started_at,
    finished_at: j.finished_at,
  };
}

export function killAllJobs(): void {
  for (const j of jobs.values()) {
    try {
      if (j.proc?.pid) treeKill(j.proc.pid, "SIGKILL");
    } catch {}
  }
  jobs.clear();
}

process.on("exit", killAllJobs);
