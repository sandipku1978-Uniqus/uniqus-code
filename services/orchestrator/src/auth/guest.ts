/**
 * Guest / education account auth.
 *
 * A guest signs up with no Google account and no email — districts control
 * what students can sign into, so this is the only way to get students using
 * the product before a district approves it. Authentication is a sealed
 * `uniqus-guest` cookie, structurally the same idea as the WorkOS `wos-session`
 * cookie (see auth/workos.ts): it carries the users.id of a row whose
 * account_type is 'guest', sealed with WORKOS_COOKIE_PASSWORD so it can't be
 * forged. authenticate() in server.ts tries the WorkOS cookie first, then
 * falls back to this one.
 *
 * The cookie is set with the same Domain as wos-session (WORKOS_COOKIE_DOMAIN)
 * so it reaches both the web app and the orchestrator subdomain.
 *
 * Flow:
 *   - POST /api/guest              → create a guest account, set cookie, return
 *                                    the one-time recovery code.
 *   - POST /api/guest/restore      → re-attach to an existing guest via its
 *                                    recovery code (new device / cleared cookies).
 *   - POST /api/guest/merge        → after the guest signs in with Google, move
 *                                    their projects onto the WorkOS account.
 *   - GET  /api/guest/recovery-code → re-display the code to a logged-in guest.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { randomInt, createHash } from "node:crypto";
import { parse as parseCookie } from "cookie";
import { sealData, unsealData } from "iron-session";
import { encryptToken } from "./encrypt.js";
import {
  createGuestUser,
  getGuestByRecoveryHash,
  getGuestRecoveryCode,
  getUserById,
  markGuestConverted,
  type UserRecord,
} from "../db/users.js";
import { reassignProjectsOwner } from "../db/projects.js";

const GUEST_COOKIE = "uniqus-guest";
// One year. There is no hard calendar expiry — the inactivity sweeper is what
// reclaims abandoned accounts — so the cookie just needs to outlive a school
// term comfortably.
const GUEST_COOKIE_TTL_SECONDS = 365 * 24 * 60 * 60;
// Unambiguous alphabet for the recovery code — no 0/O/1/I/L, so a student
// reading it off a screen (or a teacher off a list) can't fat-finger it.
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

interface GuestCookiePayload {
  userId: string;
  // The guest's display name is immutable, so caching it in the cookie lets
  // the web app render "Guest-7F3K" without a round-trip to /api/me.
  displayName: string;
  v: 1;
}

function getCookiePassword(): string {
  // Reuse the WorkOS cookie password — already required to be ≥32 chars and
  // present in every env the orchestrator (and web app) runs in.
  const pw = process.env.WORKOS_COOKIE_PASSWORD;
  if (!pw || pw.length < 32) {
    throw new Error("WORKOS_COOKIE_PASSWORD must be at least 32 characters");
  }
  return pw;
}

function isHttps(req: IncomingMessage): boolean {
  // Behind Railway/Vercel/Fly the inner socket is HTTP; the edge sets
  // x-forwarded-proto. Secure cookies are required for SameSite=None.
  if (req.headers["x-forwarded-proto"] === "https") return true;
  const host = req.headers.host ?? "";
  return !host.startsWith("localhost") && !host.startsWith("127.0.0.1");
}

// ── Recovery codes ────────────────────────────────────────────────────────────

/** UNIQUS-GUEST-XXXX-XXXX-XXXX-XXXX — 16 random chars, ~79 bits of entropy. */
export function generateRecoveryCode(): string {
  let chars = "";
  for (let i = 0; i < 16; i++) {
    chars += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
  }
  return `UNIQUS-GUEST-${chars.match(/.{4}/g)!.join("-")}`;
}

/** A short friendly handle shown in the UI, e.g. "Guest-7F3K". */
export function generateGuestDisplayName(): string {
  let s = "";
  for (let i = 0; i < 4; i++) {
    s += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
  }
  return `Guest-${s}`;
}

/**
 * Canonicalise a recovery code before hashing so casing, spacing and the
 * hyphen grouping don't matter when a student types it back in.
 */
function normalizeRecoveryCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
}

// ── Cookie sealing ────────────────────────────────────────────────────────────

export async function unsealGuestFromCookieHeader(
  cookieHeader: string | undefined,
): Promise<GuestCookiePayload | null> {
  if (!cookieHeader) return null;
  const sealed = parseCookie(cookieHeader)[GUEST_COOKIE];
  if (!sealed) return null;
  try {
    const data = await unsealData<GuestCookiePayload>(sealed, {
      password: getCookiePassword(),
      ttl: GUEST_COOKIE_TTL_SECONDS,
    });
    if (!data?.userId) return null;
    return data;
  } catch {
    return null;
  }
}

