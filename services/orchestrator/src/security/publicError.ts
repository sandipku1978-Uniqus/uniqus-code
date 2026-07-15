import { randomUUID } from "node:crypto";

export interface PublicErrorBody {
  error: string;
  request_id: string;
}

/**
 * Return a stable public error and a correlation id without echoing arbitrary
 * provider/SQL/filesystem text. Logs intentionally retain only non-secret
 * classification metadata; callers can correlate the id with surrounding
 * structured operational events.
 */
export function publicError(code: string, cause: unknown): PublicErrorBody {
  const requestId = randomUUID();
  const name = cause instanceof Error ? cause.name : typeof cause;
  const candidateCode = (cause as { code?: unknown } | null)?.code;
  const internalCode =
    typeof candidateCode === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(candidateCode)
      ? candidateCode
      : undefined;
  console.error(`[request ${requestId}] ${code}`, {
    cause_type: name,
    ...(internalCode ? { cause_code: internalCode } : {}),
  });
  return { error: code, request_id: requestId };
}
