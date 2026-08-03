import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202608030008_admin_management.sql"),
  "utf8"
);

describe("admin management migration", () => {
  it("protege as novas tabelas com RLS forçada", () => {
    for (const table of [
      "product_models",
      "product_relations",
      "product_media",
      "homepage_section_versions",
      "training_contents"
    ]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`alter table public.${table} force row level security`);
    }
  });

  it("mantém funções privilegiadas com search_path fixo e grants explícitos", () => {
    for (const fn of [
      "admin_update_user_access",
      "admin_set_permission_override",
      "duplicate_product"
    ]) {
      const start = sql.indexOf(`function public.${fn}`);
      expect(start).toBeGreaterThan(-1);
      expect(sql.slice(start, start + 900)).toContain("security definer");
      expect(sql.slice(start, start + 900)).toContain("set search_path = ''");
    }
  });

  it("impede escalada direta para administrador e mudanças no próprio acesso", () => {
    expect(sql).toContain("if p_user_id = auth.uid()");
    expect(sql).toContain("if p_role = 'admin'");
    expect(sql).toContain("p_permission_code like 'users.%'");
  });

  it("versiona a home, limita quatro banners principais e audita mutações", () => {
    expect(sql).toContain("private.version_homepage_section");
    expect(sql).toContain("if active_count >= 4");
    expect(sql).toContain("private.audit_admin_resource");
  });
});
