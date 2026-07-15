import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM. New writes use a versioned JSON envelope with row/purpose AAD.
// Legacy values remain readable during rotation: base64(IV || TAG || CIPHERTEXT).
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ENVELOPE_PREFIX = "g15:v2:";

interface EncryptionEnvelopeV2 {
  v: 2;
  k: string;
  n: string;
  c: string;
  t: string;
}

interface KeyRing {
  activeId: string;
  keys: Map<string, Buffer>;
}

function decodeKey(raw: string, label: string): Buffer {
  const buf = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error(`${label} must decode to exactly 32 bytes (256 bits)`);
  }
  return buf;
}

/**
 * Rotation configuration:
 *   OAUTH_TOKEN_ENCRYPTION_KEYS='{"2026-07":"<key>","2026-10":"<key>"}'
 *   OAUTH_TOKEN_ENCRYPTION_KEY_ID='2026-10'
 *
 * The single-key variables remain supported. When a keyring is configured,
 * keep the previous key in it until all legacy/v2 rows have been rewritten.
 */
function loadKeyRing(): KeyRing {
  const configuredRing = process.env.OAUTH_TOKEN_ENCRYPTION_KEYS?.trim();
  const keys = new Map<string, Buffer>();

  if (configuredRing) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(configuredRing);
    } catch {
      throw new Error("OAUTH_TOKEN_ENCRYPTION_KEYS must be a JSON object");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("OAUTH_TOKEN_ENCRYPTION_KEYS must be a JSON object");
    }
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(id) || typeof value !== "string") {
        throw new Error("OAUTH_TOKEN_ENCRYPTION_KEYS contains an invalid key id or value");
      }
      keys.set(id, decodeKey(value, `encryption key '${id}'`));
    }
  } else {
    const raw =
      process.env.OAUTH_TOKEN_ENCRYPTION_KEY ?? process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
    if (!raw) {
      throw new Error(
        "OAUTH_TOKEN_ENCRYPTION_KEY is required to store third-party credentials. " +
          "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
      );
    }
    const id = process.env.OAUTH_TOKEN_ENCRYPTION_KEY_ID?.trim() || "default";
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(id)) {
      throw new Error("OAUTH_TOKEN_ENCRYPTION_KEY_ID is invalid");
    }
    keys.set(id, decodeKey(raw, "OAUTH_TOKEN_ENCRYPTION_KEY"));
  }

  if (keys.size === 0) throw new Error("OAUTH_TOKEN_ENCRYPTION_KEYS cannot be empty");
  const activeId = process.env.OAUTH_TOKEN_ENCRYPTION_KEY_ID?.trim() || keys.keys().next().value;
  if (!activeId || !keys.has(activeId)) {
    throw new Error("OAUTH_TOKEN_ENCRYPTION_KEY_ID does not identify a configured key");
  }
  return { activeId, keys };
}

function validateContext(context: string): string {
  const normalized = context.trim();
  if (!normalized || normalized.length > 1024) {
    throw new Error("encryption context must contain 1-1024 characters");
  }
  return normalized;
}

function aad(keyId: string, context: string): Buffer {
  return Buffer.from(`gate15:v2:${keyId}:${validateContext(context)}`, "utf8");
}

/** Encrypt a credential and authenticate its logical row/purpose context. */
export function encryptToken(plaintext: string, context: string): string {
  const ring = loadKeyRing();
  const key = ring.keys.get(ring.activeId)!;
  const nonce = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad(ring.activeId, context));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const envelope: EncryptionEnvelopeV2 = {
    v: 2,
    k: ring.activeId,
    n: nonce.toString("base64url"),
    c: ciphertext.toString("base64url"),
    t: cipher.getAuthTag().toString("base64url"),
  };
  return ENVELOPE_PREFIX + Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
}

function decryptV2(blob: string, context: string, ring: KeyRing): string {
  let envelope: EncryptionEnvelopeV2;
  try {
    const encoded = blob.slice(ENVELOPE_PREFIX.length);
    if (!encoded || encoded.length > 128_000) throw new Error("invalid envelope size");
    envelope = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as EncryptionEnvelopeV2;
  } catch {
    throw new Error("encrypted token envelope is malformed");
  }
  if (
    envelope?.v !== 2 ||
    typeof envelope.k !== "string" ||
    typeof envelope.n !== "string" ||
    typeof envelope.c !== "string" ||
    typeof envelope.t !== "string"
  ) {
    throw new Error("encrypted token envelope is malformed");
  }
  const key = ring.keys.get(envelope.k);
  if (!key) throw new Error(`encrypted token references unknown key '${envelope.k}'`);
  const nonce = Buffer.from(envelope.n, "base64url");
  const tag = Buffer.from(envelope.t, "base64url");
  const ciphertext = Buffer.from(envelope.c, "base64url");
  if (nonce.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("encrypted token envelope is malformed");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(aad(envelope.k, context));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function decryptLegacy(blob: string, ring: KeyRing): string {
  const buf = Buffer.from(blob, "base64");
  if (buf.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error("encrypted token blob is too short to be valid");
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
  for (const key of ring.keys.values()) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch {
      // Legacy rows carry no key id, so try every explicitly configured
      // rotation key before failing closed.
    }
  }
  throw new Error("encrypted token could not be authenticated with a configured key");
}

/** Dual-read (legacy/v2), single-write (v2) credential decryption. */
export function decryptToken(blob: string, context: string): string {
  const ring = loadKeyRing();
  if (blob.startsWith(ENVELOPE_PREFIX)) return decryptV2(blob, context, ring);
  if (blob.startsWith("g15:")) throw new Error("encrypted token version is unsupported");
  validateContext(context);
  return decryptLegacy(blob, ring);
}

export function isLegacyEncryptedToken(blob: string): boolean {
  return !blob.startsWith(ENVELOPE_PREFIX);
}
