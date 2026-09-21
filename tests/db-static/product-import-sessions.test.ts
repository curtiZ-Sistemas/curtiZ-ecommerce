import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/202609210002_product_import_sessions.sql", "utf8").toLowerCase();
const previewRoute = readFileSync("apps/panel/src/app/api/catalog/products/import/preview/route.ts", "utf8");
const importRoute = readFileSync("apps/panel/src/app/api/catalog/products/import/route.ts", "utf8");
const drawer = readFileSync("apps/panel/src/components/product-import-drawer.tsx", "utf8");

describe("product import sessions", () => {
  it("keeps short-lived normalized sessions private to their owner", () => {
    expect(migration).toContain("user_id = auth.uid()");
    expect(migration).toContain("expires_at > now()");
    expect(migration).toContain("interval '1 hour'");
    expect(migration).toContain("octet_length(payload::text) <= 2097152");
    expect(migration).toContain("force row level security");
  });

  it("parses the workbook only in preview and imports later through the opaque session", () => {
    expect(previewRoute.match(/await parseProductImportWorkbook\(/gu)).toHaveLength(1);
    expect(importRoute).not.toContain("parseProductImportWorkbook");
    expect(importRoute).not.toContain("readFormResponse");
    expect(importRoute).not.toContain('from "@/lib/product-import"');
    expect(drawer).toContain("JSON.stringify({ sessionId: preview.sessionId, productKey, imageOffset })");
    expect(drawer).not.toContain('form.set("productKey"');
  });

  it("saves the draft before entering the separately resumable image stage", () => {
    expect(importRoute.indexOf('if (imageOffset === -1)')).toBeLessThan(importRoute.indexOf('stage = "images"'));
    expect(importRoute).toContain('status: "draft"');
    expect(importRoute).toContain("stock: 0");
    expect(importRoute).toContain('eq("user_id", auth.userId).gt("expires_at"');
    expect(importRoute).toContain("imageFailures = true");
    expect(importRoute).not.toContain('from("products").delete()');
  });
});
