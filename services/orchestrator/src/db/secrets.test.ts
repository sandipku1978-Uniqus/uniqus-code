import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: vi.fn(),
  encryptToken: vi.fn((value: string) => `encrypted:${value}`),
  decryptToken: vi.fn((value: string) => `decrypted:${value}`),
}));

vi.mock("./client.js", () => ({ db: mocks.db }));
vi.mock("../auth/encrypt.js", () => ({
  encryptToken: mocks.encryptToken,
  decryptToken: mocks.decryptToken,
}));

import {
  getSecretWithBinding,
  getProjectSecretPlaintexts,
  isMissingAllowedHostsColumn,
  listSecrets,
  normalizeAllowedSecretHosts,
  upsertSecret,
} from "./secrets.js";

beforeEach(() => {
  mocks.db.mockReset();
  mocks.encryptToken.mockClear();
  mocks.decryptToken.mockClear();
});

describe("secret destination bindings", () => {
  it("stores exact normalized hostnames and rejects model-style wildcards", () => {
    expect(
      normalizeAllowedSecretHosts(["https://API.Stripe.com/v1", "api.stripe.com."]),
    ).toEqual(["api.stripe.com"]);
    expect(() => normalizeAllowedSecretHosts(["*.example.com"])).toThrow(/wildcards/);
  });

  it("recognizes only the pre-migration allowed_hosts schema error", () => {
    expect(isMissingAllowedHostsColumn({
      code: "42703",
      message: "column project_secrets.allowed_hosts does not exist",
    })).toBe(true);
    expect(isMissingAllowedHostsColumn({
      code: "PGRST204",
      message: "Could not find the 'allowed_hosts' column in the schema cache",
    })).toBe(true);
    expect(isMissingAllowedHostsColumn({ code: "42501", message: "permission denied" })).toBe(false);
  });

  it("keeps listSecrets usable before the allowed_hosts migration", async () => {
    const responses = [
      {
        data: null,
        error: { code: "42703", message: "column project_secrets.allowed_hosts does not exist" },
      },
      {
        data: [{
          id: "secret_1",
          project_id: "project_1",
          name: "TOKEN",
          env: "default",
          description: null,
          created_at: "now",
          updated_at: "now",
        }],
        error: null,
      },
    ];
    const selected: string[] = [];
    mocks.db.mockImplementation(() => ({
      from: () => {
        let orderCalls = 0;
        const query = {
          select(columns: string) { selected.push(columns); return query; },
          eq() { return query; },
          order() {
            orderCalls += 1;
            return orderCalls === 1 ? query : Promise.resolve(responses.shift());
          },
        };
        return query;
      },
    }));

    await expect(listSecrets("project_1")).resolves.toMatchObject([
      { name: "TOKEN", allowed_hosts: [] },
    ]);
    expect(selected[0]).toContain("allowed_hosts");
    expect(selected[1]).not.toContain("allowed_hosts");
  });

  it("fails closed with no HTTP bindings when getSecretWithBinding falls back", async () => {
    const responses = [
      {
        data: null,
        error: { code: "PGRST204", message: "Could not find allowed_hosts in schema cache" },
      },
      { data: { encrypted_value: "ciphertext" }, error: null },
    ];
    mocks.db.mockImplementation(() => ({
      from: () => {
        const query = {
          select() { return query; },
          eq() { return query; },
          maybeSingle() { return Promise.resolve(responses.shift()); },
        };
        return query;
      },
    }));

    await expect(getSecretWithBinding("project_1", "TOKEN")).resolves.toEqual({
      value: "decrypted:ciphertext",
      allowedHosts: [],
    });
  });

  it("allows legacy upserts without bindings but refuses to discard a non-empty binding", async () => {
    const missing = {
      data: null,
      error: { code: "PGRST204", message: "Could not find allowed_hosts in schema cache" },
    };
    const legacy = {
      data: {
        id: "secret_1",
        project_id: "project_1",
        name: "TOKEN",
        env: "default",
        description: null,
        created_at: "now",
        updated_at: "now",
      },
      error: null,
    };
    const responses = [missing, legacy];
    mocks.db.mockImplementation(() => ({
      from: () => {
        const query = {
          upsert() { return query; },
          select() { return query; },
          single() { return Promise.resolve(responses.shift()); },
        };
        return query;
      },
    }));
    await expect(upsertSecret({
      project_id: "project_1",
      name: "TOKEN",
      value: "value",
    })).resolves.toMatchObject({ name: "TOKEN", allowed_hosts: [] });

    mocks.db.mockImplementation(() => ({
      from: () => {
        const query = {
          upsert() { return query; },
          select() { return query; },
          single() { return Promise.resolve(missing); },
        };
        return query;
      },
    }));
    await expect(upsertSecret({
      project_id: "project_1",
      name: "TOKEN",
      value: "value",
      allowed_hosts: ["api.example.com"],
    })).rejects.toThrow(/migration is required/);
  });

  it("excludes Supabase public client config from the model redaction set", async () => {
    mocks.db.mockReturnValue({
      from: () => {
        const query = {
          select() { return query; },
          eq() {
            return Promise.resolve({
              data: [
                { name: "SUPABASE_URL", encrypted_value: "public-url" },
                { name: "SUPABASE_ANON_KEY", encrypted_value: "public-anon" },
                { name: "SUPABASE_SERVICE_ROLE_KEY", encrypted_value: "service-role" },
                { name: "DATABASE_URL", encrypted_value: "database-url" },
              ],
              error: null,
            });
          },
        };
        return query;
      },
    });

    await expect(getProjectSecretPlaintexts("project_1")).resolves.toEqual([
      "decrypted:service-role",
      "decrypted:database-url",
    ]);
    expect(mocks.decryptToken).not.toHaveBeenCalledWith("public-url");
    expect(mocks.decryptToken).not.toHaveBeenCalledWith("public-anon");
  });
});
