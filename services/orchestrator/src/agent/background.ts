import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import treeKill from "tree-kill";
import { safeChildEnv } from "../safeEnv.js";
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

interface ManagedJob {
  id: string;
  command: string;
  proc: ChildProcess;
  log: { value: string };
  exit_code: number | null;
  started_at: number;
  finished_at: number | null;
  project_id: string | null;
}

const jobs = new Map<string, ManagedJob>();

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
  const choice = pickShell();
  const proc = spawn(choice.shell, [...choice.prefix, command], {
    cwd: sandbox.rootDir,
    env: safeChildEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const id = `job_${randomUUID().slice(0, 8)}`;
  const log = { value: "" };
  const append = (chunk: Buffer): void => {
    log.value = (log.value + chunk.toString()).slice(-MAX_LOG);
  };
  proc.stdout?.on("data", append);
  proc.stderr?.on("data", append);
  // Crucially: spawn errors must not crash the orchestrator. `error` fires
  // before `exit` for things like ENOENT.
  proc.once("error", (err) => {
    log.value = `${log.value}\n[spawn error] ${err.message}`.slice(-MAX_LOG);
    const job = jobs.get(id);
    if (job) {
      job.exit_code = 1;
      job.finished_at = Date.now();
    }
  });
  const job: ManagedJob = {
    id,
    command,
    proc,
    log,
    exit_code: null,
    started_at: Date.now(),
    finished_at: null,
    project_id: projectId,
  };
  jobs.set(id, job);
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
  if (job.proc.pid) treeKill(job.proc.pid, "SIGKILL");
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
      if (j.proc.pid) treeKill(j.proc.pid, "SIGKILL");
    } catch {}
  }
  jobs.clear();
}

process.on("exit", killAllJobs);
