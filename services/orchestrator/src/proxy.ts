import http, {
  type IncomingMessage,
  type ServerResponse,
  type IncomingHttpHeaders,
} from "node:http";
import type { Duplex } from "node:stream";
import { getServer } from "./agent/sandbox.js";
import { touch as touchVm } from "./firecracker/index.js";
import { resolveShareToken } from "./previewShare.js";

// Match `/preview/{serverId}` optionally followed by `/...` rest.
// The serverId starts with `srv_` (see startServer in sandbox.ts) and is followed
// by 8 hex chars. Keep this loose so future id formats work without code changes.
// The rest after the id may be absent, a `/path...`, OR start directly with a
// query/fragment (`/preview/srv_x?foo=1`). The old `(\/.*)?$` rejected the
// no-slash-but-has-query form, 404ing it (C-105). innerPath is normalized to a
// leading "/" by normalizeInnerPath below.
const PREVIEW_PREFIX = /^\/preview\/([^/?#]+)([/?#].*)?$/;
// A shared preview URL: /preview/share/<token>/... — resolved to a serverId via
// a revocable, expiring token (C3) rather than exposing the bare serverId.
const PREVIEW_SHARE_PREFIX = /^\/preview\/share\/([A-Za-z0-9_-]+)([/?#].*)?$/;

/** Normalize a regex "rest" group into an upstream path with a leading "/". */
function normalizeInnerPath(rest: string | undefined): string {
  if (!rest) return "/";
  return rest.startsWith("/") ? rest : `/${rest}`;
}
const PREVIEW_SHARE_COOKIE = "uniqus_preview_share";

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
  /**
   * Set when the request was authorized by a SHARE TOKEN (C3) rather than the
   * bare serverId. The proxy then pins the recipient's browser to the *token*
   * (not the serverId) so revocation/expiry survives client-side soft nav.
   */
  shareToken?: string;
}

function readCookie(headers: IncomingHttpHeaders, cookieName: string): string | null {
  const cookieHeader = headers.cookie;
  if (typeof cookieHeader !== "string") return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name !== cookieName) continue;
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

function readPreviewCookie(headers: IncomingHttpHeaders): string | null {
  return readCookie(headers, PREVIEW_COOKIE);
}

function buildPreviewCookie(serverId: string): string {
  // SameSite=None; Secure is required because the preview iframe is
  // typically embedded in a different origin (the web app). Path=/ so the
  // cookie covers `/about`, `/_next/...`, `/_next/webpack-hmr`, etc.
  // Max-Age is deliberately short (1h): the serverId is an unguessable 128-bit
  // capability (M-6) and a stale/injected cookie pins the victim's bare-path
  // preview to that server for its whole lifetime, so don't let it outlive an
  // ephemeral dev server by a day (M-7).
  return `${PREVIEW_COOKIE}=${encodeURIComponent(serverId)}; Path=/; Max-Age=3600; SameSite=None; Secure; HttpOnly`;
}

function buildShareCookie(token: string): string {
  // Pin a SHARED recipient to the token (not the serverId) so revoking/expiring
  // the token actually cuts off access on the next request, even after soft nav
  // strips the share path. Same short Max-Age as the owner cookie (C3).
  return `${PREVIEW_SHARE_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=3600; SameSite=None; Secure; HttpOnly`;
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

  // Shared preview (C3): /preview/share/<token>/... — resolve the revocable,
  // expiring token to a serverId. Checked BEFORE the bare-serverId match (which
  // would otherwise treat "share" as a serverId and 404).
  const shareDirect = url.match(PREVIEW_SHARE_PREFIX);
  if (shareDirect) {
    const token = shareDirect[1];
    const serverId = resolveShareToken(token);
    if (!serverId) return null;
    const srv = getServer(serverId);
    if (!srv) return null;
    keepAlive(srv);
    return { serverId, host: srv.host, port: srv.port, innerPath: normalizeInnerPath(shareDirect[2]), shareToken: token };
  }

  const direct = url.match(PREVIEW_PREFIX);
  if (direct) {
    const serverId = direct[1];
    const innerPath = normalizeInnerPath(direct[2]);
    const srv = getServer(serverId);
    if (!srv) return null;
    keepAlive(srv);
    return { serverId, host: srv.host, port: srv.port, innerPath };
  }

  const referer = headers.referer ?? headers.referrer;
  if (typeof referer === "string") {
    try {
      const parsed = new URL(referer);
      // A shared-preview referer resolves via the token (C3).
      const sm = parsed.pathname.match(/^\/preview\/share\/([A-Za-z0-9_-]+)/);
      if (sm) {
        const serverId = resolveShareToken(sm[1]);
        if (serverId) {
          const srv = getServer(serverId);
          if (srv) {
            keepAlive(srv);
            return { serverId, host: srv.host, port: srv.port, innerPath: url, shareToken: sm[1] };
          }
        }
      }
      const m = parsed.pathname.match(/^\/preview\/([^/?#]+)/);
      if (m && m[1] !== "share") {
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

  // Shared sessions are pinned to the TOKEN cookie, so revocation/expiry holds
  // even after client-side soft navigation strips the share path (C3).
  const shareCookie = readCookie(headers, PREVIEW_SHARE_COOKIE);
  if (shareCookie) {
    const serverId = resolveShareToken(shareCookie);
    if (serverId) {
      const srv = getServer(serverId);
      if (srv) {
        keepAlive(srv);
        return { serverId, host: srv.host, port: srv.port, innerPath: url, shareToken: shareCookie };
      }
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
 * First-load self-heal. A just-started dev server commonly isn't ready for the
 * very first preview hit — it's still binding the port, or (Next.js/Turbopack,
 * Vite) compiling the first route on demand, which can take far longer than a
 * single request's patience. That surfaces as connect-refused, "socket hang up"
 * (ECONNRESET), or a slow no-response that trips the upstream timeout — all of
 * which used to dead-end at a hard 502 the user had to manually refresh past.
 * Instead, for a top-level navigation we serve an auto-retrying "warming up"
 * page that reloads itself until the server answers, bounded by this budget;
 * past it the real error shows (the server is probably genuinely down).
 */
const PREVIEW_WARMUP_BUDGET_MS = 120_000;
/** Internal query param carrying the warmup start time across reloads. */
const WARM_PARAM = "__uniqus_warm";

/** A GET for a top-level document (vs an asset / XHR / API call). */
function isDocumentNavigation(req: IncomingMessage): boolean {
  if ((req.method ?? "GET").toUpperCase() !== "GET") return false;
  return String(req.headers["accept"] ?? "").includes("text/html");
}

/** The warmup start-timestamp the proxy embedded in the reload URL, or null. */
export function readWarmStart(url: string): number | null {
  const qi = url.indexOf("?");
  if (qi < 0) return null;
  const v = new URLSearchParams(url.slice(qi + 1)).get(WARM_PARAM);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Same URL with WARM_PARAM set to `start` — the page reloads to this. */
export function withWarmParam(url: string, start: number): string {
  const qi = url.indexOf("?");
  const path = qi < 0 ? url : url.slice(0, qi);
  const params = new URLSearchParams(qi < 0 ? "" : url.slice(qi + 1));
  params.set(WARM_PARAM, String(start));
  return `${path}?${params.toString()}`;
}

/** Drop our internal warmup param before forwarding upstream (the app never sees it). */
export function stripWarmParam(innerPath: string): string {
  const qi = innerPath.indexOf("?");
  if (qi < 0) return innerPath;
  const params = new URLSearchParams(innerPath.slice(qi + 1));
  if (!params.has(WARM_PARAM)) return innerPath;
  params.delete(WARM_PARAM);
  const rest = params.toString();
  return rest ? `${innerPath.slice(0, qi)}?${rest}` : innerPath.slice(0, qi);
}

/**
 * Forward an HTTP request to the in-sandbox dev server and stream the response back.
 *
 * For HTML responses we buffer + inject two tiny bridge scripts: a
 * navigation-reporter (so the workspace's preview URL bar reflects the iframe's
 * actual path, including SPA pushState navigations) and an element-picker (so
 * the user can click a node in the preview to point the agent at it). Both post
 * messages to `window.parent`. Cross-origin is fine — postMessage works across
 * origins; we never need to read iframe.contentWindow.location.
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
      // Strip our internal warmup param so the dev server only ever sees its own
      // clean path (the param rides on the auto-retry reload URL, not the app).
      path: stripWarmParam(target.innerPath),
      headers,
      // Bound the upstream. During a VM restart/migration the TAP IP can
      // black-hole packets (SYN dropped or accepted with no response), and
      // without a timeout the client + upstream sockets stay open indefinitely;
      // HMR reconnect storms then leak FDs on the orchestrator (C-103).
      // 90s (up from 30s): a cold Next.js/Turbopack first-route compile routinely
      // runs past 30s, and killing the request mid-compile was the #1 source of
      // first-preview 502s ("upstream timed out") even though the server was fine.
      // The warmup page below still bounds total retry time, so a genuinely dead
      // upstream is surfaced quickly via connect-refused, not held for 90s.
      timeout: 90_000,
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
      const ourCookie = target.shareToken
        ? buildShareCookie(target.shareToken)
        : buildPreviewCookie(target.serverId);
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
      let bufferedBytes = 0;
      let htmlTooBig = false;
      // Cap the buffered HTML (untrusted in-sandbox dev server output). Without
      // this, a very large HTML doc — or many concurrent ones — buffers fully in
      // the single shared orchestrator process and can OOM it (C-52). 8 MB is far
      // above any real HTML document; past it we stop injecting and stream raw.
      const MAX_HTML_BYTES = 8 * 1024 * 1024;
      upRes.on("data", (c: Buffer) => {
        if (htmlTooBig) {
          res.write(c);
          return;
        }
        bufferedBytes += c.length;
        if (bufferedBytes > MAX_HTML_BYTES) {
          htmlTooBig = true;
          // Flush what we have un-injected and switch to streaming the rest.
          res.writeHead(upRes.statusCode ?? 502, outHeaders);
          for (const ch of chunks) res.write(ch);
          chunks.length = 0;
          res.write(c);
          return;
        }
        chunks.push(c);
      });
      upRes.on("end", () => {
        if (htmlTooBig) {
          res.end();
          return;
        }
        const original = Buffer.concat(chunks).toString("utf-8");
        // For a share-token request, inject the TOKEN (not the real serverId) as
        // the page's postMessage discriminator. The injected id is only used to
        // tag uniqus:* messages to the parent window; embedding the real serverId
        // let a recipient read it from page source and hit the unauthenticated
        // bare /preview/<serverId>/ tier, surviving share DELETE/expiry (C-14).
        const injected = injectPreviewScripts(
          original,
          target.shareToken ?? target.serverId,
          target.shareToken ? `/preview/share/${target.shareToken}` : `/preview/${target.serverId}`,
        );
        res.writeHead(upRes.statusCode ?? 502, outHeaders);
        res.end(injected);
      });
      upRes.on("error", () => {
        if (!res.headersSent) {
          const html = previewErrorPage(502, "Preview server crashed", "The dev server stopped responding mid-stream. Check the server logs in the chat for details.");
          res.writeHead(502, { "Content-Type": "text/html" });
          res.end(html);
        } else {
          res.destroy();
        }
      });
    },
  );

  upstream.on("timeout", () => {
    // Tear down a black-holed upstream (no response within the timeout) so the
    // sockets don't leak; this fires the "error" handler via destroy (C-103).
    upstream.destroy(new Error("upstream timed out"));
  });
  upstream.on("error", (err) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    // First-load self-heal: for a top-level navigation that failed to reach the
    // dev server (connect-refused / "socket hang up" / timed-out compile), serve
    // an auto-retrying "warming up" page instead of a terminal 502, so the iframe
    // loads itself once the server is ready. Bounded by PREVIEW_WARMUP_BUDGET_MS:
    // the first failure stamps a start time into the reload URL; once the budget
    // elapses we fall through to the real error below.
    if (isDocumentNavigation(req)) {
      const start = readWarmStart(req.url ?? "") ?? Date.now();
      if (Date.now() - start < PREVIEW_WARMUP_BUDGET_MS) {
        const reloadUrl = withWarmParam(req.url ?? target.innerPath, start);
        res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
        res.end(previewWarmingPage(reloadUrl, start));
        return;
      }
    }
    // Don't leak the upstream error text (Node connect errors embed the VM's
    // internal IP:port) to a SHARE recipient — an untrusted party by design
    // (C-102). Owners (no shareToken) still get the detailed message.
    const detail = target.shareToken
      ? "It may be offline. Please try again later."
      : `Could not connect to the dev server: ${err.message}. It may have crashed or timed out. Ask the Uniqus agent to check the server logs and restart.`;
    const html = previewErrorPage(502, "Oh no! The server seems to be down", detail);
    res.writeHead(502, { "Content-Type": "text/html" });
    res.end(html);
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

  // Track the upstream socket so a client disconnect can tear it down too.
  let upstreamSocket: Duplex | undefined;

  // If the client drops (or stalls and the socket ends), abort the upstream
  // request and destroy its socket — otherwise we leak an upstream
  // request/socket per dropped preview WS.
  const onClientGone = (): void => {
    try {
      upstream.destroy();
    } catch {}
    try {
      upstreamSocket?.destroy();
    } catch {}
  };
  clientSocket.on("close", onClientGone);
  clientSocket.on("end", onClientGone);

  upstream.on("upgrade", (upRes, upSocket, upHead) => {
    upstreamSocket = upSocket;
    // Replay handshake to the client. Strip CR/LF from upstream-controlled
    // status + header values so a malicious upstream can't inject extra
    // headers / split the response into the client socket (L-7).
    const lines = [
      `HTTP/1.1 ${upRes.statusCode ?? 101} ${stripCrlf(upRes.statusMessage ?? "Switching Protocols")}`,
    ];
    for (const [k, v] of Object.entries(upRes.headers)) {
      if (Array.isArray(v)) {
        for (const item of v) lines.push(`${stripCrlf(k)}: ${stripCrlf(item)}`);
      } else if (v !== undefined) {
        lines.push(`${stripCrlf(k)}: ${stripCrlf(String(v))}`);
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
    // Upstream answered with a normal response instead of upgrading. Forward and
    // close. Strip CR/LF from upstream-controlled values (L-7, response-split).
    const lines = [`HTTP/1.1 ${upRes.statusCode ?? 502} ${stripCrlf(upRes.statusMessage ?? "Bad Gateway")}`];
    for (const [k, v] of Object.entries(upRes.headers)) {
      if (Array.isArray(v)) {
        for (const item of v) lines.push(`${stripCrlf(k)}: ${stripCrlf(item)}`);
      } else if (v !== undefined) {
        lines.push(`${stripCrlf(k)}: ${stripCrlf(String(v))}`);
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
 * Inject our preview bridge scripts into the head of every HTML preview
 * response: the navigation reporter, the element picker, and the runtime-error
 * reporter. All are self-contained IIFEs guarded by an install flag (idempotent
 * if injected twice) and only ever postMessage OUTWARD to window.parent —
 * cross-origin safe; we never read parent or iframe state.
 *
 * Exported for unit testing — the injected payload is stringified JS that the
 * compiler can't validate, so a test parses it to catch escape/quote breakage.
 */
export function injectPreviewScripts(
  html: string,
  serverId: string,
  // The path the document is actually served under, so the api-rewrite shim
  // prefixes the app's root-relative requests correctly. Owner: /preview/<id>;
  // share: /preview/share/<token>. Defaults from serverId for unit tests.
  basePrefix: string = `/preview/${serverId}`,
): string {
  const script =
    apiRewriteScript(basePrefix) +
    navReporterScript(serverId) +
    elementPickerScript(serverId) +
    errorReporterScript(serverId);
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

/**
 * Make plain root-relative requests from the preview app route correctly WITHOUT
 * the app needing to know it's behind the `/preview/<id>/` proxy. The orchestrator
 * reserves `/api/*` for its own API (shouldProxy excludes it), so a bare
 * `fetch("/api/...")` from the iframe would hit the orchestrator and be rejected
 * "origin not allowed" — which is why apps used to hand-roll a brittle
 * window.location prefix hack. Instead we transparently prefix the app's own
 * root-relative fetch/XHR calls with the preview base here. The app writes plain
 * `/api/*` (correct after a real deploy, where this shim isn't injected and the
 * path is same-origin), and it just works in the preview too. Idempotent IIFE,
 * runs before app code (injected at <head> start). Leaves absolute, protocol-
 * relative, relative, and already-prefixed URLs untouched.
 *
 * SECURITY: basePrefix is embedded via JSON.stringify with `<` further escaped to
 * \\u003c, so it can never break out of the <script> or the JS string even if it
 * contained `</script>` or a quote — the only safe form; never build it from raw,
 * unescaped input. (It's derived from the serverId / share token, both constrained
 * capability strings.) LIMITATION: covers string fetches, Request(string-url), and
 * XHR.open(string). `fetch(new URL(...))` (already absolute) and streamed/duplex
 * Request bodies are left as-is; the system prompt steers apps to plain relative
 * `/api/*`, which this handles.
 */
function apiRewriteScript(basePrefix: string): string {
  return `<script>(function(){
  if (window.__uniqusApiRewriteInstalled) return;
  window.__uniqusApiRewriteInstalled = true;
  var base = ${JSON.stringify(basePrefix).replace(/</g, "\\u003c")};
  function rw(u) {
    if (typeof u !== "string" || u.length === 0) return u;
    if (u.charCodeAt(0) !== 47) return u;               // not root-relative ("/")
    if (u.charCodeAt(1) === 47) return u;               // protocol-relative "//"
    if (u === base || u.indexOf(base + "/") === 0) return u; // already prefixed
    if (u.indexOf("/preview/") === 0) return u;         // any preview path (keep soft-nav/Referer chains)
    return base + u;
  }
  var of = window.fetch;
  if (typeof of === "function") {
    window.fetch = function(input, init) {
      try {
        if (typeof input === "string") input = rw(input);
        else if (input && typeof input.url === "string") {
          var nu = rw(input.url);
          if (nu !== input.url) input = new Request(nu, input);
        }
      } catch (e) {}
      return of.call(this, input, init);
    };
  }
  var XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype && typeof XHR.prototype.open === "function") {
    var oo = XHR.prototype.open;
    XHR.prototype.open = function() {
      var args = Array.prototype.slice.call(arguments);
      try { if (typeof args[1] === "string") args[1] = rw(args[1]); } catch (e) {}
      return oo.apply(this, args);
    };
  }
})();</script>`;
}

/**
 * Wraps history.pushState/replaceState and listens for popstate, then posts the
 * current path to window.parent. The workspace's PreviewPanel listens for
 * `uniqus:preview-nav` messages and updates the URL bar.
 */
function navReporterScript(serverId: string): string {
  return `<script>(function(){
  if (window.__uniqusNavReporterInstalled) return;
  window.__uniqusNavReporterInstalled = true;
  var serverId = ${JSON.stringify(serverId)};
  // Report the path RELATIVE to the proxy base. The proxied app is served under
  // /preview/<serverId>/ (or /preview/share/<token>/ for a share recipient), so
  // location.pathname carries that prefix — reporting it verbatim made the
  // parent double it (baseUrl + "/preview/<id>/foo" => .../preview/<id>/preview/
  // <id>/foo), which is exactly what "open in new tab" opened. Strip the prefix
  // here so the parent can append the app path cleanly.
  function appPath() {
    var p = location.pathname || "/";
    p = p.replace(/^\\/preview\\/share\\/[^/]+/, "").replace(/^\\/preview\\/[^/]+/, "");
    if (p === "" || p.charAt(0) !== "/") p = "/" + p;
    return p + location.search + location.hash;
  }
  function post() {
    try {
      window.parent.postMessage({
        type: "uniqus:preview-nav",
        server_id: serverId,
        path: appPath(),
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
}

/**
 * Element picker. When the parent turns pick-mode ON (by posting a
 * `uniqus:pick-mode` message into the iframe), it highlights whatever element
 * the cursor is over and, on the next click, posts the element descriptor to
 * the parent as
 *   { type:"uniqus:element", server_id, selector, tag, classes, id, rect, text }
 * then turns itself off. The shared contract is that outbound message shape; the
 * inbound control message is accepted liberally (any of a few `uniqus:` toggle
 * names) so it interoperates regardless of which name the host UI sends.
 *
 * While picking it swallows mousedown/up/click in the capture phase so the
 * preview app's own handlers don't fire on the selection click, and Escape
 * cancels. All listeners are passive observers of the page — no DOM mutation
 * beyond a single fixed-position highlight overlay (pointer-events:none).
 */
function elementPickerScript(serverId: string): string {
  return `<script>(function(){
  if (window.__uniqusElementPickerInstalled) return;
  window.__uniqusElementPickerInstalled = true;
  var serverId = ${JSON.stringify(serverId)};
  var active = false, hovered = null, box = null, label = null;

  function ensureOverlay() {
    if (box) return;
    box = document.createElement("div");
    box.setAttribute("data-uniqus-picker", "1");
    var s = box.style;
    s.position = "fixed"; s.zIndex = "2147483646"; s.pointerEvents = "none";
    s.border = "2px solid #d4439a"; s.background = "rgba(212,67,154,0.12)";
    s.borderRadius = "2px"; s.boxSizing = "border-box"; s.display = "none";
    s.transition = "left 40ms ease-out, top 40ms ease-out, width 40ms ease-out, height 40ms ease-out";
    label = document.createElement("div");
    label.setAttribute("data-uniqus-picker", "1");
    var ls = label.style;
    ls.position = "fixed"; ls.zIndex = "2147483647"; ls.pointerEvents = "none";
    ls.background = "#d4439a"; ls.color = "#fff"; ls.display = "none";
    ls.font = "11px/1.4 ui-monospace,Menlo,Consolas,monospace";
    ls.padding = "2px 6px"; ls.borderRadius = "3px"; ls.whiteSpace = "nowrap";
    ls.maxWidth = "90vw"; ls.overflow = "hidden"; ls.textOverflow = "ellipsis";
    var root = document.body || document.documentElement;
    root.appendChild(box); root.appendChild(label);
  }
  function removeOverlay() {
    if (box && box.parentNode) box.parentNode.removeChild(box);
    if (label && label.parentNode) label.parentNode.removeChild(label);
    box = null; label = null;
  }
  function esc(v) {
    if (window.CSS && CSS.escape) return CSS.escape(v);
    return String(v).replace(/[^a-zA-Z0-9_-]/g, function(c){ return "\\\\" + c; });
  }
  function stableClass(c) {
    if (!c || c.length > 30) return false;
    if (/^(css|sc|jsx|emotion|chakra)-/i.test(c)) return false; // styled/emotion/css-modules
    if (/[0-9a-f]{6,}/i.test(c) && /[0-9]/.test(c)) return false; // hashy
    return true;
  }
  function firstStableClass(el) {
    var list = el.classList ? Array.prototype.slice.call(el.classList) : [];
    for (var i = 0; i < list.length; i++) if (stableClass(list[i])) return list[i];
    return null;
  }
  function nthOfType(el) {
    var p = el.parentNode; if (!p) return 0;
    var same = [], kids = p.children, i;
    for (i = 0; i < kids.length; i++) if (kids[i].tagName === el.tagName) same.push(kids[i]);
    if (same.length < 2) return 0;
    return same.indexOf(el) + 1;
  }
  function selectorFor(el) {
    if (!el || el.nodeType !== 1) return "";
    if (el.id && /^[A-Za-z][\\w-]*$/.test(el.id)) return "#" + esc(el.id);
    var parts = [], node = el, guard = 0;
    while (node && node.nodeType === 1 && node !== document.documentElement && guard < 8) {
      guard++;
      if (node.id && /^[A-Za-z][\\w-]*$/.test(node.id)) { parts.unshift("#" + esc(node.id)); break; }
      var seg = node.tagName.toLowerCase();
      var c = firstStableClass(node);
      if (c) seg += "." + esc(c);
      var n = nthOfType(node);
      if (n) seg += ":nth-of-type(" + n + ")";
      parts.unshift(seg);
      node = node.parentNode;
    }
    return parts.join(" > ");
  }
  // P4.1: harvest the computed styles the inspector reads out. Only the subset
  // the panel shows (spacing / typography / color / radius / layout) so the
  // message stays small; each value capped to avoid enormous shadow stacks.
  function computedStylesOf(el) {
    try {
      var cs = window.getComputedStyle(el);
      var keys = [
        "color", "background-color", "font-family", "font-size", "font-weight",
        "line-height", "letter-spacing", "text-align", "text-transform",
        "padding", "margin", "border-radius", "border", "box-shadow",
        "display", "position", "width", "height", "opacity", "gap", "z-index"
      ];
      var out = {};
      for (var i = 0; i < keys.length; i++) {
        var v = cs.getPropertyValue(keys[i]);
        if (v) out[keys[i]] = String(v).slice(0, 200);
      }
      return out;
    } catch (e) { return {}; }
  }
  function describe(el) {
    var r = el.getBoundingClientRect();
    var classes = el.classList ? Array.prototype.slice.call(el.classList) : [];
    var text = (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim();
    if (text.length > 300) text = text.slice(0, 300);
    return {
      type: "uniqus:element", server_id: serverId,
      selector: selectorFor(el), tag: el.tagName.toLowerCase(),
      id: el.id || null, classes: classes,
      rect: { x: Math.round(r.left), y: Math.round(r.top),
        width: Math.round(r.width), height: Math.round(r.height),
        top: Math.round(r.top), right: Math.round(r.right),
        bottom: Math.round(r.bottom), left: Math.round(r.left) },
      text: text,
      computed_styles: computedStylesOf(el)
    };
  }
  function paint(el) {
    if (!el || el.nodeType !== 1) return;
    ensureOverlay();
    var r = el.getBoundingClientRect(), bs = box.style;
    bs.display = "block"; bs.left = r.left + "px"; bs.top = r.top + "px";
    bs.width = r.width + "px"; bs.height = r.height + "px";
    var cls = el.classList && el.classList.length
      ? "." + Array.prototype.slice.call(el.classList).slice(0, 2).join(".") : "";
    label.textContent = el.tagName.toLowerCase() + cls;
    label.style.display = "block";
    var ly = r.top - 22; if (ly < 2) ly = r.top + 2;
    label.style.left = Math.max(2, r.left) + "px"; label.style.top = ly + "px";
  }
  function onMove(e) {
    if (!active) return;
    var el = e.target;
    if (!el || el === box || el === label) return;
    hovered = el; paint(el);
  }
  function onClick(e) {
    if (!active) return;
    e.preventDefault(); e.stopPropagation();
    var el = e.target || hovered;
    if (el && el !== box && el !== label) {
      try { window.parent.postMessage(describe(el), "*"); } catch (err) {}
    }
    setActive(false);
  }
  function swallow(e) { if (active) { e.preventDefault(); e.stopPropagation(); } }
  function onKey(e) {
    if (active && (e.key === "Escape" || e.keyCode === 27)) {
      setActive(false);
      try { window.parent.postMessage({ type: "uniqus:pick-cancel", server_id: serverId }, "*"); } catch (err) {}
    }
  }
  function setActive(on) {
    on = !!on;
    if (on === active) return;
    active = on;
    if (on) { ensureOverlay(); document.documentElement.style.cursor = "crosshair"; }
    else { removeOverlay(); hovered = null; document.documentElement.style.cursor = ""; }
    try { window.parent.postMessage({ type: "uniqus:pick-state", server_id: serverId, active: active }, "*"); } catch (err) {}
  }
  window.addEventListener("message", function(e) {
    var d = e.data;
    if (!d || typeof d !== "object") return;
    var t = d.type;
    if (t === "uniqus:pick-mode" || t === "uniqus:select-mode" || t === "uniqus:picker") {
      var want = (d.enabled != null ? d.enabled : (d.active != null ? d.active : d.value));
      setActive(!!want);
    } else if (t === "uniqus:pick-start") { setActive(true); }
    else if (t === "uniqus:pick-stop") { setActive(false); }
  });
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("mousedown", swallow, true);
  document.addEventListener("mouseup", swallow, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("scroll", function(){ if (active && hovered) paint(hovered); }, true);
})();</script>`;
}

/**
 * Runtime-error reporter. Hooks window.onerror, unhandledrejection, and
 * console.error inside the preview app and posts each one to window.parent as
 *   { type:"uniqus:runtime-error", server_id, kind, message, stack, source, line, col, path }
 * so the workspace can surface errors the agent otherwise can NEVER see (they
 * happen in the user's browser, not the dev-server logs). Capped per page load
 * so a render loop that logs on every frame can't flood postMessage; wraps
 * console.error transparently (always calls through to the original) and guards
 * every hook in try/catch so a reporter bug can't break the previewed app.
 */
function errorReporterScript(serverId: string): string {
  return `<script>(function(){
  if (window.__uniqusErrorReporterInstalled) return;
  window.__uniqusErrorReporterInstalled = true;
  var serverId = ${JSON.stringify(serverId)};
  // Separate budgets so a chatty console.* logger (React dev warnings, a render
  // loop) can't starve out genuine uncaught errors / rejections, which are the
  // ones worth surfacing. console.* gets a smaller, independent cap.
  var MAX = 100, MAX_CONSOLE = 30, sent = 0, sentConsole = 0;
  function clip(s, n) { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n) : s; }
  function post(kind, message, stack, source, line, col) {
    if (kind === "console") { if (sentConsole >= MAX_CONSOLE) return; sentConsole++; }
    else { if (sent >= MAX) return; sent++; }
    try {
      window.parent.postMessage({
        type: "uniqus:runtime-error",
        server_id: serverId,
        kind: kind,
        message: clip(message, 1000),
        stack: clip(stack, 4000),
        source: clip(source, 300),
        line: (typeof line === "number" ? line : null),
        col: (typeof col === "number" ? col : null),
        path: location.pathname + location.search
      }, "*");
    } catch (e) {}
  }
  function fromError(err) {
    if (err && typeof err === "object") return { message: err.message || String(err), stack: err.stack || "" };
    return { message: String(err), stack: "" };
  }
  window.addEventListener("error", function(e) {
    try {
      if (e && e.message) {
        var st = e.error && e.error.stack ? e.error.stack : "";
        post("error", e.message, st, e.filename || "", e.lineno, e.colno);
      } else if (e && e.target && (e.target.src || e.target.href)) {
        var url = e.target.src || e.target.href;
        post("resource", "Failed to load resource: " + url, "", url, null, null);
      }
    } catch (err) {}
  }, true);
  window.addEventListener("unhandledrejection", function(e) {
    try { var info = fromError(e && e.reason); post("unhandledrejection", info.message, info.stack, "", null, null); }
    catch (err) {}
  });
  try {
    var origErr = console.error;
    if (typeof origErr === "function") {
      console.error = function() {
        try {
          var parts = [];
          for (var i = 0; i < arguments.length; i++) {
            var a = arguments[i];
            if (a && a.stack && a.message) parts.push(a.message);
            else if (a && typeof a === "object") { try { parts.push(JSON.stringify(a)); } catch (e2) { parts.push(String(a)); } }
            else parts.push(String(a));
          }
          var first = arguments[0];
          var st = (first && first.stack) ? first.stack : "";
          post("console", parts.join(" "), st, "", null, null);
        } catch (err) {}
        return origErr.apply(console, arguments);
      };
    }
  } catch (err) {}
})();</script>`;
}

/** Drop CR/LF/NUL so an upstream header value can't split the hand-built handshake (L-7). */
function stripCrlf(s: string): string {
  return String(s).replace(/[\r\n\0]/g, "");
}

/** Escape text interpolated into the preview error HTML (L-6, latent XSS sink). */
function escapeHtml(s: string): string {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

/**
 * Auto-retrying "warming up" page served while a freshly-started dev server is
 * still binding/compiling (see PREVIEW_WARMUP_BUDGET_MS). It reloads itself to
 * `reloadUrl` (which carries the warmup start time) every ~2s; the moment the
 * server answers, the reload gets the real app instead of this page. After the
 * budget elapses it stops and offers a manual retry. Self-contained — no injected
 * bridge scripts (this isn't the app's HTML). `reloadUrl`/`startMs` are
 * server-controlled (a path + a number), but reloadUrl is still JSON-stringified
 * with `<` escaped so it can never break out of the script string.
 */
export function previewWarmingPage(reloadUrl: string, startMs: number): string {
  const safeUrl = JSON.stringify(reloadUrl).replace(/</g, "\\u003c");
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Starting preview…</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,"Segoe UI",Roboto,sans-serif;background:#0e0e14;color:#e4e2dc;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
.card{text-align:center;max-width:360px}
.spin{width:36px;height:36px;margin:0 auto 18px;border:3px solid #2a2a36;border-top-color:#a78bfa;border-radius:50%;animation:s .8s linear infinite}
@keyframes s{to{transform:rotate(360deg)}}
h1{font-size:16px;margin-bottom:8px;color:#e4e2dc}
p{font-size:13px;color:#9ca3af;line-height:1.6}
.track{height:4px;background:#1a1a24;border-radius:2px;margin-top:18px;overflow:hidden}
.bar{height:100%;width:0;background:#a78bfa;transition:width .5s linear}
#giveup{display:none}
button{margin-top:14px;background:#a78bfa;color:#0e0e14;border:0;border-radius:6px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer}
</style></head><body>
<div class="card">
<div id="spin" class="spin"></div>
<h1>Starting your app…</h1>
<p id="msg">The first load compiles your project. This can take a few moments on a cold start.</p>
<div class="track" id="track"><div id="bar" class="bar"></div></div>
<div id="giveup">
<p style="margin-top:14px">The dev server isn't responding yet — it may still be installing or it crashed on startup.</p>
<button id="retry">Try again</button>
</div>
</div>
<script>(function(){
  var url=${safeUrl}, start=${startMs}, BUDGET=${PREVIEW_WARMUP_BUDGET_MS};
  var elapsed=Date.now()-start;
  var bar=document.getElementById('bar');
  if(elapsed>=0 && elapsed<BUDGET){
    if(bar) bar.style.width=Math.min(98,(elapsed/BUDGET)*100)+'%';
    setTimeout(function(){ location.replace(url); }, 2000);
  } else {
    document.getElementById('spin').style.display='none';
    document.getElementById('msg').style.display='none';
    document.getElementById('track').style.display='none';
    document.getElementById('giveup').style.display='block';
  }
  var b=document.getElementById('retry');
  if(b) b.onclick=function(){ location.replace(url.replace(/__uniqus_warm=\\d+/, '__uniqus_warm='+Date.now())); };
})();</script>
</body></html>`;
}

/**
 * Styled HTML error page for preview iframe failures. Shows a friendly
 * message instead of a blank page or raw error text.
 */
export function previewErrorPage(status: number, title: string, detail: string): string {
  const safeTitle = escapeHtml(title);
  const safeDetail = escapeHtml(detail);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,"Segoe UI",Roboto,sans-serif;background:#0e0e14;color:#e4e2dc;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
.card{text-align:center;max-width:420px}
.code{font-size:64px;font-weight:700;color:#a78bfa;opacity:0.3;line-height:1}
h1{font-size:18px;margin:12px 0 8px;color:#e4e2dc}
p{font-size:13px;color:#9ca3af;line-height:1.6;margin-bottom:16px}
a{color:#a78bfa;text-decoration:none;font-size:13px}
a:hover{text-decoration:underline}
.detail{background:#16161e;border:1px solid #2a2a36;border-radius:6px;padding:10px 14px;font-family:monospace;font-size:11px;color:#9ca3af;margin-bottom:16px;text-align:left;word-break:break-all;max-height:120px;overflow:auto}
</style></head><body>
<div class="card">
<div class="code">${status}</div>
<h1>${safeTitle}</h1>
<p>${safeDetail}</p>
<a href="/">← Back to dashboard</a>
</div></body></html>`;
}
