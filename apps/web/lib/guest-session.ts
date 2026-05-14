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
 * The cookie is *set* by the orchestrator (POST /api/guest); the web app only
 * ever reads it, and clears it on signout / after conversion.
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
 * Cookie options for clearing the guest cookie. The Domain must match what the
 * orchestrator set it with (WORKOS_COOKIE_DOMAIN) or the browser keeps the
 * stale cookie. Used by the signout + convert route handlers.
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
