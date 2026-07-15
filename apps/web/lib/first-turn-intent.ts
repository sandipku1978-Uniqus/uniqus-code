const INTENT_PREFIX = "gate15.firstTurnIntent";
const INTENT_TTL_MS = 24 * 60 * 60_000;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface PendingFirstTurn {
  projectId: string;
  content: string;
  createdAt: number;
}

function key(projectId: string, intentId: string): string {
  return `${INTENT_PREFIX}.${projectId}.${intentId}`;
}

/** Store prompt content outside the URL and return only an opaque handoff ID. */
export function createFirstTurnIntent(
  projectId: string,
  content: string,
  storage: StorageLike = window.sessionStorage,
  now = Date.now(),
): string {
  const intentId = globalThis.crypto.randomUUID();
  const pending: PendingFirstTurn = { projectId, content, createdAt: now };
  storage.setItem(key(projectId, intentId), JSON.stringify(pending));
  return intentId;
}

/** Idempotent read: reconnects may retry until the WebSocket accepts the turn. */
export function readFirstTurnIntent(
  projectId: string,
  intentId: string,
  storage: StorageLike = window.sessionStorage,
  now = Date.now(),
): string | null {
  const storageKey = key(projectId, intentId);
  const raw = storage.getItem(storageKey);
  if (!raw) return null;
  try {
    const pending = JSON.parse(raw) as Partial<PendingFirstTurn>;
    const age = typeof pending.createdAt === "number" ? now - pending.createdAt : -1;
    if (
      pending.projectId === projectId &&
      typeof pending.content === "string" && pending.content.length > 0 &&
      age >= 0 && age <= INTENT_TTL_MS
    ) {
      return pending.content;
    }
  } catch {
    // Invalid handoffs are removed below rather than repeatedly retried.
  }
  storage.removeItem(storageKey);
  return null;
}

export function completeFirstTurnIntent(
  projectId: string,
  intentId: string,
  storage: StorageLike = window.sessionStorage,
): void {
  storage.removeItem(key(projectId, intentId));
}
