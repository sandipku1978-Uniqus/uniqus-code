import http, {
  type IncomingMessage,
  type ServerResponse,
  type IncomingHttpHeaders,
} from "node:http";
import type { Duplex } from "node:stream";
import { getServer } from "./agent/sandbox.js";
import { touch as touchVm } from "./firecracker/index.js";

// Match `/preview/{serverId}` optionally followed by `/...` rest.
// The serverId starts with `srv_` (see startServer in sandbox.ts) and is followed
// by 8 hex chars. Keep this loose so future id formats work without code changes.
const PREVIEW_PREFIX = /^\/preview\/([^/?#]+)(\/.*)?$/;

/**
 * Cookie name used to pin the iframe to its preview server. Set whenever we
 * proxy a `/preview/{serverId}/...` request and read as a third-priority
 * resolver after path and Referer. This is what makes client-side routing
 * survive `history.pushState` — Next.js, Vite, etc. soft-navigate to bare
 * paths like `/about`, dropping the `/preview/{id}/` prefix from both the
 * URL and the Referer; the cookie keeps the routing sticky.
 */
const PREVIEW_COOKIE = "uniqus_preview";

export interface ProxyTarget {
  serverId: string;
  /** Host to dial. "127.0.0.1" for process-backed servers, the VM IP for Firecracker-backed ones. */
  host: string;
  port: number;
  /** The path inside the sandbox app (always starts with `/`). */
  innerPath: string;
}

function readPreviewCookie(headers: IncomingHttpHeaders): string | null {
  const cookieHeader = headers.cookie;
  if (typeof cookieHeader !== "string") return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name !== PREVIEW_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

function buildPreviewCookie(serverId: string): string {
  // SameSite=None; Secure is required because the preview iframe is
  // typically embedded in a different origin (the web app). Path=/ so the
  // cookie covers `/about`, `/_next/...`, `/_next/webpack-hmr`, etc.
  // Max-Age is short — preview ids are ephemeral, we don't want stale ones
  // outliving their dev servers.
  return `${PREVIEW_COOKIE}=${encodeURIComponent(serverId)}; Path=/; Max-Age=86400; SameSite=None; Secure; HttpOnly`;
}

/**
 * Resolve which sandboxed server a request belongs to.
 *
 * Priority:
 * 1. Path matches `/preview/{serverId}/...` → use that serverId, strip prefix.
 * 2. Otherwise, parse `Referer` for `/preview/{serverId}/`. Used for
 *    absolute-path asset requests like `/_next/static/main.js` that the
 *    iframe app emits while the URL bar still shows the preview path.
 * 3. Fall back to the `uniqus_preview` cookie. Catches the cases that 1 and 2
 *    miss: client-side soft navigation (Next.js / Vite `pushState` strips
 *    the `/preview/{id}/` prefix from the URL AND the Referer), and
 *    WebSocket upgrades for HMR (browsers don't send Referer on WS).
 *
 * Returns null when nothing matches or the server has stopped.
 */
export function resolveTarget(
  url: string,
  headers: IncomingHttpHeaders,
): ProxyTarget | null {
  // Mark the VM (if any) backing this server as "active" so the fleet's
  // idle-pause sweeper doesn't freeze the VM while the user is actively
  // poking at the preview iframe. Without this, sustained preview use
  // with no agent activity hits a paused VM at the 5-minute mark.
  const keepAlive = (srv: { project_id: string | null }) => {
    if (srv.project_id) touchVm(srv.project_id);
  };

  const direct = url.match(PREVIEW_PREFIX);
  if (direct) {
    const serverId = direct[1];
    const innerPath = direct[2] ?? "/";
    const srv = getServer(serverId);
    if (!srv) return null;
    keepAlive(srv);
    return { serverId, host: srv.host, port: srv.port, innerPath };
  }

  const referer = headers.referer ?? headers.referrer;
  if (typeof referer === "string") {
    try {
      const parsed = new URL(referer);
      const m = parsed.pathname.match(/^\/preview\/([^/?#]+)/);
      if (m) {
        const serverId = m[1];
        const srv = getServer(serverId);
        if (srv) {
          keepAlive(srv);
          return { serverId, host: srv.host, port: srv.port, innerPath: url };
        }
      }
    } catch {
      // malformed referer, fall through
    }
  }

  const cookieId = readPreviewCookie(headers);
  if (cookieId) {
    const srv = getServer(cookieId);
    if (srv) {
      keepAlive(srv);
      return { serverId: cookieId, host: srv.host, port: srv.port, innerPath: url };
    }
  }

  return null;
}

/**
 * Forward an HTTP request to the in-sandbox dev server and stream the response back.
 *
 * For HTML responses we buffer + inject a tiny navigation-reporter script so
 * the workspace's preview URL bar can reflect the iframe's actual current
 * path (including SPA pushState navigations). The script posts a message to
 * `window.parent` on every path change. Cross-origin is fine — postMessage
 * works across origins; we never need to read iframe.contentWindow.location.
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
  // Drop Accept-Encoding so HTML responses come back uncompressed. We need to
  // inject a script and don't want to gunzip/regzip on every request. Other
  // assets (JS, CSS, images) are passed through unchanged.
  delete headers["accept-encoding"];
  headers.host = `${target.host}:${target.port}`;

  const upstream = http.request(
    {
      hostname: target.host,
      port: target.port,
      method: req.method,
      path: target.innerPath,
      headers,
    },
    (upRes) => {
      const outHeaders: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(upRes.headers)) {
        if (v === undefined) continue;
        if (HOP_BY_HOP.has(k.toLowerCase())) continue;
        outHeaders[k] = v;
      }
      // Pin the iframe's browser to this preview server. We append rather
      // than overwrite so any cookies the dev server itself set still pass
      // through (Next.js auth flows, app-set session cookies, etc.).
      const ourCookie = buildPreviewCookie(target.serverId);
      const existing = outHeaders["set-cookie"];
      if (Array.isArray(existing)) {
        outHeaders["set-cookie"] = [...existing, ourCookie];
      } else if (typeof existing === "string") {
        outHeaders["set-cookie"] = [existing, ourCookie];
      } else {
        outHeaders["set-cookie"] = ourCookie;
      }

      const contentType = String(upRes.headers["content-type"] ?? "");
      const isHtml = contentType.toLowerCase().startsWith("text/html");
      if (!isHtml) {
        res.writeHead(upRes.statusCode ?? 502, outHeaders);
        upRes.pipe(res);
        return;
      }
      // Buffer + inject. Strip Content-Length (we'll let chunked-encoding handle it).
      delete outHeaders["content-length"];
      const chunks: Buffer[] = [];
      upRes.on("data", (c: Buffer) => chunks.push(c));
      upRes.on("end", () => {
        const original = Buffer.concat(chunks).toString("utf-8");
        const injected = injectNavReporter(original, target.serverId);
        res.writeHead(upRes.statusCode ?? 502, outHeaders);
        res.end(injected);
      });
      upRes.on("error", () => {
        if (!res.headersSent) {
          res.writeHead(502, { "Content-Type": "text/plain" });
          res.end("preview proxy: upstream stream error");
        } else {
          res.destroy();
        }
      });
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
  headers.host = `${target.host}:${target.port}`;

  const upstream = http.request({
    hostname: target.host,
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
    // Send a proper HTTP response so the browser knows the upgrade failed
    // definitively (rather than just destroying, which triggers infinite retries).
    try {
      clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
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

/**
 * Tiny script we inject into the head of every HTML preview response. It
 * wraps history.pushState/replaceState and listens for popstate, then posts
 * the current path to window.parent. The workspace's PreviewPanel listens
 * for `uniqus:preview-nav` messages and updates the URL bar.
 *
 * Cross-origin safe — we only postMessage outward; we never read parent state.
 * Idempotent if injected twice (the wrappers no-op on the second pass).
 */
function injectNavReporter(html: string, serverId: string): string {
  const script = `<script>(function(){
  if (window.__uniqusNavReporterInstalled) return;
  window.__uniqusNavReporterInstalled = true;
  var serverId = ${JSON.stringify(serverId)};
  function post() {
    try {
      window.parent.postMessage({
        type: "uniqus:preview-nav",
        server_id: serverId,
        path: location.pathname + location.search + location.hash,
      }, "*");
    } catch (e) {}
  }
  var wrap = function(name) {
    var orig = history[name];
    if (typeof orig !== "function") return;
    history[name] = function() {
      var r = orig.apply(this, arguments);
      try { post(); } catch (e) {}
      return r;
    };
  };
  wrap("pushState"); wrap("replaceState");
  window.addEventListener("popstate", post);
  window.addEventListener("hashchange", post);
  if (document.readyState !== "loading") post();
  else document.addEventListener("DOMContentLoaded", post);
})();</script>`;
  // Prefer to inject at the start of <head> so we run before app code; fall
  // back to <body> or just prepending if neither tag exists (rare).
  const headOpen = html.search(/<head[^>]*>/i);
  if (headOpen >= 0) {
    const insertAt = html.indexOf(">", headOpen) + 1;
    return html.slice(0, insertAt) + script + html.slice(insertAt);
  }
  const bodyOpen = html.search(/<body[^>]*>/i);
  if (bodyOpen >= 0) {
    const insertAt = html.indexOf(">", bodyOpen) + 1;
    return html.slice(0, insertAt) + script + html.slice(insertAt);
  }
  return script + html;
}
