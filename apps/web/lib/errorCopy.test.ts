import { describe, expect, it } from "vitest";
import { errorCopyFor } from "./errorCopy";

describe("billing error copy", () => {
  it("turns exhausted credits into an upgrade action instead of a retry", () => {
    const copy = errorCopyFor("credits_exhausted", "raw billing message");
    expect(copy.title).toBe("Build credits are exhausted");
    expect(copy.action).toEqual({
      label: "Manage plan & credits",
      href: "/settings#billing-settings",
    });
    expect(copy.hideRetry).toBe(true);
    expect(copy.hideSimplify).toBe(true);
  });

  it("routes missing BYOK credentials to provider-key settings", () => {
    const copy = errorCopyFor("byok_required", "Add your anthropic API key");
    expect(copy.action?.href).toBe("/settings#provider-keys-settings");
    expect(copy.title).toBe("Add the required provider keys");
  });

  it("keeps a retry for a transient billing verification failure", () => {
    const copy = errorCopyFor("billing_unavailable", "database timed out");
    expect(copy.hideRetry).not.toBe(true);
    expect(copy.hideSimplify).toBe(true);
  });
});
