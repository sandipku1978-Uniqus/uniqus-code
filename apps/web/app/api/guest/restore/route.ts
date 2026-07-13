import { NextResponse } from "next/server";
import { GUEST_COOKIE_NAME, guestCookieSetOptions } from "@/lib/guest-session";
import { orchestratorFetch } from "@/lib/orchestrator-server";

/**
 * Guest restore. Same shape as /api/guest signup, but re-attaches to an
 * existing guest account via its recovery code. Sets the first-party
 * `gate15-guest` cookie from the sealed value the orchestrator returns.
 */
export async function POST(req: Request) {
  const incoming = (await req.json().catch(() => ({}))) as {
    recovery_code?: unknown;
    captcha_token?: unknown;
  };
  const recoveryCode =
    typeof incoming.recovery_code === "string" ? incoming.recovery_code : "";
  // Relayed to the orchestrator, which verifies it (see the signup route).
  const captchaToken =
    typeof incoming.captcha_token === "string" ? incoming.captcha_token : "";

  const upstream = await orchestratorFetch("/api/guest/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recovery_code: recoveryCode, captcha_token: captchaToken }),
  });
  const body = (await upstream.json().catch(() => ({}))) as {
    display_name?: string;
    sealed_cookie?: string;
    error?: string;
  };
  if (!upstream.ok || !body.sealed_cookie) {
    return NextResponse.json(
      { error: body.error ?? "recovery code not recognised" },
      { status: upstream.ok ? 502 : upstream.status },
    );
  }
  const res = NextResponse.json({ display_name: body.display_name });
  res.cookies.set(GUEST_COOKIE_NAME, body.sealed_cookie, guestCookieSetOptions(req));
  return res;
}
