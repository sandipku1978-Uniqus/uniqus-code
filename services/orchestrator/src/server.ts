import "./env.js";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
  type IncomingHttpHeaders,
} from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import type Anthropic from "@anthropic-ai/sdk";
import type {
  ClientEvent,
  ServerEvent,
  Plan,
  TreeEntry,
  ProjectSummary,
} from "@uniqus/api-types";
import { runAgentLoop } from "./agent/loop.js";
import { proposePlan, formatPlanForExecution } from "./agent/plan.js";
import {
  shellInfo,
  listServers,
  sandboxEvents,
  startServer as sandboxStartServer,
  stopServer as sandboxStopServer,
  writeFile as sandboxWriteFile,
} from "./agent/sandbox.js";
import { readRunConfig, writeRunConfig, detectRunConfig } from "./runConfig.js";
import { upsertUser, type UserRecord } from "./db/users.js";
import { listProjects, createProject, getProject, touchProject } from "./db/projects.js";
import { loadHistory, appendMessage, clearHistory } from "./db/messages.js";
import { unsealSessionFromCookieHeader, type AuthKitSession } from "./auth/workos.js";
import { ensureBucket } from "./storage/client.js";
import { getTracker } from "./storage/sync.js";
import { resolveTarget, proxyHttp, proxyWebSocket } from "./proxy.js";
import { importZip, importGithub } from "./import.js";
import Busboy from "busboy";

// Railway/Fly inject PORT; local dev sets ORCHESTRATOR_PORT or falls back to 8787.
const PORT = Number(process.env.PORT ?? process.env.ORCHESTRATOR_PORT ?? 8787);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SANDBOX_ROOT = path.resolve(REPO_ROOT, ".sandbox");
// Public URL for the orchestrator itself, used to build preview URLs the agent
// quotes back to the user (e.g. https://api.example.com). Falls back to
// http://localhost:{PORT} for local dev.
const PREVIEW_BASE_URL =
  process.env.PREVIEW_BASE_URL ?? process.env.PUBLIC_BASE_URL ?? `http://localhost:${PORT}`;

function sandboxDirFor(projectId: string): string {
  return path.resolve(SANDBOX_ROOT, projectId);
}

type Sender = (event: ServerEvent) => void;
interface SessionCtx {
  send: Sender;
  user: UserRecord;
  projectId: string;
}
const sessions = new Set<SessionCtx>();

function broadcastToProject(projectId: string, event: ServerEvent): void {
  for (const s of sessions) if (s.projectId === projectId) s.send(event);
}

sandboxEvents.on("server_exit", (id: string, projectId: string | null) => {
  if (projectId) broadcastToProject(projectId, { type: "server_stopped", id });
});

async function main(): Promise<void> {
  const required = [
    "ANTHROPIC_API_KEY",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "WORKOS_COOKIE_PASSWORD",
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(
      `Missing required env vars in .env.local: ${missing.join(", ")}`,
    );
    process.exit(1);
  }

  await fs.mkdir(SANDBOX_ROOT, { recursive: true });

  try {
    await ensureBucket();
  } catch (err) {
    console.error("ensureBucket failed (Storage sync may not work):", err);
  }

  const httpServer = createServer((req, res) => {
    handleHttp(req, res).catch((err) => {
      console.error("HTTP handler crashed:", err);
      try {
        if (!res.headersSent) {
          const origin = req.headers.origin ?? CORS_ORIGIN;
          res.setHeader("Access-Control-Allow-Origin", origin);
          res.setHeader("Access-Control-Allow-Credentials", "true");
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
          );
        }
      } catch {}
    });
  });

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    handleUpgrade(wss, req, socket, head).catch((err) => {
      console.error("Upgrade handler crashed:", err);
      try {
        socket.destroy();
      } catch {}
    });
  });

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`orchestrator: ws://localhost:${PORT} (LAN: ws://<your-ip>:${PORT})`);
    console.log(`sandbox root: ${SANDBOX_ROOT}`);
  });
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

const CORS_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:4242";

