import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase",
    "migrations",
    "202608030004_customer_account.sql"
  ),
  "utf8"
).toLowerCase();

describe("customer account migration without a local database", () => {
  it("keeps every privileged customer function on an explicit empty search path", () => {
    expect(migration.match(/security definer/g)).toHaveLength(3);
    expect(migration.match(/security definer\s+set search_path = ''/g)).toHaveLength(3);
  });

  it("validates ownership and state for cancellation and returns", () => {
    expect(migration).toContain("customer_order.customer_id = auth.uid()");
    expect(migration).toContain(
      "previous_status not in ('pending_payment', 'payment_approved', 'processing')"
    );
    expect(migration).toContain("customer_order.status = 'delivered'");
    expect(migration).toContain("open_return_already_exists");
  });

  it("only accepts reviews for a delivered item owned by the authenticated customer", () => {
    expect(migration).toContain('create policy "customer creates delivered purchase reviews"');
    expect(migration).toContain("order_item_id is not null");
    expect(migration).toContain("customer_order.customer_id = auth.uid()");
    expect(migration).toContain("customer_order.status = 'delivered'");
    expect(migration).toContain("reviews_one_per_order_item");
  });

  it("protects addresses and private review media from IDOR", () => {
    expect(migration).toContain("where id = p_id and user_id = auth.uid()");
    expect(migration).toContain("customer_id = auth.uid()");
    expect(migration).toContain("(storage.foldername(name))[1] = auth.uid()::text");
    expect(migration).toContain("alter table public.review_media force row level security");
  });

  it("allows customers to read return items and update only their notifications", () => {
    expect(migration).toContain('create policy "customer reads own return items"');
    expect(migration).toContain('create policy "customer updates own notifications"');
    expect(migration).toContain("user_id = auth.uid()");
  });
});
