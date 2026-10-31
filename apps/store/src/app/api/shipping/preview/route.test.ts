import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MelhorEnvioError } from "@curtiz/integrations";
import { POST } from "./route";

const state = vi.hoisted(() => {
  const environment: Record<string, string> = { SHIPPING_PREVIEW_ENABLED: "true" };
  return { environment, allowed: true };
});
const mocks = vi.hoisted(() => ({ budget: vi.fn(), resolve: vi.fn(), quote: vi.fn(), db: {} }));
vi.mock("server-only", () => ({}));
vi.mock("@curtiz/config", () => ({
  getIntegrationConfig: () => ({ shipping: { enabled: true, provider: "melhorenvio" } }),
  getMelhorEnvioEnvironment: (env: Record<string, string>) => env.MELHOR_ENVIO_ENVIRONMENT
}));
vi.mock("@/lib/http-origin", () => ({ isAllowedRequestOrigin: () => state.allowed }));
vi.mock("@/lib/runtime-environment", () => ({ getStoreRuntimeEnvironment: () => state.environment }));
vi.mock("@/lib/public-request", () => ({ publicBudgetResponse: mocks.budget }));
vi.mock("@/lib/private-request", () => vi.importActual("../../../../lib/private-request"));
vi.mock("@/lib/supabase/server", () => ({ createServiceSupabaseClient: () => mocks.db }));
vi.mock("@/lib/melhor-envio-server", () => ({ resolveShippingProducts: mocks.resolve,
  configuredMelhorEnvioProvider: () => ({ quote: mocks.quote }) }));
vi.mock("@/lib/shipping-preview", () => vi.importActual("../../../../lib/shipping-preview"));

const input = { postalCode: "01310-100", productId: "11111111-1111-4111-8111-111111111111",
  variantId: "22222222-2222-4222-8222-222222222222", quantity: 1 };
const request = (body: unknown = input) => new NextRequest("https://store.test/api/shipping/preview", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
});
beforeEach(() => {
  vi.clearAllMocks(); state.allowed = true;
  state.environment = { SHIPPING_PREVIEW_ENABLED: "true", MELHOR_ENVIO_ENVIRONMENT: "production", MELHOR_ENVIO_ORIGIN_POSTAL_CODE: "01001000" };
  mocks.budget.mockResolvedValue(null);
  mocks.resolve.mockResolvedValue({ products: [{ id: input.variantId, quantity: 1, weightKg: 1, widthCm: 20,
    heightCm: 10, lengthCm: 30, insuranceValue: 150 }], fingerprint: "official-kit" });
  mocks.quote.mockResolvedValue([]);
});
describe("public shipping preview", () => {
  it.each(["sandbox", "", "unknown"])("never calls a provider in %s", async (environment) => {
    state.environment.MELHOR_ENVIO_ENVIRONMENT = environment;
    expect((await POST(request())).status).toBe(503);
    expect(mocks.budget).not.toHaveBeenCalled(); expect(mocks.quote).not.toHaveBeenCalled();
  });
  it("requires explicit opt-in and allowed origin", async () => {
    state.environment.SHIPPING_PREVIEW_ENABLED = "false";
    expect((await POST(request())).status).toBe(503);
    state.allowed = false;
    expect((await POST(request())).status).toBe(403);
  });
  it.each([{ postalCode: "123" }, { postalCode: "abc01310100" }, { quantity: 0 }, { quantity: 11 },
    { quantity: 1.5 }, { variantId: "invalid" }, { price: 1 }, { weightKg: 0.1 }])("rejects invalid or untrusted input %j", async (patch) => {
    expect((await POST(request({ ...input, ...patch }))).status).toBe(400);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it.each([429, 503])("fails closed on public budget %s before catalog/provider", async (status) => {
    mocks.budget.mockResolvedValue(Response.json({ message: "unavailable" }, { status }));
    expect((await POST(request())).status).toBe(status);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it("quotes without login using the official kit package and exposes no checkout/private data", async () => {
    state.environment.MELHOR_ENVIO_ORIGIN_POSTAL_CODE = "11111111";
    mocks.quote.mockResolvedValue([{ provider: "melhorenvio", serviceId: "1", service: "PAC", carrier: "Correios",
      amountInCents: 2100, costInCents: 1800, estimatedDays: 4, packages: [{ secret: "private" }], expiresAt: "2099-01-01T00:00:00Z" }]);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.resolve).toHaveBeenCalledWith([{ productId: input.productId, variantId: input.variantId, quantity: 1 }], mocks.db);
    expect(mocks.quote).toHaveBeenCalledWith({ originPostalCode: "11111111", destinationPostalCode: "01310100",
      products: [{ id: input.variantId, quantity: 1, weightKg: 1, widthCm: 20, heightCm: 10, lengthCm: 30, insuranceValue: 150 }] });
    expect(await response.json()).toEqual({ ok: true, quotes: [{ serviceId: "1", service: "PAC", carrier: "Correios", amountInCents: 2100, estimatedDays: 4 }] });
  });
  it("returns unavailable services explicitly and still validates live products on cache hits", async () => {
    const first = await POST(request());
    expect(await first.json()).toMatchObject({ ok: true, quotes: [], message: expect.any(String) as unknown });
    mocks.resolve.mockRejectedValue(new MelhorEnvioError("validation", 409, false));
    expect((await POST(request())).status).toBe(409);
  });
  it("does not disclose provider errors", async () => {
    state.environment.MELHOR_ENVIO_ORIGIN_POSTAL_CODE = "22222222";
    mocks.quote.mockRejectedValue(new Error("private token details"));
    const response = await POST(request());
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("private token");
  });
});
