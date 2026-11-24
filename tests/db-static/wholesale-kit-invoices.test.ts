import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const file = "20261124070000_wholesale_kit_invoices.sql";
const migrations = resolve(process.cwd(), "supabase", "migrations");
const sql = readFileSync(resolve(migrations, file), "utf8").toLowerCase();

describe("wholesale kit invoice migration without a local database", () => {
  it("only creates new objects and declares what it depends on", () => {
    expect(sql).toContain("depends on 20261124060000");
    expect(existsSync(resolve(migrations, "20261124060000_representative_kit_payer_cpf_from_account.sql"))).toBe(true);
    expect(sql).not.toMatch(/create or replace function/u);
    expect(sql).not.toMatch(/alter table public\./u);
    expect(sql).not.toMatch(/insert into private\.representative_resale_fiscal_rule_versions/u);
    expect(readdirSync(migrations).filter(name => name.startsWith("20261124070000"))).toEqual([file]);
  });

  it("grants the permission only to manager and admin", () => {
    expect(sql).toContain("'fiscal.wholesale_invoices.issue'");
    expect(sql).toMatch(/select 'manager', id from public\.permissions where code = 'fiscal\.wholesale_invoices\.issue'/u);
    expect(sql).toMatch(/select 'admin', id from public\.permissions where code = 'fiscal\.wholesale_invoices\.issue'/u);
    expect(sql).not.toMatch(/select 'operational'|select 'technical'/u);
  });

  it("keeps the tables behind forced row level security with no direct grants", () => {
    for (const table of ["wholesale_kit_invoices", "wholesale_kit_invoice_writes"]) {
      expect(sql).toContain(`alter table private.${table} enable row level security;`);
      expect(sql).toContain(`alter table private.${table} force row level security;`);
      expect(sql).toContain(`revoke all on private.${table} from public, anon, authenticated, service_role;`);
    }
  });

  it("uses an empty search path in every security definer function", () => {
    const definers = sql.match(/security definer/gu)?.length ?? 0;
    const protectedFunctions = sql.match(/security definer set search_path = ''/gu)?.length ?? 0;
    expect(definers).toBeGreaterThan(10);
    expect(protectedFunctions).toBe(definers);
  });

  it("requires the permission and MFA for every operator function and keeps the worker side to the service role", () => {
    const access = sql.slice(sql.indexOf("create function private.require_wholesale_invoice_access"));
    expect(access).toContain("private.internal_mfa_satisfied()");
    expect(access).toContain("private.has_permission('fiscal.wholesale_invoices.issue')");
    for (const name of ["list_wholesale_kit_offers", "list_wholesale_kit_invoices", "create_wholesale_kit_invoice",
      "request_wholesale_kit_invoice_retry", "cancel_wholesale_kit_invoice"]) {
      const body = sql.slice(sql.indexOf(`create function public.${name}`));
      expect(body.slice(0, body.indexOf("$$;", 100))).toContain("private.require_wholesale_invoice_access()");
    }
    expect(sql).toMatch(/grant execute on function public\.list_wholesale_kit_offers\(\)[\s\S]*to authenticated;/u);
    expect(sql).toMatch(/grant execute on function public\.begin_wholesale_kit_invoice_issue\(uuid\)[\s\S]*to service_role;/u);
    expect(sql).toMatch(/revoke all on function public\.begin_wholesale_kit_invoice_issue\(uuid\)[\s\S]*from public, anon, authenticated;/u);
  });

  it("takes and returns the kit sheets under the kit lock, once", () => {
    expect(sql).toMatch(/from public\.kits k where k\.id = p_kit and k\.active and k\.deleted_at is null for update/u);
    expect(sql).toContain("where k.id = p_kit and private.representative_kit_grade_stock(k, p_template) >= p_quantity");
    expect(sql).toContain("grade_standard_stock = k.grade_standard_stock + case when i.template = 'standard'");
    expect(sql).toContain("constraint wholesale_invoice_stock check ((status = 'cancelled') = (stock_state = 'released'))");
    expect(sql).toContain("idempotency_key uuid not null unique");
    expect(sql).toContain("operation text not null check (operation in ('bling_sale', 'bling_invoice_draft', 'bling_invoice_send'))");
  });

  it("limits the buyer to a valid CNPJ in MG and reuses the approved MG02 rule", () => {
    expect(sql).toContain("private.is_valid_cnpj(v_document)");
    expect(sql).toContain("wholesale_buyer_outside_mg");
    expect(sql).toContain("perform private.ensure_representative_kit_grade_mg02_rules();");
    for (const fixed of ["'resale_in_state_no_credit'", "{blingrule,series}' = '3'", "{blingrule,cfop}' = '5102'", "{blingrule,csosn}' = '102'"]) {
      expect(sql).toContain(fixed);
    }
  });

  it("writes audit rows without buyer data and stores only reason codes", () => {
    expect(sql).toContain("error_code ~ '^[a-z0-9_]{3,80}$'");
    const audits = sql.match(/insert into public\.audit_logs[\s\S]*?\);/gu) ?? [];
    expect(audits.length).toBeGreaterThanOrEqual(4);
    for (const audit of audits) expect(audit).not.toMatch(/buyer|document|name/u);
  });

  it("has a pgTAP test for stock, idempotency and permissions", () => {
    const test = readFileSync(resolve(process.cwd(), "supabase", "tests", "wholesale_kit_invoices_test.sql"), "utf8");
    for (const expected of ["repeating the key never takes stock twice", "the sheets are returned only once",
      "a user without the permission cannot issue", "anonymous callers cannot create wholesale invoices"]) {
      expect(test).toContain(expected);
    }
  });
});
