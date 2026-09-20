import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { encryptPII } from "../../../lib/pii";
import { POST } from "./route";

const integrationState = vi.hoisted(() => ({ checkoutEnabled: true }));
const identityState = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }));
vi.mock("server-only", () => ({}));
vi.mock("@curtiz/config", () => ({ getIntegrationConfig: () => ({
  checkoutEnabled: integrationState.checkoutEnabled,
  payment: { enabled: true, provider: "mercadopago" },
  shipping: { enabled: true, provider: "fixed", melhorEnvioEnabled: false }
}) }));
vi.mock("@curtiz/integrations", () => ({
  FIXED_SHIPPING_IN_CENTS: 1_690,
  isMercadoPagoTestCredential: (value: unknown) => typeof value === "string" && value.startsWith("TEST-")
}));
vi.mock("@/lib/checkout-flow", () => import("../../../lib/checkout-flow"));
vi.mock("@/lib/http-origin", () => ({ isAllowedRequestOrigin: () => true }));
vi.mock("@/lib/personal-data", () => import("../../../lib/personal-data"));
vi.mock("@/lib/pii", () => ({ encryptPII: () => "encrypted-cpf" }));
vi.mock("@/lib/private-request", () => import("../../../lib/private-request"));
vi.mock("@/lib/unknown-data", () => ({
  isUnknownRecord: (value: unknown) => Boolean(value && typeof value === "object" && !Array.isArray(value)),
  readNumber: (record: Record<string, unknown>, key: string) => Number(record[key] ?? 0),
  readQueryResult: (value: unknown) => value,
  readString: (record: Record<string, unknown>, key: string) => typeof record[key] === "string" ? record[key] : ""
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: vi.fn(), createServiceSupabaseClient: vi.fn() }));
vi.mock("../../../lib/melhor-envio-server", () => ({ resolveShippingProducts: vi.fn() }));

const mockedClient = vi.mocked(createServerSupabaseClient);
const body = {
  idempotencyKey: "22222222-2222-4222-8222-222222222222",
  customer: { name: "Cliente Teste", email: "cliente@example.com", phone: "11999999999", cpf: "52998224725" },
  address: { postalCode: "01310100", street: "Avenida Paulista", number: "1000", complement: "", district: "Bela Vista", city: "Sao Paulo", state: "SP" },
  lines: [{ productId: "33333333-3333-4333-8333-333333333333", variantId: "44444444-4444-4444-8444-444444444444", color: "Preto", size: "39/40", quantity: 1 }]
};
const request = (payload: unknown = body) => new NextRequest("https://loja.example/api/checkout", {
  method: "POST", headers: { origin: "https://loja.example", "content-type": "application/json" },
  body: JSON.stringify(payload)
});

function mockCheckout(discountInCents = 0) {
  const amountInCents = 10_000 - discountInCents + 1_690;
  const quote = { data: {
    subtotalInCents: 10_000, discountInCents, couponName: discountInCents ? "Cupom teste" : "",
    shippingInCents: 1_690, amountInCents
  }, error: null };
  const rpc = vi.fn<(name: string) => Promise<{ data: unknown; error: unknown }>>((name: string) => Promise.resolve(name === "consume_private_api_rate_limit"
    ? { data: true, error: null } : quote));
  const update = vi.fn();
  const eq = vi.fn().mockResolvedValue({ data: null, error: null });
  update.mockReturnValue({ eq });
  mockedClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "customer-id" } } }) },
    rpc, from: vi.fn().mockReturnValue({ update })
  } as never);
  return rpc;
}

