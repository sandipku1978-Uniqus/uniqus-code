import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import {
  buildCloneUrl,
  detectSingleRoot,
  importZip,
  removeSensitiveProjectFiles,
  scrubPat,
  validateCredentialedGithubRepo,
} from "./import.js";

// --- helpers -----------------------------------------------------------------

const tmpDirs: string[] = [];

/** A fresh, empty temp dir; cleaned up after each test. */
async function freshDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "uniqus-import-test-"));
  tmpDirs.push(dir);
  return dir;
}

/** Build an in-memory zip Buffer from a name→contents map. */
function makeZip(entries: Record<string, string | Buffer>): Buffer {
  const zip = new AdmZip();
  for (const [name, contents] of Object.entries(entries)) {
    zip.addFile(name, Buffer.isBuffer(contents) ? contents : Buffer.from(contents));
  }
  return zip.toBuffer();
}

/**
 * Build a zip with a RAW entry name that bypasses AdmZip's add-time
 * normalization (which would otherwise collapse `../foo` to `foo`). Setting
 * `entryName` directly on the entry survives the buffer round-trip, letting us
 * exercise importZip's path-traversal guard against a genuinely malicious name.
 */
function makeZipRaw(entries: Record<string, string | Buffer>): Buffer {
  const zip = new AdmZip();
  let i = 0;
  for (const [name, contents] of Object.entries(entries)) {
    zip.addFile(`placeholder-${i}`, Buffer.isBuffer(contents) ? contents : Buffer.from(contents));
    zip.getEntries()[i].entryName = name;
    i++;
  }
  return zip.toBuffer();
}

