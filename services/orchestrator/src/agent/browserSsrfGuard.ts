import { lookup } from "node:dns/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";
import type { BrowserContext } from "playwright";
import {
  assertPublicHost,
  resolvePublicHost,
  type ResolvedPublicAddress,
} from "../connectors/ssrfGuard.js";

type HostValidator = (hostname: string) => Promise<void>;

export interface PinnedBrowserTarget extends ResolvedPublicAddress {
  port: number;
}

export type BrowserTargetResolver = (
  hostname: string,
  port: number,
) => Promise<PinnedBrowserTarget>;

/** Keep browser traffic on the validated TCP proxy, including loopback URLs. */
export const BROWSER_SSRF_PROXY_LAUNCH_ARGS = [
  "--proxy-bypass-list=<-loopback>",
  "--disable-quic",
  "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
];

/** Validate one concrete browser request, including redirects and subresources. */
export async function assertBrowserRequestAllowed(
  rawUrl: string,
  allowedPrivateOrigin?: string,
  validateHost: HostValidator = assertPublicHost,
): Promise<void> {
  if (/^(?:about:blank|data:|blob:)/i.test(rawUrl)) return;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("browser request URL is invalid");
  }
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
    throw new Error(`browser request protocol '${url.protocol}' is blocked`);
  }
  if (
    allowedPrivateTarget(
      url.hostname,
      parsePort(url.port, defaultPort(url.protocol)),
      allowedPrivateOrigin,
    )
  ) return;
  await validateHost(url.hostname);
}

function stripIpBrackets(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
}

function defaultPort(protocol: string): number {
  return protocol === "https:" || protocol === "wss:" ? 443 : 80;
}

function parsePort(value: string | number, fallback?: number): number {
  const port = typeof value === "number" ? value : Number(value || fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("browser proxy target port is invalid");
  }
  return port;
}

function allowedPrivateTarget(
  hostname: string,
  port: number,
  allowedPrivateOrigin?: string,
): boolean {
  if (!allowedPrivateOrigin) return false;
  const allowed = new URL(allowedPrivateOrigin);
  return (
    stripIpBrackets(allowed.hostname) === stripIpBrackets(hostname) &&
    parsePort(allowed.port, defaultPort(allowed.protocol)) === port
  );
}

/**
 * Resolve a browser target exactly once. Public targets use the shared SSRF
 * classifier; the one trusted preview host:port capability may resolve private.
 * The returned literal IP is what the proxy passes to net/http, so there is no
 * second Chromium/kernel hostname lookup for a rebinding domain to race.
 */
export async function resolveBrowserTarget(
  hostname: string,
  port: number,
  allowedPrivateOrigin?: string,
): Promise<PinnedBrowserTarget> {
  const host = stripIpBrackets(hostname);
  const safePort = parsePort(port);
  let addresses: ResolvedPublicAddress[];
  if (allowedPrivateTarget(host, safePort, allowedPrivateOrigin)) {
    if (net.isIP(host)) {
      addresses = [{ address: host, family: net.isIP(host) }];
    } else {
      addresses = await lookup(host, { all: true, verbatim: true });
      if (addresses.length === 0) throw new Error(`could not resolve host: ${host}`);
    }
  } else {
    addresses = await resolvePublicHost(host);
  }
  return { ...addresses[0], port: safePort };
}

function parseProxyRequestUrl(req: IncomingMessage): URL {
  const raw = req.url ?? "";
  try {
    return new URL(raw);
  } catch {
    const host = req.headers.host;
    if (!host) throw new Error("browser proxy request has no target host");
    return new URL(raw || "/", `http://${host}`);
  }
}

function proxyHeaders(req: IncomingMessage, target: URL): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = { ...req.headers, host: target.host };
  delete headers["proxy-authorization"];
  delete headers["proxy-connection"];
  return headers;
}

function rejectHttp(res: ServerResponse, status = 403): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(status, { "content-type": "text/plain", connection: "close" });
  res.end(status === 403 ? "Blocked by browser SSRF policy" : "Browser proxy upstream failed");
}

function rejectSocket(socket: Duplex, status = 403): void {
  if (socket.destroyed) return;
  const reason = status === 403 ? "Forbidden" : "Bad Gateway";
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
}

function trackSocket<T extends Duplex>(socket: T, sockets: Set<Duplex>): T {
  sockets.add(socket);
  socket.once("close", () => sockets.delete(socket));
  return socket;
}

async function forwardHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  resolver: BrowserTargetResolver,
  sockets: Set<Duplex>,
): Promise<void> {
  const targetUrl = parseProxyRequestUrl(req);
  if (targetUrl.protocol !== "http:") throw new Error("unsupported proxy request protocol");
  const port = parsePort(targetUrl.port, 80);
  const target = await resolver(targetUrl.hostname, port);
  const upstream = http.request({
    host: target.address,
    family: target.family,
    port: target.port,
    method: req.method,
    path: `${targetUrl.pathname}${targetUrl.search}` || "/",
    headers: proxyHeaders(req, targetUrl),
  });
  upstream.on("socket", (socket) => trackSocket(socket, sockets));
  upstream.on("response", (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.statusMessage, upstreamRes.headers);
    upstreamRes.pipe(res);
  });
  upstream.on("error", () => rejectHttp(res, 502));
  req.on("aborted", () => upstream.destroy());
  req.pipe(upstream);
}

