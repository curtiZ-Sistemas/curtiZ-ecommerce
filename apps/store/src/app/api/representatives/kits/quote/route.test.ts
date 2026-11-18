import { NextRequest } from "next/server";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type * as Config from "@curtiz/config";
const state = vi.hoisted((): { user: { id: string } | null; provider: ReturnType<typeof vi.fn> } => ({ user: { id: "actor" }, provider: vi.fn() }));
const mocks = vi.hoisted(() => {
  const environment: Record<string, string> = {};
  return { environment, rpc: vi.fn(), rateLimit: vi.fn(), insert: vi.fn(), maybeSingle: vi.fn(), resolve: vi.fn(), quote: vi.fn() };
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
  createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) }, rpc: mocks.rpc }),
  createServiceSupabaseClient: () => ({ from: (table: string) => table === "shipping_quotes"
    ? { insert: mocks.insert }
    : { select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) } })
}));
vi.mock("@/lib/melhor-envio-server", () => ({ configuredMelhorEnvioProvider: state.provider, resolveShippingProducts: mocks.resolve }));
vi.mock("@/lib/runtime-environment", () => ({ getStoreRuntimeEnvironment: () => mocks.environment }));
vi.mock("@/lib/shipping-preview", () => import("../../../../../lib/shipping-preview"));
vi.mock("@/lib/unknown-data", () => import("../../../../../lib/unknown-data"));
vi.mock("@/lib/representative-test-transactions", () => ({ kitTestProvider: vi.fn(),
  KitTransactionError: class extends Error { constructor(readonly status = 409) { super(); } } }));
import { POST } from "./route";
const input = { variantId: "10000000-0000-4000-8000-000000000001", quantity: 1, postalCode: "35500000" };
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
  mocks.maybeSingle.mockResolvedValue({ data: { product_id: "official-product" } });
  mocks.resolve.mockResolvedValue({ products: [{ id: input.variantId, quantity: 1 }], fingerprint: "official-package" });
  mocks.quote.mockResolvedValue([{ serviceId: "1", service: "PAC", carrier: "Correios", amountInCents: 2100,
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
  it("returns production estimates to an authorized representative without saving a checkout quote", async () => {
    const response = await send({ ...input, mode: "preview" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rateLimit).toHaveBeenCalledWith(expect.anything(), "shipping_quote");
    expect(mocks.rpc).toHaveBeenCalledWith("read_representative_catalog_kit_context",
      { p_variant_id: input.variantId, p_quantity: 1 });
    expect(mocks.resolve).toHaveBeenCalledWith([{ productId: "official-product", variantId: input.variantId, quantity: 1 }], expect.anything());
    expect(mocks.quote).toHaveBeenCalledWith({ originPostalCode: "35520000", destinationPostalCode: input.postalCode,
      products: [{ id: input.variantId, quantity: 1 }] });
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
