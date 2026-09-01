import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/202609010002_variant_storefront.sql",
  "utf8"
).toLowerCase();
const catalogRoute = readFileSync("apps/store/src/app/api/catalog/route.ts", "utf8");
const sitemap = readFileSync("apps/store/src/app/sitemap.ts", "utf8");

describe("vitrine paginada por variação", () => {
  it("gera cards somente para variantes ativas com imagem explicitamente vinculada", () => {
    expect(sql).toContain("image.variant_id = variant.id");
    expect(sql).toContain("variant.active");
    expect(sql).toContain("nullif(trim(image.storage_path), '') is not null");
    expect(sql).toContain("image.width > 0 and image.height > 0");
    expect(sql).toContain("where not exists");
    expect(sql).toContain("from visual_variants visual");
  });

  it("mantém fallback de produto e valores individuais de preço e estoque", () => {
    expect(sql).toContain("coalesce(variant.price_override, product.base_price)");
    expect(sql).toContain("inventory.available_quantity");
    expect(sql).toContain("inventory.reserved_quantity");
    expect(sql).toContain("product.id::text || ':product'");
  });

  it("executa busca, filtros e paginação no banco antes do Worker", () => {
    expect(sql).toContain("websearch_to_tsquery('simple', trim(p_query))");
    expect(sql).toContain("item.variant_color");
    expect(sql).toContain("item.colors && p_colors");
    expect(sql).toContain("item.sizes && p_sizes");
    expect(sql).toContain("limit greatest(1, least(p_page_size, 48))");
    expect(sql).toContain("offset ((greatest(1, p_page) - 1)");
    expect(catalogRoute).toContain('supabase.rpc("search_catalog"');
  });

  it("não multiplica vendas ou recomendações por produto", () => {
    expect(sql).toContain("group by item.product_id");
    expect(sql).toContain("row_number() over(partition by item.product_id");
    expect(sql).toContain("where candidate.variant_rank=1");
  });

  it("usa variantId consentido para preferência de cor sem nova coleta", () => {
    expect(sql).toContain("add column color_scores jsonb");
    expect(sql).toContain("new.context_sanitized->>'variantid'");
    expect(sql).toContain("variant.product_id = new.product_id");
    expect(sql).toContain("profile.color_scores->>lower(item.variant_color)");
  });

  it("preserva produto real, favorito por variante e sitemap canônico", () => {
    expect(sql).toContain("variant_id uuid references public.product_variants(id)");
    expect(sql).toContain("variant.product_id = product_id");
    expect(sql).toContain("unique(customer_id, product_id, selection_key)");
    expect(sitemap).toContain("/produto/${encodeURIComponent(product.slug)}");
    expect(sitemap).not.toContain("variant=");
  });
});
