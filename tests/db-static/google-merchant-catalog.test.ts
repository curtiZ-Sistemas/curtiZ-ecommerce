import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202609010001_google_merchant_catalog.sql"),
  "utf8"
).toLowerCase();

describe("catálogo do Google Merchant", () => {
  it("expõe somente produto, categoria e variação ativos", () => {
    expect(sql).toContain("where product.status = 'active'");
    expect(sql).toContain("category.active");
    expect(sql).toContain("variant.active");
    expect(sql).toContain("greatest(inventory.available_quantity - inventory.reserved_quantity, 0)");
  });

  it("usa RPC pública mínima, protegida e sem dados inventados", () => {
    expect(sql).toContain("create or replace function public.get_google_merchant_feed()");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("grant execute on function public.get_google_merchant_feed() to anon, authenticated");
    expect(sql).not.toContain("shipping_price");
    expect(sql).not.toContain("review_count");
  });

  it("preserva campos opcionais e audita apenas contagens agregadas", () => {
    expect(sql).toContain("merchant_identifier_exists boolean");
    expect(sql).toContain("gtin_count");
    expect(sql).toContain("mpn_count");
  });
});
