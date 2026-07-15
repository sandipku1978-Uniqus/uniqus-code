import { NextResponse } from "next/server";
import {
  GUEST_COOKIE_NAME,
  LEGACY_GUEST_COOKIE_NAME,
  guestCookieClearOptions,
} from "@/lib/guest-session";
import { isSameOriginPost } from "@/lib/same-origin";

/**
 * Guest signout — the mirror of /api/signout for WorkOS accounts. Clears the
 * gate15-guest cookie and sends the visitor to /login, where they can start a
 * fresh guest session or restore one with a recovery code.
 */
export async function POST(req: Request) {
  if (!isSameOriginPost(req)) {
    return NextResponse.json({ error: "invalid request origin" }, { status: 403 });
  }
  const res = NextResponse.redirect(new URL("/login", req.url), 303);
  const clear = guestCookieClearOptions(req);
  res.cookies.set(GUEST_COOKIE_NAME, "", clear);
  res.cookies.set(LEGACY_GUEST_COOKIE_NAME, "", clear);
  return res;
}
