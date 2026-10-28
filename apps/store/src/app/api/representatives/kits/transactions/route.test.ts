import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
type SessionUser = { id: string; email: string };
const state = vi.hoisted((): { user: SessionUser | null; record: ReturnType<typeof vi.fn>; rate: ReturnType<typeof vi.fn>; provider: ReturnType<typeof vi.fn>; identity: ReturnType<typeof vi.fn>; pix: ReturnType<typeof vi.fn>; card: ReturnType<typeof vi.fn> } => ({ user: { id: "actor", email: "fixture@example.invalid" },
  record: vi.fn(), rate: vi.fn(), provider: vi.fn(), identity: vi.fn(), pix: vi.fn(), card: vi.fn() }));
vi.mock("@/lib/http-origin", () => import("../../../../../lib/http-origin"));
vi.mock("@/lib/private-request", () => ({ readPrivateJson: (r: Request) => r.json(),
  requirePrivateRateLimit: state.rate, PrivateRequestError: class extends Error { status = 429; } }));
vi.mock("@/lib/unknown-data", () => import("../../../../../lib/unknown-data"));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
  createServiceSupabaseClient: () => ({ rpc: vi.fn(), from: () => ({ select: () => ({ eq: () => ({
    maybeSingle: async () => ({ error: null, data: { status: "active", full_name: "Representante TESTE" } })
  }) }) }) }) }));
vi.mock("@/lib/melhor-envio-server", () => ({ resolveShippingProducts: vi.fn() }));
vi.mock("@/lib/checkout-identity", () => ({ resolveCheckoutPayerDocument: state.identity,
  CheckoutIdentityError: class extends Error { constructor(readonly code: string, readonly status = 503) { super(code); } } }));
