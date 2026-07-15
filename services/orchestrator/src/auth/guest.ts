/**
 * Guest / education account auth.
 *
 * A guest signs up with no Google account and no email — districts control
 * what students can sign into, so this is the only way to get students using
 * the product before a district approves it. Authentication is a sealed
 * `gate15-guest` cookie, structurally the same idea as the WorkOS `wos-session`
 * cookie (see auth/workos.ts): it carries the users.id of a row whose
 * account_type is 'guest', sealed with WORKOS_COOKIE_PASSWORD so it can't be
 * forged. authenticate() in server.ts tries the WorkOS cookie first, then
 * falls back to this one.
 *
 * Cookie ownership: the orchestrator SEALS the cookie value, but the web app
 * SETS the actual cookie (apps/web/app/api/guest/*). The web app reliably has
 * WORKOS_COOKIE_DOMAIN configured (AuthKit depends on it) so the cookie spans
 * app. + api.; the orchestrator historically only ever READ cookies and may
 * not have that env var. The orchestrator only needs to read this one too.
 *
 * Flow:
 *   - POST /api/guest              → create a guest account; return the sealed
 *                                    cookie value + the one-time recovery code.
 *   - POST /api/guest/restore      → re-attach to an existing guest via its
 *                                    recovery code; return the sealed cookie.
 *   - POST /api/guest/merge        → after the guest signs in with Google, move
 *                                    their projects onto the WorkOS account.
 *   - GET  /api/guest/recovery-code → re-display the code to a logged-in guest.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { randomInt, createHash, randomUUID } from "node:crypto";
import { parse as parseCookie } from "cookie";
import { sealData, unsealData } from "iron-session";
import {
  createGuestUser,
  getGuestByRecoveryHash,
  getGuestRecoveryCode,
  getUserById,
  claimGuestForConversion,
  releaseGuestLifecycleClaim,
  markGuestConverted,
  touchUserActivity,
  type UserRecord,
} from "../db/users.js";
import { publicError } from "../security/publicError.js";
import { reassignProjectsOwner } from "../db/projects.js";

export const GUEST_COOKIE = "gate15-guest";
/**
 * The pre-rebrand cookie name. READ-ONLY, and only for one release.
 *
 * The rebrand renamed the cookie but changed NEITHER the sealed payload shape
 * NOR the sealing secret (WORKOS_COOKIE_PASSWORD), so a browser still holding
 * `uniqus-guest` is holding a session that is valid in every way except its
 * name. Reading only the new name would have signed out every live guest and
 * forced them to dig out a recovery code they were shown once.
 *
 * So: accept both names on the way IN, and keep writing only `gate15-guest`
 * (the web app owns the Set-Cookie — apps/web/lib/guest-session.ts — and clears
 * both names on signout). Every active guest is re-cookied under the new name
 * on their next signup/restore, and the old cookie ages out on its own.
 * Delete this fallback in a later release.
 */
export const LEGACY_GUEST_COOKIE = "uniqus-guest";
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

// ── Recovery codes ────────────────────────────────────────────────────────────

/**
 * GATE15-XXXX-XXXX-XXXX-XXXX — 16 random chars, ~79 bits of entropy.
 *
 * Codes issued before the rebrand carry the old `UNIQUS-GUEST-` prefix. They
 * keep working: the code is stored (and looked up) as a sha256 of its
 * NORMALIZED form, nothing anywhere parses or validates the prefix, so an old
 * code hashes to the same value it always did. Only newly-issued codes change.
 */
export function generateRecoveryCode(): string {
  let chars = "";
  for (let i = 0; i < 16; i++) {
    chars += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
  }
  return `GATE15-${chars.match(/.{4}/g)!.join("-")}`;
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
  const jar = parseCookie(cookieHeader);
  // Prefer the current name; fall back to the pre-rebrand one so an already
  // signed-in guest isn't logged out by the rename. See LEGACY_GUEST_COOKIE.
  const sealed = jar[GUEST_COOKIE] ?? jar[LEGACY_GUEST_COOKIE];
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

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/**
 * POST /api/guest — create a fresh guest account. Returns the one-time recovery
 * code (shown once at signup, re-viewable later via /api/guest/recovery-code)
 * plus the sealed cookie value for the web app's route handler to set as a
 * first-party cookie.
 */
export async function handleGuestCreate(res: ServerResponse): Promise<void> {
  const code = generateRecoveryCode();
  const displayName = generateGuestDisplayName();
  let user: UserRecord;
  try {
    user = await createGuestUser({
      display_name: displayName,
      recovery_hash: hashRecoveryCode(code),
      recovery_code: code,
    });
  } catch (err) {
    return json(res, 500, publicError("guest_signup_failed", err));
  }
  // The web app sets the actual cookie (it has WORKOS_COOKIE_DOMAIN) — we just
  // hand back the sealed value for its route handler to relay.
  const sealed_cookie = await sealGuestCookie(user.id, displayName);
  json(res, 201, { recovery_code: code, display_name: displayName, sealed_cookie });
}

/**
 * POST /api/guest/restore { recovery_code } — re-attach to an existing guest
 * account from another device or after cookies were cleared. Returns the
 * sealed cookie value for the web app to set. 404 for an unknown code or a
 * guest that has already converted to a real account.
 */
export async function handleGuestRestore(
  res: ServerResponse,
  recoveryCode: string,
): Promise<void> {
  const code = (recoveryCode ?? "").trim();
  if (!code) return json(res, 400, { error: "recovery_code is required" });
  let user: UserRecord | null;
  try {
    user = await getGuestByRecoveryHash(hashRecoveryCode(code));
  } catch (err) {
    return json(res, 500, publicError("guest_restore_failed", err));
  }
  if (!user || user.guest_lifecycle_claim || !(await touchUserActivity(user.id))) {
    return json(res, 404, { error: "recovery code not recognised" });
  }
  const displayName = user.display_name ?? "Guest";
  const sealed_cookie = await sealGuestCookie(user.id, displayName);
  json(res, 200, { display_name: displayName, sealed_cookie });
}

/**
 * POST /api/guest/merge — called server-side by the web app's /projects page
 * once a guest has signed in with Google (the request carries both the
 * wos-session and the gate15-guest cookie). Moves the guest's projects onto
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
  if (!guest || guest.account_type !== "guest" || guest.converted_at || guest.guest_lifecycle_claim) {
    return { moved: 0 };
  }
  const claim = randomUUID();
  if (!(await claimGuestForConversion(guest.id, claim))) return { moved: 0 };
  try {
    const moved = await reassignProjectsOwner(guest.id, workosUser.id);
    await markGuestConverted(guest.id, claim);
    return { moved };
  } catch (err) {
    await releaseGuestLifecycleClaim(guest.id, claim).catch(() => {});
    throw err;
  }
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
