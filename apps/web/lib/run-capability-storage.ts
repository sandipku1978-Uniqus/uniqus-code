export interface RunCapabilityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
interface DefaultRunCapability {
  sessionId: string;
  capability: string;
}

const exactKey = (projectId: string, sessionId: string): string =>
  `gate15:run-capability:${projectId}:${sessionId}`;

const defaultKey = (projectId: string): string =>
  `gate15:run-capability:${projectId}:default`;

function readDefault(
  storage: RunCapabilityStorage,
  projectId: string,
): DefaultRunCapability | null {
  const raw = storage.getItem(defaultKey(projectId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DefaultRunCapability>;
    return typeof parsed.sessionId === "string" && typeof parsed.capability === "string"
      ? { sessionId: parsed.sessionId, capability: parsed.capability }
      : null;
  } catch {
    return null;
  }
}

/** Read the exact-session bearer, or the resolved default-session alias. */
export function readStoredRunCapability(
  storage: RunCapabilityStorage,
  projectId: string,
  requestedSessionId: string | null,
): string | null {
  if (requestedSessionId) return storage.getItem(exactKey(projectId, requestedSessionId));
  return readDefault(storage, projectId)?.capability ?? null;
}

/**
 * Persist the concrete session key and, when the connection used the default
 * route, an alias that survives a hard reload with no `?chat=` parameter.
 */
export function storeRunCapability(
  storage: RunCapabilityStorage,
  projectId: string,
  resolvedSessionId: string,
  capability: string,
  requestedSessionId: string | null,
): void {
  storage.setItem(exactKey(projectId, resolvedSessionId), capability);
  if (requestedSessionId === null) {
    storage.setItem(
      defaultKey(projectId),
      JSON.stringify({ sessionId: resolvedSessionId, capability } satisfies DefaultRunCapability),
    );
  }
}

/** Clear the concrete bearer and a default alias only when it points here. */
export function clearRunCapability(
  storage: RunCapabilityStorage,
  projectId: string,
  resolvedSessionId: string,
): void {
  storage.removeItem(exactKey(projectId, resolvedSessionId));
  if (readDefault(storage, projectId)?.sessionId === resolvedSessionId) {
    storage.removeItem(defaultKey(projectId));
  }
}
