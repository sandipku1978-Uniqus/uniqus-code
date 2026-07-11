import { describe, expect, it } from "vitest";
import { looksLikeImmediateCorrection } from "./correctionSignal.js";

describe("looksLikeImmediateCorrection", () => {
  it.each([
    "That still doesn't work",
    "This is still broken on mobile",
    "This isn't what I asked for",
    "You missed the validation requirement",
    "The implementation was incomplete; try again",
  ])("recognises a high-confidence correction: %s", (message) => {
    expect(looksLikeImmediateCorrection(message)).toBe(true);
  });

  it.each([
    "Can you also add validation?",
    "Fix the footer next",
    "Now make the layout responsive",
    "Thanks, that works",
    "How does this implementation work?",
  ])("does not label a normal follow-up as a correction: %s", (message) => {
    expect(looksLikeImmediateCorrection(message)).toBe(false);
  });

  it("rejects non-text and blank input", () => {
    expect(looksLikeImmediateCorrection(undefined)).toBe(false);
    expect(looksLikeImmediateCorrection("   ")).toBe(false);
  });
});
