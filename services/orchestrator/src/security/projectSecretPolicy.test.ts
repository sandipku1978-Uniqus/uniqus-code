import { describe, expect, it } from "vitest";
import { isModelVisibleProjectConfig } from "./projectSecretPolicy.js";

describe("project secret disclosure policy", () => {
  it("allows only the connector-declared Supabase public client config", () => {
    expect(isModelVisibleProjectConfig("SUPABASE_URL")).toBe(true);
    expect(isModelVisibleProjectConfig("supabase_anon_key")).toBe(true);
    expect(isModelVisibleProjectConfig("SUPABASE_SERVICE_ROLE_KEY")).toBe(false);
    expect(isModelVisibleProjectConfig("DATABASE_URL")).toBe(false);
    expect(isModelVisibleProjectConfig("NEXT_PUBLIC_ARBITRARY_SECRET")).toBe(false);
  });
});
