import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { POST } from "./route";

vi.mock("@curtiz/config", () => ({
  getIntegrationConfig: () => ({ payment: { enabled: true, provider: "mercadopago" } })
}));
vi.mock("@curtiz/integrations", () => ({
  FIXED_SHIPPING_IN_CENTS: 1_690,
  isMercadoPagoTestCredential: (value: unknown) =>
    typeof value === "string" && value.startsWith("TEST-")
}));
vi.mock("@/lib/checkout-flow", () => ({
  normalizeOptionalCouponCode: (value: unknown) =>
    typeof value === "string" ? value.trim() || undefined : undefined,
  shouldResumePendingCheckout: (order: unknown, totals: unknown) => {
    const reused = order as { reused?: unknown } | null;
    const state = totals as { status?: unknown; payment_status?: unknown } | null;
    return reused?.reused === true
      && state?.status === "pending_payment"
      && state.payment_status === "pending";
  }
}));
vi.mock("@/lib/http-origin", () => ({ isAllowedRequestOrigin: () => true }));
vi.mock("@/lib/personal-data", () => ({
  CUSTOMER_EMAIL_MAX_LENGTH: 254,
  isValidBrazilianPhone: () => true,
  isValidCpf: () => true,
  phoneDigits: (value: string) => value.replace(/\D/gu, ""),
  sanitizeCpf: (value: string) => value.replace(/\D/gu, "")
}));
vi.mock("@/lib/pii", () => ({ encryptPII: () => "encrypted-cpf" }));
vi.mock("@/lib/unknown-data", () => ({
  isUnknownRecord: (value: unknown) => Boolean(value && typeof value === "object" && !Array.isArray(value)),
  readNumber: (record: Record<string, unknown>, key: string) => Number(record[key] ?? 0),
  readQueryResult: (value: unknown) => value
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: vi.fn() }));

const mockedClient = vi.mocked(createServerSupabaseClient);
const orderId = "11111111-1111-4111-8111-111111111111";

function checkoutRequest(couponCode?: string) {
  return new NextRequest("https://loja.example/api/checkout", {
    method: "POST",
    headers: { origin: "https://loja.example", "content-type": "application/json" },
    body: JSON.stringify({
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
      ...(couponCode === undefined ? {} : { couponCode }),
      customer: { name: "Cliente Teste", email: "cliente@example.com", phone: "11999999999", cpf: "52998224725" },
      address: { postalCode: "01310100", street: "Avenida Paulista", number: "1000", complement: "", district: "Bela Vista", city: "Sao Paulo", state: "SP" },
      lines: [{ productId: "33333333-3333-4333-8333-333333333333", variantId: "44444444-4444-4444-8444-444444444444", color: "Preto", size: "39/40", quantity: 1 }]
    })
  });
}

function mockCheckout(options: { reused?: boolean; discountInCents?: number } = {}) {
  const discountInCents = options.discountInCents ?? 0;
  const amountInCents = 10_000 - discountInCents + 1_690;
  const rpc = vi.fn().mockResolvedValue({ data: {
    orderId, orderCode: "CZT-TESTE", amountInCents, discountInCents,
    name: discountInCents ? "Cupom teste" : "", reused: options.reused ?? false
  }, error: null });
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: {
    status: "pending_payment", payment_status: "pending", subtotal: 100,
    discount_total: discountInCents / 100, shipping_total: 16.9, grand_total: amountInCents / 100
  }, error: null }) };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  mockedClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "customer-id" } } }) },
    rpc,
    from: vi.fn().mockReturnValue(query)
  } as never);
  return rpc;
}

describe("checkout API", () => {
  beforeEach(() => {
    mockedClient.mockReset();
    vi.stubEnv("NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY", "TEST-public-key");
    vi.stubEnv("MERCADO_PAGO_ACCESS_TOKEN", "TEST-access-token");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("nao valida nem cobra desconto para cupom vazio", async () => {
    const rpc = mockCheckout();
    const response = await POST(checkoutRequest("   "));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("create_professional_checkout_order", expect.objectContaining({ p_coupon_code: null }));
    await expect(response.json()).resolves.toMatchObject({ ok: true, discountInCents: 0, amountInCents: 11_690 });
  });

  it("encaminha o cupom valido normalizado e preserva o frete", async () => {
    const rpc = mockCheckout({ discountInCents: 1_000 });
    const response = await POST(checkoutRequest("  SAVE10  "));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("create_professional_checkout_order", expect.objectContaining({ p_coupon_code: "SAVE10" }));
    await expect(response.json()).resolves.toMatchObject({ ok: true, discountInCents: 1_000, shippingInCents: 1_690, amountInCents: 10_690 });
  });

  it("redireciona o pedido pendente recuperado pela idempotencia", async () => {
    const rpc = mockCheckout({ reused: true });
    const response = await POST(checkoutRequest());
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({ ok: true, orderId, redirectTo: `/pedido/${orderId}/pagamento` });
  });
});
