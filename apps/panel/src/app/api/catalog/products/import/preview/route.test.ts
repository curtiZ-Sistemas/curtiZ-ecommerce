import { NextRequest } from "next/server";
import type * as SecurityModule from "@curtiz/security";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  readFormResponse: vi.fn(),
  parseWorkbook: vi.fn(),
  productPreview: vi.fn(),
  objectRows: vi.fn((value: unknown): unknown[] => Array.isArray(value)
    ? value.map((entry: unknown) => entry)
    : [])
}));

vi.mock("@curtiz/security", async (importOriginal) => ({
  ...await importOriginal<typeof SecurityModule>(),
  logServerEvent: vi.fn(),
  readFormResponse: mocks.readFormResponse,
  readJsonResponse: vi.fn()
}));
vi.mock("@/lib/product-import", () => ({
  PRODUCT_IMPORT_MAX_BYTES: 5 * 1024 * 1024,
  parseProductImportWorkbook: mocks.parseWorkbook,
  productImportPreview: mocks.productPreview
}));
vi.mock("@/lib/admin-api", () => ({
  authorizeAdminRequest: vi.fn(async () => ({ supabase: { rpc: mocks.rpc, from: mocks.from }, userId: "20000000-0000-0000-0000-000000000001" })),
  objectRows: mocks.objectRows,
  privateNoStore: { "Cache-Control": "private, no-store" },
  safePanelOrigin: vi.fn(() => true),
  unauthorizedAdminResponse: vi.fn()
}));

import { POST } from "./route";

const batch = {
  schemaVersion: "curtiz_import_v1",
  colorCount: 1,
  imageCount: 0,
  issues: [],
  products: [{
    key: "PROD-1", shopeeId: "1", source: "shopee", name: "Produto", categoryName: "Chinelos",
    modelName: "", collectionName: "", issues: []
  }]
};

describe("product import preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue({ data: false, error: null });
  });

  it("returns 403 before reading the workbook when permission is denied", async () => {
    const response = await POST(new NextRequest("https://painel.example/api/catalog/products/import/preview", { method: "POST" }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ message: "Seu acesso não permite importar produtos." });
    expect(mocks.rpc.mock.calls).toEqual([
      ["has_permission", { permission_code: "products.create" }],
      ["has_permission", { permission_code: "products.update" }],
      ["has_permission", { permission_code: "inventory.adjust" }]
    ]);
  });

  it("parses the XLSX once and creates an opaque normalized session", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2, 3])], "produtos.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    }));
    mocks.readFormResponse.mockResolvedValue(form);
    mocks.parseWorkbook.mockResolvedValue(batch);
    mocks.productPreview.mockReturnValue({
      schemaVersion: "curtiz_import_v1",
      summary: { products: 1, variations: 1, images: 0, colors: 1, warnings: 0, errors: 0 },
      products: [{ key: "PROD-1", name: "Produto", category: "Chinelos", variations: 1, images: 0, warnings: [], errors: [] }],
      issues: []
    });
    mocks.from.mockImplementation((table: string) => {
      if (table === "categories") return { select: () => Promise.resolve({ data: [{ id: "20000000-0000-0000-0000-000000000002", name: "Chinelos" }], error: null }) };
      if (table === "product_models" || table === "collections") return { select: () => Promise.resolve({ data: [], error: null }) };
      if (table === "product_import_sources") return { select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) };
      return {
        delete: () => ({ eq: () => ({ lt: () => Promise.resolve({ error: null }) }) }),
        insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: "20000000-0000-0000-0000-000000000003" }, error: null }) }) })
      };
    });

    const response = await POST(new NextRequest("https://painel.example/api/catalog/products/import/preview", { method: "POST" }));
    const body = await response.json() as { sessionId?: string };

    expect(response.status).toBe(200);
    expect(body.sessionId).toBe("20000000-0000-0000-0000-000000000003");
    expect(mocks.parseWorkbook).toHaveBeenCalledTimes(1);
    expect(mocks.from).toHaveBeenCalledWith("product_import_sessions");
  });
});
