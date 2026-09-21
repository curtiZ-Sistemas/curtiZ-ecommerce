import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/202609210001_product_bulk_imports.sql",
  "utf8"
).toLowerCase();

describe("product bulk import migration", () => {
  it("serializes external keys and reuses the transactional authorized product save", () => {
    expect(migration).toContain("primary key (source, external_key)");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("admin_save_product_authorized(import_payload)");
    expect(migration).toContain("'alreadyimported', true");
  });

  it("forces every imported product to remain a draft", () => {
    expect(migration).toContain("jsonb_set(p_payload - 'productid', '{status}', '\"draft\"'::jsonb, true)");
  });
});
