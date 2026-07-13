import { describe, expect, it } from "vitest";
import { isSensitiveProjectPath } from "./sensitivePaths.js";

describe("isSensitiveProjectPath", () => {
  it.each([
    ".env",
    "apps/web/.env.local",
    ".env.example",
    ".ssh/id_ed25519",
    ".aws/credentials",
    "certs/server.pem",
    ".pem",
    ".key",
    "keys/client.p12",
    ".npmrc",
  ])("blocks %s", (value) => expect(isSensitiveProjectPath(value)).toBe(true));

  it.each(["src/env.ts", "public/logo.svg", "README.md"])(
    "allows %s",
    (value) => expect(isSensitiveProjectPath(value)).toBe(false),
  );
});