async function read(dir: string, rel: string): Promise<string> {
  return fs.readFile(path.join(dir, rel), "utf8");
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop()!;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// --- detectSingleRoot --------------------------------------------------------

describe("detectSingleRoot", () => {
  it("returns the shared root prefix (with trailing slash) when all entries share it", () => {
    expect(
      detectSingleRoot(["repo-main/a.txt", "repo-main/src/b.ts"]),
    ).toBe("repo-main/");
  });

  it("returns null when entries have differing top-level segments", () => {
    expect(detectSingleRoot(["repo-main/a.txt", "other/b.txt"])).toBeNull();
  });

  it("returns null when any entry is a top-level file (no slash)", () => {
    expect(detectSingleRoot(["repo-main/a.txt", "README.md"])).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(detectSingleRoot([])).toBeNull();
  });

  it("normalizes backslash separators before comparing", () => {
    expect(detectSingleRoot(["repo-main\\a.txt", "repo-main\\b.txt"])).toBe(
      "repo-main/",
    );
  });
});

// --- buildCloneUrl (PAT injection) -------------------------------------------

describe("buildCloneUrl", () => {
  it("returns the url unchanged when no PAT is provided", () => {
    expect(buildCloneUrl("https://github.com/foo/bar.git")).toBe(
      "https://github.com/foo/bar.git",
    );
  });

  it("injects the PAT as x-access-token basic auth for https urls", () => {
    const url = buildCloneUrl("https://github.com/foo/bar.git", "ghp_secret123");
    expect(url).toContain("x-access-token:ghp_secret123@github.com");
  });

  it("rejects ssh-style URLs when a credential is present", () => {
    expect(() => buildCloneUrl("git@github.com:foo/bar.git", "ghp_secret123")).toThrow();
  });

  it("never injects a credential into an attacker-controlled host or subdomain", () => {
    expect(() => buildCloneUrl("https://example.com/foo/bar.git", "ghp_secret123")).toThrow();
    expect(() => buildCloneUrl("https://github.com.evil.test/foo/bar.git", "ghp_secret123")).toThrow();
  });

  it("trims surrounding whitespace from the repo url", () => {
    expect(buildCloneUrl("  https://github.com/foo/bar.git  ")).toBe(
      "https://github.com/foo/bar.git",
    );
  });
});

describe("validateCredentialedGithubRepo", () => {
  it("requires the clone identity to match the trusted picker identity", () => {
    expect(validateCredentialedGithubRepo("https://github.com/OpenAI/codex.git", "openai/codex").fullName)
      .toBe("OpenAI/codex");
    expect(() => validateCredentialedGithubRepo(
      "https://github.com/attacker/repo.git",
      "openai/codex",
    )).toThrow(/does not match/);
  });
});

// --- scrubPat ----------------------------------------------------------------

describe("scrubPat", () => {
  it("masks an x-access-token credential in arbitrary text", () => {
    const dirty =
      "fatal: could not read from https://x-access-token:ghp_topsecret@github.com/foo/bar.git";
    const clean = scrubPat(dirty);
    expect(clean).not.toContain("ghp_topsecret");
    expect(clean).toContain("x-access-token:***@github.com");
  });

  it("scrubs every occurrence (global)", () => {
    const dirty = "x-access-token:aaa@github.com x-access-token:bbb@github.com";
    const clean = scrubPat(dirty);
    expect(clean).not.toMatch(/aaa|bbb/);
    expect(clean.match(/\*\*\*/g)?.length).toBe(2);
  });

  it("leaves text without a credential unchanged", () => {
    const text = "fatal: repository not found";
    expect(scrubPat(text)).toBe(text);
  });
});

// --- importZip ---------------------------------------------------------------

describe("importZip", () => {
  it("extracts files and reports counts/bytes", async () => {
    const dir = await freshDir();
    const zip = makeZip({ "a.txt": "hello", "src/b.ts": "world!" });
    const result = await importZip(zip, dir);

    expect(result.files_imported).toBe(2);
    expect(result.total_bytes).toBe(
      Buffer.byteLength("hello") + Buffer.byteLength("world!"),
    );
    expect(result.stripped_root).toBeNull();
    expect(await read(dir, "a.txt")).toBe("hello");
    expect(await read(dir, "src/b.ts")).toBe("world!");
  });

  it("strips a single GitHub-style root folder", async () => {
    const dir = await freshDir();
    const zip = makeZip({
      "repo-main/a.txt": "hello",
      "repo-main/src/b.ts": "world",
    });
    const result = await importZip(zip, dir);

    expect(result.stripped_root).toBe("repo-main/");
    expect(await read(dir, "a.txt")).toBe("hello");
    expect(await read(dir, "src/b.ts")).toBe("world");
    // The root folder name itself must NOT appear in the destination.
    expect(await exists(path.join(dir, "repo-main"))).toBe(false);
  });

  it("skips path-traversal entries that escape the destination", async () => {
    const dir = await freshDir();
    // Raw entry names so AdmZip doesn't normalize away the `..`; the traversal
    // entry tries to climb out of the destination.
    const zip = makeZipRaw({
      "good.txt": "safe",
      "../escape.txt": "evil",
    });
    const result = await importZip(zip, dir);

    // The traversal entry is dropped; only the safe file lands.
    expect(result.files_imported).toBe(1);
    expect(await read(dir, "good.txt")).toBe("safe");
    // Nothing written above the destination directory.
    expect(await exists(path.join(path.dirname(dir), "escape.txt"))).toBe(false);
  });

  it("does not extract nested traversal that climbs out of the dest", async () => {
    const dir = await freshDir();
    const zip = makeZipRaw({
      "ok.txt": "ok",
      "sub/../../escape.txt": "evil",
    });
    const result = await importZip(zip, dir);

    expect(result.files_imported).toBe(1);
    expect(await exists(path.join(path.dirname(dir), "escape.txt"))).toBe(false);
  });

  it("skips generated dirs and artifacts (.git, node_modules, dist, build, .next)", async () => {
    const dir = await freshDir();
    const zip = makeZip({
      "keep.txt": "keep",
      ".git/config": "[core]",
      "node_modules/dep/index.js": "module.exports={}",
      "dist/out.js": "compiled",
      "build/out.js": "compiled",
      ".next/cache.bin": "cache",
    });
    const result = await importZip(zip, dir);

    expect(result.files_imported).toBe(1);
    expect(await read(dir, "keep.txt")).toBe("keep");
    for (const skipped of [".git", "node_modules", "dist", "build", ".next"]) {
      expect(await exists(path.join(dir, skipped))).toBe(false);
    }
  });

  it("drops credential-bearing paths before they enter the project tree", async () => {
    const dir = await freshDir();
    const zip = makeZip({
      "src/index.ts": "export {};",
      ".env.production": "TOKEN=secret",
      "config/client.pem": "private material",
      ".ssh/id_ed25519": "private key",
    });

    const result = await importZip(zip, dir);
    expect(result.files_imported).toBe(1);
    expect(await exists(path.join(dir, ".env.production"))).toBe(false);
    expect(await exists(path.join(dir, "config/client.pem"))).toBe(false);
    expect(await exists(path.join(dir, ".ssh"))).toBe(false);
  });

  it("scrubs sensitive files from a cloned checkout before persistence", async () => {
    const dir = await freshDir();
    await fs.mkdir(path.join(dir, "nested"), { recursive: true });
    await fs.writeFile(path.join(dir, "keep.txt"), "safe");
    await fs.writeFile(path.join(dir, "nested", ".npmrc"), "token=secret");

    await expect(removeSensitiveProjectFiles(dir)).resolves.toBe(1);
    expect(await read(dir, "keep.txt")).toBe("safe");
    expect(await exists(path.join(dir, "nested", ".npmrc"))).toBe(false);
  });

  it("rejects an archive whose only content is a skip-dir (no silent empty import)", async () => {
    const dir = await freshDir();
    const zip = makeZip({
      ".git/config": "[core]",
      ".git/HEAD": "ref: refs/heads/main",
    });

    await expect(importZip(zip, dir)).rejects.toThrow(/no importable files/);
  });

  it("rejects a single entry exceeding the per-file cap (zip-bomb guard)", async () => {
    const dir = await freshDir();
    // 51 MB > MAX_FILE_SIZE (50 MB). AdmZip stores the uncompressed size in the
    // header, which is what the pre-check reads.
    const big = Buffer.alloc(51 * 1024 * 1024, 0x61);
    const zip = makeZip({ "huge.bin": big });

    await expect(importZip(zip, dir)).rejects.toThrow(/too large/);
  });

  it("refuses to extract into a non-empty destination", async () => {
    const dir = await freshDir();
    await fs.writeFile(path.join(dir, "preexisting.txt"), "x");
    const zip = makeZip({ "a.txt": "hello" });

    await expect(importZip(zip, dir)).rejects.toThrow(/not empty/);
  });

  it("creates the destination directory if it does not yet exist", async () => {
    const parent = await freshDir();
    const dir = path.join(parent, "nested", "dest");
    const zip = makeZip({ "a.txt": "hi" });

    const result = await importZip(zip, dir);
    expect(result.files_imported).toBe(1);
    expect(await read(dir, "a.txt")).toBe("hi");
  });
});
