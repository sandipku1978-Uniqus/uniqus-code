import "./env.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
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
import { shellInfo, listServers, sandboxEvents } from "./agent/sandbox.js";
import { upsertUser, type UserRecord } from "./db/users.js";
import { listProjects, createProject, getProject, touchProject } from "./db/projects.js";
import { loadHistory, appendMessage, clearHistory } from "./db/messages.js";
import { unsealSessionFromCookieHeader, type AuthKitSession } from "./auth/workos.js";
import { ensureBucket } from "./storage/client.js";
import { getTracker } from "./storage/sync.js";

// Railway/Fly inject PORT; local dev sets ORCHESTRATOR_PORT or falls back to 8787.
const PORT = Number(process.env.PORT ?? process.env.ORCHESTRATOR_PORT ?? 8787);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SANDBOX_ROOT = path.resolve(REPO_ROOT, ".sandbox");

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

  res.writeHead(404);
  res.end();
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
          );
          await touchProject(project.id);
        } finally {
          busy = false;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      send({ type: "error", message });
      busy = false;
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
): Promise<void> {
  const start = Date.now();
  let toolCalls = 0;
  let finalMessage = userMessage;

  if (mode === "plan-then-execute") {
    const plan = await proposePlan(userMessage, apiKey, history);
    send({ type: "plan_proposed", plan });
    const approved = await awaitPlanApproval();
    send({ type: "plan_running" });
    finalMessage = `${userMessage}\n\n${formatPlanForExecution(approved)}`;
  }

  const turnStartLength = history.length;

  await runAgentLoop(finalMessage, {
    sandbox: { rootDir: sandboxDir },
    apiKey,
    projectId,
    messages: history,
    onText: (content) => send({ type: "text", content }),
    onIteration: (iter) => send({ type: "iteration", iter }),
    onToolCall: (callId, name, input) => {
      toolCalls++;
      send({ type: "tool_call", call_id: callId, name, input });
    },
    onToolResult: (callId, name, input, result, isError) => {
      send({ type: "tool_result", call_id: callId, result, is_error: isError });
      if (isError) return;
      if (name === "write_file" || name === "edit_file") {
        const p = (input as { path?: unknown })?.path;
        if (typeof p === "string") {
          send({ type: "file_changed", path: p });
          // Background push to Storage; don't block the agent loop.
          getTracker(projectId, sandboxDir)
            .syncFile(p)
            .catch((err) => console.error(`syncFile ${p} failed:`, err));
        }
        return;
      }
      if (name === "run_command") {
        // run_command may have created/modified arbitrary files (e.g. npm
        // init, scaffolders). Background-walk and push anything new.
        getTracker(projectId, sandboxDir)
          .syncChanges()
          .catch((err) => console.error("syncChanges failed:", err));
        return;
      }
      if (name === "start_server") {
        try {
          const parsed = JSON.parse(result) as { server_id: string; port: number };
          const command = String((input as { command?: unknown })?.command ?? "");
          broadcastToProject(projectId, {
            type: "server_started",
            id: parsed.server_id,
            command,
            port: parsed.port,
          });
        } catch {}
        return;
      }
      if (name === "stop_server") {
        const id = String((input as { server_id?: unknown })?.server_id ?? "");
        if (id) broadcastToProject(projectId, { type: "server_stopped", id });
      }
    },
  });

  // Persist any new messages added during this turn.
  for (let i = turnStartLength; i < history.length; i++) {
    await appendMessage(projectId, history[i]).catch((err) =>
      console.error("appendMessage failed:", err),
    );
  }

  send({ type: "complete", tool_calls: toolCalls, elapsed_ms: Date.now() - start });
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
