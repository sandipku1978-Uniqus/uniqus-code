import { describe, expect, it } from "vitest";
import {
  clearRunCapability,
  readStoredRunCapability,
  storeRunCapability,
  type RunCapabilityStorage,
} from "./run-capability-storage";

function memoryStorage(): RunCapabilityStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

describe("run capability storage", () => {
  it("reattaches a default-session run after a reload with no concrete session id", () => {
    const storage = memoryStorage();
    storeRunCapability(storage, "project_1", "session_default", "bearer", null);

    expect(readStoredRunCapability(storage, "project_1", null)).toBe("bearer");
    expect(readStoredRunCapability(storage, "project_1", "session_default")).toBe("bearer");
  });

  it("does not use an explicit-session bearer for the default route", () => {
    const storage = memoryStorage();
    storeRunCapability(storage, "project_1", "session_other", "bearer", "session_other");
    expect(readStoredRunCapability(storage, "project_1", null)).toBeNull();
  });

  it("clears a matching default alias when the run completes", () => {
    const storage = memoryStorage();
    storeRunCapability(storage, "project_1", "session_default", "bearer", null);
    clearRunCapability(storage, "project_1", "session_default");
    expect(readStoredRunCapability(storage, "project_1", null)).toBeNull();
  });
});
