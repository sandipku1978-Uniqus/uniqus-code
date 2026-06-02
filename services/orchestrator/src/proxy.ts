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
  // Max-Age is deliberately short (1h): the serverId is an unguessable 128-bit
  // capability (M-6) and a stale/injected cookie pins the victim's bare-path
  // preview to that server for its whole lifetime, so don't let it outlive an
  // ephemeral dev server by a day (M-7).
  return `${PREVIEW_COOKIE}=${encodeURIComponent(serverId)}; Path=/; Max-Age=3600; SameSite=None; Secure; HttpOnly`;
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
        const injected = injectPreviewScripts(original, target.serverId);
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

  upstream.on("error", (err) => {
    if (!res.headersSent) {
      const html = previewErrorPage(502, "Oh no! The server seems to be down", `Could not connect to the dev server: ${err.message}. It may have crashed or timed out. Ask the Uniqus agent to check the server logs and restart.`);
      res.writeHead(502, { "Content-Type": "text/html" });
      res.end(html);
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
 * response: the navigation reporter and the element picker. Both are
 * self-contained IIFEs guarded by an install flag (idempotent if injected
 * twice) and only ever postMessage OUTWARD to window.parent — cross-origin
 * safe; we never read parent or iframe state.
 *
 * Exported for unit testing — the injected payload is stringified JS that the
 * compiler can't validate, so a test parses it to catch escape/quote breakage.
 */
export function injectPreviewScripts(html: string, serverId: string): string {
  const script = navReporterScript(serverId) + elementPickerScript(serverId);
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
 * Wraps history.pushState/replaceState and listens for popstate, then posts the
 * current path to window.parent. The workspace's PreviewPanel listens for
 * `uniqus:preview-nav` messages and updates the URL bar.
 */
function navReporterScript(serverId: string): string {
  return `<script>(function(){
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
      text: text
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
