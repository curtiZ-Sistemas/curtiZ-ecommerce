import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/202609140004_customer_order_history_retention.sql",
  "utf8"
);

describe("customer order history retention migration", () => {
  it("keeps ownership and least-privilege enforcement in the customer RPC", () => {
    expect(migration).toContain("auth.uid() is null");
    expect(migration).toContain("sale.customer_id = auth.uid()");
    expect(migration).toContain("from public, anon");
    expect(migration).toContain("to authenticated");
    expect(migration).not.toContain("provider_payment_id', candidate.provider_payment_id");
  });

  it("uses canonical events and exact exclusive retention boundaries", () => {
    expect(migration).toContain("history.new_status = 'cancelled'");
    expect(migration).toContain("candidate.cancellation_completed_at + interval '72 hours'");
    expect(migration).toContain("candidate.refund_completed_at + interval '240 hours'");
    expect(migration).toContain("now() < candidate.cancellation_completed_at");
    expect(migration).toContain("now() < candidate.refund_completed_at");
    expect(migration).not.toMatch(/updated_at\s*\+\s*interval/);
  });

  it("does not hide unresolved refund problems", () => {
    expect(migration).toContain("candidate.status in ('refund_pending', 'manual_review')");
    expect(migration).toContain("candidate.refund_status in ('pending', 'failed')");
  });
});
