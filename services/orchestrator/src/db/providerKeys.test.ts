import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => ({ value: [] as Array<{ provider: string; encrypted_value: string }> }));

vi.mock("./client.js", () => ({
  db: () => ({
    from: () => ({
      select: () => ({
        eq: async () => ({ data: rows.value, error: null }),
      }),
    }),
  }),
}));

import { resolveProviderKeysForUserWithSources } from "./providerKeys.js";

describe("account provider-key isolation", () => {
  beforeEach(() => {
    rows.value = [];
    vi.stubEnv("OAUTH_TOKEN_ENCRYPTION_KEY", "11".repeat(32));
    vi.stubEnv("ANTHROPIC_API_KEY", "platform-anthropic");
    vi.stubEnv("GOOGLE_API_KEY", "platform-google");
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("does not let one unreadable account key break unrelated providers", async () => {
    rows.value = [{ provider: "google", encrypted_value: "not-an-envelope" }];

    const resolved = await resolveProviderKeysForUserWithSources("user-1", "account-first");

    expect(resolved.keys.anthropic).toBe("platform-anthropic");
    expect(resolved.sources.anthropic).toBe("platform");
    expect(resolved.keys.google).toBeUndefined();
    expect(resolved.sources.google).toBe("missing");
  });

  it("never falls back to a platform key for the unreadable provider", async () => {
    rows.value = [{ provider: "google", encrypted_value: "not-an-envelope" }];

    const resolved = await resolveProviderKeysForUserWithSources("user-1", "account-only");

    expect(resolved.keys.google).toBeUndefined();
    expect(resolved.sources.google).toBe("missing");
  });
});
