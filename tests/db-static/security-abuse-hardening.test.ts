import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/202609140003_security_abuse_hardening.sql", "utf8").toLowerCase();

describe("security abuse hardening migration", () => {
  it("faz o banco atual prevalecer sobre role antiga do JWT", () => {
    const roleFunction = sql.slice(sql.indexOf("create or replace function private.current_app_role"),
      sql.indexOf("revoke all on function private.current_app_role"));
    expect(roleFunction).toContain("from public.user_roles");
    expect(roleFunction).toContain("profile.status = 'active'");
    expect(roleFunction).not.toContain("auth.jwt()");
    expect(roleFunction).toContain("security definer");
    expect(roleFunction).toContain("set search_path = ''");
  });

  it("mantém budgets fixos, não resetáveis pelo cliente e fail-closed para internos", () => {
    expect(sql).toContain("'checkout_quote'");
    expect(sql).toContain("'payment_attempt'");
    expect(sql).toContain("'account_delete'");
    expect(sql).toContain("'order_cancel'");
    expect(sql).toContain("'return_request'");
    expect(sql).toContain("'admin_mutation'");
    expect(sql).toContain("revoke all on function public.consume_private_api_rate_limit(text) from public, anon");
    expect(sql).toContain("if private.current_app_role() in ('customer','representative')");
  });
});
