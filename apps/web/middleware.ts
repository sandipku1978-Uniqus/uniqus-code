import { authkitMiddleware } from "@workos-inc/authkit-nextjs";
import {
  NextResponse,
  type NextRequest,
  type NextFetchEvent,
} from "next/server";
import { GUEST_COOKIE_NAME, unsealGuestCookie } from "@/lib/guest-session";

/**
 * Public marketing + resource pages (app/(marketing)/* and app/guide). These
 * must be reachable without a WorkOS session or guest cookie, so they're
 * allow-listed here. Patterns are matched with path-to-regexp v6 (anchored,
 * exact), so nested blog posts need the `:path*` wildcard. Keep this in sync
 * with the footer/nav links in components/SiteFooter.tsx + MarketingNav.tsx.
 */
const PUBLIC_PATHS = [
  "/",
  "/login",
  "/callback",
  "/guide",
  "/pricing",
  "/enterprise",
  "/security",
  "/models",
  "/workspaces",
  "/templates",
  "/changelog",
  "/about",
  "/careers",
  "/contact",
  "/support",
  "/community",
  "/status",
  "/blog",
  "/blog/:path*",
];

const workosMiddleware = authkitMiddleware({
  middlewareAuth: {
    enabled: true,
    unauthenticatedPaths: PUBLIC_PATHS,
  },
});

/**
 * Guest accounts have no WorkOS session, so the stock authkitMiddleware would
 * bounce them to /login. Two bypasses:
 *
 *  1. The web app's own guest API routes (/api/guest/*) handle their own auth —
 *     signup + restore are unauthenticated by definition (the visitor has no
 *     cookie yet), convert + signout read the guest cookie themselves. The
 *     WorkOS middleware must never intercept them, or it redirects the
 *     would-be guest to the WorkOS sign-in page.
 *  2. A request carrying a valid `uniqus-guest` cookie is let through
 *     untouched. A just-converted guest still has wos-session, so that case
 *     flows through WorkOS normally.
 *
 * Everything else falls back to the WorkOS middleware exactly as before.
 */
export default async function middleware(
  req: NextRequest,
  event: NextFetchEvent,
) {
  const { pathname } = req.nextUrl;
  if (pathname === "/api/guest" || pathname.startsWith("/api/guest/")) {
    return NextResponse.next();
  }
  const guest = await unsealGuestCookie(
    req.cookies.get(GUEST_COOKIE_NAME)?.value,
  );
  if (guest) return NextResponse.next();
  return workosMiddleware(req, event);
}

export const config = {
  matcher: ["/((?!guide(?:/|$)|_next/static|_next/image|favicon.ico|.*\\.png$).*)"],
};
