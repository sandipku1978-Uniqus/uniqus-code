/**
 * Figma OAuth integration + design-context extraction.
 *
 * Mirrors github.ts: client id/secret, the state cookie, token storage and the
 * REST calls all live here. The web app only sends the browser to
 * `/api/figma/start` and reads `/api/figma/status`. Used to read a Figma file's
 * published color + text styles and infer a design system from them.
 *
 * Setup (free): register an app at https://www.figma.com/developers/apps,
 * set the redirect URL to `<PUBLIC_BASE_URL>/api/figma/callback`, and set
 * FIGMA_CLIENT_ID / FIGMA_CLIENT_SECRET on the orchestrator.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { sealData, unsealData } from "iron-session";
import {
  getFigmaLink,
  getFigmaTokens,
  setFigmaToken,
  updateFigmaTokens,
  clearFigmaToken,
  type UserRecord,
} from "./db/users.js";

const STATE_COOKIE = "gate15_figma_state";
const STATE_TTL_SECONDS = 600;
// Read-only granular scopes (Figma deprecated the broad `files:read` in 2025):
//   file_content:read    → GET /v1/files/:key/nodes (node contents)
//   library_content:read → GET /v1/files/:key/styles (published styles)
//   current_user:read    → GET /v1/me (handle for the "Connected as" label)
// These must match the scopes selected on the registered Figma app.
const SCOPE = "file_content:read library_content:read current_user:read";
const refreshInFlight = new Map<string, Promise<string>>();

interface StatePayload {
  state: string;
  userId: string;
  returnTo: string;
}

function getOauthConfig(): { clientId: string; clientSecret: string; callback: string } {
  const clientId = process.env.FIGMA_CLIENT_ID;
  const clientSecret = process.env.FIGMA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "FIGMA_CLIENT_ID and FIGMA_CLIENT_SECRET must be set to enable Figma OAuth. " +
        "Register a free app at https://www.figma.com/developers/apps.",
    );
  }
  const base = (
    process.env.PUBLIC_BASE_URL ??
    "http://localhost:8787"
  ).replace(/\/$/, "");
  return { clientId, clientSecret, callback: `${base}/api/figma/callback` };
}

function getCookiePassword(): string {
  const pw = process.env.WORKOS_COOKIE_PASSWORD;
  if (!pw || pw.length < 32) {
    throw new Error("WORKOS_COOKIE_PASSWORD must be at least 32 characters");
  }
  return pw;
}

function isHttps(req: IncomingMessage): boolean {
  if (req.headers["x-forwarded-proto"] === "https") return true;
  const host = req.headers.host ?? "";
  return !host.startsWith("localhost") && !host.startsWith("127.0.0.1");
}

function setStateCookie(res: ServerResponse, value: string, secure: boolean): void {
  const parts = [`${STATE_COOKIE}=${value}`, "Path=/", "HttpOnly", `Max-Age=${STATE_TTL_SECONDS}`, "SameSite=Lax"];
  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearStateCookie(res: ServerResponse, secure: boolean): void {
  const parts = [`${STATE_COOKIE}=`, "Path=/", "HttpOnly", "Max-Age=0", "SameSite=Lax"];
  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function readStateCookie(req: IncomingMessage): string | undefined {
  const raw = req.headers.cookie;
  if (typeof raw !== "string") return undefined;
  for (const piece of raw.split(/;\s*/)) {
    const eq = piece.indexOf("=");
    if (eq < 0) continue;
    if (piece.slice(0, eq) === STATE_COOKIE) return piece.slice(eq + 1);
  }
  return undefined;
}

function sanitizeReturnTo(raw: string | null, allowed: ReadonlySet<string>): string {
  if (!raw) return [...allowed][0] ?? "/";
  try {
    const url = new URL(raw);
    const origin = `${url.protocol}//${url.host}`;
    if (allowed.has(origin)) return url.toString();
  } catch {
    /* not a URL — reject */
  }
  return [...allowed][0] ?? "/";
}

export async function handleStart(
  req: IncomingMessage,
  res: ServerResponse,
  user: UserRecord,
  allowedOrigins: ReadonlySet<string>,
): Promise<void> {
  const { clientId, callback } = getOauthConfig();
  const reqUrl = new URL(req.url ?? "/", "http://_local");
  const returnTo = sanitizeReturnTo(reqUrl.searchParams.get("return"), allowedOrigins);

  const state = randomBytes(16).toString("hex");
  const sealed = await sealData({ state, userId: user.id, returnTo } satisfies StatePayload, {
    password: getCookiePassword(),
    ttl: STATE_TTL_SECONDS,
  });
  setStateCookie(res, sealed, isHttps(req));

  const authUrl = new URL("https://www.figma.com/oauth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", callback);
  authUrl.searchParams.set("scope", SCOPE);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("response_type", "code");

  res.writeHead(302, { Location: authUrl.toString() });
  res.end();
}

