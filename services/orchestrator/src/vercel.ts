/**
 * Vercel OAuth integration.
 *
 * Mirrors the github.ts flow shape, but Vercel uses its "integration install"
 * pattern rather than vanilla OAuth: the user lands on
 * `https://vercel.com/integrations/{slug}/new`, picks a team (or personal),
 * grants permissions, then Vercel 302s to our registered Redirect URL with
 * `?code=...&state=...&configurationId=...&teamId=...`.
 *
 * Configure on Vercel side:
 *   - https://vercel.com/dashboard/integrations/console → New Integration
 *   - Redirect URL: `${PUBLIC_BASE_URL}/api/vercel/callback`
 *   - Required scopes: read+write on Projects, Deployments, Env (so we can
 *     create projects, push deployments, and set env vars on user's behalf).
 *   - Note the integration's slug, client ID, client secret.
 *
 * Env vars on the orchestrator:
 *   VERCEL_INTEGRATION_SLUG  (e.g. "uniqus-code")
 *   VERCEL_CLIENT_ID
 *   VERCEL_CLIENT_SECRET
 *   PUBLIC_BASE_URL          (already used by GitHub OAuth)
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { sealData, unsealData } from "iron-session";
import {
  clearVercelToken,
  getVercelLink,
  getVercelToken,
  setVercelToken,
  type UserRecord,
} from "./db/users.js";

const STATE_COOKIE = "uniqus_vercel_state";
const STATE_TTL_SECONDS = 600;

interface StatePayload {
  state: string;
  userId: string;
  returnTo: string;
}

function getOauthConfig(): {
  clientId: string;
  clientSecret: string;
  slug: string;
  callback: string;
} {
  const clientId = process.env.VERCEL_CLIENT_ID;
  const clientSecret = process.env.VERCEL_CLIENT_SECRET;
  const slug = process.env.VERCEL_INTEGRATION_SLUG;
  if (!clientId || !clientSecret || !slug) {
    throw new Error(
      "VERCEL_CLIENT_ID, VERCEL_CLIENT_SECRET, and VERCEL_INTEGRATION_SLUG " +
        "must be set to enable Vercel deploy. Register the integration at " +
        "https://vercel.com/dashboard/integrations/console.",
    );
  }
  const base = (
    process.env.PUBLIC_BASE_URL ??
    process.env.PREVIEW_BASE_URL ??
    "http://localhost:8787"
  ).replace(/\/$/, "");
  return { clientId, clientSecret, slug, callback: `${base}/api/vercel/callback` };
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
  const parts = [
    `${STATE_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    `Max-Age=${STATE_TTL_SECONDS}`,
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearStateCookie(res: ServerResponse, secure: boolean): void {
  const parts = [
    `${STATE_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "Max-Age=0",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function readStateCookie(req: IncomingMessage): string | undefined {
  const raw = req.headers.cookie;
  if (typeof raw !== "string") return undefined;
  for (const piece of raw.split(/;\s*/)) {
    const eq = piece.indexOf("=");
    if (eq < 0) continue;
    if (piece.slice(0, eq) === STATE_COOKIE) {
      return piece.slice(eq + 1);
    }
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

export async function handleStart(
  req: IncomingMessage,
  res: ServerResponse,
  user: UserRecord,
  allowedOrigins: ReadonlySet<string>,
): Promise<void> {
  const { slug } = getOauthConfig();

  const reqUrl = new URL(req.url ?? "/", "http://_local");
  const returnTo = sanitizeReturnTo(reqUrl.searchParams.get("return"), allowedOrigins);

  const state = randomBytes(16).toString("hex");
  const payload: StatePayload = { state, userId: user.id, returnTo };
  const sealed = await sealData(payload, {
    password: getCookiePassword(),
    ttl: STATE_TTL_SECONDS,
  });
  setStateCookie(res, sealed, isHttps(req));

  // Vercel renders the integration install / team-picker UI here, then 302s
  // to our registered Redirect URL with the OAuth code.
  const installUrl = new URL(`https://vercel.com/integrations/${slug}/new`);
  installUrl.searchParams.set("state", state);

  res.writeHead(302, { Location: installUrl.toString() });
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
  const teamId = reqUrl.searchParams.get("teamId"); // null when installed on personal account
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
    finishWithRedirect(`${returnTo}?vercel=error&reason=${encodeURIComponent(errorParam)}`);
    return;
  }
  if (!code || !stateFromQuery) {
    finishWithRedirect(`${returnTo}?vercel=error&reason=missing_code`);
    return;
  }
  if (!payload) {
    finishWithRedirect(`${returnTo}?vercel=error&reason=missing_state`);
    return;
  }
  const a = Buffer.from(payload.state);
  const b = Buffer.from(stateFromQuery);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    finishWithRedirect(`${returnTo}?vercel=error&reason=bad_state`);
    return;
  }

  const auth = await authenticate(req);
  if (!auth || auth.user.id !== payload.userId) {
    finishWithRedirect(`${returnTo}?vercel=error&reason=session_changed`);
    return;
  }

  const { clientId, clientSecret, callback } = getOauthConfig();

  // Vercel's token endpoint is form-urlencoded, NOT JSON. Source: their
  // integrations docs. Returns { token_type, access_token, installation_id,
  // user_id, team_id }. Bearer token is the field we care about.
  let tokenBody: {
    access_token?: string;
    token_type?: string;
    installation_id?: string;
    user_id?: string;
    team_id?: string;
    error?: string;
  };
  try {
    const tokenRes = await fetch("https://api.vercel.com/v2/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: callback,
      }).toString(),
    });
    tokenBody = (await tokenRes.json()) as typeof tokenBody;
    if (!tokenRes.ok || !tokenBody.access_token) {
      finishWithRedirect(
        `${returnTo}?vercel=error&reason=${encodeURIComponent(tokenBody.error ?? "no_token")}`,
      );
      return;
    }
  } catch (err) {
    console.error("vercel code exchange failed:", err);
    finishWithRedirect(`${returnTo}?vercel=error&reason=exchange_failed`);
    return;
  }
  const accessToken = tokenBody.access_token;
  const resolvedTeamId = teamId ?? tokenBody.team_id ?? null;

  // Look up the user's Vercel username so we can show "Connected as @x" in
  // the UI. /v2/user is identity-only and doesn't require team scope.
  let vercelUserId = tokenBody.user_id ?? "";
  let vercelUsername = "";
  try {
    const meRes = await fetch("https://api.vercel.com/v2/user", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (meRes.ok) {
      const me = (await meRes.json()) as { user?: { id?: string; username?: string } };
      vercelUserId = me.user?.id ?? vercelUserId;
      vercelUsername = me.user?.username ?? "";
    }
  } catch (err) {
    console.error("vercel user lookup failed (continuing):", err);
  }

  await setVercelToken(
    auth.user.id,
    accessToken,
    { id: vercelUserId, username: vercelUsername },
    resolvedTeamId,
  );
  finishWithRedirect(`${returnTo}?vercel=connected`);
}

export async function handleStatus(user: UserRecord): Promise<{
  connected: boolean;
  user_login: string | null;
  team_id: string | null;
  connected_at: string | null;
}> {
  const link = await getVercelLink(user.id);
  if (!link) {
    return { connected: false, user_login: null, team_id: null, connected_at: null };
  }
  return {
    connected: true,
    user_login: link.user_login || null,
    team_id: link.team_id,
    connected_at: link.connected_at,
  };
}

export async function handleDisconnect(user: UserRecord): Promise<void> {
  await clearVercelToken(user.id);
}

/**
 * Resolve the current user's Vercel auth context for downstream API calls.
 * Returns null when the user hasn't connected — the deploy route uses that
 * as the "send the UI a 409 prompting reconnect" signal.
 */
export async function getVercelAuth(
  user: UserRecord,
): Promise<{ token: string; teamId: string | null } | null> {
  const token = await getVercelToken(user.id);
  if (!token) return null;
  const link = await getVercelLink(user.id);
  return { token, teamId: link?.team_id ?? null };
}

export { getVercelToken };
