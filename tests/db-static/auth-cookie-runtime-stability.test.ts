import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/202608090002_auth_cookie_runtime_stability.sql",
  "utf8"
).toLowerCase();

describe("authentication and cookie runtime stability", () => {
  it("uses the complete auth rate-limit primary key", () => {
    expect(sql).toContain("on conflict (scope, key_hash, window_started_at)");
    expect(sql).not.toContain("on conflict (scope, key_hash) do update");
    expect(sql).toContain("to anon, authenticated");
  });

  it("counts cookie categories with supported PostgreSQL primitives", () => {
    expect(sql).toContain("from pg_catalog.jsonb_object_keys(p_categories)");
    expect(sql).not.toContain("jsonb_object_length");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
  });
});
