import { describe, expect, it } from "vitest";
import { legalPolicyLinks } from "./legal-policies";

describe("legal policy links", () => {
  it("accepts only published HTTPS destinations", () => {
    expect(legalPolicyLinks("https://gate15.dev/terms", "https://gate15.dev/privacy")).toEqual({
      terms: "https://gate15.dev/terms",
      privacy: "https://gate15.dev/privacy",
    });
    expect(legalPolicyLinks("http://gate15.dev/terms", "not a url")).toEqual({
      terms: null,
      privacy: null,
    });
    expect(legalPolicyLinks("https://localhost/terms", "https://127.0.0.1/privacy")).toEqual({
      terms: null,
      privacy: null,
    });
  });
});
