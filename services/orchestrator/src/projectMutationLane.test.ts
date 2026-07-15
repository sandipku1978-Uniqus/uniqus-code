import { describe, expect, it } from "vitest";
import { ProjectMutationLanes } from "./projectMutationLane.js";

describe("ProjectMutationLanes", () => {
  it("serializes different sessions that share a project", () => {
    const lanes = new ProjectMutationLanes();
    const first = lanes.tryAcquire("project-a", "session-a");
    expect(first).not.toBeNull();
    expect(lanes.tryAcquire("project-a", "session-b")).toBeNull();
    expect(lanes.tryAcquire("project-b", "session-c")).not.toBeNull();

    first!.release();
    expect(lanes.tryAcquire("project-a", "session-b")).not.toBeNull();
  });

  it("makes release idempotent", () => {
    const lanes = new ProjectMutationLanes();
    const lease = lanes.tryAcquire("project-a", "session-a")!;
    lease.release();
    lease.release();
    expect(lanes.owner("project-a")).toBeNull();
  });
});
