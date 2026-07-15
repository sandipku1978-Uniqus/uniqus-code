/**
 * Supabase OAuth integration + Management API client.
 *
 * Mirrors the Vercel/GitHub OAuth shape, with three Supabase-specific twists
 * (see notes/supabase-oauth-setup.md):
 *   1. PKCE is REQUIRED — we generate a code_verifier, send the S256
 *      code_challenge on /authorize, and the verifier on the token exchange.
 *   2. Access tokens EXPIRE (~1h) and refresh tokens ROTATE (single-use) — so
 *      we persist both (encrypted) + an expiry and refresh on demand.
 *   3. Project creation is ASYNC — the connector polls until ACTIVE_HEALTHY.
 *
 * Configure on the Supabase side:
 *   - Organization Settings → OAuth Apps → Add application
 *   - Redirect URI: `${PUBLIC_BASE_URL}/api/supabase/callback`
 *   - Token endpoint auth: client_secret_basic (default — we send HTTP Basic)
 *   - Scopes: Organizations:Read, Projects:Read+Write, Secrets:Read, Database:Write
 *
 * Env vars on the orchestrator:
 *   SUPABASE_OAUTH_CLIENT_ID
 *   SUPABASE_OAUTH_CLIENT_SECRET
 *   PUBLIC_BASE_URL          (already used by GitHub/Vercel OAuth)
 *   WORKOS_COOKIE_PASSWORD   (seals the state cookie)
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { sealData, unsealData } from "iron-session";
import {
  clearSupabaseToken,
  getSupabaseLink,
  getSupabaseTokens,
  setSupabaseToken,
  updateSupabaseTokens,
  type UserRecord,
} from "./db/users.js";

const STATE_COOKIE = "gate15_supabase_state";
const STATE_TTL_SECONDS = 600;

const AUTHORIZE_URL = "https://api.supabase.com/v1/oauth/authorize";
const TOKEN_URL = "https://api.supabase.com/v1/oauth/token";
export const SUPABASE_API_BASE = "https://api.supabase.com/v1";

/** Refresh the access token when it's within this many ms of expiry. */
const REFRESH_SKEW_MS = 60_000;
const refreshInFlight = new Map<string, Promise<string | null>>();

interface StatePayload {
  state: string;
  /** PKCE code_verifier — kept server-side in the sealed cookie, never exposed. */
  verifier: string;
  userId: string;
  returnTo: string;
}

function getOauthConfig(): { clientId: string; clientSecret: string; callback: string } {
  const clientId = process.env.SUPABASE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.SUPABASE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "SUPABASE_OAUTH_CLIENT_ID and SUPABASE_OAUTH_CLIENT_SECRET must be set to " +
        "enable the Supabase integration. Register an OAuth app under Organization " +
        "Settings → OAuth Apps (see notes/supabase-oauth-setup.md).",
    );
  }
  const base = (
    process.env.PUBLIC_BASE_URL ??
    "http://localhost:8787"
  ).replace(/\/$/, "");
  return { clientId, clientSecret, callback: `${base}/api/supabase/callback` };
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
  } catch {}
  return [...allowed][0] ?? "/";
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** PKCE pair: a 43-char verifier and its S256 challenge. */
function makePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
}

