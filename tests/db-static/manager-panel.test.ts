import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202608080002_manager_panel.sql"),
  "utf8"
);

describe("manager panel migration", () => {
  it("atribui permissões financeiras e de conteúdo ao papel manager", () => {
    expect(sql).toContain("select 'manager', id");
    for (const permission of [
      "financial.read_summary",
      "financial.read_full",
      "reports.export",
      "audit.read",
      "content.manage"
    ]) {
      expect(sql).toContain(`'${permission}'`);
    }
  });

  it("mantém funções privilegiadas protegidas e com search_path fixo", () => {
    for (const fn of [
      "manager_dashboard_metrics",
      "manager_create_commission_simulation",
      "manager_transition_commission_closing",
      "manager_restore_homepage_section",
      "manager_log_export",
      "manager_transition_representative",
      "manager_transition_creative_campaign"
    ]) {
      const start = sql.indexOf(`function public.${fn}`);
      expect(start).toBeGreaterThan(-1);
      const body = sql.slice(start, start + 1_200);
      expect(body).toContain("security definer");
      expect(body).toContain("set search_path = ''");
      expect(body).toContain("private.require_permission");
    }
  });

  it("revoga acesso público e exige motivo para reabertura", () => {
    expect(sql).toContain("revoke all on function public.manager_dashboard_metrics");
    expect(sql).toContain("revoke all on function public.manager_transition_commission_closing");
    expect(sql).toContain("revoke all on function public.manager_can_export");
    expect(sql).toContain("reopen reason is required");
    expect(sql).toContain("previous_data_sanitized");
    expect(sql).toContain("new_data_sanitized");
    expect(sql).toContain("alter table public.creative_campaign_approvals force row level security");
    expect(sql).toContain("campaign.approval_recorded");
  });
});
