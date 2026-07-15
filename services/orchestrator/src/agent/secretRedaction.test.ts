import { describe, expect, it } from "vitest";
import { createSecretRedactor, redactSensitiveShellOutput } from "./secretRedaction.js";

describe("secret redaction", () => {
  it("redacts known project-secret values", () => {
    expect(createSecretRedactor(["canary-value"]).text("x=canary-value")).not.toContain(
      "canary-value",
    );
  });

  it("redacts common local credential-file output", () => {
    const input = [
      "DATABASE_URL=postgres://user:password@example.test/db",
      "aws_secret_access_key: canary-key",
      "https://user:canary-password@example.test/path",
      "-----BEGIN PRIVATE KEY-----",
      "canary-private-material",
      "-----END PRIVATE KEY-----",
    ].join("\n");
    const output = redactSensitiveShellOutput(input);

    expect(output).not.toContain("canary-key");
    expect(output).not.toContain("canary-password");
    expect(output).not.toContain("canary-private-material");
    expect(output).toContain("[REDACTED LOCAL SECRET]");
  });
});
