import { afterEach, describe, expect, it } from "vitest";
import {
  assertHostSandboxAllowed,
  assertSandboxModeConfigured,
  firecrackerModeConfigured,
} from "./sandboxMode.js";

const original = {
  NODE_ENV: process.env.NODE_ENV,
  UNIQUS_SANDBOX: process.env.UNIQUS_SANDBOX,
  UNIQUS_ALLOW_HOST_SANDBOX: process.env.UNIQUS_ALLOW_HOST_SANDBOX,
};

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
describe("sandbox mode", () => {
  it("accepts Firecracker", () => {
    process.env.UNIQUS_SANDBOX = "firecracker";
    expect(firecrackerModeConfigured()).toBe(true);
    expect(() => assertSandboxModeConfigured()).not.toThrow();
  });

  it("rejects an omitted or mistyped mode", () => {
    delete process.env.UNIQUS_SANDBOX;
    delete process.env.UNIQUS_ALLOW_HOST_SANDBOX;
    expect(() => assertSandboxModeConfigured()).toThrow(/must be set/);
    process.env.UNIQUS_SANDBOX = "firecraker";
    expect(() => assertSandboxModeConfigured()).toThrow(/Unsupported/);
  });

  it("allows host execution only through the non-production development override", () => {
    delete process.env.UNIQUS_SANDBOX;
    process.env.UNIQUS_ALLOW_HOST_SANDBOX = "1";
    process.env.NODE_ENV = "development";
    expect(() => assertSandboxModeConfigured()).not.toThrow();
    expect(() => assertHostSandboxAllowed()).not.toThrow();
    process.env.NODE_ENV = "production";
    expect(() => assertSandboxModeConfigured()).toThrow();
    expect(() => assertHostSandboxAllowed()).toThrow();
  });
});
