import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the sandbox module so findAppDir's filesystem probes hit an in-memory FS
// (and so importing predeploy.ts doesn't pull in the real sandbox/VM deps).
vi.mock("./sandbox.js", () => ({
  readFile: vi.fn(),
  listDir: vi.fn(),
  runCommand: vi.fn(),
}));

import { classifyServerlessLine, fileIsServerReachable, findAppDir } from "./predeploy.js";
import * as sb from "./sandbox.js";

const classify = (line: string, serverReachable: boolean) =>
  classifyServerlessLine(line.trim(), line, serverReachable);

describe("predeploy serverless-safety classifier", () => {
  it("flags the forensics fs.writeFile JSON store as a blocker", () => {
    // The forensics app's lib/store.js: no "use client", not a config → server-reachable.
    expect(fileIsServerReachable("lib/store.js", "store.js", "")).toBe(true);
    const c = classify("  await fs.writeFile(FILE, JSON.stringify(data, null, 2));", true);
    expect(c?.kind).toBe("blocker");
    expect(c?.pattern).toMatch(/filesystem write/i);
  });

  it("flags fs writes regardless of helper (writeFileSync/appendFile/mkdir)", () => {
    expect(classify("fs.writeFileSync(p, data)", true)?.kind).toBe("blocker");
    expect(classify("await fs.appendFile(log, line)", true)?.kind).toBe("blocker");
    expect(classify("fs.mkdir(dir, { recursive: true })", true)?.kind).toBe("blocker");
  });

  it("flags SQLite, better-sqlite3, and websocket servers", () => {
    expect(classify('import Database from "better-sqlite3";', true)?.kind).toBe("blocker");
    expect(classify('DATABASE_URL="file:./prisma/dev.db"', true)?.kind).toBe("blocker");
    expect(classify("const wss = new WebSocketServer({ port: 8080 });", true)?.kind).toBe("blocker");
    expect(classify('import { Server } from "socket.io";', true)?.kind).toBe("blocker");
  });

  it("does NOT flag fs writes in a client component (not server-reachable)", () => {
    expect(fileIsServerReachable("app/page.tsx", "page.tsx", '"use client"\nimport ...')).toBe(false);
    expect(classify("fs.writeFile(x, y)", false)).toBeNull();
  });

  it("does NOT flag config / build-script files", () => {
    expect(fileIsServerReachable("next.config.mjs", "next.config.mjs", "")).toBe(false);
    expect(fileIsServerReachable("scripts/seed.ts", "seed.ts", "")).toBe(false);
    expect(fileIsServerReachable("drizzle.config.ts", "drizzle.config.ts", "")).toBe(false);
  });

  it("warns on localhost URLs and module-scope timers", () => {
    expect(classify('const API = "http://localhost:3000/api";', true)?.kind).toBe("warning");
    expect(classify('fetch("http://127.0.0.1:8000/data")', true)?.kind).toBe("warning");
    expect(classify("setInterval(syncData, 60000)", true)?.kind).toBe("warning");
  });

  it("does NOT block fs writes to /tmp (the one writable serverless path)", () => {
    expect(classify('await fs.writeFile("/tmp/cache.json", data)', true)).toBeNull();
    expect(classify("fs.writeFileSync(path.join(os.tmpdir(), 'x'), data)", true)).toBeNull();
  });

  it("catches the fs.promises namespace and timer assignments", () => {
    expect(classify("await fs.promises.writeFile(file, data)", true)?.kind).toBe("blocker");
    expect(classify("const timer = setInterval(tick, 1000)", true)?.kind).toBe("warning");
    expect(classify("export const t = setTimeout(fn, 100)", true)?.kind).toBe("warning");
  });

  it("ignores benign lines and comments", () => {
    expect(classify("const x = 1;", true)).toBeNull();
    expect(classify("await db.query('select 1')", true)).toBeNull();
    expect(classify("// fs.writeFile is fine in a comment", true)).toBeNull();
    expect(classify("const rows = await supabase.from('t').select()", true)).toBeNull();
  });
});

describe("findAppDir — locates the build dir (root or one subdir down)", () => {
  // Build an in-memory FS: `files` maps relPath → package.json text; `dirs` is
  // the root listing (dir entries carry a trailing "/", matching sb.listDir).
  const mockFs = (files: Record<string, string>, dirs: string[]) => {
    (sb.readFile as ReturnType<typeof vi.fn>).mockImplementation(async (_s: unknown, p: string) => {
      if (p in files) return files[p];
      throw new Error(`ENOENT ${p}`);
    });
    (sb.listDir as ReturnType<typeof vi.fn>).mockImplementation(async () => dirs);
  };
  const pkg = (build?: string) =>
    JSON.stringify({ scripts: build ? { build } : { dev: "next dev" } });

  beforeEach(() => vi.clearAllMocks());

  it("returns '' when the root package.json has a build script", async () => {
    mockFs({ "package.json": pkg("next build") }, []);
    expect(await findAppDir({} as never)).toBe("");
  });

  it("returns the subdir when root has no build script but a child does", async () => {
    mockFs({ "my-app/package.json": pkg("next build") }, ["my-app/", "README.md"]);
    expect(await findAppDir({} as never)).toBe("my-app");
  });

  it("returns null when no package.json anywhere has a build script", async () => {
    mockFs({ "package.json": pkg(/* dev only */) }, ["public/"]);
    expect(await findAppDir({} as never)).toBeNull();
  });

  it("skips node_modules / dist / dotdirs when scanning children", async () => {
    mockFs({ "app/package.json": pkg("vite build") }, ["node_modules/", "dist/", ".next/", "app/"]);
    expect(await findAppDir({} as never)).toBe("app");
  });

  it("prefers the root over a subdir when the root is buildable", async () => {
    mockFs(
      { "package.json": pkg("next build"), "packages/ui/package.json": pkg("tsup") },
      ["packages/"],
    );
    expect(await findAppDir({} as never)).toBe("");
  });
});
