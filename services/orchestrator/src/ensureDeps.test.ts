import { describe, it, expect } from "vitest";
import { runCommandSubdir } from "./ensureDeps.js";

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
