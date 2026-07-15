import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

describe("server-private schema controls", () => {
  it("keeps account provider keys behind forced RLS with no client grants", () => {
    expect(schema).toMatch(/alter table account_provider_keys enable row level security/i);
    expect(schema).toMatch(/alter table account_provider_keys force row level security/i);
    expect(schema).toMatch(
      /revoke all on table account_provider_keys from anon, authenticated/i,
    );
    expect(schema).toMatch(/provider in \('anthropic', 'openai', 'google', 'zai'\)/i);
  });

  it("serializes last project-owner removal in the database", () => {
    expect(schema).toMatch(/create or replace function prevent_last_project_owner_removal/i);
    expect(schema).toMatch(/from projects where id = old\.project_id for update/i);
    expect(schema).toMatch(/project_members_retain_owner/i);
  });
});
