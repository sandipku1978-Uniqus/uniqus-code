import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("user-facing source encoding", () => {
  it("keeps the context-compaction em dash as real UTF-8", () => {
    const source = readFileSync(new URL("./ws-client.ts", import.meta.url), "utf8");
    expect(source).toContain(
      "Context is already compact — there are no older turns to summarize yet.",
    );
    expect(source).not.toContain("Context is already compact \u00e2\u20ac\u201d");
  });
});
