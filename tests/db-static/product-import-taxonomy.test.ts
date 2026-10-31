import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/202609220002_product_import_taxonomy.sql", "utf8").toLowerCase();
const syncMigration = readFileSync("supabase/migrations/202609230001_product_import_sync.sql", "utf8").toLowerCase();
const importRoute = readFileSync("apps/panel/src/app/api/catalog/products/import/route.ts", "utf8");
const previewRoute = readFileSync("apps/panel/src/app/api/catalog/products/import/preview/route.ts", "utf8");

describe("product import taxonomy", () => {
  it("creates taxonomy only through a permission-checked transactional RPC", () => {
    expect(migration).toContain("private.require_permission('catalog.taxonomy.manage')");
    expect(migration).toContain("admin_import_product_with_taxonomy_authorized");
    expect(migration).toContain("return public.admin_import_product_authorized");
    expect(migration).toContain("security definer");
    expect(migration).toContain("revoke all on function private.resolve_product_import_taxonomy");
  });

  it("serializes slug creation and relies on unique conflict handling", () => {
    expect(migration).toContain("product-import-category:");
    expect(migration).toContain("product-import-model:");
    expect(migration.match(/pg_advisory_xact_lock/gu)).toHaveLength(3);
    expect(migration.match(/on conflict \(slug\) do nothing/gu)).toHaveLength(2);
  });

  it("keeps preview read-only and delegates the real save to the combined RPC", () => {
    expect(previewRoute).not.toContain('.from("categories").insert');
    expect(previewRoute).not.toContain('.from("product_models").insert');
    expect(previewRoute).toContain("catalog.taxonomy.manage");
    expect(previewRoute).toContain("— será criada");
    expect(previewRoute).toContain("— será criado");
    expect(importRoute).toContain('rpc("admin_sync_import_product_authorized"');
    expect(syncMigration).toContain("private.resolve_product_import_taxonomy");
    expect(syncMigration).toContain("public.admin_save_product_authorized(v_payload)");
    expect(syncMigration).toContain("v_source.product_hash = p_product_hash");
    expect(migration).not.toContain("create or replace function public.admin_save_product_authorized");
  });
});
