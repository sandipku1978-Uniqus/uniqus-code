import type { IncomingMessage, ServerResponse } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";

const memberMocks = vi.hoisted(() => ({
  getProjectRole: vi.fn(),
  getDirectProjectMemberRole: vi.fn(),
  countDirectProjectOwners: vi.fn(),
  setProjectMemberRole: vi.fn(),
  removeProjectMember: vi.fn(),
}));
const taskMocks = vi.hoisted(() => ({
  listAgentTasks: vi.fn(),
  createAgentTask: vi.fn(),
  getAgentTask: vi.fn(),
  updateAgentTask: vi.fn(),
}));

vi.mock("./db/members.js", () => memberMocks);
vi.mock("./db/audit.js", () => ({ audit: vi.fn() }));
vi.mock("./db/agentTasks.js", () => taskMocks);

import { handleCollabRoute } from "./collabRoutes.js";

function request(method: string, url = "/api/projects/aaaaaaaa/members/bbbbbbbb"): IncomingMessage {
  return { method, url } as IncomingMessage;
}

describe("project owner membership guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memberMocks.getDirectProjectMemberRole.mockResolvedValue("owner");
    memberMocks.countDirectProjectOwners.mockResolvedValue(1);
  });

  it("does not let an admin demote an owner", async () => {
    memberMocks.getProjectRole.mockResolvedValue("admin");
    const json = vi.fn();
    await handleCollabRoute(request("PATCH"), {} as ServerResponse, { id: "admin" }, {
      json,
      readJsonBody: async () => ({ role: "viewer" }),
    });
    expect(json).toHaveBeenCalledWith(expect.anything(), 403, {
      error: "only an owner can change an owner's role",
    });
    expect(memberMocks.setProjectMemberRole).not.toHaveBeenCalled();
  });

  it("does not let an admin remove an owner", async () => {
    memberMocks.getProjectRole.mockResolvedValue("admin");
    const json = vi.fn();
    await handleCollabRoute(request("DELETE"), {} as ServerResponse, { id: "admin" }, {
      json,
      readJsonBody: async () => ({}),
    });
    expect(json).toHaveBeenCalledWith(expect.anything(), 403, {
      error: "only an owner can remove an owner",
    });
    expect(memberMocks.removeProjectMember).not.toHaveBeenCalled();
  });

  it("preserves at least one direct owner", async () => {
    memberMocks.getProjectRole.mockResolvedValue("owner");
    const json = vi.fn();
    await handleCollabRoute(request("DELETE"), {} as ServerResponse, { id: "owner-2" }, {
      json,
      readJsonBody: async () => ({}),
    });
    expect(json).toHaveBeenCalledWith(expect.anything(), 409, {
      error: "cannot remove the project's last owner",
    });
    expect(memberMocks.removeProjectMember).not.toHaveBeenCalled();
  });
});

describe("collaboration payload limits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memberMocks.getProjectRole.mockResolvedValue("editor");
    taskMocks.listAgentTasks.mockResolvedValue([]);
  });

  it("reports whether the durable-task worker can accept work", async () => {
    const json = vi.fn();
    await handleCollabRoute(
      request("GET", "/api/projects/aaaaaaaa/tasks"),
      {} as ServerResponse,
      { id: "editor" },
      { json, readJsonBody: async () => ({}), taskWorkerEnabled: false },
    );
    expect(json).toHaveBeenCalledWith(expect.anything(), 200, {
      tasks: [],
      task_worker_enabled: false,
    });
  });

  it("does not persist a task when this instance has no worker", async () => {
    const json = vi.fn();
    await handleCollabRoute(
      request("POST", "/api/projects/aaaaaaaa/tasks"),
      {} as ServerResponse,
      { id: "editor" },
      {
        json,
        readJsonBody: async () => ({ title: "task", prompt: "do it" }),
        taskWorkerEnabled: false,
      },
    );
    expect(json).toHaveBeenCalledWith(expect.anything(), 503, {
      error: "agent tasks are unavailable until the task worker is enabled",
    });
    expect(taskMocks.createAgentTask).not.toHaveBeenCalled();
  });

  it("rejects oversized comment bodies before persistence", async () => {
    const json = vi.fn();
    await handleCollabRoute(
      request("POST", "/api/projects/aaaaaaaa/comments"),
      {} as ServerResponse,
      { id: "editor" },
      {
        json,
        readJsonBody: async () => ({ body: "x".repeat(20_001) }),
      },
    );
    expect(json).toHaveBeenCalledWith(expect.anything(), 400, {
      error: "body must be 20000 chars or fewer",
    });
  });

  it("rejects oversized durable-task prompts before persistence", async () => {
    const json = vi.fn();
    await handleCollabRoute(
      request("POST", "/api/projects/aaaaaaaa/tasks"),
      {} as ServerResponse,
      { id: "editor" },
      {
        json,
        readJsonBody: async () => ({ title: "task", prompt: "x".repeat(100_001) }),
      },
    );
    expect(json).toHaveBeenCalledWith(expect.anything(), 400, {
      error: "prompt must be 100000 chars or fewer",
    });
  });

  it("rejects oversized smoke-flow arrays before persistence", async () => {
    const json = vi.fn();
    await handleCollabRoute(
      request("POST", "/api/projects/aaaaaaaa/flows"),
      {} as ServerResponse,
      { id: "editor" },
      {
        json,
        readJsonBody: async () => ({
          name: "large flow",
          steps: Array.from({ length: 101 }, () => ({ type: "wait", timeout_ms: 1 })),
        }),
      },
    );
    expect(json).toHaveBeenCalledWith(expect.anything(), 400, {
      error: "steps must contain at most 100 entries and 100000 serialized chars",
    });
  });
});
