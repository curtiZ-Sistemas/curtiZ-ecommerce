import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/202608230002_store_search_relevance.sql"),
  "utf8"
);

describe("store search relevance", () => {
  it("ordena nome exato e prefixo antes de sinais secundários", () => {
    const exact = migration.indexOf("= input.term then 0");
    const prefix = migration.indexOf("like input.term || '%' then 1");
    const category = migration.indexOf("then 3");
    expect(exact).toBeGreaterThan(0);
    expect(prefix).toBeGreaterThan(exact);
    expect(category).toBeGreaterThan(prefix);
  });

  it("considera modelo, cor e SKU sem expor produtos inativos", () => {
    expect(migration).toContain("product_models");
    expect(migration).toContain("variant.color_name");
    expect(migration).toContain("variant.sku");
    expect(migration).toContain("p.status = 'active'");
  });

  it("mantém função pública limitada e com search_path seguro", () => {
    expect(migration).toMatch(/security definer[\s\S]*set search_path = ''/u);
    expect(migration).toContain("least(coalesce(p_limit, 5), 8)");
    expect(migration).toMatch(/grant execute on function public\.search_catalog_suggestions[\s\S]*to anon, authenticated/u);
  });
});
