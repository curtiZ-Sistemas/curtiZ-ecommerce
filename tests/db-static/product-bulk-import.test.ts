import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const originalMigration = readFileSync("supabase/migrations/202609210001_product_bulk_imports.sql", "utf8").toLowerCase();
const fixMigration = readFileSync("supabase/migrations/202609220001_product_import_reliability.sql", "utf8").toLowerCase();

describe("product bulk import migration", () => {
  it("serializes external keys and reuses the transactional authorized product save", () => {
    expect(originalMigration).toContain("primary key (source, external_key)");
    expect(fixMigration).toContain("pg_advisory_xact_lock");
    expect(fixMigration).not.toContain("p_source || chr(0) || p_external_key");
    expect(fixMigration).toContain("hashtextextended(p_source || ':' || p_external_key, 0)");
    expect(fixMigration).toContain("admin_save_product_authorized(import_payload)");
    expect(fixMigration).toContain("'alreadyimported', true");
  });

  it("forces every imported product to remain a draft", () => {
    expect(fixMigration).toContain("jsonb_set(p_payload - 'productid', '{status}', '\"draft\"'::jsonb, true)");
  });

  it("preserves the current save features while restoring merchant metadata", () => {
    expect(fixMigration).toContain("admin_save_product_merchant_metadata(v_product_id, p_payload)");
    expect(fixMigration).toContain("color_hex_secondary");
    expect(fixMigration).toContain("product_size_guide_entries");
    expect(fixMigration).toContain("product_specifications");
    expect(fixMigration).toContain("product_categories");
  });

  it("resolves representative color images before generic product images", () => {
    expect(fixMigration.match(/lower\(image_variant\.color_name\) = lower\(variant\.color_name\)/gu)).toHaveLength(3);
    expect(fixMigration.match(/when image\.variant_id = variant\.id then 0/gu)).toHaveLength(3);
    expect(fixMigration.match(/when image_variant\.id is not null then 1/gu)).toHaveLength(3);
  });
});
