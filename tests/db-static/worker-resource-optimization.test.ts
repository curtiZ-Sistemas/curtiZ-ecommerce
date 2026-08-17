import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase",
    "migrations",
    "202608170001_worker_resource_optimization.sql"
  ),
  "utf8"
).toLowerCase();

const operationsRoute = readFileSync(
  resolve(process.cwd(), "apps", "panel", "src", "app", "api", "operations", "route.ts"),
  "utf8"
);

const adminDashboardRoute = readFileSync(
  resolve(process.cwd(), "apps", "panel", "src", "app", "api", "admin", "dashboard", "route.ts"),
  "utf8"
);

const managerDashboardRoute = readFileSync(
  resolve(process.cwd(), "apps", "panel", "src", "app", "api", "manager", "dashboard", "route.ts"),
  "utf8"
);

describe("worker resource optimization", () => {
  it("consolida os onze indicadores operacionais em uma RPC protegida", () => {
    expect(migration).toContain("create or replace function public.operational_dashboard_metrics()");
    expect(migration).toContain("private.require_permission('operations.dashboard.read')");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("from public, anon");
    expect(migration).toContain("to authenticated");
    expect((migration.match(/select count\(\*\)/gu) ?? [])).toHaveLength(11);
  });

  it("consulta somente os conjuntos usados pela seção operacional atual", () => {
    expect(operationsRoute).toContain('supabase.rpc("operational_dashboard_metrics")');
    expect(operationsRoute).toContain("needsOrders ? orderQuery : emptyResult()");
    expect(operationsRoute).toContain("needsInventory ? inventoryQuery : emptyResult()");
    expect(operationsRoute).toContain("needsOccurrences ? occurrenceQuery : emptyResult()");
    expect(operationsRoute).not.toContain("const metricQueries = [");
  });

  it("mantém os dashboards administrativo e gerencial com payload limitado", () => {
    expect(adminDashboardRoute).toContain('rpc("operational_critical_stock_count")');
    expect(adminDashboardRoute).not.toContain(
      '.from("inventory").select("variant_id,available_quantity,minimum_quantity")'
    );
    expect(managerDashboardRoute).toContain('searchParams.get("includeOptions") !== "0"');
    expect(managerDashboardRoute).toMatch(/includeOptions\s*\?/u);
  });
});
