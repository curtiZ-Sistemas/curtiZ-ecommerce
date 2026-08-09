import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/202608090004_auth_identity_backfill.sql",
  "utf8"
).toLowerCase();

describe("authentication identity backfill", () => {
  it("repairs missing profiles without granting an internal role", () => {
    expect(sql).toContain("from auth.users user_account");
    expect(sql).toContain("insert into public.profiles");
    expect(sql).toContain("insert into public.user_roles");
    expect(sql).toContain("'customer'::public.app_role");
    expect(sql).not.toContain("'admin'::public.app_role");
    expect(sql).not.toContain("'manager'::public.app_role");
  });
});
