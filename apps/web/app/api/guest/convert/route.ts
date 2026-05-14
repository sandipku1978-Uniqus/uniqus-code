import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  GUEST_COOKIE_NAME,
  unsealGuestCookie,
  guestCookieClearOptions,
} from "@/lib/guest-session";
import { orchestratorFetch } from "@/lib/orchestrator-server";

/**
 * Guest → WorkOS conversion. The /projects page redirects here when a request
 * carries both a wos-session and a uniqus-guest cookie (a guest who just
 * signed in with Google). The merge runs in a Route Handler — not the page —
 * because only Route Handlers can write cookies, and we must clear the guest
 * cookie afterwards.
 *
 * The orchestrator's /api/guest/merge authenticates the WorkOS side via the
 * forwarded wos-session cookie and reads the guest cookie for the guest side,
 * reassigns the guest's projects, and marks the guest row converted. It is
 * idempotent, so a stray or repeated hit here is harmless.
 */
export async function GET(req: Request) {
  const store = await cookies();
  const guest = await unsealGuestCookie(store.get(GUEST_COOKIE_NAME)?.value);
  const hasWorkos = !!store.get("wos-session");

  if (!guest || !hasWorkos) {
    // Nothing to convert — just send the visitor to their dashboard.
    return NextResponse.redirect(new URL("/projects", req.url));
  }

  let merged = false;
  try {
    const res = await orchestratorFetch("/api/guest/merge", { method: "POST" });
    merged = res.ok;
    if (!res.ok) {
      console.error(
        `guest merge failed: ${res.status} ${await res.text().catch(() => "")}`,
      );
    }
  } catch (err) {
    console.error("guest merge request threw:", err);
  }

  if (!merged) {
    // Leave the guest cookie in place so the user can retry. The ?convert=failed
    // param tells the page not to auto-bounce back here, so there's no loop.
    return NextResponse.redirect(new URL("/projects?convert=failed", req.url));
  }

  const redirect = NextResponse.redirect(new URL("/projects", req.url));
  redirect.cookies.set(GUEST_COOKIE_NAME, "", guestCookieClearOptions());
  return redirect;
}
