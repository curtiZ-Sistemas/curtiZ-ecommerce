import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { POST } from "./route";

vi.mock("@curtiz/integrations", () => ({
  isMercadoPagoTestCredential: () => true,
  MercadoPagoProviderError: class MercadoPagoProviderError extends Error { httpStatus = 502; },
  MercadoPagoTestPaymentProvider: class MercadoPagoTestPaymentProvider {
    getPaymentMethodIds() { return Promise.resolve(["pix", "visa"]); }
  }
}));
vi.mock("@/lib/checkout-flow", () => ({ normalizeOptionalCouponCode: () => undefined }));
vi.mock("@/lib/http-origin", () => ({ isAllowedRequestOrigin: () => true }));
vi.mock("@/lib/personal-data", () => ({
  CUSTOMER_EMAIL_MAX_LENGTH: 254, isValidBrazilianPhone: () => true, isValidCpf: () => true,
  phoneDigits: (value: string) => value, sanitizeCpf: (value: string) => value
}));
vi.mock("@/lib/pii", () => ({ encryptPII: () => "cipher" }));
vi.mock("@/lib/mercadopago-payment", () => ({
  normalizeMercadoPagoStatus: (value: string) => value, publicPaymentState: (value: string) => value
}));
vi.mock("@/lib/unknown-data", () => ({
  isUnknownRecord: (value: unknown) => Boolean(value && typeof value === "object" && !Array.isArray(value)),
  readNumber: () => 0, readQueryResult: (value: unknown) => value,
  readString: (record: Record<string, unknown>, key: string) => typeof record[key] === "string" ? record[key] : ""
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: vi.fn(), createServiceSupabaseClient: vi.fn() }));

describe("confirmação de pagamento", () => {
  it("rejeita checkout sem método antes de criar pedido", async () => {
    const rpc = vi.fn();
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "customer-id" } } }) }, rpc
    } as never);
    vi.mocked(createServiceSupabaseClient).mockReturnValue({ rpc: vi.fn() } as never);
    const request = new NextRequest("https://loja.example/api/checkout/payment", {
      method: "POST", headers: { origin: "https://loja.example", "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: "22222222-2222-4222-8222-222222222222",
        checkout: {
          customer: { name: "Cliente Teste", email: "cliente@example.com", phone: "11999999999", cpf: "52998224725" },
          address: { postalCode: "01310100", street: "Avenida Paulista", number: "1", complement: "", district: "Bela Vista", city: "São Paulo", state: "SP" },
          lines: [{ productId: "33333333-3333-4333-8333-333333333333", variantId: "44444444-4444-4444-8444-444444444444", color: "Preto", size: "39", quantity: 1 }]
        },
        payment: { installments: 1, payer: { entity_type: "individual", identification: { number: "52998224725" } } }
      })
    });
    const result = await POST(request);
    expect(result.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejeita método inexistente no Mercado Pago antes de criar pedido", async () => {
    const rpc = vi.fn();
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "customer-id" } } }) }, rpc
    } as never);
    vi.mocked(createServiceSupabaseClient).mockReturnValue({ rpc: vi.fn() } as never);
    const request = new NextRequest("https://loja.example/api/checkout/payment", {
      method: "POST", headers: { origin: "https://loja.example", "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: "22222222-2222-4222-8222-222222222222",
        checkout: {
          customer: { name: "Cliente Teste", email: "cliente@example.com", phone: "11999999999", cpf: "52998224725" },
          address: { postalCode: "01310100", street: "Avenida Paulista", number: "1", complement: "", district: "Bela Vista", city: "São Paulo", state: "SP" },
          lines: [{ productId: "33333333-3333-4333-8333-333333333333", variantId: "44444444-4444-4444-8444-444444444444", color: "Preto", size: "39", quantity: 1 }]
        },
        payment: {
          payment_method_id: "forged_method", installments: 1,
          payer: { entity_type: "individual", identification: { number: "52998224725" } }
        }
      })
    });
    const result = await POST(request);
    expect(result.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
