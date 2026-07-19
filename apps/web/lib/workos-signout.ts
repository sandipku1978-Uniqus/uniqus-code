import { NextResponse } from "next/server";

type WorkosSameSite = "lax" | "strict" | "none";

function workosSameSite(): WorkosSameSite {
  const value = process.env.WORKOS_COOKIE_SAMESITE?.toLowerCase();
  return value === "strict" || value === "none" ? value : "lax";
}

/** Redirect through WorkOS while expiring the exact cookie scope used at sign-in. */
export function workosSignOutResponse(
  req: Request,
  destination: string,
): NextResponse {
  const sameSite = workosSameSite();
  const response = NextResponse.redirect(destination, 303);
  response.cookies.set(process.env.WORKOS_COOKIE_NAME || "wos-session", "", {
    expires: new Date(0),
    maxAge: 0,
    path: "/",
    domain: process.env.WORKOS_COOKIE_DOMAIN || undefined,
    httpOnly: true,
    sameSite,
    secure: sameSite === "none" || new URL(req.url).protocol === "https:",
  });
  return response;
}
