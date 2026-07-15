import { describe, expect, it } from "vitest";
import { deploymentEnvironment } from "./deploy.js";

describe("deployment secret boundaries", () => {
  it("keeps stored runtime secrets out of the build environment", () => {
    const env = deploymentEnvironment(
      { DATABASE_URL: "stored-db", RUNTIME_ONLY: "secret" },
      { PUBLIC_FLAG: "yes" },
    );

    expect(env.runtime).toEqual({
      DATABASE_URL: "stored-db",
      RUNTIME_ONLY: "secret",
      PUBLIC_FLAG: "yes",
    });
    expect(env.build).toEqual({ PUBLIC_FLAG: "yes" });
  });

  it("lets explicit per-deploy values override stored runtime values", () => {
    const env = deploymentEnvironment(
      { API_URL: "stored", DATABASE_URL: "stored-db" },
      { API_URL: "request" },
    );

    expect(env.runtime).toEqual({ API_URL: "request", DATABASE_URL: "stored-db" });
    expect(env.build).toEqual({ API_URL: "request" });
  });
});