describe("checkout sem criação prematura de pedido", () => {
  beforeEach(() => {
    mockedClient.mockReset();
    vi.stubEnv("PII_ENCRYPTION_KEY", "isolated-checkout-cpf-secret-32-bytes");
    identityState.value = {
      customerId: "customer-id", cpfCiphertext: encryptPII("52998224725"), cpfLastFour: "4725"
    };
    vi.mocked(createServiceSupabaseClient).mockReturnValue({ rpc: vi.fn((name: string, args: Record<string, string>) => {
      if (name === "save_customer_checkout_identity") {
        identityState.value = {
          customerId: args.p_customer_id, cpfCiphertext: args.p_cpf_ciphertext, cpfLastFour: args.p_cpf_last_four
        };
        return Promise.resolve({ data: true, error: null });
      }
      if (name === "get_customer_checkout_identity") {
        return Promise.resolve({ data: identityState.value, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }) } as never);
    integrationState.checkoutEnabled = true;
    vi.stubEnv("NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY", "TEST-public-key");
    vi.stubEnv("MERCADO_PAGO_ACCESS_TOKEN", "TEST-access-token");
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(["abriu o checkout", "preencheu o endereço", "selecionou o frete", "chegou ao pagamento"])(
    "%s: apenas cota e não cria pedido", async () => {
      const rpc = mockCheckout();
      const result = await POST(request());
      expect(result.status).toBe(200);
      expect(rpc).toHaveBeenCalledWith("preview_professional_checkout", expect.any(Object));
      expect(rpc).not.toHaveBeenCalledWith("create_professional_checkout_order", expect.anything());
      await expect(result.json()).resolves.not.toHaveProperty("orderId");
    }
  );

  it("mantém cupom opcional e devolve totais recalculados pelo banco", async () => {
    const rpc = mockCheckout(1_000);
    const result = await POST(request({ ...body, couponCode: " SAVE10 " }));
    expect(rpc).toHaveBeenCalledWith("preview_professional_checkout", expect.objectContaining({ p_coupon_code: "SAVE10" }));
    await expect(result.json()).resolves.toMatchObject({ discountInCents: 1_000, shippingInCents: 1_690, amountInCents: 10_690 });
  });

  it("usa CHECKOUT_ENABLED como bloqueio server-side antes de consultar banco", async () => {
    integrationState.checkoutEnabled = false;
    const result = await POST(request());
    expect(result.status).toBe(503);
    await expect(result.json()).resolves.toMatchObject({ code: "CHECKOUT_DISABLED" });
    expect(mockedClient).not.toHaveBeenCalled();
  });

  it("bloqueia abuso e corpo acima do limite antes de consultar a cotação", async () => {
    const rpc = mockCheckout();
    rpc.mockImplementation((name: string) => Promise.resolve(name === "consume_private_api_rate_limit"
      ? { data: false, error: null } : { data: null, error: null }));
    const limited = await POST(request());
    expect(limited.status).toBe(429);
    expect(rpc).not.toHaveBeenCalledWith("preview_professional_checkout", expect.anything());

    mockCheckout();
    const oversized = new NextRequest("https://loja.example/api/checkout", { method: "POST",
      headers: { origin: "https://loja.example", "content-type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(33 * 1024) }) });
    expect((await POST(oversized)).status).toBe(413);
  });

  it("diferencia configuração Supabase ausente de sessão ausente", async () => {
    mockedClient.mockResolvedValue(null);
    const result = await POST(request());
    expect(result.status).toBe(503);
    await expect(result.json()).resolves.toMatchObject({ code: "CHECKOUT_CONFIGURATION_MISSING" });
  });

  it("retorna JSON diagnóstico quando a RPC obrigatória não foi aplicada", async () => {
    mockedClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "customer-id" } }, error: null }) },
      rpc: vi.fn((name: string) => Promise.resolve(name === "consume_private_api_rate_limit"
        ? { data: true, error: null }
        : { data: null, error: { code: "PGRST202", message: "function not found", details: "", hint: "reload schema" } }))
    } as never);
    const result = await POST(request());
    expect(result.status).toBe(503);
    await expect(result.json()).resolves.toMatchObject({ code: "CHECKOUT_CONFIGURATION_INVALID" });
  });

  it("mantém 401 para sessão ausente, em vez de confundir com indisponibilidade", async () => {
    mockedClient.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({
      data: { user: null }, error: { name: "AuthSessionMissingError" }
    }) } } as never);
    const result = await POST(request());
    expect(result.status).toBe(401);
    await expect(result.json()).resolves.toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
  });

  it("não mascara falha de banco desconhecida como alteração de estoque", async () => {
    const rpc = mockCheckout();
    rpc.mockImplementation((name: string) => Promise.resolve(name === "consume_private_api_rate_limit"
      ? { data: true, error: null }
      : { data: null, error: { code: "XX000", message: "database failure" } }));
    const result = await POST(request());
    expect(result.status).toBe(503);
    await expect(result.json()).resolves.toMatchObject({ code: "CHECKOUT_SERVICE_UNAVAILABLE" });
  });

  it("preserva conflito comercial real sem retry", async () => {
    const rpc = mockCheckout();
    rpc.mockImplementation((name: string) => Promise.resolve(name === "consume_private_api_rate_limit"
      ? { data: true, error: null }
      : { data: null, error: { code: "P0001", message: "checkout_line_unavailable" } }));
    const result = await POST(request());
    expect(result.status).toBe(409);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("transforma exceção de runtime em JSON controlado", async () => {
    mockedClient.mockRejectedValue(new Error("runtime failure"));
    const result = await POST(request());
    expect(result.status).toBe(503);
    await expect(result.json()).resolves.toMatchObject({ code: "CHECKOUT_SERVICE_UNAVAILABLE" });
  });

  it("não abre o pagamento quando a identidade privada está ausente", async () => {
    mockCheckout();
    identityState.value = null;
    const result = await POST(request({ ...body, customer: { ...body.customer, cpf: "" } }));
    expect(result.status).toBe(409);
    await expect(result.json()).resolves.toEqual(expect.objectContaining({
      ok: false, code: "CHECKOUT_INCOMPLETE", missingFields: ["cpf"]
    }));
  });

  it("salva CPF novo, confirma a identidade privada e só então abre o pagamento", async () => {
    mockCheckout();
    identityState.value = null;
    const service = createServiceSupabaseClient() as unknown as { rpc: ReturnType<typeof vi.fn> };
    const result = await POST(request());
    expect(result.status).toBe(200);
    const responseText = await result.text();
    expect(responseText).not.toContain(body.customer.cpf);
    expect(responseText).not.toContain("cpfCiphertext");
    expect(service.rpc).toHaveBeenCalledWith("save_customer_checkout_identity", expect.any(Object));
    expect(service.rpc).toHaveBeenCalledWith("get_customer_checkout_identity", { p_customer_id: "customer-id" });
  });

  it("abre o pagamento com identidade privada válida sem redigitar CPF", async () => {
    mockCheckout();
    const service = createServiceSupabaseClient() as unknown as { rpc: ReturnType<typeof vi.fn> };
    const result = await POST(request({ ...body, customer: { ...body.customer, cpf: "" } }));
    expect(result.status).toBe(200);
    expect(service.rpc).not.toHaveBeenCalledWith("save_customer_checkout_identity", expect.anything());
    expect(service.rpc).toHaveBeenCalledWith("get_customer_checkout_identity", { p_customer_id: "customer-id" });
  });

  it.each([
    ["name", { ...body.customer, name: "X" }],
    ["email", { ...body.customer, email: "email-invalido" }],
    ["phone", { ...body.customer, phone: "119999" }]
  ])("bloqueia checkout com %s inválido", async (field, customer) => {
    mockCheckout();
    const result = await POST(request({ ...body, customer }));
    expect(result.status).toBe(409);
    await expect(result.json()).resolves.toMatchObject({ code: "CHECKOUT_INCOMPLETE", missingFields: [field] });
  });

  it("bloqueia endereço incompleto antes do pagamento", async () => {
    mockCheckout();
    const result = await POST(request({ ...body, address: { ...body.address, district: "" } }));
    expect(result.status).toBe(409);
    await expect(result.json()).resolves.toMatchObject({ code: "CHECKOUT_INCOMPLETE", missingFields: ["district"] });
  });
});
