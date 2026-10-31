import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const budget = readFileSync("supabase/migrations/202609300001_shipping_quote_rate_limit.sql", "utf8").toLowerCase();
const previous = readFileSync("supabase/migrations/202609140003_security_abuse_hardening.sql", "utf8").toLowerCase();
const readiness = readFileSync("supabase/migrations/202609300002_shipping_quote_rate_limit_readiness.sql", "utf8").toLowerCase();
const preflight = readFileSync("scripts/validate-supabase-readiness.ts", "utf8");

const scopes = (sql: string) => {
  const match = /add constraint auth_rate_limits_scope_check check \(\s*scope in \(([^)]*)\)/u.exec(sql);
  return new Set([...(match?.[1] ?? "").matchAll(/'([a-z_]+)'/gu)].map((item) => item[1]));
};

describe("orçamento independente de cotação de frete", () => {
  it("amplia a constraint anterior somente com shipping_quote", () => {
    const before = scopes(previous);
    const after = scopes(budget);
    expect(before.size).toBeGreaterThan(0);
    expect([...after].filter((scope) => !before.has(scope))).toEqual(["shipping_quote"]);
    expect([...before].filter((scope) => !after.has(scope))).toEqual([]);
  });

  it("inclui shipping_quote na função e preserva grants/revokes", () => {
    expect(budget).toContain("when 'shipping_quote' then maximum := 30; seconds := 60;");
    expect(budget).toContain("revoke all on function public.consume_private_api_rate_limit(text) from public, anon;");
    expect(budget).toContain("grant execute on function public.consume_private_api_rate_limit(text) to authenticated;");
    expect(budget).toContain("security definer");
    expect(budget).toContain("set search_path = ''");
  });

  it("expõe um preflight somente leitura e sem dados", () => {
    expect(readiness).toContain("returns boolean");
    expect(readiness).toContain("stable");
    expect(readiness).toContain("security invoker");
    expect(readiness).toContain("set search_path = ''");
    expect(readiness).not.toMatch(/\b(insert|update|delete|truncate)\b/u);
    expect(readiness).toContain("revoke all on function public.shipping_quote_rate_limit_ready() from public;");
    expect(preflight).toContain("/rest/v1/rpc/shipping_quote_rate_limit_ready");
    expect(preflight).toContain("shippingReady !== true");
  });
});
