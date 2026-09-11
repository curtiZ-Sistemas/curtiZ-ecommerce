import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { POST } from "./route";

vi.mock("@curtiz/config", () => ({ getIntegrationConfig: () => ({ payment: { enabled: true, provider: "mercadopago" } }) }));
vi.mock("@curtiz/integrations", () => ({
  FIXED_SHIPPING_IN_CENTS: 1_690,
  isMercadoPagoTestCredential: (value: unknown) => typeof value === "string" && value.startsWith("TEST-")
}));
vi.mock("@/lib/checkout-flow", () => ({
  normalizeOptionalCouponCode: (value: unknown) => typeof value === "string" ? value.trim() || undefined : undefined
}));
vi.mock("@/lib/http-origin", () => ({ isAllowedRequestOrigin: () => true }));
vi.mock("@/lib/personal-data", () => ({
  CUSTOMER_EMAIL_MAX_LENGTH: 254, isValidBrazilianPhone: () => true, isValidCpf: () => true,
  phoneDigits: (value: string) => value.replace(/\D/gu, ""), sanitizeCpf: (value: string) => value.replace(/\D/gu, "")
}));
vi.mock("@/lib/pii", () => ({ encryptPII: () => "encrypted-cpf" }));
vi.mock("@/lib/unknown-data", () => ({
  isUnknownRecord: (value: unknown) => Boolean(value && typeof value === "object" && !Array.isArray(value)),
  readNumber: (record: Record<string, unknown>, key: string) => Number(record[key] ?? 0),
  readQueryResult: (value: unknown) => value,
  readString: (record: Record<string, unknown>, key: string) => typeof record[key] === "string" ? record[key] : ""
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: vi.fn() }));

const mockedClient = vi.mocked(createServerSupabaseClient);
const body = {
  idempotencyKey: "22222222-2222-4222-8222-222222222222",
  customer: { name: "Cliente Teste", email: "cliente@example.com", phone: "11999999999", cpf: "52998224725" },
  address: { postalCode: "01310100", street: "Avenida Paulista", number: "1000", complement: "", district: "Bela Vista", city: "Sao Paulo", state: "SP" },
  lines: [{ productId: "33333333-3333-4333-8333-333333333333", variantId: "44444444-4444-4444-8444-444444444444", color: "Preto", size: "39/40", quantity: 1 }]
};
const request = (couponCode?: string) => new NextRequest("https://loja.example/api/checkout", {
  method: "POST", headers: { origin: "https://loja.example", "content-type": "application/json" },
  body: JSON.stringify({ ...body, ...(couponCode === undefined ? {} : { couponCode }) })
});

function mockCheckout(discountInCents = 0) {
  const amountInCents = 10_000 - discountInCents + 1_690;
  const rpc = vi.fn().mockResolvedValue({ data: {
    subtotalInCents: 10_000, discountInCents, couponName: discountInCents ? "Cupom teste" : "",
    shippingInCents: 1_690, amountInCents
  }, error: null });
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
    const result = await POST(request(" SAVE10 "));
    expect(rpc).toHaveBeenCalledWith("preview_professional_checkout", expect.objectContaining({ p_coupon_code: "SAVE10" }));
    await expect(result.json()).resolves.toMatchObject({ discountInCents: 1_000, shippingInCents: 1_690, amountInCents: 10_690 });
  });
});
