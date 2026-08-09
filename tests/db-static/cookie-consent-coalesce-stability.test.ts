import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/202608090003_cookie_consent_coalesce_stability.sql",
  "utf8"
).toLowerCase();

describe("cookie consent coalesce stability", () => {
  it("uses PostgreSQL coalesce syntax without treating it as a schema function", () => {
    expect(sql).toContain("user_id = coalesce(");
    expect(sql).not.toContain("pg_catalog.coalesce");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
  });
});
