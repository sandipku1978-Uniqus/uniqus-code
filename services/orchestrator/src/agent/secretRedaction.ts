const REDACTED_SECRET = "[REDACTED PROJECT SECRET]";
const REDACTED_LOCAL_SECRET = "[REDACTED LOCAL SECRET]";

/**
 * Defense in depth for command/log output sourced from workspace files rather
 * than the encrypted project-secret store. Arbitrary shell plus local secrets
 * is inherently broad, so lifecycle filters remain the primary control; these
 * patterns stop common `cat .env`, credential JSON/YAML, URL-auth, token, and
 * PEM disclosures from crossing into model context.
 */
export function redactSensitiveShellOutput(value: string): string {
  return value
    .replace(
      /-----BEGIN [^-\r\n]*(?:PRIVATE KEY|CERTIFICATE)-----[\s\S]*?-----END [^-\r\n]*(?:PRIVATE KEY|CERTIFICATE)-----/gi,
      REDACTED_LOCAL_SECRET,
    )
    .replace(
      /^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*).+$/gm,
      `$1${REDACTED_LOCAL_SECRET}`,
    )
    .replace(
      /((?:"|')?[A-Za-z0-9_.-]*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|private[_-]?key)[A-Za-z0-9_.-]*(?:"|')?\s*[:=]\s*)(["']?)[^\s,"'}]+\2/gi,
      `$1${REDACTED_LOCAL_SECRET}`,
    )
    .replace(/(https?:\/\/[^\s:/@]+:)[^\s/@]+@/gi, `$1${REDACTED_LOCAL_SECRET}@`)
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16})\b/g, REDACTED_LOCAL_SECRET)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED_LOCAL_SECRET);
}

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
