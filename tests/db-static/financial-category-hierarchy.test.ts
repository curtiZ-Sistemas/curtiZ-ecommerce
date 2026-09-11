import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202609110001_financial_category_hierarchy.sql"),
  "utf8"
);

describe("financial category hierarchy migration", () => {
  it("evolves the existing category table without persisting totals", () => {
    expect(sql).toContain("alter table public.financial_categories");
    expect(sql).toContain("add column parent_id uuid references public.financial_categories(id)");
    expect(sql).toContain("add column is_group boolean not null default false");
    expect(sql).not.toMatch(/add column (total|total_value)/);
    expect(sql).not.toContain("create table public.financial_categories");
  });

  it("rejects groups and incompatible categories at the database boundary", () => {
    expect(sql).toContain("and not category.is_group");
    expect(sql).toContain("invalid analytic financial category");
    expect(sql).toContain("financial category cannot be its own parent");
    expect(sql).toContain("financial category parent must be a group");
    expect(sql).toContain("before insert or update of category_id on public.accounts_payable");
    expect(sql).toContain("before insert or update of category_id on public.accounts_receivable");
  });

  it("keeps totals query-based and automatic transactions idempotent", () => {
    expect(sql).toContain("from public.financial_transactions");
    expect(sql).toContain("expense_category_report");
    expect(sql).toContain("income_category_report");
    expect(sql).toContain("return public.financial_control_mutate_flat_v1(p_action, p_payload)");
  });

  it("uses existing permission and audit systems", () => {
    expect(sql).toContain("private.require_permission('financial.read_full')");
    expect(sql).toContain("private.require_permission('finance.manage')");
    expect(sql).toContain("insert into public.audit_logs");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
  });
});