vi.mock("@/lib/representative-test-transactions", () => ({
  KitTransactionError: class extends Error { constructor(readonly status = 409) { super(); } },
  kitRecord: state.record, kitCall: vi.fn(), kitTestProvider: state.provider,
  beginKitPix: state.pix, beginKitCard: state.card, cancelKitTestOrder: vi.fn(), refundKitTestOrder: vi.fn(), reconcileKitTestPayment: vi.fn()
}));
import { POST } from "./route";
import { CheckoutIdentityError } from "@/lib/checkout-identity";
const order = "10000000-0000-4000-8000-000000000001";
const send = (body: unknown, origin = "https://curtiz.com.br") => POST(new NextRequest("https://curtiz.com.br/api/representatives/kits/transactions", {
  method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body)
}));
beforeEach(() => { vi.clearAllMocks(); state.user = { id: "actor", email: "fixture@example.invalid" }; vi.stubEnv("ALLOWED_ORIGINS", "https://curtiz.com.br"); });
afterEach(() => vi.unstubAllEnvs());
describe("kit transaction access", () => {
  it("rejects cross origin before authentication or provider work", async () => {
    expect((await send({ action: "read", orderId: order }, "https://attacker.invalid")).status).toBe(403);
    expect(state.provider).not.toHaveBeenCalled();
  });
  it("requires a verified session", async () => {
    state.user = null;
    expect((await send({ action: "read", orderId: order })).status).toBe(401);
    expect(state.record).not.toHaveBeenCalled();
  });
  it("does not accept actor, prices or mode from JSON", async () => {
    expect((await send({ action: "pay_pix", orderId: order, actor: "other", amountInCents: 1, mode: "production" })).status).toBe(400);
    expect(state.record).not.toHaveBeenCalled();
  });
  it("keeps purchases closed without the explicit authorized TEST actor", async () => {
    vi.stubEnv("REPRESENTATIVE_TEST_TRANSACTIONS_ENABLED", "false");
    expect((await send({ action: "pay_pix", orderId: order })).status).toBe(403);
    expect(state.record).not.toHaveBeenCalled();
  });
  it("rejects an actor different from the isolated TEST authorization", async () => {
    vi.stubEnv("REPRESENTATIVE_TEST_TRANSACTIONS_ENABLED", "true");
    vi.stubEnv("REPRESENTATIVE_TEST_ACTOR_ID", "different-actor");
    expect((await send({ action: "pay_pix", orderId: order })).status).toBe(403);
    expect(state.record).not.toHaveBeenCalled();
  });
  it("binds reads to the verified actor and hides internal payment identity", async () => {
    state.record.mockResolvedValue({ state: "reserved", amountInCents: 8043, refundedInCents: 0,
      remainingInCents: 8043, providerPaymentId: "private-id", paymentFingerprint: "private-fingerprint" });
    const response = await send({ action: "read", orderId: order });
    expect(response.status).toBe(200);
    expect(state.record).toHaveBeenCalledWith(expect.anything(), "read_kit_test_transaction", { p_actor: "actor", p_order: order });
    const body: unknown = await response.json();
    expect(body).not.toHaveProperty("providerPaymentId");
    expect(body).not.toHaveProperty("paymentFingerprint");
  });
  it("uses TEST payer identification without requiring or saving a personal CPF", async () => {
    vi.stubEnv("REPRESENTATIVE_TEST_TRANSACTIONS_ENABLED", "true");
    vi.stubEnv("REPRESENTATIVE_TEST_ACTOR_ID", "actor");
    state.identity.mockResolvedValue("12345678909");
    expect((await send({ action: "pay_pix", orderId: order, payerDocument: "123.456.789-09" })).status).toBe(200);
    expect(state.identity).toHaveBeenCalledWith(expect.anything(), "actor", "123.456.789-09", "test");
    expect(state.pix).toHaveBeenCalledWith(expect.anything(), state.user, order, "12345678909", "Representante TESTE");
  });
  it.each([["INVALID_PAYER_DOCUMENT", 400], ["CUSTOMER_IDENTITY_REQUIRED", 409]] as const)("preserves %s before creating a charge", async (code, status) => {
    vi.stubEnv("REPRESENTATIVE_TEST_TRANSACTIONS_ENABLED", "true");
    vi.stubEnv("REPRESENTATIVE_TEST_ACTOR_ID", "actor");
    state.identity.mockRejectedValue(new CheckoutIdentityError(code, status));
    expect((await send({ action: "pay_pix", orderId: order })).status).toBe(status);
    expect(state.pix).not.toHaveBeenCalled();
  });
  it("rejects payer identification on operations that do not create payment", async () => {
    expect((await send({ action: "read", orderId: order, payerDocument: "12345678909" })).status).toBe(400);
  });
  it("keeps card charging behind the same actor-specific gate", async () => {
    expect((await send({ action: "pay_card", orderId: order, card: { paymentMethodId: "master", token: "test-only-card-token", installments: 1 } })).status).toBe(403);
    expect(state.card).not.toHaveBeenCalled();
  });
  it("accepts only a provider token, never card number or security code", async () => {
    expect((await send({ action: "pay_card", orderId: order, card: { paymentMethodId: "master", token: "test-only-card-token", installments: 1,
      cardNumber: "test-only-number", securityCode: "test-only-code" } })).status).toBe(400);
    expect(state.card).not.toHaveBeenCalled();
  });
  it("passes TEST card input to the existing separated payment service", async () => {
    vi.stubEnv("REPRESENTATIVE_TEST_TRANSACTIONS_ENABLED", "true");
    vi.stubEnv("REPRESENTATIVE_TEST_ACTOR_ID", "actor");
    state.identity.mockResolvedValue("12345678909");
    const card = { paymentMethodId: "master", token: "test-only-card-token", issuerId: 24, installments: 1 };
    expect((await send({ action: "pay_card", orderId: order, payerDocument: "12345678909", card })).status).toBe(200);
    expect(state.card).toHaveBeenCalledWith(expect.anything(), state.user, order, "12345678909", "Representante TESTE", card);
    expect(state.pix).not.toHaveBeenCalled();
  });
});

