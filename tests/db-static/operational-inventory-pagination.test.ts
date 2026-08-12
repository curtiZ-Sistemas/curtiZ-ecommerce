import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase",
    "migrations",
    "202608110001_operational_inventory_pagination.sql"
  ),
  "utf8"
).toLowerCase();

describe("operational inventory pagination migration", () => {
  it("filters critical and damaged stock before applying pagination", () => {
    expect(migration).toContain("when 'critical' then inventory.available_quantity <= inventory.minimum_quantity");
    expect(migration).toContain("when 'damaged' then inventory.damaged_quantity > 0");
    expect(migration.indexOf("and case p_filter")).toBeLessThan(migration.indexOf("offset greatest"));
  });

  it("requires inventory permission and exposes no execution to anonymous users", () => {
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("private.require_permission('inventory.read')");
    expect(migration).toContain("from public, anon");
    expect(migration).toContain("to authenticated");
  });
});
