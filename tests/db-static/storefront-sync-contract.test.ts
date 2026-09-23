import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const catalog = readFileSync("supabase/migrations/202609230002_catalog_visual_cards.sql", "utf8").toLowerCase();
const importSync = readFileSync("supabase/migrations/202609230001_product_import_sync.sql", "utf8").toLowerCase();
const publication = readFileSync("supabase/migrations/202609230003_product_media_publish_guard.sql", "utf8").toLowerCase();
const configuration = readFileSync("supabase/migrations/202609230004_store_config_navigation_faq.sql", "utf8").toLowerCase();

describe("storefront sync migration contract", () => {
  it("groups visual cards by product and real image without treating size as a card", () => {
    expect(catalog).toContain("group by item.product_id, item.image_path");
    expect(catalog).toContain("case when grouped.member_count = 1 then item.variant_id else null::uuid end");
    expect(catalog).toContain("image.width > 0 and image.height > 0");
    expect(catalog).toContain("variant.size = any(p_sizes)");
    expect(catalog).toContain("inventory.available_quantity - inventory.reserved_quantity > 0");
  });

  it("blocks new active products without a valid image while preserving legacy rows", () => {
    expect(publication).toContain("old.status is distinct from new.status");
    expect(publication).toContain("from public.product_images image");
    expect(publication).toContain("image.width > 0 and image.height > 0");
    expect(publication).not.toContain("delete from public.products");
  });

  it("does not turn an old color image into generic media when that color disappears", () => {
    expect(importSync).toContain("if target_variant_id is null then continue; end if;");
    expect(importSync).toContain("if target_variant_id is null then return new; end if;");
  });

  it("preserves manual navigation and omitted optional sheets", () => {
    expect(configuration).toContain("private.require_permission('catalog.taxonomy.manage')");
    expect(configuration).toContain("navigation.source = 'manual'");
    expect(configuration).toContain("if p_items is null then");
    expect(configuration).toContain("navigation.source_key like 'sheet:%'");
    expect(configuration).toContain("where source = 'xlsx_config'");
    expect(configuration).not.toContain("delete from public.store_navigation_items");
    expect(configuration).toContain("'safe_component','faq'");
  });
});
