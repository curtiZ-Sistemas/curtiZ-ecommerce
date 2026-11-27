import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  actor: "10000000-0000-4000-8000-000000000001", configured: false, originAllowed: true,
  session: vi.fn(), authBudget: vi.fn(), record: vi.fn(), call: vi.fn(),
  begin: vi.fn(), beginCard: vi.fn(), cardSession: vi.fn(), cancel: vi.fn(), refresh: vi.fn(), makeProvider: vi.fn(),
  originPostal: "35520000", manualFiscal: false, collection: false, creditMethod: "33", debitMethod: "44"
}));
vi.mock("@/lib/http-origin", () => ({ isAllowedRequestOrigin: () => mock.originAllowed }));
vi.mock("@/lib/runtime-environment", () => ({ getStoreRuntimeEnvironment: () => ({
  REPRESENTATIVE_KIT_ORIGIN_POSTAL_CODE: mock.originPostal,
  REPRESENTATIVE_KIT_MANUAL_FISCAL_ENABLED: String(mock.manualFiscal),
  REPRESENTATIVE_KIT_COLLECTION_ENABLED: String(mock.collection),
  BLING_REPRESENTATIVE_CREDIT_CARD_PAYMENT_METHOD_ID: mock.creditMethod,
  BLING_REPRESENTATIVE_DEBIT_CARD_PAYMENT_METHOD_ID: mock.debitMethod,
}) }));
vi.mock("@/lib/representative-resale-scope", () => import("../../../../../lib/representative-resale-scope"));
vi.mock("@/lib/private-request", () => ({
  readPrivateJson: (request: Request) => request.json(), requirePrivateRateLimit: mock.authBudget,
  PrivateRequestError: class extends Error { status = 429; }
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => ({ auth: { getUser: mock.session } }),
  createServiceSupabaseClient: () => ({})
}));
vi.mock("@/lib/representative-commercial-payments", () => ({
  commercialKitCheckoutConfigured: () => mock.configured, kitPaymentView: (order: unknown) => order,
  commercialKitCollector: () => "123", commercialKitPaymentProvider: mock.makeProvider,
  beginCommercialKitPix: mock.begin, beginCommercialKitCard: mock.beginCard, commercialKitCardSession: mock.cardSession, cancelCommercialKitPayment: mock.cancel, refreshCommercialKitPayment: mock.refresh
}));
vi.mock("@/lib/representative-test-transactions", () => ({
  KitTransactionError: class extends Error { constructor(readonly status = 409, readonly reason?: string) { super(); } },
  kitRecord: mock.record, kitCall: mock.call
}));

import { POST } from "./route";

const orderId = "10000000-0000-4000-8000-000000000002";
const addressId = "10000000-0000-4000-8000-000000000003";
const quoteId = "10000000-0000-4000-8000-000000000004";
const variantId = "10000000-0000-4000-8000-000000000005";
const idempotencyKey = "10000000-0000-4000-8000-000000000006";
const reserve = { action: "reserve", quoteId, addressId, variantId, idempotencyKey, quantity: 2 } as const;
const post = (body: object) => POST(new Request("https://curtiz.com.br/api/representatives/kits/orders", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
}));

beforeEach(() => {
  vi.resetAllMocks();
  mock.configured = false;
  mock.originAllowed = true;
  mock.collection = false;
  mock.manualFiscal = false;
  mock.originPostal = "35520000";
  mock.creditMethod = "33"; mock.debitMethod = "44";
  mock.session.mockResolvedValue({ data: { user: { id: mock.actor, email: "verified@example.invalid",
    email_confirmed_at: "2026-11-18T00:00:00Z" } } });
});

