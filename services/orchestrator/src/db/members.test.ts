import { describe, expect, it } from "vitest";
import { resolveEffectiveProjectRole } from "./members.js";

describe("organization project ownership", () => {
  it("does not grant an org project's historical creator implicit access", () => {
    expect(resolveEffectiveProjectRole({
      orgId: "org_1",
      ownerId: "creator",
      userId: "creator",
      projectRole: null,
      orgRole: null,
    })).toBeNull();
  });

  it("keeps personal-project owner semantics", () => {
    expect(resolveEffectiveProjectRole({
      orgId: null,
      ownerId: "creator",
      userId: "creator",
      projectRole: null,
      orgRole: null,
    })).toBe("owner");
  });

  it("takes the strongest explicit project or org role", () => {
    expect(resolveEffectiveProjectRole({
      orgId: "org_1",
      ownerId: "creator",
      userId: "member",
      projectRole: "viewer",
      orgRole: "admin",
    })).toBe("admin");
  });
});