async function sealGuestCookie(
  userId: string,
  displayName: string,
): Promise<string> {
  const payload: GuestCookiePayload = { userId, displayName, v: 1 };
  return sealData(payload, {
    password: getCookiePassword(),
    ttl: GUEST_COOKIE_TTL_SECONDS,
  });
}

function cookieAttributes(req: IncomingMessage, maxAgeSeconds: number): string {
  const parts = ["Path=/", "HttpOnly", `Max-Age=${maxAgeSeconds}`];
  // Match wos-session's Domain so the cookie reaches both the web app and the
  // orchestrator subdomain. Omitted in local dev (a host-only localhost cookie
  // is sent across ports anyway).
  const domain = process.env.WORKOS_COOKIE_DOMAIN;
  if (domain) parts.push(`Domain=${domain}`);
  // Cross-site (web app origin → orchestrator origin) needs SameSite=None,
  // which the browser only accepts alongside Secure. Local http dev falls back
  // to Lax so the cookie still works without TLS.
  if (isHttps(req)) parts.push("SameSite=None", "Secure");
  else parts.push("SameSite=Lax");
  return parts.join("; ");
}

function setGuestCookie(
  res: ServerResponse,
  req: IncomingMessage,
  sealed: string,
): void {
  res.setHeader(
    "Set-Cookie",
    `${GUEST_COOKIE}=${sealed}; ${cookieAttributes(req, GUEST_COOKIE_TTL_SECONDS)}`,
  );
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/**
 * POST /api/guest — create a fresh guest account, set the cookie, and return
 * the one-time recovery code. The code is shown to the user once at signup
 * (and re-viewable later via /api/guest/recovery-code while logged in).
 */
export async function handleGuestCreate(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const code = generateRecoveryCode();
  const displayName = generateGuestDisplayName();
  let user: UserRecord;
  try {
    user = await createGuestUser({
      display_name: displayName,
      recovery_hash: hashRecoveryCode(code),
      recovery_code_enc: encryptToken(code),
    });
  } catch (err) {
    return json(res, 500, { error: `guest signup failed: ${errMessage(err)}` });
  }
  setGuestCookie(res, req, await sealGuestCookie(user.id, displayName));
  json(res, 201, { recovery_code: code, display_name: displayName });
}

/**
 * POST /api/guest/restore { recovery_code } — re-attach to an existing guest
 * account from another device or after cookies were cleared. 404 for an
 * unknown code or a guest that has already converted to a real account.
 */
export async function handleGuestRestore(
  req: IncomingMessage,
  res: ServerResponse,
  recoveryCode: string,
): Promise<void> {
  const code = (recoveryCode ?? "").trim();
  if (!code) return json(res, 400, { error: "recovery_code is required" });
  let user: UserRecord | null;
  try {
    user = await getGuestByRecoveryHash(hashRecoveryCode(code));
  } catch (err) {
    return json(res, 500, { error: `guest restore failed: ${errMessage(err)}` });
  }
  if (!user) return json(res, 404, { error: "recovery code not recognised" });
  const displayName = user.display_name ?? "Guest";
  setGuestCookie(res, req, await sealGuestCookie(user.id, displayName));
  json(res, 200, { display_name: displayName });
}

/**
 * POST /api/guest/merge — called server-side by the web app's /projects page
 * once a guest has signed in with Google (the request carries both the
 * wos-session and the uniqus-guest cookie). Moves the guest's projects onto
 * the WorkOS account and marks the guest row converted. Idempotent: a guest
 * cookie pointing at an already-converted (or missing) account is a no-op.
 *
 * We deliberately keep the converted guest row rather than deleting it —
 * deleting would CASCADE-delete any audit_events that still point at it.
 * Guests can't deploy at all, so there are never deployments to worry about,
 * and their audit events stay correctly attributed to "work done as a guest".
 */
export async function handleGuestMerge(
  req: IncomingMessage,
  workosUser: UserRecord,
): Promise<{ moved: number }> {
  const guestCookie = await unsealGuestFromCookieHeader(req.headers.cookie);
  if (!guestCookie) return { moved: 0 };
  const guest = await getUserById(guestCookie.userId);
  if (!guest || guest.account_type !== "guest" || guest.converted_at) {
    return { moved: 0 };
  }
  const moved = await reassignProjectsOwner(guest.id, workosUser.id);
  await markGuestConverted(guest.id);
  return { moved };
}

/**
 * GET /api/guest/recovery-code — re-display the recovery code to a logged-in
 * guest (the "Show recovery code" affordance in the yellow banner). Holding
 * the session cookie already grants full access, so this is not a downgrade.
 */
export async function handleGuestRecoveryCode(
  user: UserRecord,
): Promise<{ recovery_code: string | null }> {
  if (user.account_type !== "guest") return { recovery_code: null };
  return { recovery_code: await getGuestRecoveryCode(user.id) };
}
