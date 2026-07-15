/**
 * Vercel deploy pipeline.
 *
 * Phase 1.6 minimum: read the sandbox tree, push raw files via Vercel's Files
 * API, then create a deployment that references those file SHAs. Vercel
 * auto-detects the framework from package.json — no manifest required.
 *
 * What's deliberately out of scope here (Phase 2):
 *   - Project-level env. We set per-deployment inline env, now MERGED with the
 *     project's stored secrets (db/secrets) so the live app has the same env as
 *     the preview; the deploy modal's env still overrides per-deploy.
 *   - Auto-provisioned database (Neon branch-per-project). User pastes their
 *     own DATABASE_URL in the deploy modal's env editor.
 *   - Custom domains / Vercel domain attachment.
 *   - Project-level env (we only set per-deployment).
 *   - Build cache reuse beyond what Vercel does on its side.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  attachVercelDeployment,
  insertDeploymentIntent,
  updateDeploymentState,
  type DeploymentState,
} from "./db/deployments.js";
import { setVercelProject } from "./db/projects.js";
import { getProjectSecretsAsEnv } from "./db/secrets.js";
import { isSensitiveProjectPath } from "./security/sensitivePaths.js";

// Files we never push. Re-derived on every deploy from the live sandbox.
// Exported so the .zip export (export.ts) reuses the exact same exclusions —
// build artifacts and secret .env files stay out of both paths.
export const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".next",
  ".git",
  ".vercel",
  ".turbo",
  ".cache",
  ".sandbox",
  "dist",
  "build",
  "out",
  ".DS_Store",
]);

export const SKIP_FILE_BASENAMES = new Set([
  ".DS_Store",
  "Thumbs.db",
]);

/**
 * True for a `.env*` file that carries real secrets and must never be uploaded
 * to Vercel or bundled into an export zip. The old exact-match Set missed
 * `.env.production` / `.env.development` / `.env.staging` / `.env.test` (loaded
 * by Next.js/Vite), leaking credentials despite the "secrets stay out" contract
 * (C-41/C-42). This excludes the whole `.env` family EXCEPT non-secret template
 * variants (`.env.example`, `.env.sample`, `.env.template`, `.env.dist`) which
 * are meant to be committed/shared.
 */
export function isSecretEnvFile(name: string): boolean {
  if (name !== ".env" && !name.startsWith(".env.")) return false;
  return !/\.(example|sample|template|dist)$/i.test(name);
}

// Vercel inline-file limit. Files larger than this can't go through the
// standard Files API path; we'll fail the deploy with a clear error rather
// than silently truncating.
const VERCEL_MAX_FILE_BYTES = 100 * 1024 * 1024;

// Total size cap so a runaway sandbox doesn't burn a half hour uploading
// gigabytes before Vercel rejects it. 200 MB matches the import cap.
const TOTAL_SIZE_CAP = 200 * 1024 * 1024;

interface FileSpec {
  /** Repo-relative path with forward slashes, e.g. "src/index.ts". */
  path: string;
  /** SHA1 of contents, hex-lowercase — Vercel's Files API uses SHA1. */
  sha: string;
  size: number;
  /** Buffer kept in memory so we can upload in a second pass. */
  data: Buffer;
}

/**
 * Walk the sandbox and gather files plus their SHA1s. Symlinks are followed
 * (rare in sandboxed projects); special files (sockets, devices) are skipped.
 */
async function gatherFiles(rootDir: string): Promise<{
  files: FileSpec[];
  totalBytes: number;
}> {
  const out: FileSpec[] = [];
  let totalBytes = 0;

  async function visit(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = path.relative(rootDir, full).replaceAll(path.sep, "/");
      if (isSensitiveProjectPath(rel)) continue;
      if (SKIP_FILE_BASENAMES.has(e.name)) continue;
      if (e.isDirectory()) {
        if (SKIP_DIR_NAMES.has(e.name)) continue;
        await visit(full);
        continue;
      }
      if (!e.isFile()) continue;

      const data = await fs.readFile(full);
      if (data.length > VERCEL_MAX_FILE_BYTES) {
        throw new Error(
          `file too large for Vercel deploy: ${path
            .relative(rootDir, full)
            .replaceAll(path.sep, "/")} (${data.length} bytes, max ${VERCEL_MAX_FILE_BYTES})`,
        );
      }
      totalBytes += data.length;
      if (totalBytes > TOTAL_SIZE_CAP) {
        throw new Error(
          `deploy exceeds ${TOTAL_SIZE_CAP / 1024 / 1024} MB cumulative size cap`,
        );
      }
      const sha = createHash("sha1").update(data).digest("hex");
      out.push({ path: rel, sha, size: data.length, data });
    }
  }

  await visit(rootDir);
  return { files: out, totalBytes };
}

