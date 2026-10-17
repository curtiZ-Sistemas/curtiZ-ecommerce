import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { BlingError, type BlingClient } from "./bling";
import { blingCatalogPayload, executeBlingCatalogJob, type BlingCatalogRpc } from "./bling-catalog";

const environment = { SUPABASE_URL: "https://example.supabase.co", BLING_STOCK_DEPOSIT_ID: "123" };
const local = () => ({ variant: { sku: "SKU-AZUL-37", color_name: "Azul", size: "37", active: true, price_override: 25.5 },
  product: { name: "Chinelo", status: "active", base_price: 20, cost_price: 8.35, weight_grams: 300, height_cm: 6, width_cm: 20, length_cm: 30 },
  metadata: { commercial_unit: "PR", pairs_per_sku: 1, ncm: "64022000", origin: 0, cest: "", production_type: "T" },
  inventory: { available_quantity: 45, reserved_quantity: 5, version: 2 }, imagePaths: ["products/test/blue.webp"] });
const linked = () => ({ external_product_id: 456, sku: "SKU-AZUL-37", last_stock_cost: 8.35, updated_at: "2026-10-17T12:00:00Z" });
const rpcFor = (options: { link?: unknown; local?: unknown; marked?: boolean } = {}) => vi.fn<BlingCatalogRpc>(async (name) => ({ error: null,
  data: name === "read_bling_product_link" ? options.link === undefined ? linked() : options.link
    : name === "read_bling_catalog_variant" ? options.local === undefined ? local() : options.local : options.marked ?? true }));
const providerFor = () => ({ request: vi.fn<BlingClient["request"]>(async (path) => ({ data: path.startsWith("/estoques/saldos")
  ? [{ produto: { id: 456 }, saldoFisicoTotal: 50 }] : path.startsWith("/produtos?") ? [] : { id: 456, codigo: "SKU-AZUL-37" } })) });

