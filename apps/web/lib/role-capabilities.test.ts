import { describe, expect, it } from "vitest";
import { roleAtLeast, type Role } from "@gate15/api-types";

describe("workspace capability role matrix", () => {
  const cases: Array<{
    role: Role | null;
    edit: boolean;
    admin: boolean;
    owner: boolean;
  }> = [
    { role: null, edit: false, admin: false, owner: false },
    { role: "viewer", edit: false, admin: false, owner: false },
    { role: "editor", edit: true, admin: false, owner: false },
    { role: "admin", edit: true, admin: true, owner: false },
    { role: "owner", edit: true, admin: true, owner: true },
  ];

  it.each(cases)("maps $role to the expected workspace capabilities", ({ role, edit, admin, owner }) => {
    expect(roleAtLeast(role, "editor")).toBe(edit);
    expect(roleAtLeast(role, "admin")).toBe(admin);
    expect(roleAtLeast(role, "owner")).toBe(owner);
  });
});
