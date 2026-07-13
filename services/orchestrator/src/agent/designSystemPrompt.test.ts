import { describe, expect, it } from "vitest";
import { DEFAULT_DESIGN_TOKENS, type DesignTokens } from "@gate15/api-types";
import { formatDesignSystemForPrompt } from "./skills.js";

describe("formatDesignSystemForPrompt", () => {
  it("installs structured foundations, component rules, patterns, and behavior", () => {
    const prompt = formatDesignSystemForPrompt(DEFAULT_DESIGN_TOKENS);
    expect(prompt).toContain("foundations:");
    expect(prompt).toContain("breakpoints: narrow=360px");
    expect(prompt).toContain("navigation: height=56px");
    expect(prompt).toContain("patterns:");
    expect(prompt).toContain("behavior (release requirements, not optional decoration):");
    expect(prompt).toContain("WCAG 2.2 AA contrast");
  });

  it("remains compatible with previously saved token objects", () => {
    const legacy: DesignTokens = {
      mode: "dark",
      colors: { background: "#111111", text: "#ffffff" },
      fonts: { body: "Body", heading: "Heading" },
      radius: "8px",
    };
    const prompt = formatDesignSystemForPrompt(legacy);
    expect(prompt).toContain("mode: dark");
    expect(prompt).toContain("background: #111111");
    expect(prompt).not.toContain("foundations:");
  });
});
