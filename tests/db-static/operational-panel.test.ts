import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase", "migrations", "202608030006_operational_panel.sql"),
  "utf8"
).toLowerCase();

describe("operational panel migration without a local database", () => {
  it("keeps every operational table behind forced RLS", () => {
    const tables = [
      "operational_tasks",
      "operational_task_items",
      "operational_occurrences",
      "operational_occurrence_attachments",
      "operational_inventory_adjustment_requests"
    ];

    for (const table of tables) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain(`alter table public.${table} force row level security`);
    }
  });

  it("protects privileged workflows with permissions and a fixed search path", () => {
    const definerCount = migration.match(/security definer/g)?.length ?? 0;
    const protectedCount =
      migration.match(/security definer\s+set search_path = ''/g)?.length ?? 0;

    expect(definerCount).toBeGreaterThan(0);
    expect(protectedCount).toBe(definerCount);
    expect(migration).toContain("private.require_permission('operations.tasks.execute')");
    expect(migration).toContain("private.require_permission('returns.inspect')");
  });

  it("prevents duplicate active workflows and unchecked completion", () => {
    expect(migration).toContain("create unique index operational_open_order_task_idx");
    expect(migration).toContain("create unique index operational_open_kit_task_idx");
    expect(migration).toContain("all task items must be checked");
    expect(migration).toContain("set status = 'blocked'");
  });

  it("allows operators to request but not directly apply inventory adjustments", () => {
    expect(migration).toContain("request_operational_inventory_adjustment");
    expect(migration).toContain("status text not null default 'pending'");
    expect(migration).not.toContain(
      "grant execute on function public.apply_inventory_adjustment"
    );
  });

  it("does not grant financial, commission or technical permissions to operations", () => {
    const operationalGrant = migration.match(
      /select 'operational', id[\s\S]*?on conflict do nothing;/
    )?.[0];

    expect(operationalGrant).toBeTruthy();
    expect(operationalGrant).not.toMatch(/financial|commission|technical|levels\./);
  });

  it("keeps occurrence attachments private and scoped by permission", () => {
    expect(migration).toContain("bucket_id = 'internal-private'");
    expect(migration).toContain("private.has_permission('operations.occurrences.read')");
    expect(migration).toContain("private.has_permission('operations.occurrences.create')");
  });
});