function teamQuery(teamId: string | null): string {
  return teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
}

async function uploadFile(
  token: string,
  teamId: string | null,
  file: FileSpec,
): Promise<void> {
  // Vercel deduplicates by sha — repeated upload of the same content is a
  // fast no-op on their side, so we don't need to track which SHAs are
  // already on file across deploys. They expire if not referenced for ~5min,
  // which is why we always re-upload right before creating the deployment.
  const res = await fetch(`https://api.vercel.com/v2/files${teamQuery(teamId)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "Content-Length": String(file.size),
      "x-vercel-digest": file.sha,
    },
    body: file.data,
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {}
    throw new Error(
      `vercel files upload failed for ${file.path}: ${res.status} ${detail.slice(0, 500)}`,
    );
  }
}

interface VercelCreateDeploymentResponse {
  id: string;
  url: string;
  projectId?: string;
  name?: string;
  readyState?: string;
  // Some responses use `status` in place of readyState; tolerate both.
  status?: string;
  errorMessage?: string;
  /** Documented when the project doesn't yet exist and Vercel created it. */
  alias?: string[];
}

interface VercelDeploymentStatusResponse {
  id: string;
  readyState: string;
  url: string;
  errorMessage?: string;
  alias?: string[];
}

function toState(raw: string | undefined): DeploymentState {
  switch ((raw ?? "").toUpperCase()) {
    case "READY":
      return "READY";
    case "ERROR":
      return "ERROR";
    case "CANCELED":
    case "CANCELLED":
      return "CANCELED";
    case "BUILDING":
    case "INITIALIZING":
    case "ANALYZING":
      return "BUILDING";
    default:
      return "QUEUED";
  }
}

export interface DeployRequest {
  /** Stable project slug — becomes the Vercel project name on first deploy. */
  projectName: string;
  /** Sandbox dir to read files from. */
  sandboxDir: string;
  /** Inline env vars sent with this deployment. */
  env: Record<string, string>;
  /** "production" deploys to the project's prod URL; "preview" gets a unique URL. */
  target: "production" | "preview";
}

export interface DeployContext {
  uniqusProjectId: string;
  ownerId: string;
  vercelToken: string;
  vercelTeamId: string | null;
  /** Only project admins/owners may export stored project secrets. */
  includeStoredSecrets: boolean;
}

export interface DeployStartResult {
  deployment_id: string; // our DB id
  vercel_deployment_id: string;
  vercel_url: string; // e.g. my-app-abcd.vercel.app (no scheme)
  inspector_url: string; // dashboard link
  state: DeploymentState;
}

/**
 * Keep stored runtime secrets out of Vercel's build environment. Values typed
 * explicitly into the deploy form remain available to both phases because the
 * user intentionally supplied them for this deployment.
 */
export function deploymentEnvironment(
  storedSecrets: Record<string, string>,
  requestEnv: Record<string, string>,
): { runtime: Record<string, string>; build: Record<string, string> } {
  return {
    runtime: { ...storedSecrets, ...requestEnv },
    build: { ...requestEnv },
  };
}

/**
 * Kick off a deploy. Synchronously uploads files + creates the Vercel
 * deployment, then returns. The caller should call pollUntilTerminal in
 * the background to push status updates to the WS clients.
 */
export async function startDeploy(
  ctx: DeployContext,
  req: DeployRequest,
): Promise<DeployStartResult> {
  const { files, totalBytes } = await gatherFiles(req.sandboxDir);
  if (files.length === 0) {
    throw new Error("nothing to deploy: sandbox is empty (excluding node_modules/.next)");
  }
  if (!files.some((f) => f.path === "package.json" || f.path === "index.html")) {
    // Vercel will accept anything, but a deploy with no recognizable entry
    // point usually means the user clicked too early. Bail with a hint
    // rather than letting Vercel produce a confusing build error.
    throw new Error(
      "no package.json or index.html at the root — ask the agent to scaffold the project first",
    );
  }

  // Upload in parallel batches. Capped concurrency keeps a 1k-file repo
  // from opening 1k sockets simultaneously.
  const CONCURRENCY = 8;
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, files.length) }, async () => {
      while (cursor < files.length) {
        const i = cursor++;
        await uploadFile(ctx.vercelToken, ctx.vercelTeamId, files[i]);
      }
    }),
  );

  // Sync the project's stored secrets into the deploy env so the deployed app
  // has the SAME env it had in the preview (the gap that made apps "work for the
  // agent, break live"). Request env (the deploy modal) wins, so the user can
  // override per-deploy. Secrets go as Vercel env vars, never as files
  // (isSecretEnvFile keeps .env* out of the upload). Never logged.
  // Editors may deploy code, but cannot use deployment as an export oracle for
  // write-only project secrets. Authorized secret loads fail closed: silently
  // omitting credentials can publish a broken or insecure application.
  const storedSecrets = ctx.includeStoredSecrets
    ? await getProjectSecretsAsEnv(ctx.uniqusProjectId)
    : {};
  const deployEnv = deploymentEnvironment(storedSecrets, req.env);
  const intent = await insertDeploymentIntent({
    project_id: ctx.uniqusProjectId,
    user_id: ctx.ownerId,
    target: req.target,
  });

  // /v13/deployments wants `env` and `build.env` as flat Record<string,string>.
  // The array-of-objects form is for project-level env (/v9/projects/.../env)
  // — using the wrong shape here gets you a 400 with a confusing message.
  const deployBody = {
    name: req.projectName,
    target: req.target,
    files: files.map((f) => ({ file: f.path, sha: f.sha, size: f.size })),
    projectSettings: {
      // null framework lets Vercel auto-detect from package.json
      // (next.config.js → next, vite.config.* → vite, etc.). We only
      // override this once the agent emits an explicit manifest in a
      // future phase.
      framework: null,
    },
    env: deployEnv.runtime,
    build: { env: deployEnv.build },
    meta: { gate15OperationKey: intent.operation_key },
  };

  const createRes = await fetch(
    `https://api.vercel.com/v13/deployments${teamQuery(ctx.vercelTeamId)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ctx.vercelToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(deployBody),
    },
  );
  const created = (await createRes.json()) as VercelCreateDeploymentResponse & {
    error?: { message?: string };
  };
  if (!createRes.ok) {
    const msg = created.error?.message ?? `${createRes.status}`;
    await updateDeploymentState(intent.id, { state: "ERROR", error_message: "deployment_failed" });
    throw new Error(`vercel deploy create failed: ${msg}`);
  }

  const initialState = toState(created.readyState ?? created.status);
  const vercelDeploymentId = created.id;
  const url = created.url; // hostname only, e.g. my-app-abcd.vercel.app

  if (created.projectId && created.name) {
    // Stamp the project link on first deploy so the dashboard URL is stable.
    await setVercelProject(
      ctx.uniqusProjectId,
      ctx.ownerId,
      created.projectId,
      created.name,
      ctx.vercelTeamId,
    ).catch(
      (err) => console.error("setVercelProject failed (continuing):", err),
    );
  }

  await attachVercelDeployment(intent.id, {
    vercel_deployment_id: vercelDeploymentId,
    vercel_url: url ?? null,
    state: initialState,
  });

  console.log(
    `[deploy ${ctx.uniqusProjectId}] created ${vercelDeploymentId} (${initialState}, ${files.length} files, ${(totalBytes / 1024).toFixed(0)} KB)`,
  );

  return {
    deployment_id: intent.id,
    vercel_deployment_id: vercelDeploymentId,
    vercel_url: url,
    inspector_url: created.projectId
      ? `https://vercel.com/${created.projectId}`
      : `https://vercel.com/dashboard`,
    state: initialState,
  };
}

