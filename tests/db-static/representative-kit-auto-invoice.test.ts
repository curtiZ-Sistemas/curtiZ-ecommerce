import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const file = "20261124030000_representative_kit_auto_invoice.sql";
const read = (name: string) => readFileSync(resolve(process.cwd(), "supabase", "migrations", name), "utf8").toLowerCase();

describe("automatic kit NF-e migration without a local database", () => {
  const sql = read(file);

  it("declares its dependencies and leaves the previous migrations untouched", () => {
    expect(sql).toContain("depends on 20261124020000");
    expect(existsSync(resolve(process.cwd(), "supabase", "migrations", "20261124020000_representative_kit_auto_eligibility.sql"))).toBe(true);
    expect(sql).not.toMatch(/insert into private\.representative_resale_fiscal_rule_versions/u);
    expect(sql).not.toMatch(/update private\.representative_resale_fiscal_rule_versions/u);
    for (const redefined of ["representative_kit_commercial_configuration", "ensure_representative_kit_", "claim_representative_kit_pix"]) {
      expect(sql).not.toMatch(new RegExp(`function [a-z_.]*${redefined}`, "u"));
    }
  });

  it("does not change the fiscal values of the MG02 rule", () => {
    expect(sql).not.toMatch(/'cfop'|'csosn'|'external_nature_id'/u);
  });

  it("makes automatic the default mode and keeps the manual path as a failure fallback", () => {
    expect(sql).toContain("values (true,'automatic')");
    expect(sql).toMatch(/representative_kit_manual_fiscal[\s\S]*\)\s*=\s*'manual'[\s\S]*auto_invoice_failed_at is not null/u);
    expect(sql).toContain("revoke all on private.representative_kit_fiscal_mode from public,anon,authenticated,service_role");
  });

  it("restricts worker functions to the service role and the retry to authenticated operators", () => {
    expect(sql).toMatch(/revoke all on function public\.auto_approve_representative_kit_bling_draft\(uuid,text\),\s*public\.record_representative_kit_auto_invoice_error\(uuid,text,boolean\) from public,anon,authenticated;/u);
    expect(sql).toMatch(/grant execute on function public\.auto_approve_representative_kit_bling_draft\(uuid,text\),\s*public\.record_representative_kit_auto_invoice_error\(uuid,text,boolean\) to service_role;/u);
    expect(sql).toContain("grant execute on function public.request_representative_kit_auto_invoice_retry(uuid) to authenticated;");
    const retry = sql.slice(sql.indexOf("create function public.request_representative_kit_auto_invoice_retry"));
    expect(retry).toContain("private.internal_mfa_satisfied()");
    expect(retry).toContain("private.has_permission('orders.update_operational_status')");
  });

  it("keeps one invoice per order: the retry never runs after a manual or issued NF-e", () => {
    const retry = sql.slice(sql.indexOf("create function public.request_representative_kit_auto_invoice_retry"));
    expect(retry).toMatch(/invoice_confirmed_at is null\s+and invoice_access_key is null and manual_invoice_id is null/u);
    expect(sql).toContain("(f.auto_invoice_failed_at is null or f.manual_invoice_id is not null)");
    expect(sql).not.toMatch(/delete from private\.representative_kit_fulfillment_writes/u);
  });

  it("stores only a reason code and every function uses an empty search path", () => {
    expect(sql).toContain("auto_invoice_error ~ '^[a-z0-9_]{3,80}$'");
    const definers = sql.match(/security definer/gu)?.length ?? 0;
    const protectedFunctions = sql.match(/security definer set search_path = ''/gu)?.length ?? 0;
    expect(definers).toBeGreaterThan(0);
    expect(protectedFunctions).toBe(definers);
  });

  it("redefines the due queue and the fiscal readiness with the invoice mode", () => {
    expect(sql).toContain("create or replace function public.due_representative_kit_fulfillment()");
    expect(sql).toContain("create or replace function private.representative_kit_fiscal_ready");
    expect(sql).toContain("private.representative_kit_invoice_mode(o) as \"invoicemode\"");
  });
});
