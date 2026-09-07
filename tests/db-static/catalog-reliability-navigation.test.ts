import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202609070004_catalog_reliability_and_navigation.sql"),
  "utf8"
);

describe("confiabilidade do catálogo e navegação", () => {
  it("publica com dados comerciais mínimos sem exigir SEO ou dimensões", () => {
    const validation = migration.slice(
      migration.indexOf("if p_payload->>'status' = 'active'"),
      migration.indexOf("v_product_id := public.admin_save_product")
    );
    expect(validation).toContain("name");
    expect(validation).toContain("v_primary_category_id is null");
    expect(validation).toContain("priceInCents");
    expect(validation).not.toMatch(/seoTitle|merchantCondition|weightGrams|heightCm|widthCm|lengthCm/u);
  });

  it("protege a configuração com RLS e permissão mínima", () => {
    expect(migration).toContain("alter table public.store_navigation_items enable row level security");
    expect(migration).toContain("public reads visible store navigation");
    expect(migration).toContain("private.has_permission('catalog.taxonomy.manage')");
    expect(migration).toContain("admin_reorder_store_navigation");
  });

  it("não executa limpeza destrutiva automática de produtos", () => {
    expect(migration).not.toMatch(/delete\s+from\s+public\.products/iu);
    expect(migration).not.toMatch(/truncate/iu);
  });
});
