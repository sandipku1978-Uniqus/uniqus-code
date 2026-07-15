import { lookup } from "node:dns/promises";
import type { LookupAddress, LookupOptions } from "node:dns";
import net, { type LookupFunction } from "node:net";
import {
  Agent,
  fetch as pinnedFetch,
  type RequestInit as UndiciRequestInit,
  type Response as UndiciResponse,
} from "undici";

/**
 * SSRF guard shared by the outbound connectors (http/postgres) and the
 * host-side git clone. The orchestrator sits on the Firecracker fleet bridge
 * and next to cloud metadata + its own loopback services, so an agent that can
 * drive an arbitrary outbound request (directly, or via indirect prompt
 * injection) could otherwise reach `169.254.169.254`, `127.0.0.1:<port>`, or a
 * peer VM's `172.16.x.y:51000` (Security C-2 / M-3 / M-5).
 *
 * The defense is: resolve the hostname, and reject if ANY resolved address is
 * private / loopback / link-local / CGNAT / multicast / the fleet bridge.
 * `safeFetch` additionally re-validates every redirect hop and strips
 * credential headers on a cross-origin redirect so a 30x can't bounce a request
 * (or an attached secret — H-2) onto an internal target.
 *
 * DNS rebinding (TOCTOU): a determined attacker controlling DNS could otherwise
 * rebind a hostname between our pre-flight resolution and the kernel's connect().
 * `safeFetch` closes that window with `pinningAgent` (P0.4): an undici dispatcher
 * whose `connect.lookup` re-resolves, re-validates EVERY address, and hands the
 * socket the exact validated IP — so the address we vetted is the address the
 * kernel dials, with no second uncontrolled lookup in between.
 */

/**
 * Expand any valid IPv6 literal to its 16 raw bytes (handles `::` compression
 * and a trailing embedded-IPv4 group like `::ffff:127.0.0.1`). Returns null if
 * the string isn't a parseable IPv6 address. Reasoning over bytes — rather than
 * textual prefixes — is what makes the block list immune to alternate spellings
 * (e.g. the hex-compressed `::ffff:7f00:1` form Node's URL parser produces for
 * `::ffff:127.0.0.1`, which the old dotted-decimal regex missed entirely).
 */
