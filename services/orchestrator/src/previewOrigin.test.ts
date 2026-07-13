import { describe, expect, it } from "vitest";
import { assertPreviewOriginConfigured } from "./previewOrigin.js";

const base = {
  NODE_ENV: "production",
  PUBLIC_BASE_URL: "https://api.uniqus.example",
  WORKOS_COOKIE_DOMAIN: ".uniqus.example",
};

describe("production preview origin isolation", () => {
  it("requires an explicit preview URL", () => {
    expect(() => assertPreviewOriginConfigured(base)).toThrow(/PREVIEW_BASE_URL is required/);
  });

  it("requires a distinct authenticated API origin", () => {
    expect(() =>
      assertPreviewOriginConfigured({
        ...base,
        PUBLIC_BASE_URL: undefined,
        PREVIEW_BASE_URL: "https://preview.example.net",
      }),
    ).toThrow(/PUBLIC_BASE_URL is required/);
  });

  it("rejects both the API origin and any host receiving app-domain cookies", () => {
    expect(() => assertPreviewOriginConfigured({ ...base, PREVIEW_BASE_URL: base.PUBLIC_BASE_URL })).toThrow(/API origin/);
    expect(() => assertPreviewOriginConfigured({ ...base, PREVIEW_BASE_URL: "https://preview.uniqus.example" })).toThrow(/outside WORKOS_COOKIE_DOMAIN/);
  });

  it("accepts a separate cookieless site", () => {
    expect(() => assertPreviewOriginConfigured({
      ...base,
      PREVIEW_BASE_URL: "https://uniqus-preview.example.net",
    })).not.toThrow();
  });
});