export async function handleCallback(
  req: IncomingMessage,
  res: ServerResponse,
  allowedOrigins: ReadonlySet<string>,
  authenticate: (req: IncomingMessage) => Promise<{ user: UserRecord } | null>,
): Promise<void> {
  const secure = isHttps(req);
  const finishWithRedirect = (target: string): void => {
    clearStateCookie(res, secure);
    res.writeHead(302, { Location: target });
    res.end();
  };

  const reqUrl = new URL(req.url ?? "/", "http://_local");
  const code = reqUrl.searchParams.get("code");
  const stateFromQuery = reqUrl.searchParams.get("state");
  const errorParam = reqUrl.searchParams.get("error");

  const sealedState = readStateCookie(req);
  let payload: StatePayload | null = null;
  if (sealedState) {
    try {
      payload = await unsealData<StatePayload>(sealedState, { password: getCookiePassword(), ttl: STATE_TTL_SECONDS });
    } catch {
      payload = null;
    }
  }
  const returnTo = payload?.returnTo ?? [...allowedOrigins][0] ?? "/";

  if (errorParam) return finishWithRedirect(`${returnTo}?figma=error&reason=${encodeURIComponent(errorParam)}`);
  if (!code || !stateFromQuery) return finishWithRedirect(`${returnTo}?figma=error&reason=missing_code`);
  if (!payload) return finishWithRedirect(`${returnTo}?figma=error&reason=missing_state`);

  const a = Buffer.from(payload.state);
  const b = Buffer.from(stateFromQuery);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return finishWithRedirect(`${returnTo}?figma=error&reason=bad_state`);
  }

  const auth = await authenticate(req);
  if (!auth || auth.user.id !== payload.userId) {
    return finishWithRedirect(`${returnTo}?figma=error&reason=session_changed`);
  }

  const { clientId, clientSecret, callback } = getOauthConfig();
  let tokens: { access_token: string; refresh_token: string; expires_in: number };
  try {
    const tokenRes = await fetch("https://api.figma.com/v1/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: callback,
        code,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) throw new Error(`exchange ${tokenRes.status}`);
    const body = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
    };
    if (!body.access_token || !body.refresh_token) {
      return finishWithRedirect(`${returnTo}?figma=error&reason=${encodeURIComponent(body.error ?? "no_token")}`);
    }
    tokens = {
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      expires_in: body.expires_in ?? 3600,
    };
  } catch (err) {
    console.error("figma code exchange failed:", err);
    return finishWithRedirect(`${returnTo}?figma=error&reason=exchange_failed`);
  }

  let handle: string | null = null;
  try {
    const meRes = await fetch("https://api.figma.com/v1/me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (meRes.ok) {
      const me = (await meRes.json()) as { handle?: string; email?: string };
      handle = me.handle ?? me.email ?? null;
    }
  } catch (err) {
    console.error("figma user lookup failed (continuing):", err);
  }

  await setFigmaToken(auth.user.id, tokens, handle);
  finishWithRedirect(`${returnTo}?figma=connected`);
}

export async function handleStatus(user: UserRecord): Promise<{
  connected: boolean;
  handle: string | null;
  connected_at: string | null;
}> {
  const link = await getFigmaLink(user.id);
  if (!link) return { connected: false, handle: null, connected_at: null };
  return { connected: true, handle: link.handle, connected_at: link.connected_at };
}

export async function handleDisconnect(user: UserRecord): Promise<void> {
  await clearFigmaToken(user.id);
}

/** Get a valid access token, refreshing if it's within 60s of expiry. */
async function getFigmaAccessToken(userId: string): Promise<string> {
  const t = await getFigmaTokens(userId);
  if (!t) throw new Error("figma_not_connected");
  if (Date.now() < t.expires_at - 60_000) return t.access_token;

  const existing = refreshInFlight.get(userId);
  if (existing) return existing;
  const pending = refreshFigmaAccessToken(userId);
  refreshInFlight.set(userId, pending);
  try {
    return await pending;
  } finally {
    if (refreshInFlight.get(userId) === pending) refreshInFlight.delete(userId);
  }
}

