import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/202608080009_product_management_stability.sql",
  "utf8"
);

describe("product management stability migration", () => {
  it("salva produto, variações e inventário em uma função protegida", () => {
    expect(migration).toContain("function public.admin_save_product(p_payload jsonb)");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("private.require_permission('products.create')");
    expect(migration).toContain("insert into public.product_variants");
    expect(migration).toContain("insert into public.inventory(");
  });

  it("audita ajustes e não apaga variantes ausentes", () => {
    expect(migration).toContain("insert into public.inventory_movements");
    expect(migration).toContain("insert into public.audit_logs");
    expect(migration).toContain("set active = false");
    expect(migration).not.toMatch(/delete\s+from\s+public\.product_variants/iu);
  });

  it("protege e audita mudanças de status", () => {
    expect(migration).toContain("function public.admin_set_product_status(");
    expect(migration).toContain("'product_status_updated'");
    expect(migration).toContain("an active product requires at least one active variant");
    expect(migration).toContain(
      "grant execute on function public.admin_set_product_status(uuid, public.product_status, text) to authenticated"
    );
  });

  it("can be repeated after a partial execution", () => {
    const dropPolicy = migration.indexOf(
      'drop policy if exists "product managers remove catalog media"'
    );
    const createPolicy = migration.indexOf(
      'create policy "product managers remove catalog media"'
    );

    expect(dropPolicy).toBeGreaterThanOrEqual(0);
    expect(createPolicy).toBeGreaterThan(dropPolicy);
  });
});
