import http, {
  type IncomingMessage,
  type ServerResponse,
  type IncomingHttpHeaders,
} from "node:http";
import type { Duplex } from "node:stream";
import { getServer } from "./agent/sandbox.js";

// Match `/preview/{serverId}` optionally followed by `/...` rest.
// The serverId starts with `srv_` (see startServer in sandbox.ts) and is followed
// by 8 hex chars. Keep this loose so future id formats work without code changes.
const PREVIEW_PREFIX = /^\/preview\/([^/?#]+)(\/.*)?$/;

export interface ProxyTarget {
  serverId: string;
  port: number;
  /** The path inside the sandbox app (always starts with `/`). */
  innerPath: string;
}

/**
 * Resolve which sandboxed server a request belongs to.
 *
 * Priority:
 * 1. Path matches `/preview/{serverId}/...` → use that serverId, strip prefix.
 * 2. Otherwise, parse `Referer` for `/preview/{serverId}/`. Used for absolute-path
 *    asset requests like `/_next/static/main.js` that the iframe app emits.
 *
 * Returns null when neither matches or the server has stopped.
 */
export function resolveTarget(
  url: string,
  headers: IncomingHttpHeaders,
): ProxyTarget | null {
  const direct = url.match(PREVIEW_PREFIX);
  if (direct) {
    const serverId = direct[1];
    const innerPath = direct[2] ?? "/";
    const srv = getServer(serverId);
    if (!srv) return null;
    return { serverId, port: srv.port, innerPath };
  }

  const referer = headers.referer ?? headers.referrer;
  if (typeof referer === "string") {
    try {
      const parsed = new URL(referer);
      const m = parsed.pathname.match(/^\/preview\/([^/?#]+)/);
      if (m) {
        const serverId = m[1];
        const srv = getServer(serverId);
        if (srv) return { serverId, port: srv.port, innerPath: url };
      }
    } catch {
      // malformed referer, fall through
    }
  }

  return null;
}

/**
 * Forward an HTTP request to the in-sandbox dev server and stream the response back.
 */
export function proxyHttp(
  req: IncomingMessage,
  res: ServerResponse,
  target: ProxyTarget,
): void {
  // Strip hop-by-hop headers; rewrite host so the upstream sees its own origin.
  const headers: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    const lower = k.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    headers[k] = v;
  }
  headers.host = `127.0.0.1:${target.port}`;

  const upstream = http.request(
    {
      hostname: "127.0.0.1",
      port: target.port,
      method: req.method,
      path: target.innerPath,
      headers,
    },
    (upRes) => {
      // Pass through status + headers verbatim. Don't rewrite Location/Set-Cookie
      // for now — most dev servers emit relative URLs; we'll revisit if needed.
      const outHeaders: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(upRes.headers)) {
        if (v === undefined) continue;
        if (HOP_BY_HOP.has(k.toLowerCase())) continue;
        outHeaders[k] = v;
      }
      res.writeHead(upRes.statusCode ?? 502, outHeaders);
      upRes.pipe(res);
    },
  );

  upstream.on("error", (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end(`preview proxy: upstream error: ${err.message}`);
    } else {
      res.destroy();
    }
  });

  req.pipe(upstream);
}

/**
 * Forward a WebSocket upgrade to the in-sandbox dev server. Required for HMR
 * (Next.js, Vite) — without it the iframe loads but never refreshes.
 */
export function proxyWebSocket(
  req: IncomingMessage,
  clientSocket: Duplex,
  head: Buffer,
  target: ProxyTarget,
): void {
  const headers: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    headers[k] = v;
  }
  headers.host = `127.0.0.1:${target.port}`;

  const upstream = http.request({
    hostname: "127.0.0.1",
    port: target.port,
    method: req.method,
    path: target.innerPath,
    headers,
  });

  upstream.on("upgrade", (upRes, upSocket, upHead) => {
    // Replay handshake to the client.
    const lines = [`HTTP/1.1 ${upRes.statusCode ?? 101} ${upRes.statusMessage ?? "Switching Protocols"}`];
    for (const [k, v] of Object.entries(upRes.headers)) {
      if (Array.isArray(v)) {
        for (const item of v) lines.push(`${k}: ${item}`);
      } else if (v !== undefined) {
        lines.push(`${k}: ${v}`);
      }
    }
    lines.push("\r\n");
    clientSocket.write(lines.join("\r\n"));
    if (upHead && upHead.length) clientSocket.write(upHead);
    if (head && head.length) upSocket.write(head);

    // Bidirectional pipe.
    upSocket.pipe(clientSocket);
    clientSocket.pipe(upSocket);

    upSocket.on("error", () => clientSocket.destroy());
    clientSocket.on("error", () => upSocket.destroy());
  });

  upstream.on("response", (upRes) => {
    // Upstream answered with a normal response instead of upgrading. Forward and close.
    const lines = [`HTTP/1.1 ${upRes.statusCode ?? 502} ${upRes.statusMessage ?? "Bad Gateway"}`];
    for (const [k, v] of Object.entries(upRes.headers)) {
      if (Array.isArray(v)) {
        for (const item of v) lines.push(`${k}: ${item}`);
      } else if (v !== undefined) {
        lines.push(`${k}: ${v}`);
      }
    }
    lines.push("\r\n");
    clientSocket.write(lines.join("\r\n"));
    upRes.pipe(clientSocket);
  });

  upstream.on("error", () => {
    try {
      clientSocket.destroy();
    } catch {}
  });

  upstream.end();
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);
