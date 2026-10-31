import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/202609210002_product_import_sessions.sql", "utf8").toLowerCase();
const previewRoute = readFileSync("apps/panel/src/app/api/catalog/products/import/preview/route.ts", "utf8");
const importRoute = readFileSync("apps/panel/src/app/api/catalog/products/import/route.ts", "utf8");
const drawer = readFileSync("apps/panel/src/components/product-import-drawer.tsx", "utf8");
const panelCss = readFileSync("apps/panel/src/app/globals.css", "utf8");
const reliabilityMigration = readFileSync("supabase/migrations/202609220001_product_import_reliability.sql", "utf8").toLowerCase();
const imageQueueMigration = readFileSync("supabase/migrations/202609220003_product_import_image_queue.sql", "utf8").toLowerCase();
const imageWorker = readFileSync("apps/product-import-worker/src/index.ts", "utf8");

describe("product import sessions", () => {
  it("keeps short-lived normalized sessions private to their owner", () => {
    expect(migration).toContain("user_id = auth.uid()");
    expect(migration).toContain("expires_at > now()");
    expect(migration).toContain("interval '1 hour'");
    expect(migration).toContain("octet_length(payload::text) <= 2097152");
    expect(migration).toContain("force row level security");
    const deletePolicy = reliabilityMigration.split('create policy "product import sessions delete own"')[1]?.split(";")[0] ?? "";
    expect(deletePolicy).toContain("user_id = auth.uid()");
    expect(deletePolicy).not.toContain("expires_at > now()");
  });

  it("parses the workbook only in preview and imports later through the opaque session", () => {
    expect(previewRoute.match(/await parseProductImportWorkbook\(/gu)).toHaveLength(1);
    expect(importRoute).not.toContain("parseProductImportWorkbook");
    expect(importRoute).not.toContain("readFormResponse");
    expect(importRoute).not.toContain('from "@/lib/product-import"');
    expect(drawer).toContain("JSON.stringify({ sessionId: preview.sessionId, productKey, imageOffset })");
    expect(drawer).not.toContain('form.set("productKey"');
  });

  it("saves the draft and delegates resumable images to persistent Queue jobs", () => {
    expect(importRoute.indexOf('stage = "save_product"')).toBeLessThan(importRoute.indexOf('stage = "images"'));
    expect(importRoute).toContain('status: "draft"');
    expect(importRoute).toContain("stock: variant.stock");
    expect(importRoute).toContain('eq("user_id", auth.userId).gt("expires_at"');
    expect(importRoute).toContain("admin_enqueue_product_import_images");
    expect(importRoute).toContain("enqueueProductImportImages");
    expect(importRoute).not.toContain("await fetch(image.url");
    expect(importRoute).not.toContain('from("products").delete()');
    expect(imageQueueMigration).toContain("create table public.product_import_image_jobs");
    expect(imageQueueMigration).toContain("unique (product_id, normalized_url)");
    expect(imageWorker).toContain("async queue(");
    expect(imageWorker).toContain("boundedResponse");
    expect(imageWorker).not.toContain("next/server");
  });

  it("keeps import results readable in a horizontal strip with diagnostics", () => {
    expect(drawer).toContain("Resultado da importação");
    expect(drawer).toContain("Etapa:");
    expect(drawer).toContain("Referência:");
    expect(panelCss).toContain("overflow-x: auto");
    expect(panelCss).toContain("flex: 0 0 380px");
  });
});
