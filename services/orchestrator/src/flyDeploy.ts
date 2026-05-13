import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { safeChildEnv } from "./safeEnv.js";
import { getSecretValue } from "./db/secrets.js";

/**
 * Fly.io deploy adapter (Plan §5 — multi-target deploy).
 *
 * The Phase-1.6 deploy is Vercel-only, which only handles JS/static. For
 * the wedge — Slack bots, Snowflake queries, ETL scripts, scheduled jobs —
 * we need a long-running container target. Fly Machines is the path.
 *
 * Flow:
 *   1. Detect project shape (package.json / requirements.txt / go.mod).
 *   2. Auto-generate Dockerfile + fly.toml if missing.
 *   3. Resolve FLY_API_TOKEN from project secrets.
 *   4. Shell out to `flyctl deploy` (tokens via env, not CLI auth).
 *
 * Requires `flyctl` to be installed in the orchestrator host. The error
 * surfaces clearly if it isn't — the user installs it once and retries.
 */

export interface FlyDeployResult {
  ok: boolean;
  app: string;
  url: string;
  log: string;
}

export type ProjectShape =
  | "node"
  | "node-server"
  | "python"
  | "go"
  | "static"
  | "unknown";

/**
 * Deps that imply a long-running process — sockets, queues, schedulers, bot
 * frameworks — and so cannot run on Vercel's serverless model. Routing such
 * a project to Vercel "deploys" it but every request reconnects (or worse,
 * hangs the function until timeout). Detecting these forces the recommend
 * path to Fly.
 */
const SERVER_DEPS = new Set([
  "ws",
  "socket.io",
  "socket.io-client",
  "engine.io",
  "bullmq",
  "bull",
  "agenda",
  "node-cron",
  "discord.js",
  "telegraf",
  "grammy",
  "@slack/socket-mode",
  "fastify-websocket",
  "@fastify/websocket",
]);

export async function detectShape(sandboxDir: string): Promise<ProjectShape> {
  const has = async (rel: string): Promise<boolean> => {
    try {
      await fs.access(path.join(sandboxDir, rel));
      return true;
    } catch {
      return false;
    }
  };
  if (await has("package.json")) {
    return (await isLongRunningNode(sandboxDir)) ? "node-server" : "node";
  }
  if (await has("requirements.txt") || await has("pyproject.toml")) return "python";
  if (await has("go.mod")) return "go";
  if (await has("index.html")) return "static";
  return "unknown";
}

