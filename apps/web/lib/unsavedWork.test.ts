import { describe, expect, it } from "vitest";
import { selectHasUnsavedWork, type SaveStatus } from "./store";

const state = (pendingEdits: Record<string, string>, saveStatus: Record<string, SaveStatus>) => ({
  pendingEdits,
  saveStatus,
});

describe("selectHasUnsavedWork", () => {
  it("is false for clean idle/saved buffers", () => {
    expect(selectHasUnsavedWork(state({}, {}))).toBe(false);
    expect(selectHasUnsavedWork(state({}, { "a.ts": { kind: "saved", at: 1 } }))).toBe(false);
  });

  it.each(["dirty", "saving", "error"] as const)("protects %s buffers", (kind) => {
    const status: SaveStatus = kind === "error" ? { kind, message: "failed" } : { kind };
    expect(selectHasUnsavedWork(state({}, { "a.ts": status }))).toBe(true);
  });

  it("protects offline pending edits even without a status entry", () => {
    expect(selectHasUnsavedWork(state({ "a.ts": "unsent" }, {}))).toBe(true);
  });
});
