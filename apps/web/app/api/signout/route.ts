import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  // AuthKit sets `wos-session` with Domain = WORKOS_COOKIE_DOMAIN wherever the
  // cookie has to span subdomains (so it reaches the orchestrator). A bare
  // delete("wos-session") emits a host-only Set-Cookie that doesn't match the
  // domain-scoped cookie, so the browser keeps it and the user stays signed
  // in. Clear it with the same Domain + Path AuthKit used.
  const cookieStore = await cookies();
  cookieStore.set("wos-session", "", {
    maxAge: 0,
    path: "/",
    domain: process.env.WORKOS_COOKIE_DOMAIN || undefined,
  });
  return NextResponse.redirect(new URL("/login", req.url));
}
