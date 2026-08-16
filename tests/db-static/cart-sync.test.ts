import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202608030002_authenticated_cart_sync.sql"),
  "utf8"
);
const stabilityMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202608080008_catalog_inventory_stability.sql"),
  "utf8"
);
const exactSyncMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202608160001_exact_customer_cart_sync.sql"),
  "utf8"
);
const exactQuantityMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202608160003_exact_cart_quantity_sync.sql"),
  "utf8"
);
const syncRoute = readFileSync(
  resolve(process.cwd(), "apps/store/src/app/api/cart/sync/route.ts"),
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
    expect(stabilityMigration).toContain(
      "'greatest(stock.available_quantity - stock.reserved_quantity, 0)'"
    );
    expect(stabilityMigration).toContain("'greatest(stock.available_quantity, 0)'");
    expect(migration).toContain(
      "grant execute on function public.validate_checkout_lines(jsonb) to authenticated"
    );
  });

  it("propagates remoções somente depois da primeira mesclagem autenticada", () => {
    expect(exactSyncMigration).toContain("p_source_cart_id = cart_id");
    expect(exactSyncMigration).toContain("delete from public.cart_items");
    expect(exactSyncMigration).toContain("set search_path = ''");
    expect(exactSyncMigration).toContain(
      "revoke all on function public.merge_customer_cart(jsonb, uuid) from authenticated"
    );
    expect(exactSyncMigration).toContain(
      "grant execute on function public.sync_customer_cart(jsonb, uuid) to authenticated"
    );
  });

  it("reduz quantidades exatamente e rejeita payloads adulterados no servidor", () => {
    expect(exactQuantityMigration).toContain("p_source_cart_id = cart_id");
    expect(exactQuantityMigration).toContain("set quantity = resolved.quantity");
    expect(exactQuantityMigration).toContain("delete from public.cart_items");
    expect(exactQuantityMigration).toContain("not between 1 and 99");
    expect(exactQuantityMigration).toContain("invalid_cart_line");
    expect(exactQuantityMigration).toContain("set search_path = ''");
    expect(exactQuantityMigration).toContain(
      "grant execute on function public.sync_customer_cart(jsonb, uuid) to authenticated"
    );
    expect(syncRoute).toContain("productId: postgresUuidSchema");
    expect(syncRoute).toContain("variantId: postgresUuidSchema");
    expect(syncRoute).toContain("quantity: z.number().int().min(1).max(99)");
  });
});
