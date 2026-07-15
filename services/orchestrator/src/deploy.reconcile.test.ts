import { beforeEach, describe, expect, it, vi } from "vitest";

const deploymentDb = vi.hoisted(() => ({
  attachVercelDeployment: vi.fn(),
  insertDeploymentIntent: vi.fn(),
  updateDeploymentState: vi.fn(),
}));
vi.mock("./db/deployments.js", () => deploymentDb);

import { reconcileCreatingDeployment } from "./deploy.js";

beforeEach(() => vi.clearAllMocks());

describe("durable Vercel create reconciliation", () => {
  it("filters by the persisted operation key and attaches the one exact match", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        deployments: [{
          uid: "dpl_remote",
          url: "preview.example.vercel.app",
          readyState: "BUILDING",
          meta: { gate15OperationKey: "11111111-1111-4111-8111-111111111111" },
        }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(reconcileCreatingDeployment(
      { vercelToken: "token", vercelTeamId: "team-1" },
      { id: "local-1", operation_key: "11111111-1111-4111-8111-111111111111" },
    )).resolves.toEqual({
      id: "dpl_remote",
      url: "preview.example.vercel.app",
      state: "BUILDING",
    });
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("meta-gate15OperationKey=11111111-1111-4111-8111-111111111111");
    expect(url).toContain("teamId=team-1");
    expect(deploymentDb.attachVercelDeployment).toHaveBeenCalledWith("local-1", {
      vercel_deployment_id: "dpl_remote",
      vercel_url: "preview.example.vercel.app",
      state: "BUILDING",
    });
  });

  it("does not attach an unrelated metadata result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ deployments: [{ uid: "other", meta: { gate15OperationKey: "other" } }] }),
    }));
    await expect(reconcileCreatingDeployment(
      { vercelToken: "token", vercelTeamId: null },
      { id: "local-1", operation_key: "expected" },
    )).resolves.toBeNull();
    expect(deploymentDb.attachVercelDeployment).not.toHaveBeenCalled();
  });
});
