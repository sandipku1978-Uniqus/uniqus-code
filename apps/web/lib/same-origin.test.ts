import { describe, expect, it } from "vitest";
import { isSameOriginPost } from "./same-origin";

describe("isSameOriginPost", () => {
  it("accepts only same-origin POST requests", () => {
    expect(isSameOriginPost(new Request("https://app.gate15.dev/api/signout", {
      method: "POST",
      headers: { origin: "https://app.gate15.dev" },
    }))).toBe(true);
    expect(isSameOriginPost(new Request("https://app.gate15.dev/api/signout", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    }))).toBe(false);
    expect(isSameOriginPost(new Request("https://app.gate15.dev/api/signout", {
      method: "GET",
      headers: { origin: "https://app.gate15.dev" },
    }))).toBe(false);
    expect(isSameOriginPost(new Request("https://app.gate15.dev/api/signout", {
      method: "POST",
    }))).toBe(false);
    expect(isSameOriginPost(new Request("https://app.gate15.dev/api/signout", {
      method: "POST",
      headers: { origin: "not a URL" },
    }))).toBe(false);
  });
});
