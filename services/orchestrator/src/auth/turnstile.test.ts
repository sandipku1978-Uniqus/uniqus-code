import { afterEach, describe, expect, it, vi } from "vitest";
import { turnstileConfigured, verifyTurnstile } from "./turnstile.js";

// Manage env + fetch by hand (this vitest build doesn't expose vi.unstubAllEnv).
// verifyTurnstile reads process.env at call time, so per-test assignment is enough.
const ORIGINAL_SECRET = process.env.TURNSTILE_SECRET_KEY;
const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.TURNSTILE_SECRET_KEY;
  else process.env.TURNSTILE_SECRET_KEY = ORIGINAL_SECRET;
  globalThis.fetch = ORIGINAL_FETCH;
});

function setSecret(value: string | undefined): void {
  if (value === undefined) delete process.env.TURNSTILE_SECRET_KEY;
  else process.env.TURNSTILE_SECRET_KEY = value;
}

/** Install a fake global fetch and return the spy for call assertions. */
function stubFetch(impl: () => Promise<Response> | Response): ReturnType<typeof vi.fn> {
  const f = vi.fn(impl);
  globalThis.fetch = f as unknown as typeof fetch;
  return f;
}

function siteverifyResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe("turnstile · ship-dark (no secret configured)", () => {
  it("turnstileConfigured() is false when TURNSTILE_SECRET_KEY is unset", () => {
    setSecret(undefined);
    expect(turnstileConfigured()).toBe(false);
  });

  it("verifyTurnstile short-circuits to not-configured WITHOUT calling fetch", async () => {
    setSecret(undefined);
    const f = stubFetch(() => siteverifyResponse({ success: true }));
    const r = await verifyTurnstile("any-token");
    expect(r).toEqual({ configured: false, ok: false, reason: "not configured" });
    expect(f).not.toHaveBeenCalled();
  });
});

describe("turnstile · configured (fails closed)", () => {
  it("rejects a missing token without hitting the network", async () => {
    setSecret("secret");
    const f = stubFetch(() => siteverifyResponse({ success: true }));
    const r = await verifyTurnstile("   ");
    expect(r.configured).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("missing token");
    expect(f).not.toHaveBeenCalled();
  });

  it("accepts a token Cloudflare confirms (success: true)", async () => {
    setSecret("secret");
    stubFetch(() => siteverifyResponse({ success: true }));
    const r = await verifyTurnstile("good-token");
    expect(r).toEqual({ configured: true, ok: true });
  });

  it("rejects a token Cloudflare denies, surfacing its error-codes for logs", async () => {
    setSecret("secret");
    stubFetch(() =>
      siteverifyResponse({ success: false, "error-codes": ["invalid-input-response"] }),
    );
    const r = await verifyTurnstile("spent-token");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid-input-response");
  });

  it("fails closed on a non-2xx from siteverify", async () => {
    setSecret("secret");
    stubFetch(() => siteverifyResponse({}, false, 503));
    const r = await verifyTurnstile("token");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("siteverify http 503");
  });

  it("fails closed when siteverify is unreachable (network throws)", async () => {
    setSecret("secret");
    stubFetch(() => {
      throw new Error("ECONNREFUSED");
    });
    const r = await verifyTurnstile("token");
    expect(r.configured).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("ECONNREFUSED");
  });

  it("sends the secret + token as form-encoded siteverify params (no remoteip)", async () => {
    setSecret("my-secret");
    const f = stubFetch(() => siteverifyResponse({ success: true }));
    await verifyTurnstile("tok-123");
    expect(f).toHaveBeenCalledTimes(1);
    const [, init] = f.mock.calls[0] as [string, RequestInit];
    const params = init.body as URLSearchParams;
    expect(params.get("secret")).toBe("my-secret");
    expect(params.get("response")).toBe("tok-123");
    expect(params.get("remoteip")).toBeNull();
  });
});
