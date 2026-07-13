import { describe, it, expect } from "vitest";
import { roleAtLeast, ROLE_RANK, type Role } from "@gate15/api-types";

/**
 * Locks the role-hierarchy invariant the collab routes rely on to prevent the
 * privilege escalation the adversarial review caught: an admin must never be
 * able to grant (or invite at) the `owner` role. The route guard is
 * `roleAtLeast(callerRole, requestedRole)`, so this test guards its semantics.
 */
const ALL: Role[] = ["owner", "admin", "editor", "viewer"];

describe("RBAC role hierarchy (privilege-escalation guard)", () => {
  it("ranks owner > admin > editor > viewer", () => {
    expect(ROLE_RANK.owner).toBeGreaterThan(ROLE_RANK.admin);
    expect(ROLE_RANK.admin).toBeGreaterThan(ROLE_RANK.editor);
    expect(ROLE_RANK.editor).toBeGreaterThan(ROLE_RANK.viewer);
  });

  it("an admin cannot grant owner (the escalation the review caught)", () => {
    expect(roleAtLeast("admin", "owner")).toBe(false);
  });

  it("an admin can grant admin/editor/viewer", () => {
    expect(roleAtLeast("admin", "admin")).toBe(true);
    expect(roleAtLeast("admin", "editor")).toBe(true);
    expect(roleAtLeast("admin", "viewer")).toBe(true);
  });

  it("an owner can grant any role", () => {
    for (const r of ALL) expect(roleAtLeast("owner", r)).toBe(true);
  });

  it("an editor cannot grant admin or owner", () => {
    expect(roleAtLeast("editor", "admin")).toBe(false);
    expect(roleAtLeast("editor", "owner")).toBe(false);
  });

  it("a missing role grants nothing", () => {
    expect(roleAtLeast(null, "viewer")).toBe(false);
    expect(roleAtLeast(undefined, "viewer")).toBe(false);
  });
});
