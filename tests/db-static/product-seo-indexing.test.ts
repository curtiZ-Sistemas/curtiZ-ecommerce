import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase", "migrations", "202609120003_product_seo_source_of_truth.sql"),
  "utf8"
).toLowerCase();
const catalog = readFileSync(
  resolve(process.cwd(), "apps", "store", "src", "lib", "catalog.ts"),
  "utf8"
).toLowerCase();
const middleware = readFileSync(
  resolve(process.cwd(), "apps", "store", "src", "middleware.ts"),
  "utf8"
).toLowerCase();
const productPage = readFileSync(
  resolve(process.cwd(), "apps", "store", "src", "app", "produto", "[slug]", "page.tsx"),
  "utf8"
).toLowerCase();

describe("indexação SEO de produtos", () => {
  it("deriva existência e sitemap da projeção comercial central", () => {
    expect(migration).toContain("from private.storefront_catalog_items() item");
    expect(migration).toContain("create or replace function public.storefront_product_exists");
    expect(migration).toContain("create or replace function public.get_storefront_product_seo_entries");
    expect(middleware).toContain('supabase.rpc(\n      "storefront_product_exists"');
  });

  it("remove o Slide Bold Marinho de fontes executáveis sem destruir histórico", () => {
    expect(catalog).not.toContain("slide-bold-marinho");
    expect(middleware).not.toContain('"slide-bold-marinho"');
    expect(migration).toContain("where slug = 'slide-bold-marinho'");
    expect(migration).toContain("set status = 'archived'");
    expect(migration).not.toMatch(/delete\s+from\s+public\.products/u);
    expect(migration).not.toMatch(/delete\s+from\s+public\.order/u);
  });

  it("mantém RPCs públicas estreitas e protegidas por security definer", () => {
    expect(migration.match(/security definer/gu)).toHaveLength(2);
    expect(migration.match(/set search_path = ''/gu)).toHaveLength(2);
    expect(migration).toContain("to anon, authenticated");
  });

  it("consulta cada página de produto dinamicamente para não preservar estado antigo", () => {
    expect(productPage).toContain('export const dynamic = "force-dynamic"');
  });
});
