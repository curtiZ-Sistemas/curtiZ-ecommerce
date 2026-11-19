import { NextRequest } from "next/server";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type * as Config from "@curtiz/config";
const state = vi.hoisted((): { user: { id: string } | null; provider: ReturnType<typeof vi.fn> } => ({ user: { id: "actor" }, provider: vi.fn() }));
const mocks = vi.hoisted(() => {
  const environment: Record<string, string> = {};
  return { environment, rpc: vi.fn(), issue: vi.fn(), address: vi.fn(), addressFilter: vi.fn(),
    rateLimit: vi.fn(), insert: vi.fn(), maybeSingle: vi.fn(), resolve: vi.fn(), quote: vi.fn() };
});
vi.mock("@curtiz/config", async importOriginal => ({
  ...await importOriginal<typeof Config>(),
  getIntegrationConfig: () => ({ shipping: { enabled: true, provider: "melhorenvio" } }),
  getMelhorEnvioEnvironment: (env: Record<string, string>) => env.MELHOR_ENVIO_ENVIRONMENT
}));
vi.mock("@/lib/http-origin", () => import("../../../../../lib/http-origin"));
vi.mock("@/lib/private-request", () => ({ readPrivateJson: (r: Request) => r.json(), requirePrivateRateLimit: mocks.rateLimit,
  PrivateRequestError: class extends Error { status = 429; } }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) }, rpc: mocks.rpc,
    from: () => ({ select: () => ({ eq: mocks.addressFilter }) })
  }),
  createServiceSupabaseClient: () => ({ rpc: mocks.issue, from: (table: string) => table === "shipping_quotes"
    ? { insert: mocks.insert }
    : { select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) } })
}));
vi.mock("@/lib/melhor-envio-server", () => ({ configuredMelhorEnvioProvider: state.provider, resolveShippingProducts: mocks.resolve }));
vi.mock("@/lib/runtime-environment", () => ({ getStoreRuntimeEnvironment: () => ({ ...process.env, ...mocks.environment }) }));
vi.mock("@/lib/representative-commercial-payments", () => ({
  commercialKitCheckoutConfigured: () => mocks.environment.REPRESENTATIVE_KIT_CHECKOUT_ENABLED === "true"
}));
vi.mock("@/lib/shipping-preview", () => import("../../../../../lib/shipping-preview"));
vi.mock("@/lib/representative-resale-scope", () => import("../../../../../lib/representative-resale-scope"));
vi.mock("@/lib/unknown-data", () => import("../../../../../lib/unknown-data"));
vi.mock("@/lib/representative-test-transactions", () => ({ kitTestProvider: vi.fn(),
  KitTransactionError: class extends Error { constructor(readonly status = 409) { super(); } } }));
import { POST } from "./route";
const input = { variantId: "10000000-0000-4000-8000-000000000001", quantity: 1, postalCode: "35500000" };
const checkout = { variantId: input.variantId, quantity: 1, mode: "checkout",
  addressId: "10000000-0000-4000-8000-000000000002", serviceId: "1" };
const shippingProduct = { id: input.variantId, quantity: 1, weightKg: 0.25,
  widthCm: 10, heightCm: 5, lengthCm: 20, insuranceValue: 50 };
