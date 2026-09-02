import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202609020001_financial_control.sql"),
  "utf8"
);

describe("financial control migration", () => {
  it("usa valores decimais e vínculos únicos para impedir duplicidade", () => {
    expect(sql).toContain("amount numeric(14,2)");
    expect(sql).not.toMatch(/amount\s+(real|float|double precision)/i);
    expect(sql).toContain("financial_transaction_receivable_unique");
    expect(sql).toContain("financial_transaction_payable_unique");
    expect(sql).toContain("financial_transaction_contribution_unique");
    expect(sql).toContain("total_cents / installment_count");
    expect(sql).toContain("total_cents % installment_count");
  });

  it("protege as tabelas e concentra escritas em RPC auditado", () => {
    for (const table of [
      "financial_accounts",
      "financial_categories",
      "financial_partner_groups",
      "financial_partners",
      "accounts_receivable",
      "accounts_payable",
      "partner_contributions",
      "financial_transactions"
    ]) {
      expect(sql).toContain(`alter table public.${table} force row level security`);
    }
    expect(sql).toContain("private.require_permission('finance.manage')");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("insert into public.audit_logs");
    expect(sql).toContain("revoke all on function public.financial_control_mutate");
  });

  it("gera lançamentos automáticos e permite estorno sem duplicar origem", () => {
    expect(sql).toContain("'receivable',id,actor,actor");
    expect(sql).toContain("'payable',id,actor,actor");
    expect(sql).toContain("'contribution',id,notes,actor,actor");
    expect(sql).toContain("on conflict (receivable_id)");
    expect(sql).toContain("on conflict (payable_id)");
    expect(sql).toContain("reversed_at=now()");
  });
});
