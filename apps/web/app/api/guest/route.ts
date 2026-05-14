import { NextResponse } from "next/server";
import { GUEST_COOKIE_NAME, guestCookieSetOptions } from "@/lib/guest-session";
import { orchestratorFetch } from "@/lib/orchestrator-server";

/**
 * Guest signup. Proxies to the orchestrator (which creates the guest user and
 * returns the sealed cookie value), then sets `uniqus-guest` as a first-party
 * cookie on the web app's own domain. The web app owns this cookie because it
 * — unlike the orchestrator — reliably has WORKOS_COOKIE_DOMAIN configured, so
 * the cookie spans app. + api. the way AuthKit's wos-session does.
 */
export async function POST(req: Request) {
  const upstream = await orchestratorFetch("/api/guest", { method: "POST" });
  const body = (await upstream.json().catch(() => ({}))) as {
    recovery_code?: string;
    display_name?: string;
    sealed_cookie?: string;
    error?: string;
  };
  if (!upstream.ok || !body.sealed_cookie) {
    return NextResponse.json(
      { error: body.error ?? "guest signup failed" },
      { status: upstream.ok ? 502 : upstream.status },
    );
  }
  const res = NextResponse.json({
    recovery_code: body.recovery_code,
    display_name: body.display_name,
  });
  res.cookies.set(GUEST_COOKIE_NAME, body.sealed_cookie, guestCookieSetOptions(req));
  return res;
}
