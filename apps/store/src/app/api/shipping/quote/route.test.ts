import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MelhorEnvioError } from "@curtiz/integrations";
import type * as PrivateRequestModule from "@/lib/private-request";
import { configuredMelhorEnvioProvider, resolveShippingProducts } from "@/lib/melhor-envio-server";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { POST } from "./route";

const runtime = vi.hoisted(() => {
  const state: { bindings: Record<string, unknown> } = { bindings: {} };
  return state;
});
const providerQuote = vi.hoisted(() => vi.fn());
const healthUpsert = vi.hoisted(() => vi.fn());
const serviceFrom = vi.hoisted(() => vi.fn());
const rateLimitRpc = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env: runtime.bindings }) }));
vi.mock("@/lib/http-origin", () => ({ isAllowedRequestOrigin: () => true }));
vi.mock("@/lib/private-request", async () => ({
  ...await vi.importActual<typeof PrivateRequestModule>("../../../../lib/private-request"),
  readPrivateJson: (request: Request) => request.json(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(),
  createServiceSupabaseClient: vi.fn()
}));
vi.mock("@/lib/unknown-data", () => ({
  isUnknownRecord: (value: unknown) => Boolean(value && typeof value === "object" && !Array.isArray(value)),
  readNumber: (record: Record<string, unknown>, key: string) => Number(record[key] ?? 0),
  readQueryResult: (value: unknown) => value,
  readString: (record: Record<string, unknown>, key: string) => typeof record[key] === "string" ? record[key] : ""
}));
vi.mock("@/lib/runtime-environment", () => ({
  getStoreRuntimeEnvironment: () => ({ ...process.env, ...runtime.bindings })
}));
vi.mock("@/lib/melhor-envio-server", () => ({
  configuredMelhorEnvioProvider: vi.fn(() => ({ quote: providerQuote })),
  resolveShippingProducts: vi.fn(async () => ({ products: [{ id: "variant-id", quantity: 1 }], fingerprint: "fingerprint" }))
}));

const sandboxRuntimeEnvironment = {
  SHIPPING_PROVIDER: "melhorenvio",
  MELHOR_ENVIO_ENABLED: "true",
  MELHOR_ENVIO_ENVIRONMENT: "sandbox",
  MELHOR_ENVIO_BASE_URL: "https://sandbox.melhorenvio.com.br",
  MELHOR_ENVIO_REDIRECT_URI: "https://panel.example.com/api/integrations/melhor-envio/callback",
  MELHOR_ENVIO_CLIENT_ID: "runtime-client-id",
  MELHOR_ENVIO_CLIENT_SECRET: "runtime-client-secret",
  MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
  MELHOR_ENVIO_APP_NAME: "curti Z",
  MELHOR_ENVIO_TECHNICAL_CONTACT: "tech@example.com",
  MELHOR_ENVIO_ORIGIN_NAME: "Loja Teste",
  MELHOR_ENVIO_ORIGIN_EMAIL: "origem@example.com",
  MELHOR_ENVIO_ORIGIN_PHONE: "11999999999",
  MELHOR_ENVIO_ORIGIN_DOCUMENT: "12345678909",
  MELHOR_ENVIO_ORIGIN_ADDRESS: "Rua Teste",
  MELHOR_ENVIO_ORIGIN_NUMBER: "100",
  MELHOR_ENVIO_ORIGIN_DISTRICT: "Centro",
  MELHOR_ENVIO_ORIGIN_CITY: "São Paulo",
  MELHOR_ENVIO_ORIGIN_STATE: "SP",
  MELHOR_ENVIO_ORIGIN_POSTAL_CODE: "01001000"
};

const request = () => new NextRequest("https://store.example.com/api/shipping/quote", {
  method: "POST",
  headers: { origin: "https://store.example.com", "content-type": "application/json" },
  body: JSON.stringify({ postalCode: "01310100", lines: [{
    productId: "11111111-1111-4111-8111-111111111111",
    variantId: "22222222-2222-4222-8222-222222222222",
    quantity: 1
  }] })
});

const database = { from: serviceFrom };
const melhorEnvioEnvironmentNames = [
  "SHIPPING_PROVIDER", "MELHOR_ENVIO_ENABLED", "MELHOR_ENVIO_ENVIRONMENT", "MELHOR_ENVIO_BASE_URL",
  "MELHOR_ENVIO_REDIRECT_URI", "MELHOR_ENVIO_CLIENT_ID", "MELHOR_ENVIO_CLIENT_SECRET",
  "MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY", "MELHOR_ENVIO_APP_NAME", "MELHOR_ENVIO_TECHNICAL_CONTACT",
  "MELHOR_ENVIO_ORIGIN_NAME", "MELHOR_ENVIO_ORIGIN_EMAIL", "MELHOR_ENVIO_ORIGIN_PHONE",
  "MELHOR_ENVIO_ORIGIN_DOCUMENT", "MELHOR_ENVIO_ORIGIN_COMPANY_DOCUMENT", "MELHOR_ENVIO_ORIGIN_STATE_REGISTER",
  "MELHOR_ENVIO_ORIGIN_CNAE", "MELHOR_ENVIO_ORIGIN_ADDRESS", "MELHOR_ENVIO_ORIGIN_NUMBER",
  "MELHOR_ENVIO_ORIGIN_COMPLEMENT", "MELHOR_ENVIO_ORIGIN_DISTRICT", "MELHOR_ENVIO_ORIGIN_CITY",
  "MELHOR_ENVIO_ORIGIN_STATE", "MELHOR_ENVIO_ORIGIN_POSTAL_CODE"
];

describe("POST /api/shipping/quote", () => {
  beforeEach(() => {
    for (const name of melhorEnvioEnvironmentNames) vi.stubEnv(name, "");
    vi.stubEnv("SHIPPING_PROVIDER", "disabled");
    vi.stubEnv("MELHOR_ENVIO_ENABLED", "false");
    runtime.bindings = { SHIPPING_PROVIDER: "disabled", MELHOR_ENVIO_ENABLED: "false" };
    healthUpsert.mockReset().mockResolvedValue({ error: null });
    serviceFrom.mockReset().mockReturnValue({ upsert: healthUpsert });
    providerQuote.mockReset().mockResolvedValue([]);
    rateLimitRpc.mockReset().mockResolvedValue({ data: true, error: null });
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "customer-id" } }, error: null }) },
      rpc: rateLimitRpc
    } as never);
    vi.mocked(createServiceSupabaseClient).mockReturnValue(database as never);
    vi.mocked(resolveShippingProducts).mockResolvedValue({
      products: [{ id: "variant-id", quantity: 1, weightKg: 0.2, widthCm: 10, heightCm: 4, lengthCm: 20, insuranceValue: 20 }],
      fingerprint: "fingerprint"
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("responde genericamente e persiste shipping_provider_disabled sem chamar o provider", async () => {
    const result = await POST(request());
    expect(result.status).toBe(503);
    await expect(result.json()).resolves.toEqual({
      ok: false,
      code: "SHIPPING_UNAVAILABLE",
      message: "O frete está temporariamente indisponível. Tente novamente."
    });
    expect(providerQuote).not.toHaveBeenCalled();
    expect(healthUpsert).toHaveBeenCalledWith(expect.objectContaining({
      provider: "melhorenvio_store",
      state: "not_configured",
      error_summary: "shipping_provider_disabled",
      metadata_sanitized: {
        scope: "store_runtime", environment: "sandbox", provider: "disabled", missing: [], invalid: []
      }
    }), { onConflict: "provider" });
  });

  it("persiste somente os nomes das configurações ausentes quando Melhor Envio está incompleto", async () => {
    runtime.bindings = { SHIPPING_PROVIDER: "melhorenvio", MELHOR_ENVIO_ENABLED: "true" };
    const result = await POST(request());
    expect(result.status).toBe(503);
    const publicBody: unknown = await result.json();
    expect(JSON.stringify(publicBody)).not.toContain("MELHOR_ENVIO_CLIENT_SECRET");
    expect(JSON.stringify(publicBody)).not.toContain("Rua Teste");
    expect(providerQuote).not.toHaveBeenCalled();
    expect(healthUpsert).toHaveBeenCalledWith(expect.objectContaining({
      provider: "melhorenvio_store",
      state: "not_configured",
      error_summary: "melhor_envio_not_configured"
    }), { onConflict: "provider" });
    const persistedHealth: unknown = healthUpsert.mock.calls[0]?.[0];
    expect(JSON.stringify(persistedHealth)).toContain("MELHOR_ENVIO_CLIENT_SECRET");
    expect(JSON.stringify(persistedHealth)).toContain("MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY");
    expect(JSON.stringify(persistedHealth)).not.toContain("runtime-client-secret");
    expect(JSON.stringify(persistedHealth)).not.toContain("Rua Teste");
  });

  it("usa bindings de runtime mesmo com o build configurado com frete disabled", async () => {
    runtime.bindings = sandboxRuntimeEnvironment;
    const result = await POST(request());
    expect(result.status).toBe(200);
    expect(rateLimitRpc).toHaveBeenCalledWith("consume_private_api_rate_limit", { p_scope: "shipping_quote" });
    expect(configuredMelhorEnvioProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        SHIPPING_PROVIDER: "melhorenvio",
        MELHOR_ENVIO_ENABLED: "true",
        MELHOR_ENVIO_CLIENT_SECRET: "runtime-client-secret"
      }), database
    );
    expect(providerQuote).toHaveBeenCalledWith(expect.objectContaining({
      originPostalCode: "01001000",
      destinationPostalCode: "01310100"
    }));
    expect(healthUpsert).toHaveBeenCalledWith(expect.objectContaining({
      provider: "melhorenvio_store",
      state: "online",
      error_summary: null,
      metadata_sanitized: {
        scope: "store_runtime", environment: "sandbox", provider: "melhorenvio", missing: [], invalid: []
      }
    }), { onConflict: "provider" });
  });

  it("retorna 503 antes de consultar o Melhor Envio quando a RPC rejeita o escopo", async () => {
    runtime.bindings = sandboxRuntimeEnvironment;
    rateLimitRpc.mockResolvedValue({ data: null, error: { code: "22023" } });
    const result = await POST(request());
    expect(result.status).toBe(503);
    expect(rateLimitRpc).toHaveBeenCalledWith("consume_private_api_rate_limit", { p_scope: "shipping_quote" });
    expect(providerQuote).not.toHaveBeenCalled();
    expect(healthUpsert).not.toHaveBeenCalled();
    expect(JSON.stringify(await result.json())).not.toContain("22023");
  });

  it.each([
    ["authentication", "melhor_envio_authentication", 503],
    ["provider_unavailable", "melhor_envio_provider_unavailable", 503],
    ["validation", "melhor_envio_validation", 400],
    ["timeout", "melhor_envio_timeout", 503]
  ] as const)("persiste %s com categoria sanitizada", async (errorCode, summary, status) => {
    runtime.bindings = sandboxRuntimeEnvironment;
    providerQuote.mockRejectedValue(new MelhorEnvioError(errorCode, status, false));
    const result = await POST(request());
    expect(result.status).toBe(status === 400 ? 400 : 503);
    expect(healthUpsert).toHaveBeenCalledWith(expect.objectContaining({
      provider: "melhorenvio_store",
      error_summary: summary,
      metadata_sanitized: {
        scope: "store_runtime", environment: "sandbox", provider: "melhorenvio", missing: [], invalid: []
      }
    }), { onConflict: "provider" });
    const body: unknown = await result.json();
    expect(body).not.toHaveProperty("metadata_sanitized");
    expect(JSON.stringify(body)).not.toContain("runtime-client-secret");
  });
});
