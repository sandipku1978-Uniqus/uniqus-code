import { describe, expect, it } from "vitest";
import {
  assertSecureSecretTransport,
  httpConnector,
  isAllowedSecretDestination,
} from "./http.js";

describe("HTTP connector secret destination bindings", () => {
  it("does not expose a model-controlled host allowlist", () => {
    const schema = JSON.stringify(httpConnector.methods[0].args_schema);
    expect(schema).not.toContain("allowed_secret_hosts");
    expect(schema).toContain("auth_secret");
  });

  it("matches only an exact normalized hostname", () => {
    expect(isAllowedSecretDestination("API.Example.com.", ["api.example.com"])).toBe(true);
    expect(isAllowedSecretDestination("evil.api.example.com", ["api.example.com"])).toBe(false);
    expect(isAllowedSecretDestination("example.com", ["api.example.com"])).toBe(false);
  });

  it("refuses to put a stored secret on a plaintext HTTP connection", () => {
    expect(() => assertSecureSecretTransport(new URL("http://api.example.com"))).toThrow(
      /only over HTTPS/,
    );
    expect(() => assertSecureSecretTransport(new URL("https://api.example.com"))).not.toThrow();
  });
});
