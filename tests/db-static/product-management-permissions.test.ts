import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/202608120001_product_management_permissions.sql",
  "utf8"
);

describe("product management permissions migration", () => {
  it("requires separate permissions for stock and archive operations", () => {
    expect(migration).toContain("private.require_permission('inventory.adjust')");
    expect(migration).toContain("private.require_permission('products.archive')");
    expect(migration).toContain("revoke all on function public.admin_save_product(jsonb) from authenticated");
    expect(migration).toContain("admin_save_product_authorized");
    expect(migration).toContain("admin_set_product_status_authorized");
  });
});
