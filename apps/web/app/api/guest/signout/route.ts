import { NextResponse } from "next/server";
import {
  GUEST_COOKIE_NAME,
  guestCookieClearOptions,
} from "@/lib/guest-session";

/**
 * Guest signout — the mirror of /api/signout for WorkOS accounts. Clears the
 * gate15-guest cookie and sends the visitor to /login, where they can start a
 * fresh guest session or restore one with a recovery code.
 */
export async function GET(req: Request) {
  const res = NextResponse.redirect(new URL("/login", req.url));
  res.cookies.set(GUEST_COOKIE_NAME, "", guestCookieClearOptions());
  return res;
}