function authorityTarget(authority: string): { hostname: string; port: number } {
  const parsed = new URL(`http://${authority}`);
  if (!parsed.port) throw new Error("CONNECT target must include a port");
  return { hostname: parsed.hostname, port: parsePort(parsed.port) };
}

async function forwardConnect(
  req: IncomingMessage,
  client: Duplex,
  head: Buffer,
  resolver: BrowserTargetResolver,
  sockets: Set<Duplex>,
): Promise<void> {
  const { hostname, port } = authorityTarget(req.url ?? "");
  const target = await resolver(hostname, port);
  const upstream = trackSocket(
    net.connect({ host: target.address, family: target.family, port: target.port }),
    sockets,
  );
  upstream.once("connect", () => {
    if (client.destroyed) {
      upstream.destroy();
      return;
    }
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length > 0) upstream.write(head);
    client.pipe(upstream);
    upstream.pipe(client);
  });
  upstream.once("error", () => rejectSocket(client, 502));
  client.once("error", () => upstream.destroy());
}

function serializedUpgradeRequest(req: IncomingMessage, target: URL): string {
  const headers = proxyHeaders(req, target);
  const lines = Object.entries(headers).flatMap(([name, value]) => {
    if (value === undefined) return [];
    return (Array.isArray(value) ? value : [value]).map((item) => `${name}: ${item}`);
  });
  const requestPath = `${target.pathname}${target.search}` || "/";
  return `${req.method ?? "GET"} ${requestPath} HTTP/${req.httpVersion}\r\n${lines.join("\r\n")}\r\n\r\n`;
}

async function forwardUpgrade(
  req: IncomingMessage,
  client: Duplex,
  head: Buffer,
  resolver: BrowserTargetResolver,
  sockets: Set<Duplex>,
): Promise<void> {
  const targetUrl = parseProxyRequestUrl(req);
  if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "ws:") {
    throw new Error("unsupported websocket proxy protocol");
  }
  const port = parsePort(targetUrl.port, 80);
  const target = await resolver(targetUrl.hostname, port);
  const upstream = trackSocket(
    net.connect({ host: target.address, family: target.family, port: target.port }),
    sockets,
  );
  upstream.once("connect", () => {
    if (client.destroyed) {
      upstream.destroy();
      return;
    }
    upstream.write(serializedUpgradeRequest(req, targetUrl));
    if (head.length > 0) upstream.write(head);
    client.pipe(upstream);
    upstream.pipe(client);
  });
  upstream.once("error", () => rejectSocket(client, 502));
  client.once("error", () => upstream.destroy());
}

export interface BrowserSsrfProxy {
  url: string;
  close(): Promise<void>;
}

/**
 * Local forward proxy used as Chromium's sole network egress. HTTP requests,
 * HTTPS CONNECT tunnels, and WebSocket upgrades all dial the literal address
 * returned by the validated resolver, closing the DNS-rebinding TOCTOU left by
 * route.continue().
 */
export async function startBrowserSsrfProxy(
  allowedPrivateOrigin?: string,
  resolveTarget?: BrowserTargetResolver,
): Promise<BrowserSsrfProxy> {
  const sockets = new Set<Duplex>();
  const resolver = resolveTarget ?? ((hostname, port) =>
    resolveBrowserTarget(hostname, port, allowedPrivateOrigin));
  const server = http.createServer((req, res) => {
    void forwardHttpRequest(req, res, resolver, sockets).catch(() => rejectHttp(res));
  });
  server.on("connection", (socket) => {
    trackSocket(socket, sockets);
  });
  server.on("connect", (req, client, head) => {
    void forwardConnect(req, client, head, resolver, sockets).catch(() => rejectSocket(client));
  });
  server.on("upgrade", (req, client, head) => {
    void forwardUpgrade(req, client, head, resolver, sockets).catch(() => rejectSocket(client));
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("browser SSRF proxy failed to bind a TCP port");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      if (!server.listening) return;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * Defense in depth: validate every URL at Playwright's request boundary too.
 * The actual connection is pinned by startBrowserSsrfProxy; this route check
 * provides early aborts and covers redirects/subresources before proxying.
 */
export async function installBrowserSsrfGuard(
  context: BrowserContext,
  allowedPrivateOrigin?: string,
): Promise<void> {
  await context.route("**/*", async (route) => {
    try {
      await assertBrowserRequestAllowed(route.request().url(), allowedPrivateOrigin);
      await route.continue();
    } catch {
      await route.abort("blockedbyclient");
    }
  });
}
