import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface SqlSafetyClassification {
  requiresConfirmation: boolean;
  operation: string;
  reason: "read_only" | "additive" | "destructive" | "unknown" | "multi_statement";
}

const CONFIRMATION_TTL_MS = 5 * 60_000;
const confirmationKey = randomBytes(32);
const consumedTokens = new Map<string, number>();

/**
 * Remove comments and quoted bodies before classifying SQL. Semicolons outside
 * those regions remain intact so multi-statement requests cannot hide behind a
 * string, dollar-quoted function body, or comment.
 */
function structuralSql(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (ch === "-" && next === "-") {
      out += "  ";
      i += 2;
      while (i < sql.length && sql[i] !== "\n" && sql[i] !== "\r") {
        out += " ";
        i += 1;
      }
      continue;
    }

    if (ch === "/" && next === "*") {
      let depth = 1;
      out += "  ";
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth += 1;
          out += "  ";
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth -= 1;
          out += "  ";
          i += 2;
        } else {
          out += sql[i] === "\n" || sql[i] === "\r" ? sql[i] : " ";
          i += 1;
        }
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      const quote = ch;
      out += " ";
      i += 1;
      while (i < sql.length) {
        if (sql[i] === quote && sql[i + 1] === quote) {
          out += "  ";
          i += 2;
        } else if (sql[i] === quote) {
          out += " ";
          i += 1;
          break;
        } else {
          out += sql[i] === "\n" || sql[i] === "\r" ? sql[i] : " ";
          i += 1;
        }
      }
      continue;
    }

    if (ch === "$") {
      const delimiter = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (delimiter) {
        out += " ".repeat(delimiter.length);
        i += delimiter.length;
        const end = sql.indexOf(delimiter, i);
        const stop = end === -1 ? sql.length : end + delimiter.length;
        while (i < stop) {
          out += sql[i] === "\n" || sql[i] === "\r" ? sql[i] : " ";
          i += 1;
        }
        continue;
      }
    }

    out += ch;
    i += 1;
  }
  return out;
}

function operationFor(statement: string): string {
  if (/^DROP\b/.test(statement)) return "DROP";
  if (/^TRUNCATE\b/.test(statement)) return "TRUNCATE";
  if (/^DELETE\b/.test(statement)) return "DELETE";
  if (/^UPDATE\b/.test(statement)) return "UPDATE";
  if (/^INSERT\b/.test(statement)) return "INSERT";
  if (/^ALTER\b/.test(statement)) return "ALTER";
  if (/^REVOKE\b/.test(statement)) return "REVOKE";
  if (/^(DO|CALL|EXECUTE)\b/.test(statement)) return statement.match(/^\w+/)?.[0] ?? "PROCEDURAL SQL";
  return statement.match(/^\w+/)?.[0] ?? "UNKNOWN SQL";
}

/**
 * Default-deny SQL classification. Only a single, structurally read-only
 * statement or narrowly additive DDL can run without a second confirmation.
 * Everything else (including DML, procedural SQL, and multi-statements) is
 * treated as destructive/unknown rather than trying to enumerate bad syntax.
 */
export function classifySqlSafety(sql: string): SqlSafetyClassification {
  const statements = structuralSql(sql)
    .split(";")
    .map((statement) => statement.replace(/\s+/g, " ").trim().toUpperCase())
    .filter(Boolean);

  if (statements.length !== 1) {
    return {
      requiresConfirmation: true,
      operation: statements.length > 1 ? "MULTI-STATEMENT SQL" : "UNKNOWN SQL",
      reason: statements.length > 1 ? "multi_statement" : "unknown",
    };
  }

  const statement = statements[0];
  if (/^(SELECT|SHOW|VALUES|TABLE)\b/.test(statement)) {
    return { requiresConfirmation: false, operation: "READ", reason: "read_only" };
  }

  const additiveCreate =
    /^CREATE\s+(?:(?:GLOBAL|LOCAL)\s+)?(?:TEMP(?:ORARY)?\s+)?(?:UNIQUE\s+)?(?:TABLE|SCHEMA|SEQUENCE|INDEX|VIEW|MATERIALIZED\s+VIEW|TYPE|DOMAIN|FUNCTION|PROCEDURE|TRIGGER|POLICY|EXTENSION)\b/.test(
      statement,
    ) && !/^CREATE\s+(?:OR\s+REPLACE|.*\sOR\s+REPLACE)\b/.test(statement);
  const additiveAlter =
    /^ALTER\s+TABLE\b/.test(statement) &&
    /\bADD\s+(?:COLUMN|CONSTRAINT)\b/.test(statement) &&
    !/\b(DROP|RENAME|ALTER|SET|RESET|DISABLE|ENABLE|ATTACH|DETACH)\b/.test(statement.replace(/^ALTER\b/, ""));
  const additiveGrant = /^GRANT\b/.test(statement);

  if (additiveCreate || additiveAlter || additiveGrant) {
    return { requiresConfirmation: false, operation: "ADDITIVE DDL", reason: "additive" };
  }

  const operation = operationFor(statement);
  const destructive = /^(DROP|TRUNCATE|DELETE|UPDATE|INSERT|ALTER|REVOKE|DO|CALL|EXECUTE)\b/.test(statement);
  return {
    requiresConfirmation: true,
    operation,
    reason: destructive ? "destructive" : "unknown",
  };
}

function operationHash(scope: string, sql: string): string {
  return createHash("sha256").update(scope).update("\0").update(sql.trim()).digest("base64url");
}

export function issueSqlConfirmationToken(scope: string, sql: string, now = Date.now()): string {
  const expiresAt = now + CONFIRMATION_TTL_MS;
  const hash = operationHash(scope, sql);
  const payload = `${expiresAt}.${hash}`;
  const signature = createHmac("sha256", confirmationKey).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

/** Verify and consume a confirmation token. Tokens are query/scope-bound, short-lived, and one-shot. */
export function consumeSqlConfirmationToken(
  token: unknown,
  scope: string,
  sql: string,
  now = Date.now(),
): boolean {
  if (typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expiresRaw, hash, signature] = parts;
  const expiresAt = Number(expiresRaw);
  if (!Number.isSafeInteger(expiresAt) || expiresAt < now || expiresAt > now + CONFIRMATION_TTL_MS) return false;
  if (hash !== operationHash(scope, sql)) return false;

  const expected = createHmac("sha256", confirmationKey)
    .update(`${expiresRaw}.${hash}`)
    .digest();
  let presented: Buffer;
  try {
    presented = Buffer.from(signature, "base64url");
  } catch {
    return false;
  }
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) return false;

  for (const [used, expiry] of consumedTokens) {
    if (expiry < now) consumedTokens.delete(used);
  }
  if (consumedTokens.has(token)) return false;
  consumedTokens.set(token, expiresAt);
  return true;
}
