import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/202609200001_reconcile_product_save_schema.sql",
  "utf8"
);

describe("product save schema reconciliation", () => {
  it("only drops NOT NULL from the nine optional product columns", () => {
    const statements = migration.replace(/--[^\n]*/gu, "").trim();
    expect(statements).toMatch(/^alter table public\.products\s/u);
    expect(statements.match(/alter column \w+ drop not null/gu)).toHaveLength(9);
    for (const column of [
      "short_description", "description", "category_id", "base_price", "cost_price",
      "weight_grams", "height_cm", "width_cm", "length_cm"
    ]) {
      expect(statements).toContain(`alter column ${column} drop not null`);
    }
    expect(statements).not.toMatch(/\b(drop constraint|drop table|delete from|truncate|disable row level security)\b/iu);
  });
});
