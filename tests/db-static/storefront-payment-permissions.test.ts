import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/202609140001_public_size_guide_permissions.sql", "utf8");
describe("public product dependent queries", () => {
  it("grants only the product columns required by media and size-guide RLS", () => {
    expect(migration).toContain("grant select (id, status) on table public.products to anon");
    expect(migration).not.toMatch(/grant select on (?:table )?public.products/i);
    expect(migration).not.toMatch(/grant.*(?:private|orders|profiles|cost_price)/i);
    expect(migration).not.toMatch(/disable row level security/i);
  });
  it("keeps internal permission checks out of the anonymous policy", () => {
    const publicPolicy = migration.split('create policy "public reads active product size guides"')[1]?.split("drop policy")[0];
    expect(publicPolicy).toContain("product.status = 'active'");
    expect(publicPolicy).not.toContain("private.has_permission");
    expect(migration).toContain("for select to authenticated using (private.has_permission('products.read'))");
  });
});
