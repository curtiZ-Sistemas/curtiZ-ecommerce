import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202608030003_public_storefront_product.sql"),
  "utf8"
).toLowerCase();

describe("public storefront product migration", () => {
  it("exposes only active catalog data with a fixed search path", () => {
    expect(sql).toContain("product.status = 'active'");
    expect(sql).toContain("review.status = 'approved'");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
  });

  it("recalculates variant prices and available stock in the database", () => {
    expect(sql).toContain("coalesce(variant.price_override, product.base_price)");
    expect(sql).toContain("inventory.available_quantity - inventory.reserved_quantity");
    expect(sql).toContain(
      "grant execute on function public.get_catalog_product(text) to anon, authenticated"
    );
  });
});
