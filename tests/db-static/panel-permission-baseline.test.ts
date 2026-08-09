import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const permissions = readFileSync(
  "supabase/migrations/202608080014_panel_permission_baseline.sql",
  "utf8"
).toLowerCase();
const metrics = readFileSync(
  "supabase/migrations/202608080015_operational_metrics_scaling.sql",
  "utf8"
).toLowerCase();
const operations = readFileSync("apps/panel/src/app/api/operations/route.ts", "utf8");

describe("panel production baseline", () => {
  it.each(["operational", "admin", "manager", "technical"])(
    "creates production role permissions for %s without relying on seed",
    (role) => expect(permissions).toContain(`select '${role}', id from public.permissions`)
  );

  it("keeps permission decisions in RLS helpers and reloads the API schema", () => {
    expect(permissions).toContain("on conflict do nothing");
    expect(permissions).toContain("notify pgrst, 'reload schema'");
  });

  it("aggregates critical stock in the database with server-side authorization", () => {
    expect(metrics).toContain("perform private.require_permission('inventory.read')");
    expect(metrics).toContain("select count(*)");
    expect(metrics).toContain("set search_path = ''");
    expect(operations).toContain('supabase.rpc("operational_critical_stock_count")');
    expect(operations).not.toContain('.limit(10000)');
  });
});
