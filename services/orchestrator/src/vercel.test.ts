import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRecord } from "./db/users.js";

const userDb = vi.hoisted(() => ({
  clearVercelToken: vi.fn(),
  getVercelLink: vi.fn(),
  getVercelToken: vi.fn(),
  setVercelToken: vi.fn(),
}));

vi.mock("./db/users.js", () => userDb);

import { deleteVercelProject } from "./vercel.js";

const user: UserRecord = {
  id: "user-1",
  workos_id: "workos-1",
  email: "owner@example.com",
  display_name: "Owner",
  account_type: "standard",
  converted_at: null,
  guest_lifecycle_claim: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  userDb.getVercelToken.mockResolvedValue("secret-token");
  userDb.getVercelLink.mockResolvedValue({
    user_id: "vercel-user-1",
    user_login: "owner",
    team_id: "team-1",
    connected_at: "2026-07-14T00:00:00.000Z",
  });
});

describe("deleteVercelProject", () => {
  it("requires a connected Vercel account before deleting", async () => {
    userDb.getVercelToken.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      deleteVercelProject(user, { id: "prj_remote", teamId: "team-1" }),
    ).rejects.toThrow("Reconnect Vercel");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses to delete through a different Vercel team", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      deleteVercelProject(user, { id: "prj_remote", teamId: "team-2" }),
    ).rejects.toThrow("account or team that owns");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("deletes the immutable remote project id in its recorded team scope", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);

    await deleteVercelProject(user, { id: "prj_remote/with slash", teamId: "team-1" });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.vercel.com/v9/projects/prj_remote%2Fwith%20slash?teamId=team-1",
      expect.objectContaining({
        method: "DELETE",
        headers: { Authorization: "Bearer secret-token" },
      }),
    );
  });

  it("treats an already-missing Vercel project as deleted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    await expect(
      deleteVercelProject(user, { id: "prj_remote", teamId: "team-1" }),
    ).resolves.toBeUndefined();
  });

  it("fails closed when Vercel rejects the deletion", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    await expect(
      deleteVercelProject(user, { id: "prj_remote", teamId: "team-1" }),
    ).rejects.toThrow("HTTP 503");
  });
});
