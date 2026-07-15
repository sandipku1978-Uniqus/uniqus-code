import { beforeEach, describe, expect, it, vi } from "vitest";

const userDb = vi.hoisted(() => ({
  clearSupabaseToken: vi.fn(),
  getSupabaseLink: vi.fn(),
  getSupabaseTokens: vi.fn(),
  setSupabaseToken: vi.fn(),
  updateSupabaseTokens: vi.fn(),
  getFigmaLink: vi.fn(),
  getFigmaTokens: vi.fn(),
  setFigmaToken: vi.fn(),
  updateFigmaTokens: vi.fn(),
  clearFigmaToken: vi.fn(),
}));

vi.mock("./db/users.js", () => userDb);

import { getSupabaseAccessToken } from "./supabase.js";
import { extractFigmaDesignContext } from "./figma.js";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SUPABASE_OAUTH_CLIENT_ID = "supabase-client";
  process.env.SUPABASE_OAUTH_CLIENT_SECRET = "supabase-secret";
  process.env.FIGMA_CLIENT_ID = "figma-client";
  process.env.FIGMA_CLIENT_SECRET = "figma-secret";
});

describe("OAuth refresh concurrency", () => {
  it("single-flights Supabase refreshes in-process", async () => {
    const expired = {
      access_token: "old-access",
      refresh_token: "old-refresh",
      expires_at: 0,
      generation: "11111111-1111-4111-8111-111111111111",
    };
    userDb.getSupabaseTokens.mockResolvedValue(expired);
    userDb.updateSupabaseTokens.mockResolvedValue(true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }),
    }));

    await expect(Promise.all([
      getSupabaseAccessToken("user-1"),
      getSupabaseAccessToken("user-1"),
    ])).resolves.toEqual(["new-access", "new-access"]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(userDb.updateSupabaseTokens).toHaveBeenCalledTimes(1);
    expect(userDb.updateSupabaseTokens).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ refresh_token: "new-refresh" }),
      expired.generation,
    );
  });

  it("returns the database winner when a Supabase CAS loses", async () => {
    const expired = {
      access_token: "old-access",
      refresh_token: "old-refresh",
      expires_at: 0,
      generation: "11111111-1111-4111-8111-111111111111",
    };
    const winner = {
      access_token: "winner-access",
      refresh_token: "winner-refresh",
      expires_at: Date.now() + 3600_000,
      generation: "22222222-2222-4222-8222-222222222222",
    };
    userDb.getSupabaseTokens
      .mockResolvedValueOnce(expired)
      .mockResolvedValueOnce(expired)
      .mockResolvedValueOnce(winner);
    userDb.updateSupabaseTokens.mockResolvedValue(false);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "loser-access", refresh_token: "loser-refresh", expires_in: 3600 }),
    }));

    await expect(getSupabaseAccessToken("user-1")).resolves.toBe("winner-access");
  });

  it("never clears Figma credentials from a stale invalid-grant snapshot", async () => {
    const expired = {
      access_token: "old-access",
      refresh_token: "old-refresh",
      expires_at: 0,
      generation: "11111111-1111-4111-8111-111111111111",
    };
    const winner = {
      access_token: "winner-access",
      refresh_token: "winner-refresh",
      expires_at: Date.now() + 3600_000,
      generation: "22222222-2222-4222-8222-222222222222",
    };
    userDb.getFigmaTokens
      .mockResolvedValueOnce(expired)
      .mockResolvedValueOnce(expired)
      .mockResolvedValueOnce(winner);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 400 })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ meta: { styles: [{ node_id: "1:2", style_type: "FILL", name: "Brand" }] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ nodes: { "1:2": { document: { fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }] } } } }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(extractFigmaDesignContext("user-1", "file-key-123"))
      .resolves.toMatchObject({ styleCount: 1 });
    expect(userDb.clearFigmaToken).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[1]?.[1]).toEqual({
      headers: { Authorization: "Bearer winner-access" },
    });
  });
});