const send = (body: unknown = input, origin = "https://curtiz.com.br") => POST(new NextRequest("https://curtiz.com.br/api/representatives/kits/quote", {
  method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body)
}));
beforeEach(() => {
  vi.resetAllMocks();
  state.user = { id: "actor" };
  vi.stubEnv("ALLOWED_ORIGINS", "https://curtiz.com.br");
  vi.stubEnv("REPRESENTATIVE_TEST_TRANSACTIONS_ENABLED", "false");
  mocks.environment = { SHIPPING_PREVIEW_ENABLED: "true", MELHOR_ENVIO_ENVIRONMENT: "production",
    MELHOR_ENVIO_ORIGIN_POSTAL_CODE: "35520000" };
  mocks.rpc.mockResolvedValue({ data: { items: [{ available: 2 }] } });
  mocks.addressFilter.mockReturnValue({ eq: mocks.addressFilter, maybeSingle: mocks.address });
  mocks.address.mockResolvedValue({ data: { postal_code: "30110-100", state: "MG" } });
  mocks.maybeSingle.mockResolvedValue({ data: { product_id: "official-product" } });
  mocks.resolve.mockResolvedValue({ products: [shippingProduct], fingerprint: "official-package" });
  mocks.quote.mockResolvedValue([{ provider: "melhorenvio", serviceId: "1", service: "PAC", carrier: "Correios", amountInCents: 2100,
    costInCents: 1800, estimatedDays: 4, expiresAt: "2099-01-01T00:00:00Z", packages: [{ private: true }] }]);
  state.provider.mockReturnValue({ quote: mocks.quote });
});
afterEach(() => vi.unstubAllEnvs());
describe("kit quote scope", () => {
  it("rejects foreign origins", async () => { expect((await send(input, "https://attacker.invalid")).status).toBe(403); });
  it("requires login", async () => { state.user = null; expect((await send()).status).toBe(401); });
  it("rejects client prices and quantities above the catalog boundary", async () => {
    expect((await send({ ...input, amountInCents: 1 })).status).toBe(400);
    expect((await send({ ...input, quantity: 100 })).status).toBe(400);
    expect(state.provider).not.toHaveBeenCalled();
  });
  it("does not request provider quotes until the actor is explicitly authorized", async () => {
    vi.stubEnv("REPRESENTATIVE_TEST_TRANSACTIONS_ENABLED", "false");
    expect((await send()).status).toBe(403);
    expect(state.provider).not.toHaveBeenCalled();
  });
  it("blocks TEST quotes in production even when sandbox flags were copied", async () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("REPRESENTATIVE_TEST_TRANSACTIONS_ENABLED", "true");
    vi.stubEnv("REPRESENTATIVE_TEST_ACTOR_ID", "actor");
    mocks.environment.MELHOR_ENVIO_ENVIRONMENT = "sandbox";
    expect((await send()).status).toBe(403);
    expect(state.provider).not.toHaveBeenCalled();
  });
  it("returns production estimates to an authorized representative without saving a checkout quote", async () => {
    const response = await send({ ...input, mode: "preview" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rateLimit).toHaveBeenCalledWith(expect.anything(), "shipping_quote");
    expect(mocks.rpc).toHaveBeenCalledWith("read_representative_catalog_kit_context",
      { p_variant_id: input.variantId, p_quantity: 1 });
    expect(mocks.resolve).toHaveBeenCalledWith([{ productId: "official-product", variantId: input.variantId, quantity: 1 }], expect.anything());
    expect(mocks.quote).toHaveBeenCalledWith({ originPostalCode: "35520000", destinationPostalCode: input.postalCode,
      products: [shippingProduct] });
    expect(await response.json()).toEqual({ ok: true, mode: "preview", quotes: [{
      serviceId: "1", service: "PAC", carrier: "Correios", amountInCents: 2100, estimatedDays: 9
    }] });
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated, unapproved and out-of-stock requests before provider access", async () => {
    const body = { ...input, mode: "preview" };
    state.user = null;
    expect((await send(body)).status).toBe(401);
    state.user = { id: "actor" };
    mocks.rpc.mockResolvedValueOnce({ data: null });
    expect((await send(body)).status).toBe(403);
    expect((await send({ ...body, quantity: 3 })).status).toBe(409);
    expect(state.provider).not.toHaveBeenCalled();
  });
  it("keeps sandbox rates out of the preview", async () => {
    mocks.environment.MELHOR_ENVIO_ENVIRONMENT = "sandbox";
    expect((await send({ ...input, mode: "preview" })).status).toBe(503);
    expect(state.provider).not.toHaveBeenCalled();
  });
  it("rejects a CEP or saved state outside Minas Gerais before reaching the provider", async () => {
    expect((await send({ ...input, mode: "preview", postalCode: "01310100" })).status).toBe(403);
    mocks.address.mockResolvedValueOnce({ data: { postal_code: "30110-100", state: "SP" } });
    expect((await send(checkout)).status).toBe(403);
    mocks.address.mockResolvedValueOnce({ data: { postal_code: "01310-100", state: "MG" } });
    expect((await send(checkout)).status).toBe(403);
    expect(mocks.quote).not.toHaveBeenCalled();
    expect(mocks.issue).not.toHaveBeenCalled();
  });
  it("fails closed if the configured warehouse CEP is outside Minas Gerais", async () => {
    mocks.environment.MELHOR_ENVIO_ORIGIN_POSTAL_CODE = "01310100";
    expect((await send({ ...input, mode: "preview" })).status).toBe(503);
    expect(mocks.quote).not.toHaveBeenCalled();
  });
  it("uses the saved address and selected production rate when issuing a checkout quote", async () => {
    mocks.issue.mockResolvedValue({ data: { id: "private-quote", serviceId: "1", amountInCents: 2100 } });
    const response = await send(checkout);
    expect(response.status).toBe(200);
    expect(mocks.addressFilter.mock.calls).toEqual([["id", checkout.addressId], ["user_id", "actor"], ["country", "BR"]]);
    expect(mocks.quote).toHaveBeenCalledWith(expect.objectContaining({ destinationPostalCode: "30110100" }));
    expect(mocks.issue).toHaveBeenCalledWith("confirm_representative_kit_shipping_quote", expect.objectContaining({
      p_actor: "actor", p_variant: checkout.variantId, p_quantity: 1, p_address: checkout.addressId,
      p_postal_code: "30110100", p_service_id: "1", p_amount_in_cents: 2100, p_cart_fingerprint: "official-package",
      p_origin_postal_code: "35520000", p_unit_price_cents: 5000, p_dimensions: [250, 10, 5, 20]
    }));
    expect(await response.json()).toEqual({
      ok: true, mode: "checkout", quote: { id: "private-quote", serviceId: "1", amountInCents: 2100 }
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("rejects checkout quotes with a client CEP, an inaccessible address or a missing service", async () => {
    expect((await send({ ...checkout, postalCode: input.postalCode })).status).toBe(400);
    mocks.address.mockResolvedValueOnce({ data: null });
    expect((await send(checkout)).status).toBe(404);
    expect(mocks.quote).not.toHaveBeenCalled();
    expect((await send({ ...checkout, serviceId: "unavailable" })).status).toBe(409);
    expect(mocks.issue).not.toHaveBeenCalled();
  });
  it("still saves a sandbox quote for the authorized test actor", async () => {
    vi.stubEnv("REPRESENTATIVE_TEST_TRANSACTIONS_ENABLED", "true");
    vi.stubEnv("REPRESENTATIVE_TEST_ACTOR_ID", "actor");
    mocks.environment.MELHOR_ENVIO_ENVIRONMENT = "sandbox";
    mocks.insert.mockReturnValue({ select: async () => ({ data: [{
      id: "sandbox-quote", service: "PAC", carrier: "Correios", amount: 21,
      estimated_days: 4, expires_at: "2099-01-01T00:00:00Z"
    }] }) });
    const response = await send();
    expect(response.status).toBe(200);
    expect(mocks.insert).toHaveBeenCalledWith([expect.objectContaining({
      customer_id: "actor", provider_environment: "sandbox", cart_fingerprint: "official-package"
    })]);
    expect(await response.json()).toMatchObject({ ok: true, quotes: [{ id: "sandbox-quote", amountInCents: 2100 }] });
  });
});
