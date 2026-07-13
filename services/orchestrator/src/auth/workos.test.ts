import { describe, expect, it, vi } from "vitest";
import {
  hasActiveWorkosSession,
  hasExpectedWorkosClaims,
  WorkosSessionActivityCache,
} from "./workos.js";

const now = Date.parse("2026-07-12T12:00:00Z");

describe("WorkOS active-session validation", () => {
  it("accepts only the matching active, unexpired session", () => {
    expect(hasActiveWorkosSession("session_1", "user_1", [{
      id: "session_1",
      userId: "user_1",
      status: "active",
      expiresAt: "2026-07-12T13:00:00Z",
      endedAt: null,
    }], now)).toBe(true);
  });

  it.each(["expired", "revoked"] as const)("rejects a %s session", (status) => {
    expect(hasActiveWorkosSession("session_1", "user_1", [{
      id: "session_1",
      userId: "user_1",
      status,
      expiresAt: "2026-07-12T13:00:00Z",
      endedAt: status === "revoked" ? "2026-07-12T11:00:00Z" : null,
    }], now)).toBe(false);
  });

  it("rejects an active session whose expiry has passed", () => {
    expect(hasActiveWorkosSession("session_1", "user_1", [{
      id: "session_1",
      userId: "user_1",
      status: "active",
      expiresAt: "2026-07-12T11:59:59Z",
      endedAt: null,
    }], now)).toBe(false);
  });

  it("caches a positive status briefly without caching a negative result", async () => {
    let clock = now;
    const cache = new WorkosSessionActivityCache(30_000, () => clock);
    const activeLoader = vi.fn(async () => [{
      id: "session_1",
      userId: "user_1",
      status: "active" as const,
      expiresAt: "2026-07-12T13:00:00Z",
      endedAt: null,
    }]);

    await expect(Promise.all([
      cache.hasActive("session_1", "user_1", activeLoader),
      cache.hasActive("session_1", "user_1", activeLoader),
    ])).resolves.toEqual([true, true]);
    await expect(cache.hasActive("session_1", "user_1", activeLoader)).resolves.toBe(true);
    expect(activeLoader).toHaveBeenCalledTimes(1);

    clock += 30_001;
    await expect(cache.hasActive("session_1", "user_1", activeLoader)).resolves.toBe(true);
    expect(activeLoader).toHaveBeenCalledTimes(2);

    const missingLoader = vi.fn(async () => []);
    await expect(cache.hasActive("missing", "user_1", missingLoader)).resolves.toBe(false);
    await expect(cache.hasActive("missing", "user_1", missingLoader)).resolves.toBe(false);
    expect(missingLoader).toHaveBeenCalledTimes(2);
  });
});

describe("WorkOS access-token claims", () => {
  const token = (claims: Record<string, unknown>): string =>
    `${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
  const expected = {
    clientId: "client_1",
    issuer: "https://api.workos.com",
    userId: "user_1",
    sessionId: "session_1",
  };

  it("accepts the documented audience variant when client_id is absent", () => {
    expect(hasExpectedWorkosClaims(token({
      iss: "https://api.workos.com/",
      aud: "client_1",
      sub: "user_1",
      sid: "session_1",
      exp: now / 1000 + 60,
    }), expected, now)).toBe(true);
  });

  it("binds present application claims plus issuer, user, session, and expiry", () => {
    expect(hasExpectedWorkosClaims(token({
      iss: "https://api.workos.com/",
      client_id: "client_1",
      sub: "user_1",
      sid: "session_1",
      exp: now / 1000 + 60,
    }), expected, now)).toBe(true);
    expect(hasExpectedWorkosClaims(token({
      iss: "https://attacker.example",
      client_id: "client_1",
      sub: "user_1",
      sid: "session_1",
      exp: now / 1000 + 60,
    }), expected, now)).toBe(false);
    expect(hasExpectedWorkosClaims(token({
      iss: "https://api.workos.com",
      client_id: "client_other",
      sub: "user_1",
      sid: "session_1",
      exp: now / 1000 + 60,
    }), expected, now)).toBe(false);
    expect(hasExpectedWorkosClaims(token({
      iss: "https://api.workos.com",
      aud: ["client_other"],
      sub: "user_1",
      sid: "session_1",
      exp: now / 1000 + 60,
    }), expected, now)).toBe(false);
  });
});
