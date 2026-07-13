import { describe, expect, it } from "vitest";
import { createRunReconnectCapability, mayReconnectToRun } from "./runAuthorization.js";

describe("live run authorization", () => {
  it("requires both the initiating user and the random reconnect capability", () => {
    const capability = createRunReconnectCapability();
    const base = {
      initiatorUserId: "owner",
      reconnectCapability: capability,
    };
    expect(mayReconnectToRun({ ...base, actorUserId: "owner", suppliedCapability: capability })).toBe(true);
    expect(mayReconnectToRun({ ...base, actorUserId: "editor", suppliedCapability: capability })).toBe(false);
    expect(mayReconnectToRun({ ...base, actorUserId: "owner", suppliedCapability: "wrong" })).toBe(false);
  });
});
