import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/202608090001_restore_audit_log_write_protection.sql",
  "utf8"
).toLowerCase();

describe("audit log write protection", () => {
  it("revokes direct audit mutations restored by the panel access migration", () => {
    expect(sql).toContain("revoke insert, update, delete, truncate");
    expect(sql).toContain("on table public.audit_logs");
    expect(sql).toContain("from anon, authenticated");
  });
});
