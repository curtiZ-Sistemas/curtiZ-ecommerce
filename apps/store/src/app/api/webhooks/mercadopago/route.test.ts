import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { POST } from "./route";

const provider = vi.hoisted(() => ({ getPayment: vi.fn() }));
vi.mock("@curtiz/integrations", () => ({
  isMercadoPagoTestCredential: (value: string | undefined) => value?.startsWith("TEST-") === true,
  MercadoPagoTestPaymentProvider: class { getPayment = provider.getPayment; }
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceSupabaseClient: vi.fn() }));
vi.mock("@/lib/mercadopago-payment", () => import("../../../../lib/mercadopago-payment"));

const secret = "webhook-test-secret";
const body = JSON.stringify({ id: "event-1", type: "payment", data: { id: "123" } });
const signature = (timestamp: number, dataId = "123") => createHmac("sha256", secret)
  .update(`id:${dataId};request-id:req-1;ts:${timestamp};`).digest("hex");
const request = (timestamp = Math.floor(Date.now() / 1000), overrides: HeadersInit = {}) =>
  new Request("https://store.example/api/webhooks/mercadopago?data.id=123", {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": "req-1",
      "x-signature": `ts=${timestamp},v1=${signature(timestamp)}`, ...overrides },
    body
  });

describe("webhook canônico do Mercado Pago", () => {
  beforeEach(() => {
    vi.stubEnv("MERCADO_PAGO_ACCESS_TOKEN", "TEST-access-token");
    vi.stubEnv("MERCADO_PAGO_WEBHOOK_SECRET", secret);
    vi.mocked(createServiceSupabaseClient).mockReset();
    provider.getPayment.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rejeita assinatura inválida e replay expirado antes do banco e do provedor", async () => {
    expect((await POST(request(undefined, { "x-signature": "ts=1,v1=" + "0".repeat(64) }))).status).toBe(401);
    expect((await POST(request(Math.floor(Date.now() / 1000) - 301))).status).toBe(401);
    expect(createServiceSupabaseClient).not.toHaveBeenCalled();
    expect(provider.getPayment).not.toHaveBeenCalled();
  });

  it("rejeita corpo acima de 64 KiB antes de processar", async () => {
    const oversized = request(undefined, { "content-length": String(64 * 1024 + 1) });
    expect((await POST(oversized)).status).toBe(413);
    expect(createServiceSupabaseClient).not.toHaveBeenCalled();
  });

  it("trata evento idêntico já processado como duplicado sem consultar o provedor", async () => {
    vi.mocked(createServiceSupabaseClient).mockReturnValue({ rpc: async () => ({ data: "duplicate", error: null }) } as never);
    const response = await POST(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, duplicate: true });
    expect(provider.getPayment).not.toHaveBeenCalled();
  });

  it.each([["busy", 503], ["limited", 429], ["hash_conflict", 409]])("blocks %s claims without a provider call", async (claim, status) => {
    vi.mocked(createServiceSupabaseClient).mockReturnValue({ rpc: async () => ({ data: claim, error: null }) } as never);
    expect((await POST(request())).status).toBe(status);
    expect(provider.getPayment).not.toHaveBeenCalled();
  });

  it("rejects an invalid query signature without reading the stream", async () => {
    const input = request(undefined, { "x-signature": "invalid" });
    expect((await POST(input)).status).toBe(401);
    expect(input.bodyUsed).toBe(false);
  });

  const lease = "00000000-0000-4000-8000-000000000001";
  const confirmedPayment = () => ({
    id: "123", externalReference: "ORDER-server", amountInCents: 14990, currency: "BRL",
    status: "approved", statusDetail: "accredited", dateApproved: "2026-09-14T12:00:00Z",
    providerFeeInCents: 290, netReceivedInCents: 14700, paymentTypeId: "bank_transfer",
    paymentMethodId: "pix", installments: 1,
    refunds: [{ id: "refund-1", amountInCents: 1000, status: "approved", dateCreated: "2026-09-14T13:00:00Z" }]
  });
  const setupProcessing = (failure?: "payment" | "refund" | "lease", review = false) => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_payment_webhook") return { data: `acquired:${lease}`, error: null };
      if (name === "finalize_mercadopago_payment") return { data: review ? "manual_review" : "processed", error: failure === "payment" ? { code: "XX000" } : null };
      if (name === "reconcile_mercadopago_provider_refund") return { data: "completed", error: failure === "refund" ? { code: "XX000" } : null };
      if (name === "finish_payment_webhook") return { data: failure !== "lease", error: null };
      throw new Error("Unexpected RPC");
    });
    vi.mocked(createServiceSupabaseClient).mockReturnValue({ rpc } as never);
    provider.getPayment.mockResolvedValue(confirmedPayment());
    return rpc;
  };

  it("reconciles only provider-confirmed amounts and refunds before acknowledging the current lease", async () => {
    const rpc = setupProcessing();
    expect((await POST(request())).status).toBe(200);
    expect(provider.getPayment).toHaveBeenCalledWith("123");
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_payment_webhook", "finalize_mercadopago_payment", "reconcile_mercadopago_provider_refund", "finish_payment_webhook"
    ]);
    expect(rpc).toHaveBeenCalledWith("finalize_mercadopago_payment", expect.objectContaining({
      p_external_reference: "ORDER-server", p_amount: 149.9, p_currency: "BRL", p_provider_payment_id: "123"
    }));
    expect(rpc).toHaveBeenCalledWith("finish_payment_webhook", {
      p_event_id: "event-1", p_lease_token: lease, p_success: true, p_error_code: null
    });
  });

  it.each(["payment", "refund", "lease"] as const)("does not acknowledge a %s reconciliation failure", async (failure) => {
    const rpc = setupProcessing(failure);
    expect((await POST(request())).status).toBe(503);
    if (failure !== "lease") expect(rpc).toHaveBeenCalledWith("finish_payment_webhook", expect.objectContaining({ p_success: false }));
  });

  it("keeps mismatched provider IDs out of financial RPCs", async () => {
    const rpc = setupProcessing();
    provider.getPayment.mockResolvedValue({ ...confirmedPayment(), id: "foreign-payment" });
    expect((await POST(request())).status).toBe(502);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["claim_payment_webhook", "finish_payment_webhook"]);
  });

  it("does not acknowledge an unexpected finalization result", async () => {
    const rpc = setupProcessing();
    const original = rpc.getMockImplementation();
    rpc.mockImplementation(async (name) => name === "finalize_mercadopago_payment"
      ? { data: "unknown_result", error: null } : await original?.(name) ?? { data: false, error: null });
    expect((await POST(request())).status).toBe(503);
    expect(rpc).toHaveBeenCalledWith("finish_payment_webhook", expect.objectContaining({
      p_success: false, p_error_code: "payment_reconciliation_failed"
    }));
  });

  it("acknowledges persisted manual review without attempting refunds", async () => {
    const rpc = setupProcessing(undefined, true);
    const response = await POST(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, review: true });
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain("reconcile_mercadopago_provider_refund");
  });
});
