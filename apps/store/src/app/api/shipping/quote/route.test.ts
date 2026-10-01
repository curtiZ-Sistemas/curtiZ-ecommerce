import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MelhorEnvioError } from "@curtiz/integrations";
import type * as PrivateRequestModule from "@/lib/private-request";
import { configuredMelhorEnvioProvider, resolveShippingProducts } from "@/lib/melhor-envio-server";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { POST } from "./route";

const runtime = vi.hoisted(() => {
  const state: { bindings: Record<string, unknown>; unavailable: boolean } = { bindings: {}, unavailable: false };
  return state;
});
const origin = vi.hoisted(() => ({ allowed: true }));
const providerQuote = vi.hoisted(() => vi.fn());
const healthUpsert = vi.hoisted(() => vi.fn());
const eventInsert = vi.hoisted(() => vi.fn());
const quoteInsert = vi.hoisted(() => vi.fn());
const rateLimitRpc = vi.hoisted(() => vi.fn());
const serverLog = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
// Simula somente o contexto que o OpenNext cria em runWithCloudflareRequestContext;
// getStoreRuntimeEnvironment e mergeCloudflareRuntimeBindings rodam de verdade.
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    if (runtime.unavailable) throw new Error("context unavailable");
    return { env: runtime.bindings };
  }
}));
vi.mock("@curtiz/security", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  logServerEvent: serverLog
}));
vi.mock("@/lib/http-origin", () => ({ isAllowedRequestOrigin: () => origin.allowed }));
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
// Módulos reais, reexportados por caminho relativo porque o Vitest da loja não resolve o alias "@/".
vi.mock("@/lib/runtime-environment", () => vi.importActual("../../../../lib/runtime-environment"));
vi.mock("@/lib/shipping-quote-diagnostics", () => vi.importActual("../../../../lib/shipping-quote-diagnostics"));
vi.mock("@/lib/melhor-envio-server", () => ({
  configuredMelhorEnvioProvider: vi.fn(() => ({ quote: providerQuote })),
  resolveShippingProducts: vi.fn()
}));

