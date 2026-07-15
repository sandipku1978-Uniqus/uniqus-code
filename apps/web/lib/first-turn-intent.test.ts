import { describe, expect, it } from "vitest";
import {
  completeFirstTurnIntent,
  createFirstTurnIntent,
  readFirstTurnIntent,
} from "./first-turn-intent";

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

describe("first-turn intent handoff", () => {
  it("keeps confidential content out of the opaque ID and survives retries", () => {
    const storage = new MemoryStorage();
    const content = "Build the confidential Acme acquisition dashboard";
    const id = createFirstTurnIntent("project-1", content, storage, 1_000);
    expect(id).not.toContain("Acme");
    expect(readFirstTurnIntent("project-1", id, storage, 2_000)).toBe(content);
    expect(readFirstTurnIntent("project-1", id, storage, 2_000)).toBe(content);
    completeFirstTurnIntent("project-1", id, storage);
    expect(readFirstTurnIntent("project-1", id, storage, 2_000)).toBeNull();
  });

  it("binds the handoff to its project and expires stale content", () => {
    const storage = new MemoryStorage();
    const id = createFirstTurnIntent("project-1", "secret", storage, 1_000);
    expect(readFirstTurnIntent("project-2", id, storage, 2_000)).toBeNull();
    expect(readFirstTurnIntent("project-1", id, storage, 25 * 60 * 60_000)).toBeNull();
  });
});
