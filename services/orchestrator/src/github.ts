/**
 * GitHub OAuth integration.
 *
 * Single source of truth for GitHub auth lives here on the orchestrator side:
 * the client ID/secret, the state cookie, the encryption key, and the DB
 * writes are all colocated. The web app's only responsibility is to send the
 * user's browser to `/api/github/start` and read `/api/github/status`.
 *
 * Flow:
 *   1. Browser → GET /api/github/start?return=<web url>
 *      - Authenticated via the existing WorkOS session cookie.
 *      - Server generates a random `state`, seals {state, userId, returnTo}
 *        into a short-lived cookie, redirects to github.com/login/oauth.
 *   2. GitHub → GET /api/github/callback?code=...&state=...
 *      - Server reads & clears the state cookie, checks the state match,
 *        exchanges the code for an access token, fetches the user's login,
 *        encrypts and stores the token, then 302s back to `returnTo`.
 *   3. Browser → GET /api/github/status (any time after)
 *      - Returns { connected: bool, login: string | null }.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { sealData, unsealData } from "iron-session";
import {
  getGithubLink,
  getGithubToken,
  setGithubToken,
  clearGithubToken,
  type UserRecord,
} from "./db/users.js";

const STATE_COOKIE = "uniqus_github_state";
const STATE_TTL_SECONDS = 600; // 10 min — plenty for a real human login

// Read-only `repo` is enough to clone any repo the user can see, including
// private ones in orgs that have approved the OAuth app. We deliberately do
// NOT request `write:repo_hook` etc. — that's Phase 3 territory.
const SCOPE = "repo read:user";

interface StatePayload {
  state: string;
  userId: string;
  returnTo: string;
}

function getOauthConfig(): { clientId: string; clientSecret: string; callback: string } {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set to enable GitHub OAuth. " +
        "Register an OAuth App at https://github.com/settings/developers.",
    );
  }
  // Public callback URL must match exactly what's configured on the OAuth App.
  // We derive from PUBLIC_BASE_URL (already used for preview URLs) so there's
  // a single canonical orchestrator base URL configured per environment.
  const base = (
    process.env.PUBLIC_BASE_URL ??
    process.env.PREVIEW_BASE_URL ??
    "http://localhost:8787"
  ).replace(/\/$/, "");
  return { clientId, clientSecret, callback: `${base}/api/github/callback` };
}

function getCookiePassword(): string {
  // Reuse the WorkOS cookie password — it's already required to be ≥32 chars
  // and is present in every env where the orchestrator runs.
  const pw = process.env.WORKOS_COOKIE_PASSWORD;
  if (!pw || pw.length < 32) {
    throw new Error("WORKOS_COOKIE_PASSWORD must be at least 32 characters");
  }
  return pw;
}

function isHttps(req: IncomingMessage): boolean {
  // Behind Railway/Vercel/Fly the inner socket is HTTP; the edge sets
  // x-forwarded-proto. Anything other than localhost in production should
  // be HTTPS, and Secure cookies are required for SameSite=None.
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
  // Only allow returning to one of the WEB_ORIGIN allowlisted hosts. An open
  // redirect on the OAuth callback would let an attacker craft a phishing URL
  // that looks like our OAuth flow but lands on attacker.com after success.
  if (!raw) return [...allowed][0] ?? "/";
  try {
    const url = new URL(raw);
    const origin = `${url.protocol}//${url.host}`;
    if (allowed.has(origin)) return url.toString();
  } catch {
    // Not a URL — could be a relative path. Reject; the callback always
    // lands on a different origin than the orchestrator anyway.
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
  const payload: StatePayload = { state, userId: user.id, returnTo };
  const sealed = await sealData(payload, {
    password: getCookiePassword(),
    ttl: STATE_TTL_SECONDS,
  });
  setStateCookie(res, sealed, isHttps(req));

  const authUrl = new URL("https://github.com/login/oauth/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", callback);
  authUrl.searchParams.set("scope", SCOPE);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("allow_signup", "false");

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

  // Always best-effort clear the state cookie so a stale value can't outlive
  // a successful or failed callback.
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
    finishWithRedirect(`${returnTo}?github=error&reason=${encodeURIComponent(errorParam)}`);
    return;
  }
  if (!code || !stateFromQuery) {
    finishWithRedirect(`${returnTo}?github=error&reason=missing_code`);
    return;
  }
  if (!payload) {
    finishWithRedirect(`${returnTo}?github=error&reason=missing_state`);
    return;
  }

  // Constant-time state compare. Mismatched state means the request didn't
  // originate from our /api/github/start — drop it.
  const a = Buffer.from(payload.state);
  const b = Buffer.from(stateFromQuery);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    finishWithRedirect(`${returnTo}?github=error&reason=bad_state`);
    return;
  }

  // Re-authenticate the request (the user could have signed out mid-flow,
  // or a different user could be holding the state cookie). The state
  // cookie's userId must match the currently signed-in user.
  const auth = await authenticate(req);
  if (!auth || auth.user.id !== payload.userId) {
    finishWithRedirect(`${returnTo}?github=error&reason=session_changed`);
    return;
  }

  const { clientId, clientSecret, callback } = getOauthConfig();

  // Exchange the code for an access token. GitHub returns urlencoded by
  // default; we ask for JSON so we don't have to parse formdata back out.
  let token: string | null = null;
  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: callback,
      }),
    });
    if (!tokenRes.ok) throw new Error(`exchange ${tokenRes.status}`);
    const body = (await tokenRes.json()) as { access_token?: string; error?: string };
    if (!body.access_token) {
      finishWithRedirect(
        `${returnTo}?github=error&reason=${encodeURIComponent(body.error ?? "no_token")}`,
      );
      return;
    }
    token = body.access_token;
  } catch (err) {
    console.error("github code exchange failed:", err);
    finishWithRedirect(`${returnTo}?github=error&reason=exchange_failed`);
    return;
  }

  // Pull the GitHub login so we can show "Connected as @octocat" in the UI
  // without round-tripping the API on every page load.
  let login = "";
  try {
    const meRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "uniqus-code",
      },
    });
    if (meRes.ok) {
      const me = (await meRes.json()) as { login?: string };
      login = me.login ?? "";
    }
  } catch (err) {
    console.error("github user lookup failed (continuing with empty login):", err);
  }

  await setGithubToken(auth.user.id, token, login);
  finishWithRedirect(`${returnTo}?github=connected`);
}

export async function handleStatus(user: UserRecord): Promise<{
  connected: boolean;
  login: string | null;
  connected_at: string | null;
}> {
  const link = await getGithubLink(user.id);
  if (!link) return { connected: false, login: null, connected_at: null };
  return { connected: true, login: link.login, connected_at: link.connected_at };
}

export async function handleDisconnect(user: UserRecord): Promise<void> {
  await clearGithubToken(user.id);
}

export interface GithubRepo {
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  clone_url: string;
  updated_at: string;
}

/**
 * List the user's accessible repositories. GitHub paginates; for the
 * "pick a repo to import" UI 100 most-recently-pushed repos is plenty.
 */
export async function listUserRepos(user: UserRecord): Promise<GithubRepo[]> {
  const token = await getGithubToken(user.id);
  if (!token) {
    throw new Error("github_not_connected");
  }
  const res = await fetch(
    "https://api.github.com/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member",
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "uniqus-code",
      },
    },
  );
  if (res.status === 401) {
    // Token was revoked from GitHub's side — clear our copy so the UI prompts
    // for reconnection rather than silently failing forever.
    await clearGithubToken(user.id);
    throw new Error("github_not_connected");
  }
  if (!res.ok) {
    throw new Error(`github api ${res.status}`);
  }
  const raw = (await res.json()) as Array<{
    name: string;
    full_name: string;
    private: boolean;
    default_branch: string;
    clone_url: string;
    updated_at: string;
  }>;
  return raw.map((r) => ({
    name: r.name,
    full_name: r.full_name,
    private: r.private,
    default_branch: r.default_branch,
    clone_url: r.clone_url,
    updated_at: r.updated_at,
  }));
}

export { getGithubToken };
