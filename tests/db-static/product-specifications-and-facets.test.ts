import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const details = readFileSync("supabase/migrations/202609200002_product_specifications.sql", "utf8");
const facets = readFileSync("supabase/migrations/202609200003_catalog_color_facets.sql", "utf8");
const twoToneColors = readFileSync("supabase/migrations/202609200004_two_tone_product_colors.sql", "utf8");

describe("product details and live color facets", () => {
  it("keeps details optional, permissioned and in the authorized product transaction", () => {
    expect(details).toContain("product_id uuid not null references public.products(id)");
    expect(details).toContain("force row level security");
    expect(details).toContain("private.require_permission('products.update')");
    expect(details).toContain("private.require_permission('inventory.adjust')");
    expect(details).toContain("public.admin_save_product(p_payload)");
    expect(details).toContain("delete from public.product_size_guide_entries");
    expect(details).toContain("delete from public.product_specifications");
    expect(details).toContain("if p_payload ? 'specifications'");
    expect(details).toContain("revoke all on function public.admin_save_product_authorized(jsonb) from public, anon");
  });

  it("calculates color counts from eligible variants before pagination", () => {
    expect(facets).toContain("from scoped item");
    expect(facets).toContain("inventory.available_quantity - inventory.reserved_quantity > 0");
    expect(facets).toContain("pg_catalog.count(distinct storefront_key)::integer amount");
    expect(facets).toContain("group by color_key");
    expect(facets).toContain("pg_catalog.regexp_replace(variant.color_name");
    expect(facets).not.toContain("Preta Strass");
  });

  it("stores the optional second tone without replacing the existing color identity", () => {
    expect(twoToneColors).toContain("add column if not exists color_hex_secondary char(7)");
    expect(twoToneColors).toContain("color_hex_secondary = nullif(trim(item.value->>'colorHexSecondary'), '')");
    expect(twoToneColors).toContain("variant.sku::text = trim(item.value->>'sku')");
    expect(twoToneColors).toContain("public.admin_save_product(p_payload)");
  });
});
