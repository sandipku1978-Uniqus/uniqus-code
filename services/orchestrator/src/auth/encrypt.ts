import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM. 12-byte IV (NIST SP 800-38D recommendation), 16-byte auth tag.
// Layout on disk (base64-encoded): IV (12) || TAG (16) || CIPHERTEXT.
const IV_BYTES = 12;
const TAG_BYTES = 16;

function loadKey(): Buffer {
  // Single key wraps every third-party OAuth token we hold (GitHub, Vercel,
  // future providers). One leak compromises all stored tokens — accept that
  // tradeoff for one less env var to manage. If this ever needs to split,
  // add per-provider keys without breaking the generic helper.
  const raw =
    process.env.OAUTH_TOKEN_ENCRYPTION_KEY ?? process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "OAUTH_TOKEN_ENCRYPTION_KEY is required to store third-party OAuth tokens. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  // Accept hex (64 chars) or base64. Either way must decode to 32 bytes.
  const buf = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error(
      "OAUTH_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (256 bits)",
    );
  }
  return buf;
}

export function encryptToken(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptToken(blob: string): string {
  const key = loadKey();
  const buf = Buffer.from(blob, "base64");
  if (buf.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error("encrypted token blob is too short to be valid");
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const enc = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
