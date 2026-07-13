import { parse as parseCookie } from "cookie";
import { sealData, unsealData } from "iron-session";
import { WorkOS } from "@workos-inc/node";

export interface AuthKitSession {
  accessToken: string;
  sessionId: string;
  user: {
    id: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    profilePictureUrl?: string | null;
  };
  impersonator?: unknown;
}

export interface ActiveSessionRecord {
  id: string;
  userId: string;
  status: "active" | "expired" | "revoked";
  expiresAt: string;
  endedAt?: string | null;
}

const COOKIE_NAME = "wos-session";
const WORKOS_SESSION_CACHE_TTL_MS = 30_000;
const WORKOS_SESSION_CACHE_MAX_ENTRIES = 10_000;
let workos: WorkOS | null = null;

function getWorkOS(): WorkOS {
  if (workos) return workos;
  const apiKey = process.env.WORKOS_API_KEY;
  const clientId = process.env.WORKOS_CLIENT_ID;
  if (!apiKey || !clientId) {
    throw new Error("WORKOS_API_KEY and WORKOS_CLIENT_ID are required");
  }
  workos = new WorkOS({ apiKey, clientId });
  return workos;
}

export function hasActiveWorkosSession(
  sessionId: string,
  userId: string,
  sessions: readonly ActiveSessionRecord[],
  now = Date.now(),
): boolean {
  return sessions.some(
    (session) =>
      session.id === sessionId &&
      session.userId === userId &&
      session.status === "active" &&
      !session.endedAt &&
      Number.isFinite(Date.parse(session.expiresAt)) &&
      Date.parse(session.expiresAt) > now,
  );
}

/**
 * Short-lived positive cache for WorkOS's server-side session status. Access
 * JWTs are still unsealed and validated on every request; this only avoids a
 * WorkOS listSessions round-trip on every authenticated API/WS call. Negative
 * results are deliberately not cached so a newly-created session is not held
 * in a false unauthenticated state by eventual consistency.
 */
export class WorkosSessionActivityCache {
  private readonly entries = new Map<string, { expiresAt: number }>();
  private readonly inFlight = new Map<string, Promise<boolean>>();

  constructor(
    private readonly ttlMs = WORKOS_SESSION_CACHE_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  async hasActive(
    sessionId: string,
    userId: string,
    loadSessions: () => Promise<readonly ActiveSessionRecord[]>,
  ): Promise<boolean> {
    const key = `${userId}:${sessionId}`;
    const now = this.now();
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > now) return true;
    if (cached) this.entries.delete(key);

    const pending = this.inFlight.get(key);
    if (pending) return await pending;

    const check = (async () => {
      const sessions = await loadSessions();
      if (!hasActiveWorkosSession(sessionId, userId, sessions, now)) return false;

      const matchingExpiry = Date.parse(
        sessions.find((session) => session.id === sessionId && session.userId === userId)!
          .expiresAt,
      );
      this.entries.set(key, {
        expiresAt: Math.min(now + Math.max(1, this.ttlMs), matchingExpiry),
      });
      this.prune(now);
      return true;
    })();
    this.inFlight.set(key, check);
    try {
      return await check;
    } finally {
      if (this.inFlight.get(key) === check) this.inFlight.delete(key);
    }
  }

  private prune(now: number): void {
    if (this.entries.size <= WORKOS_SESSION_CACHE_MAX_ENTRIES) return;
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
    while (this.entries.size > WORKOS_SESSION_CACHE_MAX_ENTRIES) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.entries.delete(oldestKey);
    }
  }
}

const workosSessionActivity = new WorkosSessionActivityCache();

/** Validate application/issuer claims after the SDK has verified the signature. */
export function hasExpectedWorkosClaims(
  accessToken: string,
  expected: { clientId: string; issuer: string; userId: string; sessionId: string },
  now = Date.now(),
): boolean {
  try {
    const parts = accessToken.split(".");
    if (parts.length !== 3) return false;
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
    const normalizeIssuer = (value: string): string => value.replace(/\/+$/, "");
    if (typeof claims.iss !== "string" || normalizeIssuer(claims.iss) !== normalizeIssuer(expected.issuer)) return false;
    if (claims.sub !== expected.userId || claims.sid !== expected.sessionId) return false;
    if (typeof claims.exp !== "number" || claims.exp * 1000 <= now) return false;
    // AuthKit documentation currently shows both token variants: the Sessions
    // guide omits client_id while the token API reference includes it. Enforce
    // either application-binding claim when present without rejecting a token
    // solely because one optional variant is absent. The SDK has already
    // verified the signature against this client's JWKS before this check.
    if (claims.client_id !== undefined && claims.client_id !== expected.clientId) return false;
    if (claims.aud !== undefined) {
      const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (!audience.includes(expected.clientId)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Authenticate the sealed AuthKit cookie through the WorkOS SDK. The SDK
 * verifies the access JWT signature and standard time claims via this client's
 * WorkOS JWKS; hasExpectedWorkosClaims then binds issuer/user/session and any
 * application claim the token carries. Finally, a short positive cache fronts
 * the server-side session record so revocations take effect shortly without a
 * WorkOS API call on every request. Any SDK/network failure on a cache miss is
 * a fail-closed unauthenticated result.
 */
export async function unsealSessionFromCookieHeader(
  cookieHeader: string | undefined,
): Promise<AuthKitSession | null> {
  if (!cookieHeader) return null;
  const password = process.env.WORKOS_COOKIE_PASSWORD;
  if (!password || password.length < 32) {
    throw new Error("WORKOS_COOKIE_PASSWORD must be at least 32 characters");
  }
  const sealed = parseCookie(cookieHeader)[COOKIE_NAME];
  if (!sealed) return null;

  try {
    const client = getWorkOS();
    const result = await client.userManagement.authenticateWithSessionCookie({
      sessionData: sealed,
      cookiePassword: password,
    });
    if (!result.authenticated) return null;
    if (!hasExpectedWorkosClaims(result.accessToken, {
      clientId: process.env.WORKOS_CLIENT_ID!,
      issuer: process.env.WORKOS_AUTHKIT_ISSUER ?? "https://api.workos.com",
      userId: result.user.id,
      sessionId: result.sessionId,
    })) return null;
    const active = await workosSessionActivity.hasActive(
      result.sessionId,
      result.user.id,
      async () =>
        (await (
          await client.userManagement.listSessions(result.user.id, { limit: 100 })
        ).autoPagination()) as ActiveSessionRecord[],
    );
    if (!active) return null;
    return {
      accessToken: result.accessToken,
      sessionId: result.sessionId,
      user: {
        id: result.user.id,
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
        profilePictureUrl: result.user.profilePictureUrl,
      },
      impersonator: result.impersonator,
    };
  } catch {
    return null;
  }
}

// Retained for guest/session helpers that share the same iron-session format.
export { sealData, unsealData };
