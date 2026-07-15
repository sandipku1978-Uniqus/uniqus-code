import { describe, expect, it } from "vitest";
import {
  applySecurityHeaders,
  buildContentSecurityPolicy,
} from "./security-headers";

describe("security headers", () => {
  it("binds scripts to the request nonce and denies framing", () => {
    const csp = buildContentSecurityPolicy("testNonce123", true);
    expect(csp).toMatch(/script-src[^;]*'nonce-testNonce123'/);
    expect(csp).toMatch(/frame-ancestors 'none'/);
    expect(csp).not.toMatch(/unsafe-eval/);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it("includes legacy and modern frame protection", () => {
    const headers = new Headers();
    applySecurityHeaders(headers, "default-src 'self'; frame-ancestors 'none'");
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("content-security-policy") ?? "").toMatch(/frame-ancestors/);
  });
});