async function isLongRunningNode(sandboxDir: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(path.join(sandboxDir, "package.json"), "utf-8");
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    for (const name of Object.keys(all)) {
      if (SERVER_DEPS.has(name)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function ensureFlyManifests(
  sandboxDir: string,
  appName: string,
): Promise<{ shape: ProjectShape; created: string[] }> {
  const created: string[] = [];
  const shape = await detectShape(sandboxDir);
  const dockerPath = path.join(sandboxDir, "Dockerfile");
  if (!(await exists(dockerPath))) {
    const body = renderDockerfile(shape);
    if (body) {
      await fs.writeFile(dockerPath, body, "utf-8");
      created.push("Dockerfile");
    }
  }
  const flyTomlPath = path.join(sandboxDir, "fly.toml");
  if (!(await exists(flyTomlPath))) {
    await fs.writeFile(flyTomlPath, renderFlyToml(appName, shape), "utf-8");
    created.push("fly.toml");
  }
  // Fly ignores most build artifacts via .dockerignore; create a minimal one
  // if missing so node_modules / .venv don't bloat the build context.
  const dockerIgnore = path.join(sandboxDir, ".dockerignore");
  if (!(await exists(dockerIgnore))) {
    await fs.writeFile(
      dockerIgnore,
      `node_modules\n.next\n.venv\n__pycache__\n.git\n.uniqus\n.sandbox\n*.log\n.env\n.env.*\n!.env.example\n`,
      "utf-8",
    );
    created.push(".dockerignore");
  }
  return { shape, created };
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function renderDockerfile(shape: ProjectShape): string | null {
  switch (shape) {
    case "node":
    case "node-server":
      return `FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY . .
RUN if [ -f package.json ] && grep -q '"build"' package.json; then npm run build || true; fi
ENV PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "if [ -f package.json ] && grep -q '\\"start\\"' package.json; then npm start; else node server.js; fi"]
`;
    case "python":
      return `FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt* pyproject.toml* poetry.lock* ./
RUN if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; fi
COPY . .
ENV PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "if [ -f app.py ]; then python app.py; elif [ -f main.py ]; then python main.py; else python -m http.server $PORT; fi"]
`;
    case "go":
      return `FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/app ./...

FROM alpine:3.19
COPY --from=build /out/app /usr/local/bin/app
ENV PORT=8080
EXPOSE 8080
CMD ["/usr/local/bin/app"]
`;
    case "static":
      return `FROM nginx:alpine
COPY . /usr/share/nginx/html
EXPOSE 80
`;
    default:
      return null;
  }
}

function renderFlyToml(appName: string, shape: ProjectShape): string {
  const internalPort = shape === "static" ? 80 : 8080;
  // node-server projects hold open WS or queue connections — auto-stop would
  // sever them every few minutes. Keep at least one machine running.
  const keepWarm = shape === "node-server";
  return `# fly.toml — generated by Uniqus
app = "${appName}"
primary_region = "iad"

[build]

[http_service]
  internal_port = ${internalPort}
  force_https = true
  auto_stop_machines = ${keepWarm ? "false" : "true"}
  auto_start_machines = true
  min_machines_running = ${keepWarm ? 1 : 0}

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 256
`;
}

export async function flyDeploy(args: {
  sandboxDir: string;
  appName: string;
  projectId: string;
  region?: string;
  envVars?: Record<string, string>;
  onLog?: (chunk: string) => void;
}): Promise<FlyDeployResult> {
  // Resolve token. Encourage FLY_API_TOKEN as the secret name.
  const token = await getSecretValue(args.projectId, "FLY_API_TOKEN");
  if (!token) {
    throw new Error(
      "FLY_API_TOKEN secret is not set. Add it from the Secrets pane (generate one at https://fly.io/user/personal_access_tokens).",
    );
  }
  const { shape, created } = await ensureFlyManifests(args.sandboxDir, args.appName);
  if (shape === "unknown") {
    throw new Error(
      "Could not detect project shape (no package.json, requirements.txt, pyproject.toml, go.mod, or index.html found).",
    );
  }
  if (created.length > 0) {
    args.onLog?.(`[fly] generated ${created.join(", ")}\n`);
  }

  // Auto-create the Fly app if it doesn't exist. The Machines REST API
  // returns 404 on GET /apps/<name> when missing, 200 when it's already
  // ours. POST creates. We tolerate "name taken" so a retry after a
  // partial failure is idempotent.
  await ensureFlyApp(args.appName, token, args.onLog);

  const env = {
    ...safeChildEnv(),
    FLY_API_TOKEN: token,
    FLY_ACCESS_TOKEN: token,
  };
  const flyArgs = ["deploy", "--app", args.appName, "--remote-only", "--yes"];
  if (args.region) flyArgs.push("--region", args.region);
  for (const [k, v] of Object.entries(args.envVars ?? {})) {
    flyArgs.push("-e", `${k}=${v}`);
  }
  const log: string[] = [];
  const proc = spawn("flyctl", flyArgs, {
    cwd: args.sandboxDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return await new Promise<FlyDeployResult>((resolve, reject) => {
    let spawned = true;
    proc.once("error", (err) => {
      spawned = false;
      reject(
        new Error(
          `flyctl is not installed on the orchestrator host. Install from https://fly.io/docs/flyctl/install/ and retry. (${err.message})`,
        ),
      );
    });
    const append = (d: Buffer): void => {
      const s = d.toString();
      log.push(s);
      args.onLog?.(s);
    };
    proc.stdout?.on("data", append);
    proc.stderr?.on("data", append);
    proc.once("close", (code) => {
      if (!spawned) return;
      const all = log.join("");
      if (code !== 0) {
        reject(new Error(`flyctl exited ${code}.\n${all.slice(-3000)}`));
        return;
      }
      resolve({
        ok: true,
        app: args.appName,
        url: `https://${args.appName}.fly.dev`,
        log: all.slice(-4000),
      });
    });
  });
}

/**
 * Idempotent: GET /v1/apps/<name>; if 404, POST /v1/apps with
 * { app_name, org_slug:"personal" }. Tolerates 422 "name taken" so two
 * deploys racing don't fail one of them.
 *
 * Uses the Machines REST API on api.machines.dev — same token as flyctl.
 */
async function ensureFlyApp(
  appName: string,
  token: string,
  onLog?: (s: string) => void,
): Promise<void> {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const get = await fetch(`https://api.machines.dev/v1/apps/${appName}`, { headers });
  if (get.status === 200) return;
  if (get.status !== 404) {
    const body = await get.text().catch(() => "");
    throw new Error(`Fly GET /apps/${appName} returned ${get.status}: ${body.slice(0, 300)}`);
  }
  onLog?.(`[fly] creating app ${appName} in org "personal"…\n`);
  const create = await fetch("https://api.machines.dev/v1/apps", {
    method: "POST",
    headers,
    body: JSON.stringify({ app_name: appName, org_slug: "personal" }),
  });
  if (create.status === 201 || create.status === 200) return;
  const body = await create.text().catch(() => "");
  // 422 with "name taken" means a concurrent caller already won the race —
  // that's actually the desired terminal state.
  if (create.status === 422 && /taken|exists/i.test(body)) return;
  throw new Error(
    `Fly app create failed (${create.status}): ${body.slice(0, 300)}. ` +
      `If this is a permission issue, regenerate FLY_API_TOKEN with org-level scope.`,
  );
}
