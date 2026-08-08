import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/202608080010_panel_data_access_stability.sql",
  "utf8"
).toLowerCase();
const operationsRoute = readFileSync(
  "apps/panel/src/app/api/operations/route.ts",
  "utf8"
);

describe("panel data access stability", () => {
  it("stops with a clear error when the help center migration is missing", () => {
    expect(migration).toContain("202608080006_help_center_reform.sql is not applied");
    expect(migration).toContain("public.help_contents");
    expect(migration).toContain("public.help_content_feedback");
  });

  it("enables RLS before restoring authenticated access", () => {
    const enableRls = migration.indexOf("enable row level security");
    const authenticatedGrant = migration.indexOf(
      "grant select, insert, update, delete on table"
    );

    expect(enableRls).toBeGreaterThanOrEqual(0);
    expect(authenticatedGrant).toBeGreaterThan(enableRls);
    expect(migration).not.toContain("grant all privileges on table %i.%i to authenticated");
    expect(migration).not.toContain("grant truncate");
    expect(migration).not.toContain(" to anon");
  });

  it("restores backend access and limits default privileges to service role", () => {
    expect(migration).toContain("grant all privileges on table %i.%i to service_role");
    expect(migration).toContain("alter default privileges for role postgres");
    expect(migration).not.toMatch(/alter default privileges[\s\S]*to authenticated/iu);
    expect(migration).toContain("notify pgrst, 'reload schema'");
  });

  it("disambiguates the direct relationship between orders and shipments", () => {
    expect(operationsRoute).toContain("shipments!shipments_order_id_fkey(");
  });
});
