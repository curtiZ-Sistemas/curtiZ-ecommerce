import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/202609200005_product_editor_drafts.sql",
  "utf8"
);
const pgTap = readFileSync("supabase/tests/product_editor_drafts_test.sql", "utf8");

describe("persistent product editor drafts", () => {
  it("stores exactly one permissioned draft per account with forced RLS", () => {
    expect(migration).toContain("user_id uuid primary key references public.profiles(id) on delete cascade");
    expect(migration).toContain("alter table public.product_editor_drafts enable row level security");
    expect(migration).toContain("alter table public.product_editor_drafts force row level security");
    expect(migration.match(/user_id = auth\.uid\(\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(migration).toContain("private.has_permission('products.create')");
    expect(migration).toContain("private.has_permission('products.update')");
    expect(migration).toContain("revoke all on table public.product_editor_drafts from public, anon");
  });

  it("makes newer autosaves win and clears the new-product draft inside the product transaction", () => {
    expect(migration).toContain("where public.product_editor_drafts.saved_at <= excluded.saved_at");
    expect(migration).toContain("admin_save_product_authorized_and_clear_draft");
    expect(migration).toContain("saved_product_id := public.admin_save_product_authorized(p_payload)");
    expect(migration).toContain("delete from public.product_editor_drafts where user_id = auth.uid()");
  });

  it("has pgTAP coverage for replacement, isolation, stale writes and deletion", () => {
    expect(pgTap).toContain("Repeated autosaves still keep one row");
    expect(pgTap).toContain("Older request cannot overwrite newer data");
    expect(pgTap).toContain("User B cannot delete user A draft");
    expect(pgTap).toContain("Owner can delete the draft permanently");
  });
});
