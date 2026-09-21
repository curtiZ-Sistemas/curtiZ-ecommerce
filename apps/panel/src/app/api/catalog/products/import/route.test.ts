import { NextRequest } from "next/server";
import type * as SecurityModule from "@curtiz/security";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  readJsonResponse: vi.fn(),
  parseSession: vi.fn()
}));
const sessionState: { result: { data: unknown; error: { code?: string } | null } } = {
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
  parseProductImportSessionPayload: mocks.parseSession
}));
vi.mock("@/lib/catalog-image", () => ({ inspectCatalogImage: vi.fn() }));
vi.mock("@/lib/image-upload", () => ({ prepareUploadImage: vi.fn() }));
vi.mock("@/lib/product-management", () => ({ automaticProductSeo: vi.fn(() => ({ title: "Produto", description: "Produto" })) }));

import { POST } from "./route";

const request = () => new NextRequest("https://painel.example/api/catalog/products/import", { method: "POST" });
const normalizedProduct = {
  key: "PROD-1", shopeeId: "1", source: "shopee", name: "Produto", slug: "produto",
  categoryName: "Chinelos", modelName: "", collectionName: "", shortDescription: "", description: "",
  featured: false, priceInCents: 1_000, compareAtPriceInCents: null, costInCents: null,
  weightGrams: null, heightCm: null, widthCm: null, lengthCm: null,
  merchantCondition: null, merchantGender: null, merchantAgeGroup: null,
  googleProductCategory: "", merchantIdentifierExists: null,
  variants: [{ variationKey: "V1", color: "Lilás", colorHex: "#C8A2C8", colorHexSecondary: "", size: "35", sku: "SKU-1", active: true, stock: 10, priceInCents: null, costInCents: null, gtin: "", mpn: "" }],
  images: [{ url: "https://down-sg.img.susercontent.com/file/test", color: "Lilás", order: 0, primary: true, applyAllSizes: true }],
  sizeGuide: [], specifications: [], issues: []
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
    mocks.rpc.mockImplementation(async (name: string) => name === "has_permission"
      ? { data: true, error: null }
      : { data: { productId: "20000000-0000-0000-0000-000000000004", alreadyImported: false }, error: null });
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
      batch: { schemaVersion: "curtiz_import_v1", products: [normalizedProduct], colorCount: 1, imageCount: 1, issues: [] },
      references: { "PROD-1": { categoryId: "20000000-0000-0000-0000-000000000002", modelId: null, collectionId: null } }
    });

    const response = await POST(request());
    const body = await response.json() as { hasMore?: boolean; nextImageOffset?: number };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ hasMore: true, nextImageOffset: 0 });
    const importCalls = mocks.rpc.mock.calls as Array<[string, { p_payload?: { status?: unknown; variants?: Array<{ stock?: unknown }> } }]>;
    const importCall = importCalls.find(([name]) => name === "admin_import_product_authorized");
    expect(importCall?.[1].p_payload?.status).toBe("draft");
    expect(importCall?.[1].p_payload?.variants?.[0]?.stock).toBe(0);
    expect(mocks.from).not.toHaveBeenCalledWith("product_variants");
  });

  it("keeps the saved draft when an image fails and allows image resumption", async () => {
    mocks.readJsonResponse.mockResolvedValue({
      sessionId: "20000000-0000-0000-0000-000000000003", productKey: "PROD-1", imageOffset: 0
    });
    sessionState.result = { data: { payload: {}, batch_hash: "a".repeat(64) }, error: null };
    mocks.parseSession.mockReturnValue({
      batch: { schemaVersion: "curtiz_import_v1", products: [normalizedProduct], colorCount: 1, imageCount: 1, issues: [] },
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
    const body = await response.json() as { imageFailures?: boolean; hasMore?: boolean; warnings?: string[] };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ imageFailures: true, hasMore: false });
    expect(body.warnings?.[0]).toContain("Imagem 1");
    expect(mocks.from).not.toHaveBeenCalledWith("products");
  });
});