function ipv6ToBytes(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf("%"); // strip any scope/zone id
  if (zone !== -1) s = s.slice(0, zone);
  // Fold a trailing dotted-decimal IPv4 group into two hextets.
  const v4 = s.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4) {
    const o = v4[1].split(".").map(Number);
    if (o.some((n) => n > 255)) return null;
    s = s.slice(0, s.length - v4[1].length) + `${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : null;
  let groups: string[];
  if (tail === null) {
    groups = head;
  } else {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    groups = [...head, ...Array<string>(fill).fill("0"), ...tail];
  }
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const n = parseInt(g, 16);
    bytes.push((n >> 8) & 0xff, n & 0xff);
  }
  return bytes;
}

/** True for any IPv6 address an outbound request must never reach. */
function isBlockedIpv6(ip: string): boolean {
  const b = ipv6ToBytes(ip);
  if (!b) return true; // unparseable despite net.isIPv6 — deny by default
  // ::/96 (unspecified, loopback, IPv4-compatible). Block :: and ::1 outright;
  // recurse on the embedded v4 for the deprecated ::x.x.x.x compat form.
  if (b.slice(0, 12).every((x) => x === 0)) {
    if (b[12] === 0 && b[13] === 0 && b[14] === 0 && (b[15] === 0 || b[15] === 1)) return true;
    return isBlockedIp(`${b[12]}.${b[13]}.${b[14]}.${b[15]}`);
  }
  // ::ffff:0:0/96 IPv4-mapped — the exact form that defeated the old guard.
  if (b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff) {
    return isBlockedIp(`${b[12]}.${b[13]}.${b[14]}.${b[15]}`);
  }
  // 64:ff9b::/96 well-known NAT64 — judge by the embedded v4.
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.slice(4, 12).every((x) => x === 0)) {
    return isBlockedIp(`${b[12]}.${b[13]}.${b[14]}.${b[15]}`);
  }
  // 2002::/16 6to4 — embedded v4 sits in bytes 2..5.
  if (b[0] === 0x20 && b[1] === 0x02) {
    return isBlockedIp(`${b[2]}.${b[3]}.${b[4]}.${b[5]}`);
  }
  if ((b[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique-local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0) return true; // fec0::/10 site-local (deprecated)
  if (b[0] === 0xff) return true; // ff00::/8 multicast
  return false;
}

/** True for any address an outbound request must never reach. */
export function isBlockedIp(ip: string): boolean {
  if (net.isIPv6(ip)) return isBlockedIpv6(ip);
  if (!net.isIPv4(ip)) return true; // unknown form — deny by default
  const [a, b] = ip.split(".").map(Number);
  if (a === 0) return true; // "this" network
  if (a === 10) return true; // 10/8 private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private (incl. fleet bridge 172.16/16)
  if (a === 192 && b === 168) return true; // 192.168/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

export interface ResolvedPublicAddress {
  address: string;
  family: number;
}

/** Resolve once and return only addresses proven publicly routable. */
export async function resolvePublicHost(hostname: string): Promise<ResolvedPublicAddress[]> {
  const host = hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new Error(`blocked address: ${host}`);
    return [{ address: host, family: net.isIP(host) }];
  }
  let results: ResolvedPublicAddress[];
  try {
    results = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error(`could not resolve host: ${host}`);
  }
  if (results.length === 0) throw new Error(`could not resolve host: ${host}`);
  for (const r of results) {
    if (isBlockedIp(r.address)) {
      throw new Error(`host ${host} resolves to a blocked address (${r.address})`);
    }
  }
  return results;
}

/** Throw unless `hostname` (or every IP it resolves to) is publicly routable. */
export async function assertPublicHost(hostname: string): Promise<void> {
  await resolvePublicHost(hostname);
}

/** Parse + validate an outbound URL. Returns the parsed URL on success. */
export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error("invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("url must be http(s)://");
  }
  await assertPublicHost(u.hostname);
  return u;
}

/**
 * Validate a single URL path segment that gets interpolated into a pinned-host
 * API URL (e.g. GitHub owner/repo). Rejects anything outside a safe charset so
 * an agent can't smuggle `/`, `..`, or query/fragment characters to traverse to
 * other endpoints the credential can reach (L-8). Callers should also
 * encodeURIComponent the returned value.
 */
export function validatePathComponent(value: string, label = "path component"): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(`invalid ${label}: must match [A-Za-z0-9._-]+`);
  }
  if (value === "." || value === "..") {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

const CREDENTIAL_HEADERS = ["authorization", "cookie", "proxy-authorization"];

/**
 * P0.4: a Node-style `dns.lookup` that pins outbound connections to a validated
 * IP. undici calls this when establishing a socket; we re-resolve, reject if ANY
 * resolved address is blocked, then hand back a vetted address. Because undici
 * connects to exactly the address we return (no further DNS), a rebind between
 * resolve and connect can't slip a private target past the guard.
 */
type PinningLookupCallback = (
  err: NodeJS.ErrnoException | null,
  address?: string | LookupAddress[],
  family?: number,
) => void;

export function pinningLookup(
  hostname: string,
  options: LookupOptions,
  callback: PinningLookupCallback,
): void {
  resolvePublicHost(hostname)
    .then((addrs) => {
      const wantFamily =
        options.family === "IPv4" ? 4 : options.family === "IPv6" ? 6 : options.family;
      const matches = wantFamily ? addrs.filter((a) => a.family === wantFamily) : addrs;
      if (matches.length === 0) {
        callback(new Error(`host ${hostname} has no address for family ${wantFamily}`));
        return;
      }

      // Node's family auto-selection calls custom lookup functions with
      // `all:true` and requires the dns.lookup(..., { all:true }) array shape.
      // Returning the legacy (address, family) tuple in that case makes Node
      // read an undefined address and every undici request fails before connect.
      if (options.all) {
        callback(null, matches);
        return;
      }

      callback(null, matches[0].address, matches[0].family);
    })
    .catch((err) =>
      callback(err instanceof Error ? err : new Error(`could not resolve host: ${hostname}`)),
    );
}

/** Shared dispatcher that validates + pins the connect-time IP for every request. */
const pinningAgent = new Agent({
  // The cast bridges the callback's optional error-path address to Node's
  // LookupFunction type. Successful calls honor both its single and all-address
  // result shapes.
  connect: { lookup: pinningLookup as unknown as LookupFunction },
});

/**
 * fetch() with SSRF validation on the initial URL and on every redirect hop.
 * Redirects are followed manually (so each Location is re-validated) and any
 * credential header is dropped when a redirect crosses to a different origin —
 * otherwise a 30x to an attacker host would carry a secret-derived header off
 * to it (H-2). The `pinningAgent` dispatcher additionally pins each connect to a
 * freshly-validated IP, closing the DNS-rebind TOCTOU (P0.4).
 */
export async function safeFetch(
  rawUrl: string,
  init: Omit<UndiciRequestInit, "headers"> & { headers?: Record<string, string> } = {},
  maxRedirects = 4,
): Promise<UndiciResponse> {
  let current = await assertPublicUrl(rawUrl);
  let headers: Record<string, string> = { ...(init.headers ?? {}) };
  // Track method + body across hops so we can apply RFC 7231 redirect semantics
  // rather than blindly replaying the original request to every target.
  let method = String(init.method ?? "GET").toUpperCase();
  let body = init.body;
  for (let hop = 0; ; hop++) {
    const res = await pinnedFetch(current.toString(), {
      ...init,
      method,
      body,
      headers,
      redirect: "manual",
      dispatcher: pinningAgent,
    });
    const isRedirect = res.status >= 300 && res.status < 400 && res.headers.has("location");
    // Stop (and hand back the 3xx) when there's nothing to follow OR the budget
    // is spent. maxRedirects:0 therefore means "never follow" — used when a
    // secret is attached so the credential can't be bounced to another host.
    if (!isRedirect || hop >= maxRedirects) return res;
    // We ARE going to follow: drain this hop's body so undici returns the socket
    // to the pool instead of leaking the connection across a redirect chain.
    void res.body?.cancel().catch(() => {});
    const next = new URL(res.headers.get("location") as string, current);
    await assertPublicUrl(next.toString());
    if (next.origin !== current.origin) {
      // Don't carry credentials across origins on a redirect.
      headers = Object.fromEntries(
        Object.entries(headers).filter(([k]) => !CREDENTIAL_HEADERS.includes(k.toLowerCase())),
      );
    }
    // RFC 7231: 301/302/303 turn the follow-up into a bodyless GET; 307/308
    // preserve method + body. Without this a POST body (which may carry a
    // secret) would be replayed verbatim to the redirect target.
    if ((res.status === 301 || res.status === 302 || res.status === 303) && method !== "GET" && method !== "HEAD") {
      method = "GET";
      body = undefined;
      headers = Object.fromEntries(
        Object.entries(headers).filter(([k]) => {
          const lk = k.toLowerCase();
          return lk !== "content-type" && lk !== "content-length";
        }),
      );
    }
    current = next;
  }
}

/** Read a fetch response without allowing a peer to stream unbounded bytes into memory. */
export async function readResponseTextLimited(
  response: Pick<UndiciResponse, "body">,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) return { text: "", truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = maxBytes - total;
      if (remaining > 0) chunks.push(value.subarray(0, remaining));
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("response body exceeded limit").catch(() => {});
        return {
          text: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf-8"),
          truncated: true,
        };
      }
    }
  } finally {
    reader.releaseLock();
  }
  return {
    text: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf-8"),
    truncated: false,
  };
}
