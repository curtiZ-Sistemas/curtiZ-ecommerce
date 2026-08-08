import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202608080001_admin_inventory_restock.sql"),
  "utf8"
);

describe("admin inventory restock migration", () => {
  it("autoriza o Administrador por permissão persistida", () => {
    expect(sql).toContain("values ('inventory.adjust'");
    expect(sql).toContain("select 'admin', id");
    expect(sql).toContain("private.require_permission('inventory.adjust')");
  });

  it("mantém a reposição atômica e auditável", () => {
    const start = sql.indexOf("function public.admin_restock_inventory");
    expect(start).toBeGreaterThan(-1);
    expect(sql.slice(start, start + 500)).toContain("security definer");
    expect(sql.slice(start, start + 500)).toContain("set search_path = ''");
    expect(sql).toContain("for update");
    expect(sql).toContain("insert into public.inventory_movements");
    expect(sql).toContain("insert into public.audit_logs");
  });

  it("exige justificativa e não concede execução pública", () => {
    expect(sql).toContain("char_length(trim(coalesce(p_reason, ''))) < 10");
    expect(sql).toContain("from public, anon");
    expect(sql).toContain("to authenticated");
  });

  it("calcula vendas aprovadas no banco e devolve centavos inteiros", () => {
    const start = sql.indexOf("function public.admin_approved_sales_total_in_cents");
    expect(start).toBeGreaterThan(-1);
    expect(sql.slice(start, start + 500)).toContain("security definer");
    expect(sql.slice(start, start + 500)).toContain("set search_path = ''");
    expect(sql).toContain("payment_status = 'approved'");
    expect(sql).toContain("sum(round(grand_total * 100))");
  });
});