/**
 * Should this request go to the preview proxy?
 *
 * Yes if the path explicitly starts with `/preview/`, or if there's a Referer
 * pointing at `/preview/...` AND the request path is NOT an orchestrator-owned
 * route (`/api/*`, `/health`, the WS root with `?project=`). The exclusion
 * matters: a user who has a preview iframe open will have a `Referer` of
 * `/preview/srv_xxx/...` on every request from that tab, including the web
 * app's own API calls if they were ever co-mounted on the same origin.
 */
function shouldProxy(url: string, headers: IncomingHttpHeaders): boolean {
  if (url.startsWith("/preview/")) return true;
  const ref = headers.referer ?? headers.referrer;
  if (typeof ref !== "string") return false;
  if (url.startsWith("/api/") || url === "/health") return false;
  // The orchestrator WS upgrade lives at `/` with `?project=...`. Anything
  // with a project query is the agent socket, never the proxy.
  if (url.startsWith("/?") && url.includes("project=")) return false;
  return true;
}

function setCors(res: ServerResponse, req: IncomingMessage): void {
  const origin = req.headers.origin ?? CORS_ORIGIN;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {} as T;
  return JSON.parse(Buffer.concat(chunks).toString("utf-8")) as T;
}

async function authenticate(req: IncomingMessage): Promise<{
  session: AuthKitSession;
  user: UserRecord;
} | null> {
  const session = await unsealSessionFromCookieHeader(req.headers.cookie);
  if (!session) return null;
  const user = await upsertUser({
    workos_id: session.user.id,
    email: session.user.email,
    display_name:
      [session.user.firstName, session.user.lastName].filter(Boolean).join(" ") || null,
  });
  return { session, user };
}

