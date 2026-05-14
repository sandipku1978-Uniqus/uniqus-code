/**
 * Guest session — the web-app mirror of the orchestrator's auth/guest.ts.
 * Unseals the `uniqus-guest` cookie (sealed with the shared
 * WORKOS_COOKIE_PASSWORD) so the middleware and server components can tell
 * whether the visitor is a guest without a round-trip to the orchestrator.
 *
 * This file is import-safe for the Edge middleware: it pulls in iron-session
 * (Edge-compatible) and nothing from next/headers. Server-component helpers
 * that need next/headers live in guest-server.ts.
 *
 * The cookie is *set* by the web app's route handlers (apps/web/app/api/guest/*):
 * the orchestrator seals the value, but the web app owns the actual cookie so
 * it gets the right Domain (WORKOS_COOKIE_DOMAIN, which the web app reliably
 * has and the orchestrator may not). Read by the middleware, server components,
 * and — cross-origin but same-site — the orchestrator.
 */

import { unsealData } from "iron-session";

export const GUEST_COOKIE_NAME = "uniqus-guest";
// Must match GUEST_COOKIE_TTL_SECONDS in services/orchestrator/src/auth/guest.ts.
const GUEST_COOKIE_TTL_SECONDS = 365 * 24 * 60 * 60;

export interface GuestSession {
  userId: string;
  /** Immutable guest handle, e.g. "Guest-7F3K" — cached in the cookie. */
  displayName: string;
  v: 1;
}

export function guestCookiePassword(): string {
  const pw = process.env.WORKOS_COOKIE_PASSWORD;
  if (!pw || pw.length < 32) {
    throw new Error("WORKOS_COOKIE_PASSWORD must be at least 32 characters");
  }
  return pw;
}

/**
 * Unseal a raw `uniqus-guest` cookie value. Returns null for a missing,
 * malformed, or expired cookie. Safe to call from the Edge middleware.
 */
export async function unsealGuestCookie(
  sealed: string | undefined | null,
): Promise<GuestSession | null> {
  if (!sealed) return null;
  try {
    const data = await unsealData<GuestSession>(sealed, {
      password: guestCookiePassword(),
      ttl: GUEST_COOKIE_TTL_SECONDS,
    });
    return data?.userId ? data : null;
  } catch {
    return null;
  }
}

/**
 * Cookie options for SETTING the guest cookie from a web-app route handler
 * (apps/web/app/api/guest/*). Domain comes from WORKOS_COOKIE_DOMAIN — the same
 * domain AuthKit uses for wos-session — so the cookie spans app. + api.
 * `secure` is derived from the request so it also works on http://localhost.
 */
export function guestCookieSetOptions(req: Request) {
  return {
    httpOnly: true,
    path: "/",
    maxAge: GUEST_COOKIE_TTL_SECONDS,
    sameSite: "lax" as const,
    secure: new URL(req.url).protocol === "https:",
    domain: process.env.WORKOS_COOKIE_DOMAIN || undefined,
  };
}

/**
 * Cookie options for clearing the guest cookie. Domain + path must match how it
 * was set (guestCookieSetOptions) or the browser keeps the stale cookie. Used
 * by the signout + convert route handlers.
 */
export function guestCookieClearOptions(): {
  maxAge: number;
  path: string;
  domain: string | undefined;
} {
  return {
    maxAge: 0,
    path: "/",
    domain: process.env.WORKOS_COOKIE_DOMAIN || undefined,
  };
}
