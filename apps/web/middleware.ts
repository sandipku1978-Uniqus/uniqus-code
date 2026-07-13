import {
  authkit,
  authkitMiddleware,
  handleAuthkitHeaders,
} from "@workos-inc/authkit-nextjs";
import {
  NextResponse,
  type NextRequest,
  type NextFetchEvent,
} from "next/server";
import { GUEST_COOKIE_NAME, unsealGuestCookie } from "@/lib/guest-session";

/**
 * Public marketing + resource pages (app/(marketing)/*, which now includes the
 * user guide). These must be reachable without a WorkOS session or guest
 * cookie, so they're allow-listed here. Patterns are matched with
 * path-to-regexp v6 (anchored, exact), so nested blog posts need the `:path*`
 * wildcard. Keep this in sync with the footer/nav links in
 * components/SiteFooter.tsx + MarketingNav.tsx.
 */
const PUBLIC_PATHS = [
  "/",
  "/login",
  "/callback",
  "/docs",
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
 *  2. A request carrying a valid `gate15-guest` cookie skips the
 *     middlewareAuth sign-in redirect, but still runs AuthKit's session step
 *     (`authkit()`): withAuth() THROWS on any route the AuthKit middleware
 *     didn't stamp with the `x-workos-middleware` request header, and /,
 *     /login, and the marketing layout all call it. Running the session step
 *     also resolves the wos-session when BOTH cookies are present (the
 *     ?convert=failed retry state), so those pages see the real user.
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
  if (guest) {
    // Same as authkitMiddleware minus the unauthenticated-paths redirect:
    // guests must reach /projects etc. without being bounced to sign-in.
    const { headers } = await authkit(req);
    return handleAuthkitHeaders(req, headers);
  }
  return workosMiddleware(req, event);
}

export const config = {
  // The guide used to be excluded here (it was a standalone static page). It now
  // lives in the `(marketing)` group, whose layout calls withAuth() — which
  // throws unless the AuthKit middleware has stamped the request — so /docs
  // must run through middleware like every other marketing page. It stays
  // publicly reachable via PUBLIC_PATHS above.
  //
  // Static files under /public must be excluded: they carry no session, and an
  // unauthenticated request for one would otherwise be 307'd to WorkOS sign-in
  // and never served. This previously excluded ONLY `.png`, which quietly held
  // because the sole asset was a .png logo — every other static type (the .webp
  // backdrops, the .svg mark/favicon, the .woff icon font) redirected instead of
  // loading. Exclude the asset directories and the extensions, not one format.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|brand/|fonts/|.*\\.(?:png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|txt|xml|webmanifest)$).*)",
  ],
};
