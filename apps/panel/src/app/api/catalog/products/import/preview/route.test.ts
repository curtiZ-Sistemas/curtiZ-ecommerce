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
vi.mock("@/lib/product-import-session", () => ({
  productImportTaxonomySlug: (value: string) => value.toLocaleLowerCase("pt-BR").replace(/\s+/gu, "-")
}));
vi.mock("@/lib/admin-api", () => ({
  authorizeAdminRequest: vi.fn(async () => ({ supabase: { rpc: mocks.rpc, from: mocks.from }, userId: "20000000-0000-0000-0000-000000000001" })),
  objectRows: mocks.objectRows,
  privateNoStore: { "Cache-Control": "private, no-store" },
  safePanelOrigin: vi.fn(() => true),
  unauthorizedAdminResponse: vi.fn()
}));

import { POST } from "./route";

const importOptions = {
  createCategoryIfMissing: true,
  createModelIfMissing: true,
  associateColorImagesToAllSizes: true,
  deduplicateImageDownloadsByUrl: true
};
const batch = {
  schemaVersion: "curtiz_import_v1",
  colorCount: 1,
  imageCount: 0,
  options: importOptions,
  issues: [],
  products: [{
    key: "PROD-1", shopeeId: "1", source: "shopee", name: "Produto", categoryName: "Chinelos",
    modelName: "", collectionName: "", issues: [] as Array<{ level: "warning" | "error"; message: string }>
  }]
};

function previewFromBatch(value: typeof batch) {
  const product = value.products[0]!;
  return {
    schemaVersion: value.schemaVersion,
    summary: { products: 1, variations: 1, images: 0, colors: 1, warnings: product.issues.filter((issue) => issue.level === "warning").length, errors: product.issues.filter((issue) => issue.level === "error").length },
    products: [{
      key: product.key, name: product.name, category: product.categoryName, variations: 1, images: 0,
      warnings: product.issues.filter((issue) => issue.level === "warning").map((issue) => issue.message),
      errors: product.issues.filter((issue) => issue.level === "error").map((issue) => issue.message)
    }],
    issues: []
  };
}

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
    expect(mocks.rpc).toHaveBeenCalledWith("admin_create_product_import_run", {
      p_run_id: "20000000-0000-0000-0000-000000000003",
      p_products_total: 1
    });
  });

  it("returns a safe diagnostic when the import session migration is missing", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2, 3])], "produtos.xlsx"));
    mocks.readFormResponse.mockResolvedValue(form);
    mocks.parseWorkbook.mockResolvedValue(batch);
    mocks.productPreview.mockReturnValue({ schemaVersion: "curtiz_import_v1", summary: {}, products: [], issues: [] });
    mocks.from.mockImplementation((table: string) => {
      if (table === "categories" || table === "product_models" || table === "collections") {
        return { select: () => Promise.resolve({ data: [], error: null }) };
      }
      if (table === "product_import_sources") return { select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) };
      return {
        delete: () => ({ eq: () => ({ lt: () => Promise.resolve({ error: null }) }) }),
        insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: { code: "PGRST205" } }) }) })
      };
    });

    const response = await POST(new NextRequest("https://painel.example/api/catalog/products/import/preview", { method: "POST" }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      stage: "session",
      code: "IMPORT_SCHEMA_UNAVAILABLE",
      retryable: false
    });
  });

  it("previews missing category and model as planned creations without mutating taxonomy", async () => {
    const creatableBatch = structuredClone(batch);
    creatableBatch.products[0]!.modelName = "Slim Liso";
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.parseWorkbook.mockResolvedValue(creatableBatch);
    mocks.productPreview.mockImplementation(previewFromBatch);
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1])], "produtos.xlsx"));
    mocks.readFormResponse.mockResolvedValue(form);
    mocks.from.mockImplementation((table: string) => {
      if (table === "categories" || table === "product_models" || table === "collections") {
        return { select: () => Promise.resolve({ data: [], error: null }) };
      }
      if (table === "product_import_sources") return { select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) };
      return {
        delete: () => ({ eq: () => ({ lt: () => Promise.resolve({ error: null }) }) }),
        insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: "20000000-0000-0000-0000-000000000003" }, error: null }) }) })
      };
    });

    const response = await POST(new NextRequest("https://painel.example/api/catalog/products/import/preview", { method: "POST" }));
    const body = await response.json() as { products: Array<{ warnings: string[]; errors: string[] }> };

    expect(response.status).toBe(200);
    expect(body.products[0]?.warnings).toEqual([
      "Categoria: Chinelos — será criada",
      "Modelo: Slim Liso — será criado"
    ]);
    expect(body.products[0]?.errors).toEqual([]);
    expect(mocks.from).toHaveBeenCalledWith("categories");
    expect(mocks.from).toHaveBeenCalledWith("product_models");
  });

  it("reports missing taxonomy when automatic creation is disabled", async () => {
    const strictBatch = structuredClone(batch);
    strictBatch.options = { ...importOptions, createCategoryIfMissing: false, createModelIfMissing: false };
    strictBatch.products[0]!.modelName = "Slim Liso";
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.parseWorkbook.mockResolvedValue(strictBatch);
    mocks.productPreview.mockImplementation(previewFromBatch);
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1])], "produtos.xlsx"));
    mocks.readFormResponse.mockResolvedValue(form);
    mocks.from.mockImplementation((table: string) => {
      if (table === "categories" || table === "product_models" || table === "collections") return { select: () => Promise.resolve({ data: [], error: null }) };
      if (table === "product_import_sources") return { select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) };
      return { delete: () => ({ eq: () => ({ lt: () => Promise.resolve({ error: null }) }) }), insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: "20000000-0000-0000-0000-000000000003" }, error: null }) }) }) };
    });

    const response = await POST(new NextRequest("https://painel.example/api/catalog/products/import/preview", { method: "POST" }));
    const body = await response.json() as { products: Array<{ errors: string[] }> };

    expect(body.products[0]?.errors).toEqual([
      "Categoria não encontrada: Chinelos.",
      "Modelo não encontrado: Slim Liso."
    ]);
    expect(mocks.rpc).not.toHaveBeenCalledWith("has_permission", { permission_code: "catalog.taxonomy.manage" });
  });

  it("reports permission errors before importing missing taxonomy", async () => {
    const creatableBatch = structuredClone(batch);
    creatableBatch.products[0]!.modelName = "Slim Liso";
    mocks.rpc.mockImplementation(async (_name: string, args: { permission_code?: string }) => ({
      data: args.permission_code !== "catalog.taxonomy.manage",
      error: null
    }));
    mocks.parseWorkbook.mockResolvedValue(creatableBatch);
    mocks.productPreview.mockImplementation(previewFromBatch);
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1])], "produtos.xlsx"));
    mocks.readFormResponse.mockResolvedValue(form);
    mocks.from.mockImplementation((table: string) => {
      if (table === "categories" || table === "product_models" || table === "collections") return { select: () => Promise.resolve({ data: [], error: null }) };
      if (table === "product_import_sources") return { select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) };
      return { delete: () => ({ eq: () => ({ lt: () => Promise.resolve({ error: null }) }) }), insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: "20000000-0000-0000-0000-000000000003" }, error: null }) }) }) };
    });

    const response = await POST(new NextRequest("https://painel.example/api/catalog/products/import/preview", { method: "POST" }));
    const body = await response.json() as { products: Array<{ errors: string[] }> };

    expect(body.products[0]?.errors).toEqual([
      "Sem permissão para criar a categoria: Chinelos.",
      "Sem permissão para criar o modelo: Slim Liso."
    ]);
  });
});
