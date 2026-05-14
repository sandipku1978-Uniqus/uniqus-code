import { authkitMiddleware } from "@workos-inc/authkit-nextjs";
import {
  NextResponse,
  type NextRequest,
  type NextFetchEvent,
} from "next/server";
import { GUEST_COOKIE_NAME, unsealGuestCookie } from "@/lib/guest-session";

const workosMiddleware = authkitMiddleware({
  middlewareAuth: {
    enabled: true,
    unauthenticatedPaths: ["/", "/login", "/callback"],
  },
});

/**
 * Guest accounts have no WorkOS session, so the stock authkitMiddleware would
 * bounce them to /login. Let a request through untouched when it carries a
 * valid `uniqus-guest` cookie; otherwise fall back to the WorkOS middleware
 * exactly as before. A just-converted guest still has wos-session, so that
 * case flows through WorkOS normally.
 */
export default async function middleware(
  req: NextRequest,
  event: NextFetchEvent,
) {
  const guest = await unsealGuestCookie(
    req.cookies.get(GUEST_COOKIE_NAME)?.value,
  );
  if (guest) return NextResponse.next();
  return workosMiddleware(req, event);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)"],
};
