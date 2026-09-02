import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/202609020002_global_activity_audit.sql"), "utf8");
const authRoute = readFileSync(resolve(process.cwd(), "apps/store/src/app/api/auth/[mode]/route.ts"), "utf8");

describe("global activity audit migration", () => {
  it("evolui a tabela central com ator, origem, ação, módulo e contexto", () => {
    for (const column of ["actor_name_snapshot", "actor_email_snapshot", "action_type", "module", "origin_type", "session_id_hash", "changed_fields", "transaction_id"]) {
      expect(sql).toContain(column);
    }
    expect(sql).toContain("private.audit_action_type");
    expect(sql).toContain("private.audit_module");
    expect(sql).toContain("public.log_internal_auth_event");
    expect(sql).toContain("America/Sao_Paulo");
  });

  it("sanitiza segredos, calcula antes/depois e impede mutação", () => {
    expect(sql).toContain("private.sanitize_audit_json");
    expect(sql).toMatch(/authorization\|cookie\|password/);
    expect(sql).toMatch(/bank\.\?account\|account\.\?number/);
    expect(sql).toContain("private.audit_changed_fields");
    expect(sql).toContain("before update or delete on public.audit_logs");
    expect(sql).toContain("audit logs are immutable");
    expect(sql).toContain("revoke insert, update, delete, truncate on public.audit_logs");
  });

  it("cobre criação, alteração e exclusão direta sem duplicar evento semântico", () => {
    expect(sql).toContain("after insert or update or delete");
    expect(sql).toContain("deferrable initially deferred");
    expect(sql).toContain("l.transaction_id = txid_current()");
    expect(sql).toContain("case when event_actor is null then 'system' else 'person' end");
    expect(sql).toContain("homepage-audit:");
  });

  it("expõe paginação, filtros, busca indexada e exportação autoauditada", () => {
    expect(sql).toContain("public.activity_log_page");
    expect(sql).toContain("limit safe_size offset");
    expect(sql).toContain("audit_logs_search_idx");
    expect(sql).toContain("p_actor is null or l.actor_id = p_actor");
    expect(sql).toContain("public.export_activity_logs");
    expect(sql).toContain("'audit.exported'");
    expect(sql).toContain("private.require_permission('reports.export')");
  });

  it("registra login e logout internos sem confiar em ator enviado pelo cliente", () => {
    expect(sql).toContain("actor uuid := auth.uid()");
    expect(sql).toContain("normalized_event not in ('LOGIN','LOGOUT')");
    expect(authRoute).toContain('p_event: "LOGIN"');
    expect(authRoute).toContain('p_event: "LOGOUT"');
    expect(authRoute).toMatch(/p_event: "LOGOUT"[\s\S]{0,200}supabase\.auth\.signOut\(\)/);
  });
});
