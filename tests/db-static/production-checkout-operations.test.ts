import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/202609120006_production_checkout_operations.sql",
  "utf8"
);

describe("production checkout operations migration", () => {
  it("uses a bounded stock-aware RPC with least-privilege grants", () => {
    expect(migration).toContain("function public.cart_variant_stock_availability");
    expect(migration).toContain("stock.available_quantity > 0");
    expect(migration).toContain("where requested.position <= 50");
    expect(migration).toContain("grant execute on function public.cart_variant_stock_availability(uuid[]) to anon, authenticated");
  });

  it("filters customer-visible orders before applying the limit", () => {
    const functionSql = migration.slice(
      migration.indexOf("function public.list_my_visible_orders"),
      migration.indexOf("function private.expire_stale_mercadopago_orders")
    );
    expect(functionSql).toContain("sale.customer_id = auth.uid()");
    expect(functionSql).toContain("payment.payment_method_summary");
    expect(functionSql.indexOf("payment.status_detail, '') <> 'expired'")).toBeLessThan(functionSql.indexOf("limit p_limit"));
    expect(functionSql).toContain("grant execute on function public.list_my_visible_orders(integer) to authenticated");
    expect(functionSql).not.toContain("to anon");
  });

  it("serializes bounded idempotent housekeeping without widening grants", () => {
    expect(migration).toContain("pg_try_advisory_xact_lock");
    expect(migration).toContain("limit p_limit");
    expect(migration).toContain("private.expire_stale_mercadopago_order(candidate.order_id)");
    expect(migration).toContain("from public, anon, authenticated");
  });

  it("enforces attachment scanning in RLS and Storage, not only in the API", () => {
    expect(migration).toContain("attachment.scan_status = 'clean'");
    expect(migration).toContain("scan_status = 'pending'");
    expect(migration).toContain("coalesce((storage.foldername(name))[2], '') <> 'support'");
    expect(migration).toContain("attachment.storage_path = name and attachment.scan_status = 'clean'");
    expect(migration).toContain("support participants read clean attachment files");
    expect(migration).toContain("support participants create pending attachment metadata");
  });
});