/** POST the token endpoint with HTTP Basic client auth (client_secret_basic). */
async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const { clientId, clientSecret } = getOauthConfig();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams(body).toString(),
  });
  return (await res.json().catch(() => ({}))) as TokenResponse;
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
  const { verifier, challenge } = makePkce();
  const payload: StatePayload = { state, verifier, userId: user.id, returnTo };
  const sealed = await sealData(payload, { password: getCookiePassword(), ttl: STATE_TTL_SECONDS });
  setStateCookie(res, sealed, isHttps(req));

  const authUrl = new URL(AUTHORIZE_URL);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", callback);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);

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
  const finish = (target: string): void => {
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
      payload = await unsealData<StatePayload>(sealedState, {
        password: getCookiePassword(),
        ttl: STATE_TTL_SECONDS,
      });
    } catch {
      payload = null;
    }
  }
  const fallbackReturn = [...allowedOrigins][0] ?? "/";
  const returnTo = payload?.returnTo ?? fallbackReturn;

  if (errorParam) {
    finish(`${returnTo}?supabase=error&reason=${encodeURIComponent(errorParam)}`);
    return;
  }
  if (!code || !stateFromQuery) {
    finish(`${returnTo}?supabase=error&reason=missing_code`);
    return;
  }
  if (!payload) {
    finish(`${returnTo}?supabase=error&reason=missing_state`);
    return;
  }
  const a = Buffer.from(payload.state);
  const b = Buffer.from(stateFromQuery);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    finish(`${returnTo}?supabase=error&reason=bad_state`);
    return;
  }

  const auth = await authenticate(req);
  if (!auth || auth.user.id !== payload.userId) {
    finish(`${returnTo}?supabase=error&reason=session_changed`);
    return;
  }

  const { callback } = getOauthConfig();
  let tok: TokenResponse;
  try {
    tok = await postToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: callback,
      code_verifier: payload.verifier,
    });
  } catch (err) {
    console.error("supabase code exchange failed:", err);
    finish(`${returnTo}?supabase=error&reason=exchange_failed`);
    return;
  }
  if (!tok.access_token || !tok.refresh_token) {
    finish(`${returnTo}?supabase=error&reason=${encodeURIComponent(tok.error ?? "no_token")}`);
    return;
  }

  // Pick a default org for "Connected to <org>" display (best-effort).
  let org: { id: string | null; name: string | null } = { id: null, name: null };
  try {
    const orgsRes = await fetch(`${SUPABASE_API_BASE}/organizations`, {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    if (orgsRes.ok) {
      const orgs = (await orgsRes.json()) as Array<{ id?: string; name?: string }>;
      if (Array.isArray(orgs) && orgs.length > 0) {
        org = { id: orgs[0].id ?? null, name: orgs[0].name ?? null };
      }
    }
  } catch (err) {
    console.error("supabase org lookup failed (continuing):", err);
  }

  await setSupabaseToken(
    auth.user.id,
    {
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      expires_in: Number(tok.expires_in) || 3600,
    },
    org,
  );
  finish(`${returnTo}?supabase=connected`);
}

export async function handleStatus(user: UserRecord): Promise<{
  connected: boolean;
  org_id: string | null;
  org_name: string | null;
  connected_at: string | null;
}> {
  const link = await getSupabaseLink(user.id);
  if (!link) return { connected: false, org_id: null, org_name: null, connected_at: null };
  return {
    connected: true,
    org_id: link.org_id,
    org_name: link.org_name,
    connected_at: link.connected_at,
  };
}

export async function handleDisconnect(user: UserRecord): Promise<void> {
  await clearSupabaseToken(user.id);
}

/**
 * Return a VALID access token for the user, refreshing (and persisting the
 * rotated tokens) if the stored one is expired/near-expiry. Null when the user
 * hasn't connected or the refresh failed (e.g. they revoked the app).
 */
export async function getSupabaseAccessToken(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const tokens = await getSupabaseTokens(userId);
  if (!tokens) return null;
  if (tokens.expires_at - Date.now() > REFRESH_SKEW_MS) return tokens.access_token;

  const existing = refreshInFlight.get(userId);
  if (existing) return existing;
  const pending = refreshSupabaseAccessToken(userId);
  refreshInFlight.set(userId, pending);
  try {
    return await pending;
  } finally {
    if (refreshInFlight.get(userId) === pending) refreshInFlight.delete(userId);
  }
}

async function refreshSupabaseAccessToken(userId: string): Promise<string | null> {
  // Re-read after entering the single-flight: an earlier caller/process may
  // already have replaced this rotated credential pair.
  const tokens = await getSupabaseTokens(userId);
  if (!tokens) return null;
  if (tokens.expires_at - Date.now() > REFRESH_SKEW_MS) return tokens.access_token;

  let tok: TokenResponse;
  try {
    tok = await postToken({ grant_type: "refresh_token", refresh_token: tokens.refresh_token });
  } catch (err) {
    console.error("supabase token refresh threw:", err);
    return null;
  }
  if (!tok.access_token || !tok.refresh_token) {
    console.error("supabase token refresh failed:", tok.error ?? tok.error_description ?? "no_token");
    const winner = await getSupabaseTokens(userId);
    if (winner && winner.generation !== tokens.generation) return winner.access_token;
    return null;
  }
  const won = await updateSupabaseTokens(userId, {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    expires_in: Number(tok.expires_in) || 3600,
  }, tokens.generation);
  if (won) return tok.access_token;

  // Another orchestrator instance refreshed the same row first. Never
  // overwrite it with this stale response; return the winner's token instead.
  const winner = await getSupabaseTokens(userId);
  return winner?.access_token ?? null;
}

/**
 * Authenticated Management API call on behalf of `userId`. Refreshes the token
 * as needed. Parses JSON (or returns the raw text), and throws a readable error
 * on non-2xx. Base is https://api.supabase.com/v1.
 */
export async function supabaseFetch(
  userId: string | null,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<unknown> {
  const token = await getSupabaseAccessToken(userId);
  if (!token) {
    throw new Error(
      "Supabase is not connected for this account (or access was revoked). Connect it in Settings → Integrations.",
    );
  }
  const res = await fetch(`${SUPABASE_API_BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const msg =
      parsed && typeof parsed === "object" && "message" in parsed
        ? String((parsed as { message: unknown }).message)
        : text.slice(0, 500);
    throw new Error(`Supabase API ${res.status}: ${msg}`);
  }
  return parsed;
}
