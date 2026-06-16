import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { finalizeRestore } from "./agentRpc.js";

/**
 * P0.5 — locks the per-VM agent bearer-auth contract (F1/P0.1/P0.2).
 *
 * Two layers are covered:
 *  1. The AGENT enforcement contract: a non-/health request is 401 without (or
 *     with a wrong) bearer and 200 with the right one, while /health stays
 *     unauthenticated. The guard below mirrors the real agents
 *     (`services/sandbox-agent/src/main.rs` ~259–282 and `src/agent.mjs`
 *     ~174–181) — keep the three in lockstep.
 *  2. The ORCHESTRATOR wire contract: `finalizeRestore` (real code) re-provisions
 *     a golden clone's token, so it must send `auth_token` + `uniqus_auth` in the
 *     body AND the same token as a `Bearer` header (so a retry after the agent
 *     flips enforcement on still authenticates).
 */

// Mirrors the agent's constant-time bearer check. `enforced` is null when auth
// is off (a golden clone before /net/configure provisions it).
function authGuard(enforced: string | null, authHeader: string | undefined, path: string): number {
  if (path === "/health") return 200;
  if (!enforced) return 200;
  const presented = Buffer.from(authHeader ?? "");
  const expected = Buffer.from(`Bearer ${enforced}`);
  const ok = presented.length === expected.length && timingSafeEqual(presented, expected);
  return ok ? 200 : 401;
}

function startServer(
  handler: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void,
): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => handler(req, body, res));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        port,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

describe("agent bearer-auth enforcement contract", () => {
  const TOKEN = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

  it("401s a non-/health request with no bearer when auth is enforced", () => {
    expect(authGuard(TOKEN, undefined, "/fs/file")).toBe(401);
  });

  it("401s a wrong bearer", () => {
    expect(authGuard(TOKEN, "Bearer not-the-token", "/fs/file")).toBe(401);
  });

  it("200s the correct bearer", () => {
    expect(authGuard(TOKEN, `Bearer ${TOKEN}`, "/fs/file")).toBe(200);
  });

  it("leaves /health unauthenticated (readiness probe)", () => {
    expect(authGuard(TOKEN, undefined, "/health")).toBe(200);
  });

  it("does not enforce before a token is provisioned (golden clone pre-/net/configure)", () => {
    expect(authGuard(null, undefined, "/fs/file")).toBe(200);
  });
});

describe("finalizeRestore re-provisions golden-clone auth (P0.2)", () => {
  let server: { port: number; close: () => Promise<void> } | null = null;
  afterEach(async () => {
    if (server) await server.close();
    server = null;
  });

  it("sends auth_token + uniqus_auth in the body AND a Bearer header", async () => {
    const TOKEN = "feedfacefeedfacefeedfacefeedfacefeedfacefeedface";
    let captured: { method?: string; url?: string; auth?: string; body: unknown } = { body: null };
    server = await startServer((req, body, res) => {
      captured = {
        method: req.method,
        url: req.url,
        auth: req.headers["authorization"],
        body: body ? JSON.parse(body) : null,
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });

    await finalizeRestore("127.0.0.1", server.port, {
      ip: "172.16.3.4/16",
      gw: "172.16.0.1",
      mac: "02:fc:aa:bb:cc:dd",
      mount_sandbox: true,
      seed: "c2VlZA==",
      time_ms: 1_700_000_000_000,
      auth_token: TOKEN,
      uniqus_auth: true,
    });

    expect(captured.method).toBe("POST");
    expect(captured.url).toBe("/net/configure");
    expect(captured.auth).toBe(`Bearer ${TOKEN}`);
    expect(captured.body).toMatchObject({ auth_token: TOKEN, uniqus_auth: true });
  });
});
