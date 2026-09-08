import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/202609080002_product_size_guide.sql",
  "utf8"
);

describe("product size guide migration", () => {
  it("keeps public writes blocked and syncs entries inside the authorized save", () => {
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("force row level security");
    expect(migration).toContain("product.status = 'active'");
    expect(migration).toContain("private.has_permission('products.update')");
    expect(migration).toContain("revoke all on table public.product_size_guide_entries from public");
    expect(migration).toContain("delete from public.product_size_guide_entries where product_id = v_product_id");
    expect(migration).toContain("public.admin_save_product(p_payload)");
  });
});
