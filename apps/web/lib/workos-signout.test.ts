import { afterEach, describe, expect, it } from "vitest";
import { workosSignOutResponse } from "./workos-signout";

const originalEnv = {
  domain: process.env.WORKOS_COOKIE_DOMAIN,
  name: process.env.WORKOS_COOKIE_NAME,
  sameSite: process.env.WORKOS_COOKIE_SAMESITE,
};

afterEach(() => {
  setEnv("WORKOS_COOKIE_DOMAIN", originalEnv.domain);
  setEnv("WORKOS_COOKIE_NAME", originalEnv.name);
  setEnv("WORKOS_COOKIE_SAMESITE", originalEnv.sameSite);
});

describe("workosSignOutResponse", () => {
  it("redirects through WorkOS and expires the domain-scoped session cookie", () => {
    process.env.WORKOS_COOKIE_DOMAIN = ".gate15.dev";
    process.env.WORKOS_COOKIE_NAME = "wos-session";
    process.env.WORKOS_COOKIE_SAMESITE = "lax";

    const response = workosSignOutResponse(
      new Request("https://app.gate15.dev/api/signout"),
      "https://api.workos.com/user_management/sessions/logout?session_id=session_123",
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://api.workos.com/user_management/sessions/logout?session_id=session_123",
    );
    const cookie = response.headers.get("set-cookie");
    expect(cookie).toContain("wos-session=");
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("Domain=.gate15.dev");
    expect(cookie).toContain("Path=/");
  });

  it("also clears a host-only cookie in local development", () => {
    delete process.env.WORKOS_COOKIE_DOMAIN;
    delete process.env.WORKOS_COOKIE_NAME;
    delete process.env.WORKOS_COOKIE_SAMESITE;

    const response = workosSignOutResponse(
      new Request("http://localhost:4242/api/signout"),
      "http://localhost:4242/login",
    );
    const cookie = response.headers.get("set-cookie");

    expect(cookie).toContain("wos-session=");
    expect(cookie).not.toContain("Domain=");
    expect(cookie).not.toContain("Secure");
  });
});

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
