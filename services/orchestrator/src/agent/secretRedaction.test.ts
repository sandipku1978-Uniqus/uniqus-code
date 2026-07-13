import { describe, expect, it } from "vitest";
import { createSecretRedactor } from "./secretRedaction.js";

describe("project secret redaction", () => {
  it("redacts every occurrence, longest values first, in nested provider content", () => {
    const redactor = createSecretRedactor(["token", "token-long"]);
    const value = redactor.clone({
      content: [
        { type: "text", text: "token-long / token" },
        { type: "tool_result", content: "token-long" },
      ],
    });
    expect(JSON.stringify(value)).not.toContain("token");
    expect(JSON.stringify(value)).toContain("[REDACTED PROJECT SECRET]");
  });

  it("does not mutate the caller's value when cloning", () => {
    const original = { text: "s3cr3t" };
    const copy = createSecretRedactor(["s3cr3t"]).clone(original);
    expect(original.text).toBe("s3cr3t");
    expect(copy.text).toBe("[REDACTED PROJECT SECRET]");
  });
});
