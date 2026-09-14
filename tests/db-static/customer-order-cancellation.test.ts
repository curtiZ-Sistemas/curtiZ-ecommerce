import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const sql = readFileSync("supabase/migrations/202609140002_customer_order_cancellations.sql", "utf8");
describe("cancellation SQL security contract (not a concurrency execution test)", () => {
  it("locks ownership before claiming a hold and checking dispatch", () => {
    expect(sql).toContain("customer_id = p_customer_id for update");
    expect(sql).toContain("dispatched_at is not null");
    expect(sql).toContain("lease_until > now()");
    expect(sql).toContain("idempotency_key uuid not null unique");
  });
  it("retains privileged refund RPCs and binds customer authorization to the server hold", () => {
    expect(sql).toContain("c.idempotency_key = p_idempotency_key and o.status = 'refund_pending'");
    expect(sql).toContain("p_refund_amount = p.amount");
    expect(sql).not.toMatch(/grant.*finance.reconcile/i);
    expect(sql).toContain("from public, anon, authenticated;");
  });
  it("guards orders, tasks and shipments and reuses the reservation release", () => {
    for (const table of ["orders", "operational_tasks", "shipments"]) expect(sql).toContain(`on public.${table} for each row execute function private.guard_customer_cancellation_execution()`);
    expect(sql).toContain("perform private.release_order_reservations(new.id)");
    expect(sql).toContain("inventory_restored_at is null for update");
    expect(sql).toContain("payment_status = 'refunded'");
  });
});