/**
 * Poll Vercel for deploy status until the deployment reaches a terminal
 * state. Updates the DB row on every transition. Caller should call this in
 * the background and broadcast updates over WS.
 */
export async function pollUntilTerminal(
  ctx: { vercelToken: string; vercelTeamId: string | null },
  rowId: string,
  vercelDeploymentId: string,
  onUpdate: (state: DeploymentState, url: string | null, errorMessage: string | null) => void,
  options: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<DeploymentState> {
  const interval = options.intervalMs ?? 3_000;
  const timeoutAt = Date.now() + (options.timeoutMs ?? 10 * 60 * 1000); // 10 min
  let lastState: DeploymentState = "QUEUED";

  while (Date.now() < timeoutAt) {
    let status: VercelDeploymentStatusResponse | null = null;
    try {
      const res = await fetch(
        `https://api.vercel.com/v13/deployments/${vercelDeploymentId}${teamQuery(ctx.vercelTeamId)}`,
        { headers: { Authorization: `Bearer ${ctx.vercelToken}` } },
      );
      const body = (await res.json()) as VercelDeploymentStatusResponse & {
        error?: { message?: string };
      };
      if (!res.ok) {
        // Don't immediately give up on transient 5xx — log and retry next tick.
        console.error(`[poll ${vercelDeploymentId}] ${res.status}`, body);
        await sleep(interval);
        continue;
      }
      status = body;
    } catch (err) {
      console.error(`[poll ${vercelDeploymentId}] fetch failed:`, err);
      await sleep(interval);
      continue;
    }
    if (!status) {
      await sleep(interval);
      continue;
    }
    const state = toState(status.readyState);
    const url = status.url ?? null;
    const errorMessage = status.errorMessage ?? null;
    const publicErrorMessage = errorMessage ? "deployment_failed" : null;

    if (state !== lastState) {
      lastState = state;
      try {
        await updateDeploymentState(rowId, {
          state,
          vercel_url: url,
          error_message: publicErrorMessage,
        });
      } catch (err) {
        console.error("updateDeploymentState failed:", err);
      }
      onUpdate(state, url, publicErrorMessage);
    }

    if (state === "READY" || state === "ERROR" || state === "CANCELED") {
      return state;
    }
    await sleep(interval);
  }

  // Timed out — leave the row in BUILDING and surface a soft failure so the
  // user can refresh later. We don't mark ERROR because Vercel may still
  // finish; the row's state lags reality but doesn't lie.
  console.warn(`[poll ${vercelDeploymentId}] timed out after 10min, last state ${lastState}`);
  return lastState;
}

/**
 * Resolve a provider create whose HTTP response was lost. The operation key is
 * persisted before POST and attached as Vercel metadata, which their list API
 * can filter. No match means the caller should retry this reconciliation later,
 * never issue another create immediately.
 */
export async function reconcileCreatingDeployment(
  ctx: { vercelToken: string; vercelTeamId: string | null },
  row: { id: string; operation_key: string },
): Promise<{ id: string; url: string | null; state: DeploymentState } | null> {
  const query = new URLSearchParams({
    limit: "2",
    [`meta-gate15OperationKey`]: row.operation_key,
  });
  if (ctx.vercelTeamId) query.set("teamId", ctx.vercelTeamId);
  const res = await fetch(`https://api.vercel.com/v6/deployments?${query}`, {
    headers: { Authorization: `Bearer ${ctx.vercelToken}` },
  });
  const body = (await res.json()) as {
    deployments?: Array<{
      uid?: string;
      id?: string;
      url?: string;
      state?: string;
      readyState?: string;
      meta?: Record<string, unknown>;
    }>;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(`vercel deployment reconciliation failed: ${body.error?.message ?? res.status}`);
  }
  const matches = (body.deployments ?? []).filter(
    (deployment) => deployment.meta?.gate15OperationKey === row.operation_key,
  );
  if (matches.length === 0) return null;
  if (matches.length !== 1) {
    throw new Error(`vercel operation ${row.operation_key} matched multiple deployments`);
  }
  const remote = matches[0];
  const id = remote.uid ?? remote.id;
  if (!id) throw new Error("reconciled Vercel deployment has no id");
  const state = toState(remote.readyState ?? remote.state);
  await attachVercelDeployment(row.id, {
    vercel_deployment_id: id,
    vercel_url: remote.url ?? null,
    state,
  });
  return { id, url: remote.url ?? null, state };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
