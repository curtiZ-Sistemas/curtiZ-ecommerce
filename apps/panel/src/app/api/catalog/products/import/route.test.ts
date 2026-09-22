import { NextRequest } from "next/server";
import type * as SecurityModule from "@curtiz/security";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  readJsonResponse: vi.fn(),
  parseSession: vi.fn(),
  enqueueImages: vi.fn()
}));
const sessionState: { result: { data: unknown; error: { code?: string; message?: string } | null } } = {
  result: { data: null, error: null }
};

vi.mock("@curtiz/security", async (importOriginal) => ({
  ...await importOriginal<typeof SecurityModule>(),
  logServerEvent: vi.fn(), readJsonResponse: mocks.readJsonResponse
}));
vi.mock("@/lib/admin-api", () => ({
  authorizeAdminRequest: vi.fn(async () => ({ supabase: { rpc: mocks.rpc, from: mocks.from }, userId: "20000000-0000-0000-0000-000000000001" })),
  objectRows: (value: unknown): unknown[] => Array.isArray(value)
    ? value.map((entry: unknown) => entry)
    : [],
  privateNoStore: { "Cache-Control": "private, no-store" },
  safePanelOrigin: vi.fn(() => true),
  unauthorizedAdminResponse: vi.fn()
}));
vi.mock("@/lib/product-import-session", () => ({
  isAllowedShopeeImageUrl: vi.fn(() => true),
  parseProductImportSessionPayload: mocks.parseSession,
  productImportTaxonomySlug: vi.fn((value: string) => value.toLocaleLowerCase("pt-BR").replace(/\s+/gu, "-"))
}));
vi.mock("@/lib/product-import-images", async () => await import("../../../../../lib/product-import-images"));
vi.mock("@/lib/product-import-queue", () => ({ enqueueProductImportImages: mocks.enqueueImages }));
vi.mock("@/lib/catalog-image", () => ({ inspectCatalogImage: vi.fn() }));
vi.mock("@/lib/image-upload", () => ({ prepareUploadImage: vi.fn() }));
vi.mock("@/lib/product-management", () => ({ automaticProductSeo: vi.fn(() => ({ title: "Produto", description: "Produto" })) }));

import { POST } from "./route";

const request = () => new NextRequest("https://painel.example/api/catalog/products/import", { method: "POST" });
const importOptions = {
  createCategoryIfMissing: true,
  createModelIfMissing: true,
  associateColorImagesToAllSizes: true,
  deduplicateImageDownloadsByUrl: true
};
const normalizedProduct = {
  key: "PROD-1", shopeeId: "1", source: "shopee", name: "Produto", slug: "produto",
  categoryName: "Chinelos", modelName: "", collectionName: "", shortDescription: "", description: "",
  featured: false, priceInCents: 1_000, compareAtPriceInCents: 1_500, costInCents: 835,
  weightGrams: 300, heightCm: 8, widthCm: 20, lengthCm: 28,
  merchantCondition: "new", merchantGender: "female", merchantAgeGroup: "adult",
  googleProductCategory: "Apparel & Accessories > Shoes > Sandals", merchantIdentifierExists: false,
  variants: [{ variationKey: "V1", color: "Lilás", colorHex: "#C8A2C8", colorHexSecondary: "#FFFFFF", size: "35", sku: "SKU-1", active: true, stock: 10, priceInCents: 1_290, costInCents: 955, gtin: "7890000000001", mpn: "MPN-1" }],
  images: [{ url: "https://down-sg.img.susercontent.com/file/test", color: "Lilás", order: 0, primary: true, applyAllSizes: true }],
  sizeGuide: [{ size: "35", measurementCm: 23.5 }], specifications: [{ label: "Material", value: "Borracha" }], issues: []
};

