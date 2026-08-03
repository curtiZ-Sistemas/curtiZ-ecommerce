import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202608030002_authenticated_cart_sync.sql"),
  "utf8"
);

describe("authenticated cart synchronization migration", () => {
  it("requires an authenticated user and ignores browser prices", () => {
    expect(migration).toContain("v_user_id uuid := auth.uid()");
    expect(migration).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(migration).toContain("coalesce(variant.price_override, product.base_price)");
    expect(migration).not.toContain("item.requested_price_cents as current_price");
  });

  it("uses a fixed search path and grants access only to authenticated users", () => {
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain(
      "grant execute on function public.merge_customer_cart(jsonb, uuid) to authenticated"
    );
  });

  it("revalidates checkout lines against active variants and available stock", () => {
    expect(migration).toContain("public.validate_checkout_lines");
    expect(migration).toContain("stock.available_quantity - stock.reserved_quantity");
    expect(migration).toContain(
      "grant execute on function public.validate_checkout_lines(jsonb) to authenticated"
    );
  });
});
