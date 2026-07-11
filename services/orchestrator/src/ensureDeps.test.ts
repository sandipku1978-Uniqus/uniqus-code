import { afterEach, describe, it, expect, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as sandboxIo from "./agent/sandbox.js";
import {
  dependencyFingerprint,
  ensureProjectDeps,
  needsInstall,
  runCommandSubdir,
} from "./ensureDeps.js";

describe("runCommandSubdir — subdirectory-project detection for the deps probe", () => {
  it("parses a leading `cd <dir> &&` prefix (the agent's subdir convention)", () => {
    expect(runCommandSubdir("cd my-app && npm run dev")).toBe("my-app");
    expect(runCommandSubdir('cd "my app" && npm run dev')).toBe("my app");
    expect(runCommandSubdir("cd 'my app' && yarn dev")).toBe("my app");
    // The exact command from the portfolio-dashboard incident.
    expect(
      runCommandSubdir("cd portfolio-dashboard && npx next dev --turbo -p 3000 -H 0.0.0.0"),
    ).toBe("portfolio-dashboard");
    expect(runCommandSubdir("  cd app &&npm run dev")).toBe("app");
    expect(runCommandSubdir("cd apps/web && vite --host 0.0.0.0")).toBe("apps/web");
  });

  it("returns null for root commands (probe falls back to the sandbox root)", () => {
    expect(runCommandSubdir("npm run dev")).toBeNull();
    expect(runCommandSubdir("npx next dev -p 3000 -H 0.0.0.0")).toBeNull();
    expect(runCommandSubdir("")).toBeNull();
  });

  it("rejects absolute, home, drive, and traversal-shaped dirs", () => {
    expect(runCommandSubdir("cd /etc && ls")).toBeNull();
    expect(runCommandSubdir("cd ~ && ls")).toBeNull();
    expect(runCommandSubdir("cd ~/x && ls")).toBeNull();
    expect(runCommandSubdir("cd .. && npm run dev")).toBeNull();
    expect(runCommandSubdir("cd foo/../../bar && ls")).toBeNull();
    expect(runCommandSubdir("cd C:/x && ls")).toBeNull();
    expect(runCommandSubdir("cd . && npm run dev")).toBeNull();
  });
});

describe("needsInstall — manifest-aware dependency state", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not trust a populated node_modules tree without a success marker", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "uniqus-deps-test-"));
    try {
      await writeFile(path.join(dir, "package.json"), '{"dependencies":{"vite":"6.0.0"}}');
      await mkdir(path.join(dir, "node_modules", "vite"), { recursive: true });

      expect(await needsInstall(dir)).toBe("npm");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("skips only while the last successful fingerprint matches", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "uniqus-deps-test-"));
    try {
      const packageJson = path.join(dir, "package.json");
      await writeFile(packageJson, '{"dependencies":{"vite":"6.0.0"}}');
      await mkdir(path.join(dir, "node_modules", "vite"), { recursive: true });
      const stateDir = path.join(dir, ".cache", "uniqus");
      await mkdir(stateDir, { recursive: true });
      await writeFile(
        path.join(stateDir, "deps.sha256"),
        `${await dependencyFingerprint(dir, "npm")}\n`,
      );

      expect(await needsInstall(dir)).toBeNull();

      await writeFile(packageJson, '{"dependencies":{"vite":"8.1.4"}}');
      expect(await needsInstall(dir)).toBe("npm");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("invalidates the marker when a lockfile appears or changes", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "uniqus-deps-test-"));
    try {
      await writeFile(path.join(dir, "package.json"), '{"dependencies":{"vite":"6.0.0"}}');
      await mkdir(path.join(dir, "node_modules", "vite"), { recursive: true });
      const stateDir = path.join(dir, ".cache", "uniqus");
      await mkdir(stateDir, { recursive: true });
      await writeFile(
        path.join(stateDir, "deps.sha256"),
        `${await dependencyFingerprint(dir, "npm")}\n`,
      );

      await writeFile(path.join(dir, "package-lock.json"), '{"lockfileVersion":3}');
      expect(await needsInstall(dir)).toBe("npm");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform !== "win32")(
    "records a real install and reconciles a later manifest change",
    async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "uniqus-deps-install-"));
      try {
        const depOne = path.join(dir, "dep-one");
        const depTwo = path.join(dir, "dep-two");
        await mkdir(depOne);
        await mkdir(depTwo);
        await writeFile(
          path.join(depOne, "package.json"),
          JSON.stringify({ name: "fixture-dep", version: "1.0.0" }),
        );
        await writeFile(
          path.join(depTwo, "package.json"),
          JSON.stringify({ name: "fixture-dep", version: "2.0.0" }),
        );
        const packageJson = path.join(dir, "package.json");
        await writeFile(
          packageJson,
          JSON.stringify({ dependencies: { "fixture-dep": "file:./dep-one" } }),
        );

        const first = await ensureProjectDeps({ rootDir: dir }, dir);
        expect(first, first.stderr).toMatchObject({ attempted: true, ok: true, manager: "npm" });
        expect(await needsInstall(dir)).toBeNull();

        await writeFile(
          packageJson,
          JSON.stringify({ dependencies: { "fixture-dep": "file:./dep-two" } }),
        );
        expect(await needsInstall(dir)).toBe("npm");

        const second = await ensureProjectDeps({ rootDir: dir }, dir);
        expect(second, second.stderr).toMatchObject({ attempted: true, ok: true, manager: "npm" });
        expect(await needsInstall(dir)).toBeNull();
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it("uses the fingerprint probe, strict npm install, and post-install marker in a VM", async () => {
    const run = vi
      .spyOn(sandboxIo, "runCommand")
      .mockResolvedValueOnce({
        stdout: "install:npm\n",
        stderr: "",
        exitCode: 0,
        truncated: false,
      })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0, truncated: false })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0, truncated: false });

    const result = await ensureProjectDeps(
      { rootDir: "/host/project", vm: {} as never },
      "vm-project",
    );

    expect(result).toMatchObject({ attempted: true, ok: true, manager: "npm" });
    expect(run).toHaveBeenCalledTimes(3);
    expect(run.mock.calls[0]?.[1]).toContain("deps.sha256");
    expect(run.mock.calls[1]?.[1]).toContain("--engine-strict");
    expect(run.mock.calls[2]?.[1]).toContain("deps.sha256");
  });
});