const sandboxRuntimeEnvironment = {
  CHECKOUT_ENABLED: "true",
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
const sensitiveValues = [
  "runtime-client-secret", "runtime-client-id", "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=", "12345678909",
  "11999999999", "origem@example.com", "tech@example.com", "Rua Teste", "MELHOR_ENVIO_", "SHIPPING_PROVIDER",
  "22023", "select ", "stack", "at POST"
];

const request = () => new NextRequest("https://store.example.com/api/shipping/quote", {
  method: "POST",
  headers: { origin: "https://store.example.com", "content-type": "application/json" },
  body: JSON.stringify({ postalCode: "01310100", lines: [{
    productId: "11111111-1111-4111-8111-111111111111",
    variantId: "22222222-2222-4222-8222-222222222222",
    quantity: 1
  }] })
});

const database = {
  from: (table: string) => {
    if (table === "integration_health") return { upsert: healthUpsert };
    if (table === "technical_events") return { insert: eventInsert };
    if (table === "shipping_quotes") return { insert: (rows: unknown) => ({ select: () => quoteInsert(rows) as unknown }) };
    throw new Error(`unexpected table ${table}`);
  }
};

// Mesmos valores do build do CI: integrações desativadas.
const buildEnvironment = {
  CHECKOUT_ENABLED: "false", PAYMENT_PROVIDER: "disabled", MERCADO_PAGO_ENABLED: "false",
  SHIPPING_PROVIDER: "disabled", MELHOR_ENVIO_ENABLED: "false"
};
const melhorEnvioEnvironmentNames = Object.keys(sandboxRuntimeEnvironment).filter((name) => name.startsWith("MELHOR_ENVIO_"));

const publicBody = async (response: Response) => {
  const body: unknown = await response.json();
  const text = JSON.stringify(body);
  for (const value of sensitiveValues) expect(text).not.toContain(value);
  return body as Record<string, unknown>;
};
const lastHealth = () => healthUpsert.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;
const lastEvent = () => eventInsert.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;

describe("POST /api/shipping/quote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const name of melhorEnvioEnvironmentNames) vi.stubEnv(name, "");
    for (const [name, value] of Object.entries(buildEnvironment)) vi.stubEnv(name, value);
    runtime.bindings = { ...buildEnvironment };
    runtime.unavailable = false;
    origin.allowed = true;
    healthUpsert.mockReset().mockResolvedValue({ error: null });
    eventInsert.mockReset().mockResolvedValue({ error: null });
    quoteInsert.mockReset().mockResolvedValue({ data: [{
      id: "quote-id", service_id: "1", service: "PAC", carrier: "Correios", amount: 19.9, cost: 18.5,
      estimated_days: 5, expires_at: "2026-10-01T00:00:00.000Z"
    }], error: null });
    serverLog.mockReset();
    providerQuote.mockReset().mockResolvedValue([{
      provider: "melhorenvio", serviceId: "1", service: "PAC", carrier: "Correios", amountInCents: 1990, costInCents: 1850,
      estimatedDays: 5, packages: [], expiresAt: "2026-10-01T00:00:00.000Z"
    }]);
    rateLimitRpc.mockReset().mockResolvedValue({ data: true, error: null });
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "customer-id" } }, error: null }) },
      rpc: rateLimitRpc
    } as never);
    vi.mocked(createServiceSupabaseClient).mockReturnValue(database as never);
    vi.mocked(configuredMelhorEnvioProvider).mockClear();
    vi.mocked(resolveShippingProducts).mockReset().mockResolvedValue({
      products: [{ id: "variant-id", quantity: 1, weightKg: 0.2, widthCm: 10, heightCm: 4, lengthCm: 20, insuranceValue: 20 }],
      fingerprint: "fingerprint"
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("rejeita origem inválida com 403 sem consultar sessão", async () => {
    origin.allowed = false;
    const result = await POST(request());
    expect(result.status).toBe(403);
    expect(createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("exige sessão com 401", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) }, rpc: rateLimitRpc
    } as never);
    const result = await POST(request());
    expect(result.status).toBe(401);
    expect(rateLimitRpc).not.toHaveBeenCalled();
    expect(eventInsert).not.toHaveBeenCalled();
  });

  it("registra shipping_rate_limit_unavailable quando a RPC do limitador falha", async () => {
    runtime.bindings = sandboxRuntimeEnvironment;
    rateLimitRpc.mockResolvedValue({ data: null, error: { code: "22023" } });
    const result = await POST(request());
    expect(result.status).toBe(503);
    const body = await publicBody(result);
    expect(body.message).toContain("Não foi possível calcular o frete agora.");
    expect(providerQuote).not.toHaveBeenCalled();
    expect(lastHealth()).toMatchObject({ provider: "melhorenvio_store", state: "degraded", error_summary: "shipping_rate_limit_unavailable" });
    expect(lastEvent()).toMatchObject({ event_type: "shipping_rate_limit_unavailable", severity: "error" });
  });

  it("não trata 429 do limitador como falha técnica", async () => {
    rateLimitRpc.mockResolvedValue({ data: false, error: null });
    const result = await POST(request());
    expect(result.status).toBe(429);
    expect(eventInsert).not.toHaveBeenCalled();
  });

  it("registra store_runtime_context_unavailable quando o contexto do Worker não existe", async () => {
    vi.stubEnv("NODE_ENV", "production");
    runtime.unavailable = true;
    const result = await POST(request());
    expect(result.status).toBe(503);
    const body = await publicBody(result);
    expect(body.message).toContain("O frete está temporariamente indisponível. Tente novamente.");
    expect(lastHealth()).toMatchObject({ state: "offline", error_summary: "store_runtime_context_unavailable" });
    expect(lastEvent()).toMatchObject({ event_type: "store_runtime_context_unavailable" });
    expect(JSON.stringify(lastEvent())).not.toContain("disabled");
  });

  it("registra log estruturado seguro quando nem a persistência do diagnóstico é possível", async () => {
    vi.stubEnv("NODE_ENV", "production");
    runtime.unavailable = true;
    vi.mocked(createServiceSupabaseClient).mockReturnValue(null);
    const result = await POST(request());
    expect(result.status).toBe(503);
    const supportCode = result.headers.get("x-support-code");
    expect(serverLog).toHaveBeenCalledWith("error", "shipping_quote_diagnostic", expect.objectContaining({
      code: "store_runtime_context_unavailable", supportCode, requestId: expect.stringMatching(/^[0-9a-f-]{36}$/u) as unknown
    }));
    for (const value of sensitiveValues.slice(0, 8)) expect(JSON.stringify(serverLog.mock.calls)).not.toContain(value);
  });

  it("persiste shipping_provider_disabled sem chamar o provider", async () => {
    const result = await POST(request());
    expect(result.status).toBe(503);
    const body = await publicBody(result);
    expect(body).toMatchObject({ ok: false, code: "SHIPPING_UNAVAILABLE", supportCode: expect.stringMatching(/^FRT-[0-9A-F]{8}$/u) as unknown });
    expect(body.message).toBe(`O frete está temporariamente indisponível. Tente novamente. Código de suporte: ${String(body.supportCode)}.`);
    expect(providerQuote).not.toHaveBeenCalled();
    expect(lastHealth()).toMatchObject({
      provider: "melhorenvio_store", state: "not_configured", error_summary: "shipping_provider_disabled",
      metadata_sanitized: expect.objectContaining({ provider: "disabled", missing: [], invalid: [], supportCode: body.supportCode }) as unknown
    });
    expect(lastEvent()).toMatchObject({
      source: "store.shipping_quote", event_type: "shipping_provider_disabled", route: "/api/shipping/quote",
      user_id: "customer-id", message: expect.stringContaining(String(body.supportCode)) as unknown
    });
  });

  it("persiste melhor_envio_not_configured com nomes ausentes e inválidos, sem valores", async () => {
    runtime.bindings = { ...sandboxRuntimeEnvironment, MELHOR_ENVIO_CLIENT_SECRET: "", MELHOR_ENVIO_ORIGIN_STATE: "São Paulo" };
    const result = await POST(request());
    expect(result.status).toBe(503);
    await publicBody(result);
    expect(providerQuote).not.toHaveBeenCalled();
    expect(lastHealth()).toMatchObject({
      state: "not_configured", error_summary: "melhor_envio_not_configured",
      metadata_sanitized: expect.objectContaining({
        missing: ["MELHOR_ENVIO_CLIENT_SECRET"], invalid: ["MELHOR_ENVIO_ORIGIN_STATE_INVALID"]
      }) as unknown
    });
    const persisted = JSON.stringify([healthUpsert.mock.calls, eventInsert.mock.calls]);
    for (const value of ["runtime-client-id", "Rua Teste", "12345678909", "origem@example.com", "11999999999"]) {
      expect(persisted).not.toContain(value);
    }
  });

  it("distingue configuração inválida de configuração ausente", async () => {
    runtime.bindings = { ...sandboxRuntimeEnvironment, MELHOR_ENVIO_BASE_URL: "https://sandbox.melhorenvio.com.br/api/v2" };
    const result = await POST(request());
    expect(result.status).toBe(503);
    expect(lastHealth()).toMatchObject({
      error_summary: "melhor_envio_configuration_invalid",
      metadata_sanitized: expect.objectContaining({ missing: [], invalid: ["MELHOR_ENVIO_BASE_URL_INVALID"] }) as unknown
    });
  });

  it("usa o runtime do Worker mesmo com o build disabled e chega a resolveShippingProducts e provider.quote", async () => {
    expect(process.env.SHIPPING_PROVIDER).toBe("disabled");
    expect(process.env.MELHOR_ENVIO_ENABLED).toBe("false");
    runtime.bindings = sandboxRuntimeEnvironment;
    const result = await POST(request());
    expect(result.status).toBe(200);
    expect(rateLimitRpc).toHaveBeenCalledWith("consume_private_api_rate_limit", { p_scope: "shipping_quote" });
    expect(resolveShippingProducts).toHaveBeenCalled();
    expect(configuredMelhorEnvioProvider).toHaveBeenCalledWith(expect.objectContaining({
      SHIPPING_PROVIDER: "melhorenvio", MELHOR_ENVIO_ENABLED: "true", MELHOR_ENVIO_CLIENT_SECRET: "runtime-client-secret"
    }), database);
    expect(providerQuote).toHaveBeenCalledWith(expect.objectContaining({ originPostalCode: "01001000", destinationPostalCode: "01310100" }));
    expect(quoteInsert).toHaveBeenCalledWith([expect.objectContaining({
      customer_id: "customer-id", provider_environment: "sandbox", cart_fingerprint: "fingerprint", amount: 19.9
    })]);
    const body = await publicBody(result);
    expect(body).toEqual({ ok: true, quotes: [{
      id: "quote-id", serviceId: "1", service: "PAC", carrier: "Correios", amountInCents: 1990,
      estimatedDays: 5, expiresAt: "2026-10-01T00:00:00.000Z"
    }] });
    expect(lastHealth()).toMatchObject({ state: "online", error_summary: null });
    expect(eventInsert).not.toHaveBeenCalled();
  });

  it.each([
    [new MelhorEnvioError("validation", 409, false), 409, "shipping_product_invalid"],
    [new MelhorEnvioError("provider_unavailable", 503, true), 503, "shipping_product_lookup_unavailable"]
  ] as const)("diagnostica falhas de produto separadamente (%#)", async (error, status, code) => {
    runtime.bindings = sandboxRuntimeEnvironment;
    vi.mocked(resolveShippingProducts).mockRejectedValue(error);
    const result = await POST(request());
    expect(result.status).toBe(status);
    await publicBody(result);
    expect(providerQuote).not.toHaveBeenCalled();
    expect(lastEvent()).toMatchObject({ event_type: code });
    if (code === "shipping_product_invalid") expect(healthUpsert).not.toHaveBeenCalled();
  });

  it.each([
    ["authentication", 503, "melhor_envio_authentication", 503, "offline"],
    ["timeout", 504, "melhor_envio_timeout", 503, "degraded"],
    ["provider_unavailable", 503, "melhor_envio_provider_unavailable", 503, "degraded"],
    ["rate_limited", 429, "melhor_envio_rate_limited", 503, "degraded"],
    ["validation", 400, "melhor_envio_validation", 400, "degraded"]
  ] as const)("classifica erro %s do provider", async (errorCode, providerStatus, summary, status, state) => {
    runtime.bindings = sandboxRuntimeEnvironment;
    providerQuote.mockRejectedValue(new MelhorEnvioError(errorCode, providerStatus, false));
    const result = await POST(request());
    expect(result.status).toBe(status);
    const body = await publicBody(result);
    expect(body).not.toHaveProperty("metadata_sanitized");
    expect(lastHealth()).toMatchObject({ state, error_summary: summary });
    expect(lastEvent()).toMatchObject({ event_type: summary });
  });

  it("não confunde falha ao gravar shipping_quotes com erro do provider", async () => {
    runtime.bindings = sandboxRuntimeEnvironment;
    quoteInsert.mockResolvedValue({ data: null, error: { message: "insert or update on table violates" } });
    const result = await POST(request());
    expect(result.status).toBe(503);
    await publicBody(result);
    expect(providerQuote).toHaveBeenCalled();
    expect(lastHealth()).toMatchObject({ error_summary: "shipping_quote_persistence_unavailable" });
    expect(lastEvent()).toMatchObject({ event_type: "shipping_quote_persistence_unavailable" });
  });

  it("devolve o mesmo código de suporte no corpo, no cabeçalho e no evento técnico", async () => {
    const result = await POST(request());
    const body = await publicBody(result);
    expect(result.headers.get("x-support-code")).toBe(body.supportCode);
    const event = lastEvent();
    expect(event?.message).toContain(String(body.supportCode));
    expect(event?.context_sanitized).toMatchObject({ supportCode: body.supportCode, requestId: event?.request_id });
  });
});