describe("Bling catalogue authority", () => {
  it("preserves the actual sale price, SKU, dimensions, pair unit and approved product classification", () => {
    expect(blingCatalogPayload(local(), environment)).toMatchObject({ codigo: "SKU-AZUL-37", preco: 25.5, unidade: "PR",
      pesoBruto: 0.3, tipoProducao: "T", tributacao: { origem: 0, ncm: "64022000", cest: "" },
      midia: { imagens: { imagensURL: [{ link: "https://example.supabase.co/storage/v1/object/public/catalog-public/products/test/blue.webp" }] } } });
    expect(blingCatalogPayload(local(), environment)).not.toHaveProperty("precoCusto"); // read-only supplier property
  });
  it("keeps one kit SKU distinct from its number of pairs without inventing component links", () => {
    const value = local(); value.metadata.commercial_unit = "UN"; value.metadata.pairs_per_sku = 3;
    expect(blingCatalogPayload(value, environment)).toMatchObject({ unidade: "UN", formato: "S", preco: 25.5 });
    expect(blingCatalogPayload(value, environment)).not.toHaveProperty("estrutura");
  });
  it("forwards only safe paths in our public catalogue bucket", () => {
    const value = local(); value.imagePaths = ["https://private.example/file", "products/../secret", "products/good.webp"];
    expect(blingCatalogPayload(value, environment).midia).toEqual({ imagens: { imagensURL: [{ link:
      "https://example.supabase.co/storage/v1/object/public/catalog-public/products/good.webp" }] } });
  });
  it("rejects invalid prices and fiscal classifications before writing", () => {
    const value = local(); value.variant.price_override = NaN;
    expect(() => blingCatalogPayload(value, environment)).toThrow("invalid_product_data");
    value.variant.price_override = 20; value.metadata.ncm = "unknown";
    expect(() => blingCatalogPayload(value, environment)).toThrow("invalid_product_fiscal_data");
  });
  it("does not create a second product when the SKU already exists", async () => {
    const rpc = rpcFor({ link: null }), provider = providerFor();
    provider.request.mockResolvedValue({ data: [{ id: 456, codigo: "SKU-AZUL-37" }] });
    await executeBlingCatalogJob({ rpc, provider, environment, type: "bling.product.create", variantId: "v1" });
    expect(provider.request).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("match_bling_products", { p_matches: [{ sku: "SKU-AZUL-37", externalProductId: 456 }] });
  });
  it("blocks duplicate provider SKUs and does not repeat an uncertain create", async () => {
    const rpc = rpcFor({ link: null }), provider = providerFor();
    provider.request.mockResolvedValueOnce({ data: [{ id: 456, codigo: "SKU-AZUL-37" }, { id: 789, codigo: "SKU-AZUL-37" }] });
    await expect(executeBlingCatalogJob({ rpc, provider, environment, type: "bling.product.create", variantId: "v1" })).rejects.toThrow("duplicate_external_sku");
    provider.request.mockResolvedValueOnce({ data: [] }).mockRejectedValueOnce(new BlingError("uncertain_write", 503, false, true));
    await expect(executeBlingCatalogJob({ rpc, provider, environment, type: "bling.product.create", variantId: "v1" })).rejects.toMatchObject({ uncertainWrite: true });
    expect(provider.request.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it("accepts the official stock response with product ID only and preserves reservations", async () => {
    const rpc = rpcFor(), provider = providerFor();
    await executeBlingCatalogJob({ rpc, provider, environment, type: "bling.stock.sync", variantId: "v1" });
    expect(rpc).toHaveBeenCalledWith("mark_bling_stock_cost_synced", { p_variant_id: "v1", p_expected_version: 2, p_expected_quantity: 50, p_expected_cost: 8.35 });
    expect(provider.request.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
  it("writes absolute stock and the approved cost, then reads the balance back", async () => {
    const rpc = rpcFor(), provider = providerFor();
    provider.request.mockResolvedValueOnce({ data: [{ produto: { id: 456 }, saldoFisicoTotal: 0 }] })
      .mockResolvedValueOnce({ data: { codigo: "SKU-AZUL-37" } }).mockResolvedValueOnce({ data: { id: 1 } })
      .mockResolvedValueOnce({ data: { produto: { id: 456 }, deposito: { id: 123 }, custo: 8.35 } })
      .mockResolvedValueOnce({ data: [{ produto: { id: 456 }, saldoFisicoTotal: 50 }] });
    await executeBlingCatalogJob({ rpc, provider, environment, type: "bling.stock.sync", variantId: "v1" });
    const stockCall = provider.request.mock.calls.find(([path]) => path === "/estoques");
    expect(stockCall?.[1]?.method).toBe("POST");
    expect(stockCall?.[1]?.body).toMatchObject({ operacao: "B", quantidade: 50, custo: 8.35, deposito: { id: 123 } });
  });
  it("does not acknowledge a balance if local physical inventory changed during the provider write", async () => {
    const rpc = rpcFor({ marked: false }), provider = providerFor();
    await expect(executeBlingCatalogJob({ rpc, provider, environment, type: "bling.stock.sync", variantId: "v1" })).rejects.toThrow("inventory_changed");
  });
  it("updates cost even when physical stock is unchanged and verifies the provider movement", async () => {
    const rpc = rpcFor({ link: { ...linked(), last_stock_cost: 5 } }), provider = providerFor();
    provider.request.mockResolvedValueOnce({ data: [{ produto: { id: 456 }, saldoFisicoTotal: 50 }] })
      .mockResolvedValueOnce({ data: { codigo: "SKU-AZUL-37" } }).mockResolvedValueOnce({ data: { id: 1 } })
      .mockResolvedValueOnce({ data: { produto: { id: 456 }, deposito: { id: 123 }, custo: 8.35 } })
      .mockResolvedValueOnce({ data: [{ produto: { id: 456 }, saldoFisicoTotal: 50 }] });
    await executeBlingCatalogJob({ rpc, provider, environment, type: "bling.stock.sync", variantId: "v1" });
    expect(provider.request.mock.calls.find(([path]) => path === "/estoques")?.[1]?.body).toMatchObject({ quantidade: 50, custo: 8.35 });
    expect(provider.request).toHaveBeenCalledWith("/estoques/1");
  });
  it("never writes stock to a product whose external SKU changed", async () => {
    const rpc = rpcFor(), provider = providerFor();
    provider.request.mockResolvedValueOnce({ data: [{ produto: { id: 456 }, saldoFisicoTotal: 0 }] }).mockResolvedValueOnce({ data: { codigo: "OTHER" } });
    await expect(executeBlingCatalogJob({ rpc, provider, environment, type: "bling.stock.sync", variantId: "v1" })).rejects.toThrow("external_sku_changed");
    expect(provider.request.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
  it("preserves existing fiscal settings when no reviewed metadata was entered", () => {
    const value = { ...local(), metadata: null };
    expect(blingCatalogPayload(value, environment)).not.toHaveProperty("tributacao");
    expect(blingCatalogPayload(value, environment)).not.toHaveProperty("unidade");
  });
});
