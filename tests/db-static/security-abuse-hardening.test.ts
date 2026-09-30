import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/202609140003_security_abuse_hardening.sql", "utf8").toLowerCase();
const shippingSql = readFileSync("supabase/migrations/202609300001_shipping_quote_rate_limit.sql", "utf8").toLowerCase();

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

describe("shipping quote rate limit migration", () => {
  it("preserva todos os scopes da constraint e adiciona somente shipping_quote", () => {
    const scopes = (source: string) => {
      const constraint = source.match(/scope in \(([\s\S]*?)\)/u)?.[1] ?? "";
      return [...constraint.matchAll(/'([a-z_]+)'/gu)].map((match) => match[1]);
    };
    expect(new Set(scopes(shippingSql))).toEqual(new Set([...scopes(sql), "shipping_quote"]));
  });

  it("mantém a função segura e adiciona o orçamento independente de 30 por minuto", () => {
    const functionBody = (source: string) => source.slice(
      source.indexOf("create or replace function public.consume_private_api_rate_limit"),
      source.indexOf("revoke all on function public.consume_private_api_rate_limit")
    ).replace(/\r\n/gu, "\n").trim();
    const newCase = "    when 'shipping_quote' then maximum := 30; seconds := 60;\n";
    expect(functionBody(shippingSql)).toContain(newCase.trim());
    expect(functionBody(shippingSql).replace(newCase, "")).toBe(functionBody(sql));
    expect(shippingSql).toContain("revoke all on function public.consume_private_api_rate_limit(text) from public, anon");
    expect(shippingSql).toContain("grant execute on function public.consume_private_api_rate_limit(text) to authenticated");
    expect(shippingSql).toContain("notify pgrst, 'reload schema'");
  });
});
