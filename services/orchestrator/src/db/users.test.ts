import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: vi.fn(),
  calls: [] as string[],
  projectsError: null as { message: string } | null,
  userError: null as { message: string } | null,
  userData: [{ id: "user_1" }] as Array<{ id: string }>,
}));

vi.mock("./client.js", () => ({ db: mocks.db }));

import { deleteUser } from "./users.js";

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.projectsError = null;
  mocks.userError = null;
  mocks.userData = [{ id: "user_1" }];
  mocks.db.mockReset();
  mocks.db.mockReturnValue({
    from(table: string) {
      if (table === "projects") {
        const query = {
          delete() {
            mocks.calls.push("projects.delete");
            return query;
          },
          eq(column: string, value: string) {
            mocks.calls.push(`projects.eq:${column}:${value}`);
            return query;
          },
          async is(column: string, value: null) {
            mocks.calls.push(`projects.is:${column}:${String(value)}`);
            return { error: mocks.projectsError };
          },
        };
        return query;
      }
      if (table === "users") {
        const query = {
          delete() {
            mocks.calls.push("users.delete");
            return query;
          },
          eq(column: string, value: string) {
            mocks.calls.push(`users.eq:${column}:${value}`);
            return query;
          },
          async select(column: string) {
            mocks.calls.push(`users.select:${column}`);
            return { data: mocks.userData, error: mocks.userError };
          },
        };
        return query;
      }
      throw new Error(`unexpected table ${table}`);
    },
  });
});

describe("deleteUser", () => {
  it("deletes personal projects before the owner row", async () => {
    await deleteUser("user_1", "claim_1");
    expect(mocks.calls).toEqual([
      "projects.delete",
      "projects.eq:owner_id:user_1",
      "projects.is:org_id:null",
      "users.delete",
      "users.eq:id:user_1",
      "users.eq:guest_lifecycle_claim:claim_1",
      "users.select:id",
    ]);
  });

  it("does not attempt the user delete when project cleanup fails", async () => {
    mocks.projectsError = { message: "constraint failure" };
    await expect(deleteUser("user_1", "claim_1")).rejects.toThrow(
      /personal-project cleanup failed/,
    );
    expect(mocks.calls).not.toContain("users.delete");
  });

  it("fails closed when the lifecycle claim no longer owns the user row", async () => {
    mocks.userData = [];
    await expect(deleteUser("user_1", "stale-claim")).rejects.toThrow(
      /guest lifecycle claim was lost/,
    );
  });
});
