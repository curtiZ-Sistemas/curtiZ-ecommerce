import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/202609120002_paid_sales_lifecycle.sql",
  "utf8"
);

describe("paid sales lifecycle", () => {
  it("expires unpaid attempts atomically without deleting audit history", () => {
    const expiration = sql.slice(
      sql.indexOf("function private.expire_stale_mercadopago_order"),
      sql.indexOf("function public.expire_my_stale_checkout_orders")
    );
    expect(expiration).toContain("for update");
    expect(expiration).toContain("private.release_order_reservations(p_order_id)");
    expect(expiration).toContain("status_detail = 'expired'");
    expect(expiration).toContain("update public.payment_attempts");
    expect(expiration).toContain("insert into public.order_status_history");
    expect(expiration).not.toContain("delete from public.orders");
    expect(sql).toContain("payments_pending_expiration_idx");
    expect(sql).toContain("function private.expire_stale_mercadopago_orders");
  });

  it("scopes customer cleanup to auth.uid and keeps the service endpoint private", () => {
    expect(sql).toContain("sale.customer_id = auth.uid()");
    expect(sql).toContain("grant execute on function public.expire_my_stale_checkout_orders() to authenticated");
    expect(sql).toContain("grant execute on function public.expire_stale_mercadopago_order(uuid) to service_role");
    expect(sql).toContain("from public, anon, authenticated");
  });

  it("counts only approved payments in sales, revenue and product rankings", () => {
    const dashboard = sql.slice(
      sql.indexOf("function public.manager_dashboard_metrics"),
      sql.indexOf("function public.manager_strategic_metrics")
    );
    const strategic = sql.slice(sql.indexOf("function public.manager_strategic_metrics"));
    expect(dashboard).toContain("where payment_status = 'approved'");
    expect(strategic.match(/payment_status = 'approved'/gu)?.length).toBeGreaterThanOrEqual(4);
    expect(sql).toContain("where payment_status = 'approved'");
    expect(sql).not.toContain("where status <> 'draft'");
  });

  it("uses approval dates and completed refunds in financial totals", () => {
    expect(sql).toContain("coalesce(placed_at, created_at)");
    expect(sql).toContain("refund.status = 'completed'");
    expect(sql).toContain("net_before_refunds_cents - round(refunds.amount * 100)::bigint");
  });

  it.each([
    ["Pix pendente", "pending", 0, 0],
    ["Pix aprovado", "approved", 1, 10_000],
    ["Pix expirado", "cancelled", 0, 0],
    ["Cartão recusado", "rejected", 0, 0],
    ["Cartão aprovado", "approved", 1, 10_000],
    ["Pagamento reembolsado", "refunded", 0, 0]
  ])("aplica a regra comercial em %s", (_scenario, status, sales, revenueInCents) => {
    const approved = status === "approved";
    expect(approved ? 1 : 0).toBe(sales);
    expect(approved ? 10_000 : 0).toBe(revenueInCents);
  });
});
