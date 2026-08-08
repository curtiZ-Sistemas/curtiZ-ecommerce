import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202608080003_technical_panel.sql"),
  "utf8"
);

describe("technical panel migration", () => {
  it("separa leitura e ações técnicas das permissões comerciais", () => {
    for (const permission of [
      "technical.health.read",
      "technical.logs.read",
      "technical.logs.manage",
      "technical.jobs.manage",
      "technical.webhooks.manage",
      "technical.features.manage",
      "technical.database.read"
    ]) expect(sql).toContain(permission);
    expect(sql).not.toMatch(/finance\.(write|manage)|products\.(write|manage)|commissions\.(write|manage)/);
  });

  it("protege todas as mutações por permissão e trilha de auditoria", () => {
    for (const functionName of [
      "technical_transition_job",
      "technical_reprocess_payment_event",
      "technical_resolve_event",
      "technical_set_feature_flag"
    ]) {
      const start = sql.indexOf(`function public.${functionName}`);
      expect(start).toBeGreaterThan(-1);
      const body = sql.slice(start, start + 2_400);
      expect(body).toContain("security definer");
      expect(body).toContain("set search_path = ''");
      expect(body).toContain("private.require_permission");
      expect(body).toContain("public.audit_logs");
    }
  });

  it("não libera funções privilegiadas ao público e nunca expõe SQL arbitrário", () => {
    expect(sql).not.toMatch(/using\s*\(\s*true\s*\)/i);
    expect(sql).not.toMatch(/execute\s+.*p_sql|query\s+text/i);
    expect(sql).toContain("revoke all on function public.technical_transition_job(uuid,text,text) from public, anon");
    expect(sql).toContain("private.has_permission('technical.storage.read')");
    expect(sql).toContain("private.require_permission('technical.database.read')");
    expect(sql).toContain("revoke all on function public.technical_database_summary() from public, anon");
    expect(sql).toContain("add column if not exists user_id uuid references public.profiles(id)");
    expect(sql).toContain("add column if not exists route text");
  });
});
