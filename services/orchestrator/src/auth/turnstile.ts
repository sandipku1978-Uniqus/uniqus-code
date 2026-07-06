/**
 * Cloudflare Turnstile verification for the anonymous, abuse-prone guest
 * endpoints (signup + restore).
 *
 * Ships DARK: when TURNSTILE_SECRET_KEY is unset, `turnstileConfigured()` is
 * false and callers skip the check entirely — preserving the pre-CAPTCHA
 * behavior for local dev and un-provisioned deploys. Once the secret is set the
 * check is enforced and FAILS CLOSED: a missing/invalid token, a non-2xx from
 * Cloudflare, or an unreachable/slow siteverify all deny the request.
 *
 * Verified HERE, at the orchestrator — not in the web app's route handler —
 * because `api.…/api/guest` is directly reachable and a crawler can bypass the
 * web relay entirely. The web route is not a trust boundary; this is. The token
 * is minted by the Turnstile widget in the visitor's browser and relayed
 * browser → web route → orchestrator in the request body (`captcha_token`).
 *
 * `remoteip` is deliberately NOT sent: the token is minted at the browser's IP,
 * but the orchestrator only ever sees the web app's egress IP (and it does not
 * trust X-Forwarded-For — see clientIp in server.ts). Passing our IP would make
 * Turnstile's optional remoteip check mismatch and falsely reject. The token +
 * secret + sitekey binding is the real check.
 */

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
// A hung siteverify must not hang guest signup. On timeout we fail closed.
const VERIFY_TIMEOUT_MS = 5000;

export interface TurnstileResult {
  /** Whether TURNSTILE_SECRET_KEY is set. When false, callers skip the check. */
  configured: boolean;
  /** True only when a token was present AND Cloudflare confirmed it. */
  ok: boolean;
  /** Short reason for server logs when ok is false — never shown to end users. */
  reason?: string;
}

/** True once TURNSTILE_SECRET_KEY is provisioned; gates enforcement (ship dark). */
export function turnstileConfigured(): boolean {
  return !!process.env.TURNSTILE_SECRET_KEY;
}

/**
 * Verify a Turnstile token against Cloudflare's siteverify API. Callers should
 * only invoke this when `turnstileConfigured()` — but it's safe either way: an
 * unconfigured call returns `{ configured: false, ok: false }`.
 */
export async function verifyTurnstile(
  token: string | undefined | null,
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { configured: false, ok: false, reason: "not configured" };
  const response = (token ?? "").trim();
  if (!response) return { configured: true, ok: false, reason: "missing token" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { configured: true, ok: false, reason: `siteverify http ${res.status}` };
    }
    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      "error-codes"?: string[];
    };
    if (data.success) return { configured: true, ok: true };
    return {
      configured: true,
      ok: false,
      reason: (data["error-codes"] ?? ["verify failed"]).join(","),
    };
  } catch (err) {
    // Network error, timeout, or abort → fail closed (configured, couldn't verify).
    return {
      configured: true,
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}
