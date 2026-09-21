import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(async () => ({ data: false, error: null }))
}));

vi.mock("@curtiz/security", () => ({ readFormResponse: vi.fn() }));
vi.mock("@/lib/product-import", () => ({
  PRODUCT_IMPORT_MAX_BYTES: 5 * 1024 * 1024,
  parseProductImportWorkbook: vi.fn(),
  productImportPreview: vi.fn()
}));
vi.mock("@/lib/admin-api", () => ({
  authorizeAdminRequest: vi.fn(async () => ({ supabase: { rpc: mocks.rpc } })),
  objectRows: vi.fn(),
  privateNoStore: { "Cache-Control": "private, no-store" },
  safePanelOrigin: vi.fn(() => true),
  unauthorizedAdminResponse: vi.fn()
}));

import { POST } from "./route";

describe("product import preview authorization", () => {
  it("returns 403 before reading the workbook when products.create is denied", async () => {
    const response = await POST(new NextRequest("https://painel.example/api/catalog/products/import/preview", {
      method: "POST"
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ message: "Seu acesso não permite importar produtos." });
    expect(mocks.rpc.mock.calls).toEqual([
      ["has_permission", { permission_code: "products.create" }],
      ["has_permission", { permission_code: "products.update" }],
      ["has_permission", { permission_code: "inventory.adjust" }]
    ]);
  });
});
