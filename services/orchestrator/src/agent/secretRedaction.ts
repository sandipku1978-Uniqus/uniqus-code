const REDACTED_SECRET = "[REDACTED PROJECT SECRET]";

export interface SecretRedactor {
  text(value: string): string;
  clone<T>(value: T): T;
  redactInPlace(value: unknown): void;
}
/**
 * Last-mile protection for legacy files, command output, uploads, and message
 * history. Values are fetched outside the model call and never logged.
 */
export function createSecretRedactor(values: readonly string[]): SecretRedactor {
  const secrets = [...new Set(values.filter((value) => value.length > 0))].sort(
    (a, b) => b.length - a.length,
  );

  const text = (value: string): string => {
    let result = value;
    for (const secret of secrets) result = result.split(secret).join(REDACTED_SECRET);
    return result;
  };

  const redactInPlace = (value: unknown, seen = new WeakSet<object>()): void => {
    if (!value || typeof value !== "object") return;
    if (seen.has(value as object)) return;
    seen.add(value as object);
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        if (typeof value[i] === "string") value[i] = text(value[i]);
        else redactInPlace(value[i], seen);
      }
      return;
    }
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (typeof item === "string") (value as Record<string, unknown>)[key] = text(item);
      else redactInPlace(item, seen);
    }
  };

  const clone = <T>(value: T): T => {
    if (typeof value === "string") return text(value) as T;
    if (value === undefined || value === null) return value;
    const copy = structuredClone(value);
    redactInPlace(copy);
    return copy;
  };

  return { text, clone, redactInPlace };
}
