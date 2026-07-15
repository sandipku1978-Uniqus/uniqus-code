import { describe, expect, it } from "vitest";
import { isSensitiveProjectPath } from "./sensitivePaths.js";

describe("sensitive project path policy", () => {
  it.each([
    ".env",
    "config/.env.production",
    ".ssh/id_ed25519",
    ".aws/credentials",
    ".config/gcloud/application_default_credentials.json",
    ".npmrc",
    "nested/.git-credentials",
    "certs/client.pem",
    "certs/client.p12",
  ])("blocks %s across every project lifecycle", (candidate) => {
    expect(isSensitiveProjectPath(candidate)).toBe(true);
  });

  it.each(["src/index.ts", "README.md", "config/public.json"])(
    "allows ordinary project path %s",
    (candidate) => expect(isSensitiveProjectPath(candidate)).toBe(false),
  );
});