function sessionQuery() {
  const query = {
    select: vi.fn(), eq: vi.fn(), gt: vi.fn(),
    maybeSingle: vi.fn(async () => sessionState.result)
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.gt.mockReturnValue(query);
  return query;
}

describe("product import session API", () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    vi.clearAllMocks();
    sessionState.result = { data: null, error: null };
    mocks.readJsonResponse.mockResolvedValue({
      sessionId: "20000000-0000-0000-0000-000000000003", productKey: "PROD-1", imageOffset: -1
    });
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "has_permission") return { data: true, error: null };
      if (name === "admin_enqueue_product_import_images") return { data: { jobIds: ["20000000-0000-0000-0000-000000000006"] }, error: null };
      return { data: { productId: "20000000-0000-0000-0000-000000000004", alreadyImported: false }, error: null };
    });
    mocks.from.mockImplementation(() => sessionQuery());
  });

  it("rejects an unknown, foreign or expired session", async () => {
    const response = await POST(request());
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({ message: expect.stringContaining("expirou") as unknown });
  });

  it("persists the draft and source before starting image requests", async () => {
    sessionState.result = { data: { payload: {}, batch_hash: "a".repeat(64) }, error: null };
    mocks.parseSession.mockReturnValue({
      batch: { schemaVersion: "curtiz_import_v1", products: [normalizedProduct], colorCount: 1, imageCount: 1, options: importOptions, issues: [] },
      references: { "PROD-1": { categoryId: "20000000-0000-0000-0000-000000000002", modelId: null, collectionId: null } }
    });

    const response = await POST(request());
    const body = await response.json() as { hasMore?: boolean; queuedImages?: number };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ hasMore: false, queuedImages: 1 });
    const importCalls = mocks.rpc.mock.calls as Array<[string, { p_payload?: { status?: unknown; variants?: Array<{ stock?: unknown }> } }]>;
    const importCall = importCalls.find(([name]) => name === "admin_import_product_with_taxonomy_authorized");
    expect(importCall?.[1].p_payload?.status).toBe("draft");
    expect(importCall?.[1].p_payload?.variants?.[0]?.stock).toBe(10);
    expect(importCall?.[1].p_payload).toMatchObject({
      costInCents: 835,
      weightGrams: 300,
      heightCm: 8,
      widthCm: 20,
      lengthCm: 28,
      googleProductCategory: "Apparel & Accessories > Shoes > Sandals",
      sizeGuide: [{ size: "35", measurementCm: 23.5 }],
      specifications: [{ label: "Material", value: "Borracha" }],
      variants: [expect.objectContaining({ costInCents: 955, gtin: "7890000000001", mpn: "MPN-1" })]
    });
    expect(importCall?.[1]).toMatchObject({
      p_category_name: "Chinelos",
      p_category_slug: "chinelos",
      p_create_category: true,
      p_create_model: true
    });
    expect(mocks.from).not.toHaveBeenCalledWith("product_variants");
    expect(mocks.enqueueImages).toHaveBeenCalledWith([{
      jobId: "20000000-0000-0000-0000-000000000006",
      runId: "20000000-0000-0000-0000-000000000003",
      productId: "20000000-0000-0000-0000-000000000004"
    }]);
  });

  it("returns safe non-retryable database diagnostics", async () => {
    sessionState.result = { data: { payload: {}, batch_hash: "a".repeat(64) }, error: null };
    mocks.parseSession.mockReturnValue({
      batch: { schemaVersion: "curtiz_import_v1", products: [normalizedProduct], colorCount: 1, imageCount: 1, options: importOptions, issues: [] },
      references: { "PROD-1": { categoryId: "20000000-0000-0000-0000-000000000002", modelId: null, collectionId: null } }
    });
    mocks.rpc.mockImplementation(async (name: string) => name === "has_permission"
      ? { data: true, error: null }
      : { data: null, error: { code: "23503", message: "internal foreign key details" } });

    const response = await POST(request());
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ stage: "save_product", code: "MISSING_RELATION", retryable: false });
    expect(JSON.stringify(body)).not.toContain("internal foreign key details");
  });

  it("identifies a missing import schema without retrying", async () => {
    sessionState.result = { data: null, error: { code: "PGRST205", message: "table details" } };

    const response = await POST(request());
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ stage: "session", code: "IMPORT_SCHEMA_UNAVAILABLE", retryable: false });
    expect(JSON.stringify(body)).not.toContain("table details");
  });

  it("identifies the legacy null-character import function", async () => {
    sessionState.result = { data: { payload: {}, batch_hash: "a".repeat(64) }, error: null };
    mocks.parseSession.mockReturnValue({
      batch: { schemaVersion: "curtiz_import_v1", products: [normalizedProduct], colorCount: 1, imageCount: 1, options: importOptions, issues: [] },
      references: { "PROD-1": { categoryId: "20000000-0000-0000-0000-000000000002", modelId: null, collectionId: null } }
    });
    mocks.rpc.mockImplementation(async (name: string) => name === "has_permission"
      ? { data: true, error: null }
      : { data: null, error: { code: "54000", message: "null character not permitted" } });

    const response = await POST(request());
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ stage: "save_product", code: "IMPORT_SCHEMA_UNAVAILABLE", retryable: false });
    expect(JSON.stringify(body)).not.toContain("null character");
  });

  it("never downloads or transforms images inside the panel Worker", async () => {
    mocks.readJsonResponse.mockResolvedValue({
      sessionId: "20000000-0000-0000-0000-000000000003", productKey: "PROD-1", imageOffset: 0
    });
    sessionState.result = { data: { payload: {}, batch_hash: "a".repeat(64) }, error: null };
    const repeatedImageProduct = {
      ...normalizedProduct,
      images: [
        normalizedProduct.images[0],
        { ...normalizedProduct.images[0], color: "Rosa", order: 2, primary: false }
      ]
    };
    mocks.parseSession.mockReturnValue({
      batch: { schemaVersion: "curtiz_import_v1", products: [repeatedImageProduct], colorCount: 2, imageCount: 2, options: importOptions, issues: [] },
      references: { "PROD-1": { categoryId: "20000000-0000-0000-0000-000000000002", modelId: null, collectionId: null } }
    });
    mocks.from.mockImplementation((table: string) => {
      if (table === "product_import_sessions") return sessionQuery();
      if (table === "product_import_sources") {
        const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(async () => ({ data: { product_id: "20000000-0000-0000-0000-000000000004" }, error: null })) };
        query.select.mockReturnValue(query); query.eq.mockReturnValue(query); return query;
      }
      if (table === "product_variants") return { select: () => ({ eq: () => Promise.resolve({ data: [{ id: "20000000-0000-0000-0000-000000000005", color_name: "Lilás" }], error: null }) }) };
      if (table === "product_images") return { select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) };
      throw new Error(`Tabela inesperada: ${table}`);
    });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("CDN indisponível"); }));

    const response = await POST(request());
    const body = await response.json() as { imageFailures?: boolean; hasMore?: boolean; warnings?: string[]; queuedImages?: number };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ imageFailures: false, hasMore: false, queuedImages: 1 });
    expect(body.warnings?.some((warning) => warning.includes("cores diferentes"))).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalledWith("products");
  });
});
