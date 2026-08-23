import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202608230005_product_management_drawer_delete.sql"),
  "utf8"
);

describe("product management safe deletion migration", () => {
  it("requires an explicit permission and records an audit event", () => {
    expect(migration).toContain("private.require_permission('products.delete')");
    expect(migration).toContain("'product.delete'");
    expect(migration).toContain("grant execute on function public.admin_delete_product(uuid) to authenticated");
  });

  it("checks every foreign-key dependency before deleting owned records", () => {
    expect(migration).toContain("pg_catalog.pg_constraint");
    expect(migration).toContain("private.product_has_deletion_dependencies(p_product_id)");
    expect(migration).toContain("raise exception 'product has related records'");
    expect(migration).toContain("delete from public.inventory");
  });
});