async function refreshFigmaAccessToken(userId: string): Promise<string> {
  const t = await getFigmaTokens(userId);
  if (!t) throw new Error("figma_not_connected");
  if (Date.now() < t.expires_at - 60_000) return t.access_token;
  const { clientId, clientSecret } = getOauthConfig();
  const res = await fetch("https://api.figma.com/v1/oauth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: t.refresh_token }),
  });
  if (!res.ok) {
    // A concurrent process may have consumed a single-use refresh token and
    // already stored its replacement. Never clear credentials from this stale
    // snapshot; prefer the winner when its generation changed.
    const winner = await getFigmaTokens(userId);
    if (winner && winner.generation !== t.generation) return winner.access_token;
    throw new Error("figma_not_connected");
  }
  const body = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!body.access_token) {
    const winner = await getFigmaTokens(userId);
    if (winner && winner.generation !== t.generation) return winner.access_token;
    throw new Error("figma_not_connected");
  }
  const won = await updateFigmaTokens(userId, {
    access_token: body.access_token,
    refresh_token: body.refresh_token ?? t.refresh_token,
    expires_in: body.expires_in ?? 3600,
  }, t.generation);
  if (won) return body.access_token;
  const winner = await getFigmaTokens(userId);
  if (!winner) throw new Error("figma_not_connected");
  return winner.access_token;
}

/** Pull the file key out of a Figma file/design URL, or null. */
export function parseFigmaFileKey(input: string): string | null {
  const s = input.trim();
  // Already a bare key?
  if (/^[A-Za-z0-9]{10,}$/.test(s)) return s;
  try {
    const url = new URL(s);
    if (!/(^|\.)figma\.com$/i.test(url.hostname)) return null;
    const m = url.pathname.match(/\/(?:file|design|proto)\/([A-Za-z0-9]+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function rgbaToHex(c: { r: number; g: number; b: number }): string {
  const h = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

interface FigmaStyleMeta {
  node_id: string;
  style_type: "FILL" | "TEXT" | "EFFECT" | "GRID";
  name: string;
}

/**
 * Read a Figma file's published color + text styles and render them as a text
 * "design context" the analyzer can infer from. Throws a user-actionable error
 * when the token is missing/expired or the file has no usable styles.
 */
export async function extractFigmaDesignContext(
  userId: string,
  fileKey: string,
): Promise<{ contextText: string; styleCount: number }> {
  const token = await getFigmaAccessToken(userId);
  const headers = { Authorization: `Bearer ${token}` };

  const stylesRes = await fetch(`https://api.figma.com/v1/files/${fileKey}/styles`, { headers });
  if (stylesRes.status === 403) throw new Error("Figma denied access to that file — check it's shared with your account.");
  if (stylesRes.status === 404) throw new Error("Figma file not found — check the URL.");
  if (!stylesRes.ok) throw new Error(`Figma API ${stylesRes.status}`);
  const stylesBody = (await stylesRes.json()) as { meta?: { styles?: FigmaStyleMeta[] } };
  const styles = (stylesBody.meta?.styles ?? []).filter(
    (s) => s.style_type === "FILL" || s.style_type === "TEXT",
  );
  if (styles.length === 0) {
    throw new Error(
      "That Figma file has no published color or text styles. Publish some styles (or pick a file that has them) and try again.",
    );
  }

  const ids = styles.slice(0, 60).map((s) => s.node_id);
  const nodesRes = await fetch(
    `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(ids.join(","))}`,
    { headers },
  );
  if (!nodesRes.ok) throw new Error(`Figma API ${nodesRes.status}`);
  const nodesBody = (await nodesRes.json()) as {
    nodes?: Record<string, { document?: Record<string, unknown> } | null>;
  };

  const colorLines: string[] = [];
  const textLines: string[] = [];
  for (const s of styles) {
    const doc = nodesBody.nodes?.[s.node_id]?.document as Record<string, unknown> | undefined;
    if (!doc) continue;
    if (s.style_type === "FILL") {
      const fills = doc.fills as Array<{ type?: string; color?: { r: number; g: number; b: number } }> | undefined;
      const solid = fills?.find((f) => f.type === "SOLID" && f.color);
      if (solid?.color) colorLines.push(`${s.name}: ${rgbaToHex(solid.color)}`);
    } else if (s.style_type === "TEXT") {
      const st = doc.style as { fontFamily?: string; fontWeight?: number; fontSize?: number } | undefined;
      if (st?.fontFamily) {
        textLines.push(
          `${s.name}: ${st.fontFamily}${st.fontWeight ? ` ${st.fontWeight}` : ""}${st.fontSize ? ` ${Math.round(st.fontSize)}px` : ""}`,
        );
      }
    }
  }

  if (colorLines.length === 0 && textLines.length === 0) {
    throw new Error("Couldn't read color/text values from that Figma file's styles.");
  }

  const contextText =
    `Figma published styles from file ${fileKey}:\n` +
    (colorLines.length ? `\nColor styles:\n${colorLines.join("\n")}\n` : "") +
    (textLines.length ? `\nText styles:\n${textLines.join("\n")}\n` : "");
  return { contextText, styleCount: colorLines.length + textLines.length };
}
