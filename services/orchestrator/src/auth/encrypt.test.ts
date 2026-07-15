import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCipheriv, randomBytes } from "node:crypto";
import { decryptToken, encryptToken, isLegacyEncryptedToken } from "./encrypt.js";

const ORIGINAL = {
  key: process.env.OAUTH_TOKEN_ENCRYPTION_KEY,
  legacyKey: process.env.GITHUB_TOKEN_ENCRYPTION_KEY,
  keys: process.env.OAUTH_TOKEN_ENCRYPTION_KEYS,
  keyId: process.env.OAUTH_TOKEN_ENCRYPTION_KEY_ID,
};

const OLD_KEY = Buffer.alloc(32, 0x11).toString("hex");
const NEW_KEY = Buffer.alloc(32, 0x22).toString("hex");

function legacyEncrypt(value: string, keyHex: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

describe("credential encryption envelopes", () => {
  beforeEach(() => {
    delete process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
    delete process.env.OAUTH_TOKEN_ENCRYPTION_KEYS;
    delete process.env.OAUTH_TOKEN_ENCRYPTION_KEY_ID;
    process.env.OAUTH_TOKEN_ENCRYPTION_KEY = OLD_KEY;
  });

  afterEach(() => {
    for (const [name, value] of Object.entries({
      OAUTH_TOKEN_ENCRYPTION_KEY: ORIGINAL.key,
      GITHUB_TOKEN_ENCRYPTION_KEY: ORIGINAL.legacyKey,
      OAUTH_TOKEN_ENCRYPTION_KEYS: ORIGINAL.keys,
      OAUTH_TOKEN_ENCRYPTION_KEY_ID: ORIGINAL.keyId,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("binds ciphertext to its purpose and row context", () => {
    const blob = encryptToken("canary", "account-provider-key:user-a:openai");

    expect(blob).toMatch(/^g15:v2:/);
    expect(decryptToken(blob, "account-provider-key:user-a:openai")).toBe("canary");
    expect(() => decryptToken(blob, "account-provider-key:user-b:openai")).toThrow();
    expect(() => decryptToken(blob, "account-provider-key:user-a:google")).toThrow();
  });

  it("uses a fresh nonce for each write", () => {
    const first = encryptToken("same", "row:a");
    const second = encryptToken("same", "row:a");
    expect(first).not.toBe(second);
  });

  it("dual-reads legacy ciphertext during a keyring rotation", () => {
    const legacy = legacyEncrypt("old-token", OLD_KEY);
    process.env.OAUTH_TOKEN_ENCRYPTION_KEYS = JSON.stringify({ old: OLD_KEY, current: NEW_KEY });
    process.env.OAUTH_TOKEN_ENCRYPTION_KEY_ID = "current";
    delete process.env.OAUTH_TOKEN_ENCRYPTION_KEY;

    expect(isLegacyEncryptedToken(legacy)).toBe(true);
    expect(decryptToken(legacy, "user-credential:u:github-access")).toBe("old-token");
    const current = encryptToken("new-token", "user-credential:u:github-access");
    expect(decryptToken(current, "user-credential:u:github-access")).toBe("new-token");
  });

  it("fails closed for unknown envelope versions and removed keys", () => {
    expect(() => decryptToken("g15:v1:abc", "row:a")).toThrow(/version/i);

    process.env.OAUTH_TOKEN_ENCRYPTION_KEYS = JSON.stringify({ old: OLD_KEY });
    process.env.OAUTH_TOKEN_ENCRYPTION_KEY_ID = "old";
    delete process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
    const oldBlob = encryptToken("old", "row:a");

    process.env.OAUTH_TOKEN_ENCRYPTION_KEYS = JSON.stringify({ current: NEW_KEY });
    process.env.OAUTH_TOKEN_ENCRYPTION_KEY_ID = "current";
    expect(() => decryptToken(oldBlob, "row:a")).toThrow(/unknown key/i);
  });
});