describe("commercial kit order route", () => {
  it("uses the MG02 manual reservation rule and blocks Pix until the order qualifies", async () => {
    mock.configured = true;
    mock.manualFiscal = true;
    mock.record.mockResolvedValue({ orderId, state: "reserved" });
    expect((await post(reserve)).status).toBe(200);
    expect(mock.record).toHaveBeenCalledWith(expect.anything(),"reserve_representative_kit_manual_pix", expect.objectContaining({p_actor: mock.actor}));
    mock.call.mockResolvedValueOnce(false);
    expect((await post({ action: "pix", orderId })).status).toBe(409);
    expect(mock.call).toHaveBeenCalledWith(expect.anything(),"can_start_representative_kit_manual_pix", { p_actor: mock.actor, p_order: orderId });
    expect(mock.begin).not.toHaveBeenCalled();
  });

  it("reserves cash on receipt without a route only when collection is enabled, also in manual fiscal mode", async () => {
    mock.configured = true;
    mock.manualFiscal = true;
    const collection = { action: "reserve_collection", selectionId: variantId, quoteId, addressId, quantity: 1, idempotencyKey,
      method: "cash", cashTenderedInCents: 40000 };
    expect((await post(collection)).status).toBe(409);
    expect(mock.record).not.toHaveBeenCalled();
    mock.collection = true;
    mock.record.mockResolvedValue({ orderId, state: "awaiting_receipt" });
    expect((await post(collection)).status).toBe(200);
    expect(mock.record).toHaveBeenCalledWith(expect.anything(), "reserve_representative_kit_own_collection", expect.objectContaining({
      p_actor: mock.actor, p_selection: variantId, p_quote: quoteId, p_method: "cash", p_cash_tendered: 40000 }));
  });

  it("blocks origin before reading the account", async () => {
    mock.originAllowed = false;
    expect((await post(reserve)).status).toBe(403);
    expect(mock.session).not.toHaveBeenCalled();
  });

  it("requires a valid session and rejects customer-supplied prices and identities", async () => {
    expect((await post({ ...reserve, amountInCents: 1, actorId: mock.actor })).status).toBe(400);
    mock.session.mockResolvedValueOnce({ data: { user: null } });
    expect((await post(reserve)).status).toBe(401);
    expect(mock.record).not.toHaveBeenCalled();
  });

  it("blocks both new writes when commercial release is closed without calling a provider", async () => {
    for (const body of [reserve,{ action: "pix", orderId }]) {
      const response = await post(body);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "RESALE_NOT_HOMOLOGATED" });
    }
    expect(mock.makeProvider).not.toHaveBeenCalled();
    expect(mock.record).not.toHaveBeenCalled();
  });

  it("reserves through the service RPC with only server-derived actor and origin", async () => {
    mock.configured = true;
    mock.record.mockResolvedValue({ orderId, state: "reserved" });
    const response = await post(reserve);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mock.record).toHaveBeenCalledWith(expect.anything(),"reserve_representative_kit_own_delivery",{
      p_actor: mock.actor, p_origin: "35520000", p_selection: variantId, p_template: null, p_quantity: 2,
      p_quote: quoteId, p_address: addressId, p_key: idempotencyKey
    });
    mock.originPostal = "01310100";
    expect((await post(reserve)).status).toBe(503);
    expect(mock.record).toHaveBeenCalledOnce();
  });

  it("keeps status and cancellation available when checkout is disabled", async () => {
    const provider = {};
    mock.makeProvider.mockReturnValue(provider);
    mock.cancel.mockResolvedValue({ state: "cancelled" });
    mock.refresh.mockResolvedValue({ state: "paid" });
    mock.call.mockResolvedValue(null);
    expect((await post({ action: "cancel",orderId })).status).toBe(200);
    expect((await post({ action: "status",orderId })).status).toBe(200);
    expect(mock.cancel).toHaveBeenCalledWith(expect.anything(),provider,"123",mock.actor,orderId);
    expect(mock.refresh).toHaveBeenCalledWith(expect.anything(),provider,"123",mock.actor,orderId);
  });

  it("sends pair quantities to the buyer-scoped return RPC and keeps whole returns working", async () => {
    mock.record.mockResolvedValue({ id: quoteId, state: "requested" });
    const request = { action: "return", orderId, quantity: 1, reason: "Inspeção de teste", idempotencyKey };
    const pairs = { "PAIR-34": 2 };
    expect((await post({ ...request, pairs })).status).toBe(200);
    expect(mock.record).toHaveBeenLastCalledWith(expect.anything(),"request_representative_kit_pair_return",{
      p_actor: mock.actor, p_order: orderId, p_reason: request.reason, p_key: idempotencyKey, p_pairs: pairs
    });
    expect((await post({ ...request, pairs: {} })).status).toBe(400);
    expect((await post({ ...request, pairs, quantity: 2 })).status).toBe(400);
    expect((await post(request)).status).toBe(200);
    expect(mock.record).toHaveBeenLastCalledWith(expect.anything(),"request_representative_kit_return",{
      p_actor: mock.actor, p_order: orderId, p_reason: request.reason, p_key: idempotencyKey, p_quantity: 1
    });
    expect(mock.record).toHaveBeenCalledTimes(2);
  });

  describe("card payment", () => {
    const token = "token-fixture-123";
    const payment = { kind: "credit", token, payment_method_id: "visa", installments: 3, issuer_id: "25" };
    const body = { action: "card", orderId, payment };
    it("does not collect money when the card fiscal mapping is missing", async () => {
      mock.configured = true;
      mock.creditMethod = ""; mock.debitMethod = "";
      for (const request of [body, { action: "card_session", orderId }]) {
        const response = await post(request);
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ code: "CARD_FISCAL_NOT_CONFIGURED" });
      }
      expect(mock.beginCard).not.toHaveBeenCalled();
      expect(mock.cardSession).not.toHaveBeenCalled();
    });

    it("is closed with the rest of the checkout until the release is configured", async () => {
      for (const request of [body, { action: "card_session", orderId }]) expect((await post(request)).status).toBe(409);
      expect(mock.makeProvider).not.toHaveBeenCalled();
      expect(mock.beginCard).not.toHaveBeenCalled();
    });

    it("sends only the token and form choices, with the actor and order taken from the server", async () => {
      mock.configured = true;
      mock.beginCard.mockResolvedValue({ order: { state: "paid" }, card: { status: "approved" } });
      const response = await post({ ...body, orderId: orderId.toUpperCase() });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, order: { state: "paid" }, card: { status: "approved" } });
      expect(mock.beginCard).toHaveBeenCalledWith(expect.anything(), undefined, "123",
        { id: mock.actor, email: "verified@example.invalid" }, orderId,
        { kind: "credit", token, paymentMethodId: "visa", installments: 3, issuerId: 25 });
      expect(mock.begin).not.toHaveBeenCalled();
    });

    it("reports a refused card and a card in analysis without turning them into errors", async () => {
      mock.configured = true;
      mock.beginCard.mockResolvedValueOnce({ order: { state: "reserved" }, card: { status: "rejected", message: "Pagamento recusado." } });
      expect(await (await post(body)).json()).toMatchObject({ ok: true, card: { status: "rejected" } });
      mock.beginCard.mockResolvedValueOnce({ order: { state: "payment_pending" }, card: { status: "in_process" } });
      expect(await (await post(body)).json()).toMatchObject({ ok: true, order: { state: "payment_pending" }, card: { status: "in_process" } });
    });

    it("rejects customer-supplied amounts, payers, documents and malformed card data", async () => {
      mock.configured = true;
      for (const payment of [
        { ...body.payment, amountInCents: 1 }, { ...body.payment, payer: { identification: { number: "52998224725" } } },
        { ...body.payment, token: "short" }, { ...body.payment, kind: "pix" }, { ...body.payment, installments: 49 }
      ]) expect((await post({ ...body, payment })).status).toBe(400);
      expect((await post({ ...body, amountInCents: 1 })).status).toBe(400);
      expect(mock.beginCard).not.toHaveBeenCalled();
    });

    it("applies the same ownership, e-mail and MG02 blocks as the Pix", async () => {
      mock.configured = true;
      mock.manualFiscal = true;
      mock.call.mockResolvedValueOnce(false);
      expect((await post(body)).status).toBe(409);
      expect(mock.call).toHaveBeenCalledWith(expect.anything(), "can_start_representative_kit_manual_pix", { p_actor: mock.actor, p_order: orderId });
      mock.session.mockResolvedValueOnce({ data: { user: { id: mock.actor, email: "a@example.invalid", email_confirmed_at: null } } });
      expect((await post(body)).status).toBe(403);
      expect(mock.beginCard).not.toHaveBeenCalled();
    });

    it("hands the browser only the public session data", async () => {
      mock.configured = true;
      mock.cardSession.mockResolvedValue({ orderId, amountInCents: 12100, publicKey: "APP_USR-public", email: "verified@example.invalid" });
      const response = await post({ action: "card_session", orderId });
      expect(await response.json()).toEqual({ ok: true, session: { orderId, amountInCents: 12100, publicKey: "APP_USR-public", email: "verified@example.invalid" } });
    });

    it("answers a missing payer document with a specific code, for Pix and card, and no document", async () => {
      mock.configured = true;
      const { KitTransactionError } = await import("@/lib/representative-test-transactions");
      mock.begin.mockRejectedValue(new KitTransactionError(409, "payer_document_required"));
      mock.beginCard.mockRejectedValue(new KitTransactionError(409, "payer_document_required"));
      for (const request of [{ action: "pix", orderId }, body]) {
        const response = await post(request);
        expect(response.status).toBe(409);
        const answer = await response.json() as Record<string, unknown>;
        expect(answer.code).toBe("PAYER_DOCUMENT_REQUIRED");
        expect(String(answer.message)).toMatch(/CPF ou CNPJ/u);
        expect(JSON.stringify(answer)).not.toMatch(/\d{11}/u);
      }
      mock.begin.mockRejectedValue(new KitTransactionError(409));
      const generic = await (await post({ action: "pix", orderId })).json() as Record<string, unknown>;
      expect(generic.code).toBeUndefined();
    });
  });
});
