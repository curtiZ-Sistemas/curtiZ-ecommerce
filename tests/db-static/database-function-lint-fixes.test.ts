import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/202608210002_database_function_lint_fixes.sql",
  "utf8"
);

describe("database function lint fixes", () => {
  it("uses columns and enum values that exist in the current schema", () => {
    expect(migration).toContain("referral_relationships(representative_id, sponsor_id, source)");
    expect(migration).toContain("'rejected', 'completed', 'cancelled'");
    expect(migration).toContain("previous_data_sanitized");
    expect(migration).not.toContain("old_data_sanitized");
  });

  it("does not depend on migration metadata existing", () => {
    expect(migration).toContain("to_regclass('supabase_migrations.schema_migrations')");
    expect(migration).toContain(
      "execute 'select max(version)::text from supabase_migrations.schema_migrations'"
    );
  });

  it("qualifies the canonical cart id and preserves server-side recalculation", () => {
    expect(migration).toContain("target_cart_id uuid");
    expect(migration).toContain("where item.cart_id = target_cart_id");
    expect(migration).toContain("public.merge_customer_cart(p_lines, p_source_cart_id)");
    expect(migration).toContain("greatest(stock.available_quantity, 0)");
    expect(migration).toContain("coalesce(variant.price_override, product.base_price)");
  });

  it("keeps homepage ordering serialized and revision checked", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("homepage revision conflict");
    expect(migration).toContain("for position_index in");
  });
});
