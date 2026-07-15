import { describe, expect, it } from "vitest";
import {
  classifySqlSafety,
  consumeSqlConfirmationToken,
  issueSqlConfirmationToken,
} from "./sqlSafety.js";

describe("classifySqlSafety", () => {
  it.each([
    "select * from projects",
    "-- read only\nselect '; drop table ignored' as value;",
    "show search_path",
    "values (1), (2)",
    "create table if not exists projects (id uuid primary key)",
    "create unique index projects_id_idx on projects(id)",
    "alter table projects add column title text",
    "grant select on projects to authenticated",
  ])("allows a single read-only or additive statement: %s", (sql) => {
    expect(classifySqlSafety(sql).requiresConfirmation).toBe(false);
  });

  it.each([
    "drop index projects_id_idx",
    "drop function destroy_everything()",
    "drop type project_kind",
    "drop trigger audit_trigger on projects",
    "drop policy project_access on projects",
    "do $$ begin execute 'drop table projects'; end $$",
    "call destructive_procedure()",
    "execute prepared_delete",
    "delete/**/from projects",
    "alter table projects drop column title",
    "create or replace function f() returns void language sql as $$ select 1 $$",
    "insert into projects(id) values (1)",
    "update projects set title = 'changed'",
    "select 1; drop table projects",
    "with removed as (delete from projects returning *) select * from removed",
  ])("requires confirmation for destructive or unknown SQL: %s", (sql) => {
    expect(classifySqlSafety(sql).requiresConfirmation).toBe(true);
  });
});

describe("SQL confirmation tokens", () => {
  it("binds a short-lived one-shot token to the exact scope and query", () => {
    const now = 10_000;
    const sql = "drop table projects";
    const token = issueSqlConfirmationToken("console:user-a:ref-a", sql, now);

    expect(consumeSqlConfirmationToken(token, "console:user-b:ref-a", sql, now)).toBe(false);
    expect(consumeSqlConfirmationToken(token, "console:user-a:ref-a", `${sql};`, now)).toBe(false);
    expect(consumeSqlConfirmationToken(token, "console:user-a:ref-a", sql, now)).toBe(true);
    expect(consumeSqlConfirmationToken(token, "console:user-a:ref-a", sql, now)).toBe(false);
  });

  it("rejects expired tokens", () => {
    const token = issueSqlConfirmationToken("scope", "delete from projects", 1_000);
    expect(consumeSqlConfirmationToken(token, "scope", "delete from projects", 301_001)).toBe(false);
  });
});
