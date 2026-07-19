import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  GUEST_COOKIE_NAME,
  LEGACY_GUEST_COOKIE_NAME,
  unsealGuestCookie,
  guestCookieClearOptions,
} from "@/lib/guest-session";
import { orchestratorFetch } from "@/lib/orchestrator-server";
import {
  billingPostAuthHref,
  billingSettingsHref,
  parseBillingSelection,
} from "@/lib/billing-display";

/**
 * Guest → WorkOS conversion. The /projects page redirects here when a request
 * carries both a wos-session and a gate15-guest cookie (a guest who just
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
  const requestUrl = new URL(req.url);
  const billingSelection = parseBillingSelection(
    requestUrl.searchParams.get("billing_plan"),
    requestUrl.searchParams.get("max_monthly_usd"),
  );
  const returnToBilling = requestUrl.searchParams.get("billing_settings") === "1";
  const store = await cookies();
  const guest = await unsealGuestCookie(
    store.get(GUEST_COOKIE_NAME)?.value ?? store.get(LEGACY_GUEST_COOKIE_NAME)?.value,
  );
  const hasWorkos = !!store.get("wos-session");

  if (!guest || !hasWorkos) {
    // Nothing to convert — just send the visitor to their dashboard.
    return NextResponse.redirect(
      new URL(
        billingSelection || returnToBilling ? billingSettingsHref(billingSelection) : "/projects",
        req.url,
      ),
    );
  }

  let merged = false;
  try {
    const res = await orchestratorFetch("/api/guest/merge", { method: "POST" });
    const result = await res.json().catch(() => null) as { completed?: boolean } | null;
    merged = res.ok && result?.completed === true;
    if (!res.ok) {
      console.error(
        `guest merge failed: ${res.status}`,
      );
    } else if (!merged) {
      console.error("guest merge did not complete");
    }
  } catch (err) {
    console.error("guest merge request threw:", err);
  }

  if (!merged) {
    // Leave the guest cookie in place so the user can retry. The ?convert=failed
    // param tells the page not to auto-bounce back here, so there's no loop.
    return NextResponse.redirect(
      new URL(billingPostAuthHref(billingSelection, true, returnToBilling), req.url),
    );
  }

  const redirect = NextResponse.redirect(
    new URL(
      billingSelection || returnToBilling ? billingSettingsHref(billingSelection) : "/projects",
      req.url,
    ),
  );
  const clear = guestCookieClearOptions(req);
  redirect.cookies.set(GUEST_COOKIE_NAME, "", clear);
  redirect.cookies.set(LEGACY_GUEST_COOKIE_NAME, "", clear);
  return redirect;
}