async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Preview proxy: forward `/preview/:serverId/...` and Referer-tagged absolute
  // paths to the in-sandbox dev server. Runs BEFORE CORS/auth so iframes loaded
  // cross-site work without our cookie. Access control is by serverId (random UUID).
  const url = req.url ?? "/";
  if (shouldProxy(url, req.headers)) {
    const target = resolveTarget(url, req.headers);
    if (target) {
      proxyHttp(req, res, target);
      return;
    }
    if (url.startsWith("/preview/")) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("preview server not found or stopped");
      return;
    }
  }

  setCors(res, req);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === "/health") {
    return json(res, 200, { ok: true });
  }

  if (!req.url?.startsWith("/api/")) {
    res.writeHead(404);
    res.end();
    return;
  }

  const auth = await authenticate(req);
  if (!auth) {
    return json(res, 401, { error: "not authenticated" });
  }
  const { user } = auth;

  if (req.url === "/api/me" && req.method === "GET") {
    return json(res, 200, {
      user: { id: user.id, email: user.email, display_name: user.display_name },
    });
  }

  if (req.url === "/api/projects" && req.method === "GET") {
    const rows = await listProjects(user.id);
    return json(res, 200, { projects: rows.map(toProjectSummary) });
  }

  if (req.url === "/api/projects" && req.method === "POST") {
    const body = await readJsonBody<{ name?: string; description?: string }>(req);
    const name = (body.name ?? "").trim();
    if (!name) return json(res, 400, { error: "name is required" });
    const project = await createProject({
      owner_id: user.id,
      name,
      description: body.description ?? null,
    });
    await fs.mkdir(sandboxDirFor(project.id), { recursive: true });
    return json(res, 201, { project: toProjectSummary(project) });
  }

  // Codebase import: GitHub clone. Creates the project, clones into the sandbox,
  // then pushes the resulting tree to Storage so other sessions hydrate from it.
  if (req.url === "/api/projects/import-github" && req.method === "POST") {
    const body = await readJsonBody<{
      name?: string;
      description?: string;
      repo_url?: string;
      branch?: string;
      pat?: string;
    }>(req);
    const name = (body.name ?? "").trim();
    const repoUrl = (body.repo_url ?? "").trim();
    if (!name) return json(res, 400, { error: "name is required" });
    if (!repoUrl) return json(res, 400, { error: "repo_url is required" });

    const project = await createProject({
      owner_id: user.id,
      name,
      description: body.description ?? null,
    });
    const dest = sandboxDirFor(project.id);
    await fs.mkdir(dest, { recursive: true });

    try {
      const result = await importGithub(
        { repo_url: repoUrl, branch: body.branch, pat: body.pat },
        dest,
      );
      await getTracker(project.id, dest).syncChanges();
      return json(res, 201, { project: toProjectSummary(project), import: result });
    } catch (err) {
      // Roll back the empty project so the user can retry without a stale row.
      // If sync also fails we still return the import error to the user.
      const message = err instanceof Error ? err.message : String(err);
      return json(res, 400, { error: `import failed: ${message}` });
    }
  }

  // Codebase import: ZIP upload. Multipart/form-data with a file field plus
  // text fields `name` and (optional) `description`.
  if (req.url === "/api/projects/import-zip" && req.method === "POST") {
    return await handleZipImport(req, res, user.id);
  }

  // Stop a specific server: DELETE /api/projects/{projectId}/servers/{serverId}
  // The user closing the preview tab needs to kill the underlying process,
  // not just hide the iframe.
  const stopMatch = req.url?.match(
    /^\/api\/projects\/([0-9a-fA-F-]{8,})\/servers\/(srv_[0-9a-fA-F]+)$/,
  );
  if (stopMatch && req.method === "DELETE") {
    const projectId = stopMatch[1];
    const serverId = stopMatch[2];
    const project = await getProject(projectId, user.id);
    if (!project) return json(res, 403, { error: "project not found or access denied" });
    // Verify the server belongs to this project before killing it (defense
    // in depth — listServers + getProject already gate access).
    const owned = listServers(projectId).some((s) => s.id === serverId);
    if (!owned) return json(res, 404, { error: "server not found in this project" });
    try {
      sandboxStopServer(serverId);
      broadcastToProject(projectId, { type: "server_stopped", id: serverId });
      return json(res, 200, { ok: true });
    } catch (err) {
      return json(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // One-click Run: stop any existing servers for this project, then start
  // (or restart) using the project's stored config (or auto-detect from
  // package.json/requirements.txt). URL: /api/projects/{id}/run
  const runMatch = req.url?.match(/^\/api\/projects\/([0-9a-fA-F-]{8,})\/run$/);
  if (runMatch && req.method === "POST") {
    const projectId = runMatch[1];
    const project = await getProject(projectId, user.id);
    if (!project) return json(res, 403, { error: "project not found or access denied" });

    const dest = sandboxDirFor(projectId);
    await fs.mkdir(dest, { recursive: true });

    // Optional override body — `command` and `port` only used if provided.
    // Empty body means "use whatever's stored or auto-detected".
    type RunBody = { command?: string; port?: number };
    const body = await readJsonBody<RunBody>(req).catch<RunBody>(() => ({}));

    const config = body.command && body.port
      ? {
          command: body.command.trim(),
          port: Number(body.port),
          source: "user" as const,
        }
      : (await readRunConfig(dest)) ?? (await detectRunConfig(dest));

    if (!config) {
      return json(res, 400, {
        error:
          "No run config and we couldn't detect one (no package.json `dev`/`start` script, no app.py / main.py). Ask the agent to scaffold the project, or pass {command, port} in the body.",
      });
    }

    // Stop any servers currently running for this project — both agent-started
    // and previous manual ones. Restart-on-click is what users expect.
    for (const s of listServers(projectId)) {
      try {
        sandboxStopServer(s.id);
        broadcastToProject(projectId, { type: "server_stopped", id: s.id });
      } catch (err) {
        console.error(`failed to stop ${s.id}:`, err);
      }
    }

    try {
      const info = await sandboxStartServer(
        { rootDir: dest },
        config.command,
        config.port,
        60_000,
        projectId,
      );
      broadcastToProject(projectId, {
        type: "server_started",
        id: info.id,
        command: info.command,
        port: info.port,
      });
      // Persist whatever we just used so subsequent clicks reuse it (and so
      // the agent and user converge on the same config).
      await writeRunConfig(dest, {
        command: config.command,
        port: config.port,
        source: config.source ?? "user",
      }).catch((err) => console.error("writeRunConfig failed:", err));
      getTracker(projectId, dest)
        .syncFile(".uniqus-run.json")
        .then(() => broadcastToProject(projectId, { type: "storage_synced", at: Date.now() }))
        .catch(() => {});
      return json(res, 200, {
        id: info.id,
        port: info.port,
        command: info.command,
        public_url: `${PREVIEW_BASE_URL.replace(/\/$/, "")}/preview/${info.id}/`,
        config_source: config.source ?? "user",
      });
    } catch (err) {
      return json(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  res.writeHead(404);
  res.end();
}

async function handleZipImport(
  req: IncomingMessage,
  res: ServerResponse,
  ownerId: string,
): Promise<void> {
  let zipBuffer: Buffer | null = null;
  let projectName = "";
  let description: string | null = null;
  let parseError: string | null = null;

  try {
    await new Promise<void>((resolve, reject) => {
      const bb = Busboy({
        headers: req.headers,
        limits: { fileSize: 250 * 1024 * 1024, files: 1 },
      });
      const chunks: Buffer[] = [];
      bb.on("file", (_field, file, info) => {
        if (!info.filename.toLowerCase().endsWith(".zip")) {
          parseError = "uploaded file must be a .zip";
          file.resume();
          return;
        }
        file.on("data", (d: Buffer) => chunks.push(d));
        file.on("limit", () => {
          parseError = "zip file exceeds 250 MB upload limit";
        });
        file.on("end", () => {
          if (!parseError) zipBuffer = Buffer.concat(chunks);
        });
      });
      bb.on("field", (name, value) => {
        if (name === "name") projectName = value.trim();
        else if (name === "description") description = value.trim() || null;
      });
      bb.on("finish", () => resolve());
      bb.on("error", (err) => reject(err));
      req.pipe(bb);
    });
  } catch (err) {
    return json(res, 400, {
      error: `multipart parse failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  if (parseError) return json(res, 400, { error: parseError });
  if (!projectName) return json(res, 400, { error: "name is required" });
  if (!zipBuffer) return json(res, 400, { error: "no zip file uploaded" });

  const project = await createProject({
    owner_id: ownerId,
    name: projectName,
    description,
  });
  const dest = sandboxDirFor(project.id);
  await fs.mkdir(dest, { recursive: true });

  try {
    const result = await importZip(zipBuffer, dest);
    await getTracker(project.id, dest).syncChanges();
    return json(res, 201, { project: toProjectSummary(project), import: result });
  } catch (err) {
    return json(res, 400, {
      error: `import failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

function toProjectSummary(p: {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}): ProjectSummary {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

// ── WebSocket upgrade ─────────────────────────────────────────────────────────

async function handleUpgrade(
  wss: WebSocketServer,
  req: IncomingMessage,
  socket: import("node:stream").Duplex,
  head: Buffer,
): Promise<void> {
  const reject = (status: number, message: string): void => {
    socket.write(`HTTP/1.1 ${status} ${message}\r\n\r\n`);
    socket.destroy();
  };

  // Preview proxy WS: HMR / live-reload sockets from inside the iframe app.
  // Resolved by URL prefix or Referer; access by serverId only (matches HTTP proxy).
  const rawUrl = req.url ?? "/";
  if (shouldProxy(rawUrl, req.headers)) {
    const target = resolveTarget(rawUrl, req.headers);
    if (target) {
      proxyWebSocket(req, socket, head, target);
      return;
    }
    if (rawUrl.startsWith("/preview/")) return reject(404, "Preview server not found");
  }

  const auth = await authenticate(req);
  if (!auth) return reject(401, "Unauthorized");

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const projectId = url.searchParams.get("project");
  if (!projectId) return reject(400, "Missing project query parameter");

  const project = await getProject(projectId, auth.user.id);
  if (!project) return reject(403, "Project not found or access denied");

  await fs.mkdir(sandboxDirFor(projectId), { recursive: true });

  wss.handleUpgrade(req, socket as import("node:net").Socket, head, (ws) => {
    handleConnection(ws, auth.user, project).catch((err) => {
      console.error("Connection handler crashed:", err);
      try {
        ws.close();
      } catch {}
    });
  });
}

// ── WebSocket session ─────────────────────────────────────────────────────────

async function handleConnection(
  ws: WebSocket,
  user: UserRecord,
  project: {
    id: string;
    name: string;
    description: string | null;
    created_at: string;
    updated_at: string;
  },
): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY!;
  const sandboxDir = sandboxDirFor(project.id);

  const send: Sender = (event) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
  };
  const ctx: SessionCtx = { send, user, projectId: project.id };
  sessions.add(ctx);

  // Mutable history; populated after async hydrate below. Mutating in place
  // keeps the reference stable for runAgentLoop across many turns.
  const history: Anthropic.MessageParam[] = [];
  let pendingPlanResolve: ((plan: Plan) => void) | null = null;
  let busy = false;
  let ready = false;
  // Per-session abort controller. Replaced for each user_message turn; the
  // current one is what the `abort` event triggers.
  let currentAbort: AbortController | null = null;

  // Attach handlers SYNCHRONOUSLY before any async work.
  // Otherwise messages that arrive during hydration (especially the
  // client's initial request_tree on WS open) get silently dropped.
  ws.on("close", () => {
    sessions.delete(ctx);
  });

  ws.on("message", async (raw) => {
    let event: ClientEvent;
    try {
      event = JSON.parse(raw.toString()) as ClientEvent;
    } catch {
      send({ type: "error", message: "invalid JSON" });
      return;
    }

    try {
      if (event.type === "plan_approved") {
        if (pendingPlanResolve) {
          const r = pendingPlanResolve;
          pendingPlanResolve = null;
          r(event.plan);
        }
        return;
      }

      if (event.type === "request_tree") {
        const entries = await walkSandbox(sandboxDir);
        send({ type: "tree_listing", entries });
        return;
      }

      if (event.type === "request_file") {
        const content = await readSandboxFile(sandboxDir, event.path);
        send({ type: "file_content", path: event.path, content });
        return;
      }

      if (event.type === "reset_session") {
        await clearHistory(project.id);
        history.length = 0;
        send({ type: "session_reset" });
        return;
      }

      if (event.type === "abort") {
        // User clicked Stop. Cancel the in-flight Anthropic stream and any
        // running run_command. The loop returns with aborted=true and we
        // record the partial turn to history (handled in runSession).
        if (currentAbort && !currentAbort.signal.aborted) {
          currentAbort.abort();
        } else {
          // Nothing running — also clear a pending plan approval if any, so
          // the user isn't stuck waiting on a plan they no longer want.
          if (pendingPlanResolve) {
            pendingPlanResolve = null;
            send({ type: "session_reset" });
          }
        }
        return;
      }

      if (event.type === "client_write_file") {
        // User edited a file in the IDE. Persist + sync to Storage. Always ack
        // back so the editor can show "saved" / "save failed" state.
        try {
          await sandboxWriteFile({ rootDir: sandboxDir }, event.path, event.content);
          send({ type: "client_write_ack", path: event.path, ok: true });
          // Tell other sessions on this project that the file changed (their
          // editor will refresh if they have it open). Skip our own session
          // — the user already has the latest content locally.
          for (const s of sessions) {
            if (s.projectId === project.id && s !== ctx) {
              s.send({ type: "file_changed", path: event.path });
            }
          }
          getTracker(project.id, sandboxDir)
            .syncFile(event.path)
            .then(() => broadcastToProject(project.id, { type: "storage_synced", at: Date.now() }))
            .catch((err) => console.error(`client write syncFile ${event.path} failed:`, err));
        } catch (err) {
          send({
            type: "client_write_ack",
            path: event.path,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      if (event.type === "user_message") {
        if (!ready) {
          send({ type: "error", message: "session is still loading, try again in a moment" });
          return;
        }
        if (busy) {
          send({ type: "error", message: "agent is already running" });
          return;
        }
        busy = true;
        currentAbort = new AbortController();
        try {
          await runSession(
            event.content,
            event.mode,
            send,
            apiKey,
            history,
            project.id,
            sandboxDir,
            () =>
              new Promise<Plan>((resolve) => {
                pendingPlanResolve = resolve;
              }),
            currentAbort.signal,
          );
          await touchProject(project.id);
        } finally {
          busy = false;
          currentAbort = null;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      send({ type: "error", message });
      busy = false;
      currentAbort = null;
    }
  });

  // ── Async hydration (handlers above are already accepting messages) ──
  const tracker = getTracker(project.id, sandboxDir);

  try {
    await tracker.initialize();
    if (tracker.isLocalEmpty()) {
      const restored = await tracker.hydrateFromStorage();
      if (restored > 0) {
        console.log(`[${project.id}] hydrated ${restored} files from Storage`);
      }
    }
  } catch (err) {
    console.error("file sync init failed:", err);
  }

  try {
    const loaded = await loadHistory(project.id);
    history.push(...loaded);
  } catch (err) {
    console.error("loadHistory failed:", err);
    send({
      type: "error",
      message: `failed to load chat history: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  send({
    type: "session_started",
    sandbox_dir: sandboxDir,
    shell: shellInfo().name,
    platform: process.platform,
    project: toProjectSummary(project),
    user: { id: user.id, email: user.email, display_name: user.display_name },
  });

  for (const msg of history) {
    replayMessage(send, msg);
  }

  for (const s of listServers(project.id)) {
    send({ type: "server_started", id: s.id, command: s.command, port: s.port });
  }

  ready = true;
}

function replayMessage(send: Sender, msg: Anthropic.MessageParam): void {
  if (msg.role === "user") {
    if (typeof msg.content === "string") {
      send({ type: "text", content: `\n[replay] you: ${msg.content}\n` });
    }
    // Tool results in user-role blocks aren't surfaced on replay (too verbose).
    return;
  }
  if (msg.role === "assistant" && Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (block.type === "text") {
        send({ type: "text", content: block.text });
      } else if (block.type === "tool_use") {
        send({
          type: "tool_call",
          call_id: block.id,
          name: block.name,
          input: block.input,
        });
        send({
          type: "tool_result",
          call_id: block.id,
          result: "(replayed from history)",
          is_error: false,
        });
      }
    }
  }
}

async function runSession(
  userMessage: string,
  mode: "plan-then-execute" | "execute-only",
  send: Sender,
  apiKey: string,
  history: Anthropic.MessageParam[],
  projectId: string,
  sandboxDir: string,
  awaitPlanApproval: () => Promise<Plan>,
  signal: AbortSignal,
): Promise<void> {
  const start = Date.now();
  let toolCalls = 0;
  let finalMessage = userMessage;

  if (mode === "plan-then-execute") {
    const plan = await proposePlan(userMessage, apiKey, history);
    if (signal.aborted) {
      send({ type: "complete", tool_calls: 0, elapsed_ms: Date.now() - start, aborted: true });
      return;
    }
    send({ type: "plan_proposed", plan });
    const approved = await awaitPlanApproval();
    if (signal.aborted) {
      send({ type: "complete", tool_calls: 0, elapsed_ms: Date.now() - start, aborted: true });
      return;
    }
    send({ type: "plan_running" });
    finalMessage = `${userMessage}\n\n${formatPlanForExecution(approved)}`;
  }

  const turnStartLength = history.length;

  // Coalesce storage_synced broadcasts so we don't flood the UI on
  // back-to-back writes — emit at most once per ~500ms window.
  let syncEmitTimer: NodeJS.Timeout | null = null;
  const emitSynced = (): void => {
    if (syncEmitTimer) return;
    syncEmitTimer = setTimeout(() => {
      syncEmitTimer = null;
      broadcastToProject(projectId, { type: "storage_synced", at: Date.now() });
    }, 500);
  };

  const result = await runAgentLoop(finalMessage, {
    sandbox: { rootDir: sandboxDir },
    apiKey,
    projectId,
    messages: history,
    signal,
    previewBaseUrl: PREVIEW_BASE_URL,
    onText: (content) => send({ type: "text", content }),
    onIteration: (iter) => send({ type: "iteration", iter }),
    onToolCallStarted: (callId, name) => {
      toolCalls++;
      // Emit tool_call with empty input so the UI can render a "running…" row
      // immediately, before the model has finished generating the input. The
      // final tool_call event below will replace the input once it's known.
      send({ type: "tool_call", call_id: callId, name, input: {} });
    },
    onToolCall: (callId, name, input) => {
      // Re-emit with the full input now that streaming finished. The UI
      // dedupes on call_id and updates the existing row in place.
      send({ type: "tool_call", call_id: callId, name, input });
    },
    onToolResult: (callId, name, input, toolResult, isError) => {
      send({ type: "tool_result", call_id: callId, result: toolResult, is_error: isError });
      if (isError) return;
      if (name === "write_file" || name === "edit_file") {
        const p = (input as { path?: unknown })?.path;
        if (typeof p === "string") {
          send({ type: "file_changed", path: p });
          getTracker(projectId, sandboxDir)
            .syncFile(p)
            .then(() => emitSynced())
            .catch((err) => console.error(`syncFile ${p} failed:`, err));
        }
        return;
      }
      if (name === "run_command") {
        // run_command may have created/modified arbitrary files. Background
        // walk + push.
        getTracker(projectId, sandboxDir)
          .syncChanges()
          .then(() => emitSynced())
          .catch((err) => console.error("syncChanges failed:", err));
        return;
      }
      if (name === "start_server") {
        try {
          const parsed = JSON.parse(toolResult) as { server_id: string; port: number };
          const command = String((input as { command?: unknown })?.command ?? "");
          broadcastToProject(projectId, {
            type: "server_started",
            id: parsed.server_id,
            command,
            port: parsed.port,
          });
          // Save the agent's choice as the project's default "Run" config so
          // the user's one-click Run button reuses it next time. Background;
          // failures here are non-fatal — the agent's server is already up.
          if (command && Number.isFinite(parsed.port)) {
            writeRunConfig(sandboxDir, {
              command,
              port: parsed.port,
              source: "agent",
            })
              .then(() =>
                getTracker(projectId, sandboxDir)
                  .syncFile(".uniqus-run.json")
                  .then(() => emitSynced()),
              )
              .catch((err) => console.error("writeRunConfig failed:", err));
          }
        } catch {}
        return;
      }
      if (name === "stop_server") {
        const id = String((input as { server_id?: unknown })?.server_id ?? "");
        if (id) broadcastToProject(projectId, { type: "server_stopped", id });
      }
    },
  });

  // Persist any new messages added during this turn — even if aborted, the
  // partial assistant message + synthesized tool_results need to survive so
  // the next turn's history is a valid sequence.
  for (let i = turnStartLength; i < history.length; i++) {
    await appendMessage(projectId, history[i]).catch((err) =>
      console.error("appendMessage failed:", err),
    );
  }

  send({
    type: "complete",
    tool_calls: toolCalls,
    elapsed_ms: Date.now() - start,
    aborted: result.aborted || undefined,
  });
}

// ── Filesystem helpers ────────────────────────────────────────────────────────

async function walkSandbox(rootDir: string): Promise<TreeEntry[]> {
  const entries: TreeEntry[] = [];

  async function walk(dir: string): Promise<void> {
    const list = await fs.readdir(dir, { withFileTypes: true });
    for (const e of list) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      const full = path.join(dir, e.name);
      const rel = path.relative(rootDir, full).replaceAll(path.sep, "/");
      entries.push({ path: rel, is_dir: e.isDirectory() });
      if (e.isDirectory()) await walk(full);
    }
  }

  try {
    await walk(rootDir);
  } catch {}
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

async function readSandboxFile(rootDir: string, p: string): Promise<string | null> {
  try {
    const full = path.resolve(rootDir, p);
    if (!full.startsWith(rootDir)) return null;
    return await fs.readFile(full, "utf-8");
  } catch {
    return null;
  }
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
