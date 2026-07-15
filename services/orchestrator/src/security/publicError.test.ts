import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publicError } from "./publicError.js";

afterEach(() => vi.restoreAllMocks());

describe("publicError", () => {
  it("does not expose or log arbitrary exception text", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const body = publicError(
      "deploy_failed",
      new Error("canary-secret at C:\\Users\\service\\private.env"),
    );

    expect(body).toEqual({
      error: "deploy_failed",
      request_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(JSON.stringify(body)).not.toContain("canary-secret");
    expect(JSON.stringify(log.mock.calls)).not.toContain("canary-secret");
  });

  it("keeps raw caught exception text out of server client-response sinks", () => {
    const source = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
    const rawError = String.raw`(?:\b(?:err|bootErr|lastError)\.message|String\((?:err|bootErr|lastError))`;
    const forbidden = [
      new RegExp(String.raw`(?:error|message):[^\r\n]*${rawError}`),
      new RegExp(String.raw`return\s+fail\([^\r\n]*${rawError}`),
      new RegExp(String.raw`\bpushNote\s*=\s*[^\r\n]*${rawError}`),
      /\berror_message:\s*(?:errMsg|msg|errorMessage|latestDeploy\.error_message)\b/,
      /\berror:\s*u\.error\s*[,}]/,
      /return\s+json\([^\r\n]*\{\s*error:\s*(?:msg|raw|message)\b/,
      /const\s+(?:message|raw|msg)\s*=\s*err instanceof Error \? err\.message : String\(err\);/,
      new RegExp(String.raw`error:\s*\`[\s\S]{0,200}${rawError}`),
    ];

    for (const pattern of forbidden) expect(source).not.toMatch(pattern);
  });
});
