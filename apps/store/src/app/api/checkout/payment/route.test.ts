import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MercadoPagoProviderError, type MercadoPagoPayment, type MercadoPagoPaymentInput } from "@curtiz/integrations";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { POST } from "./route";
import { validateSavedCardCustomer, validateSavedCardPayer } from "@/lib/mercadopago-saved-cards";
import { decryptPII, encryptPII } from "../../../../lib/pii";

const state = vi.hoisted(() => ({
  checkoutEnabled: true, createPayment: vi.fn(), getPayment: vi.fn(), getPaymentMethodIds: vi.fn()
}));
vi.mock("server-only", () => ({}));
vi.mock("@curtiz/config", () => ({ getIntegrationConfig: () => ({ checkoutEnabled: state.checkoutEnabled }) }));
vi.mock("@curtiz/integrations", () => ({
  isMercadoPagoTestCredential: (value: string | undefined) => value?.startsWith("TEST-") === true,
  MercadoPagoProviderError: class extends Error {
    constructor(code: string, readonly httpStatus = 502) { super(code); }
  },
  MercadoPagoTestPaymentProvider: class {
    getPaymentMethodIds = state.getPaymentMethodIds;
    createPayment = state.createPayment;
    getPayment = state.getPayment;
  }
}));
vi.mock("@/lib/checkout-flow", () => import("../../../../lib/checkout-flow"));
vi.mock("@/lib/http-origin", () => ({ isAllowedRequestOrigin: () => true }));
vi.mock("@/lib/personal-data", () => import("../../../../lib/personal-data"));
vi.mock("@/lib/mercadopago-payer-identity", () => import("../../../../lib/mercadopago-payer-identity"));
vi.mock("@/lib/pii", () => import("../../../../lib/pii"));
vi.mock("@/lib/mercadopago-payment", () => import("../../../../lib/mercadopago-payment"));
vi.mock("@/lib/unknown-data", () => import("../../../../lib/unknown-data"));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: vi.fn(), createServiceSupabaseClient: vi.fn() }));
vi.mock("@/lib/mercadopago-saved-cards", () => ({ validateSavedCardCustomer: vi.fn(), validateSavedCardPayer: vi.fn(), SavedCardsError: class extends Error {} }));

const orderId = "11111111-1111-4111-8111-111111111111";
const checkoutKey = "22222222-2222-4222-8222-222222222222";
const firstKey = "55555555-5555-4555-8555-555555555555";
const secondKey = "66666666-6666-4666-8666-666666666666";
const body = {
  idempotencyKey: firstKey, checkoutIdempotencyKey: checkoutKey,
  checkout: {
    customer: { name: "Cliente Teste", email: "cliente@example.com", phone: "11999999999", cpf: "52998224725" },
    address: { postalCode: "01310100", street: "Avenida Paulista", number: "1", complement: "", district: "Bela Vista", city: "São Paulo", state: "SP" },
    lines: [{ productId: "33333333-3333-4333-8333-333333333333", variantId: "44444444-4444-4444-8444-444444444444", color: "Preto", size: "39", quantity: 1 }]
  },
  payment: { payment_method_id: "visa", token: "first-card-token", installments: 1,
    payer: { entity_type: "individual", identification: { type: "CPF", number: "12345678909" } } }
};
const request = (payload: unknown = body) => new NextRequest("https://loja.example/api/checkout/payment", {
  method: "POST", headers: { origin: "https://loja.example", "content-type": "application/json" }, body: JSON.stringify(payload)
});
const providerPayment = (status = "approved"): MercadoPagoPayment => ({
  id: "provider-1", status, statusDetail: "", amountInCents: 6790, currency: "BRL", externalReference: "CZ-123",
  paymentMethodId: "visa", paymentTypeId: "credit_card", dateApproved: null, expiresAt: null,
  pixCopyPaste: "", pixQrCodeBase64: "", boletoUrl: "", digitableLine: "", providerFeeInCents: null,
  netReceivedInCents: null, installments: 1, refunds: []
});
type QueryResult = { data: unknown; error: unknown };
type Attempt = { id: string; provider_payment_id: string; status: string; payment_method: string; fingerprint: unknown };

function database() {
  const identity = { customerId: "customer-id", cpfCiphertext: encryptPII(body.checkout.customer.cpf), cpfLastFour: "4725" };
  const order = { id: orderId, public_code: "CZ-123", customer_id: "customer-id", customer_email_snapshot: "cliente@example.com",
    customer_name_snapshot: "Cliente Teste", cpf_last_four: "4725", status: "pending_payment", grand_total: 67.9, currency: "BRL" };
  const payment = { id: "local-payment", status: "pending", provider_payment_id: "", amount: 67.9, currency: "BRL" };
  const attempts = new Map<string, Attempt>();
  const creationKeys = new Set<unknown>();
  const failures = { creation: "", attempt: "", finalize: "" };
  function from(table: string) {
    const filters = new Map<string, unknown>();
    let patch: Record<string, unknown> | null = null;
    const result = (): QueryResult => {
      const attempt = filters.has("idempotency_key") ? attempts.get(String(filters.get("idempotency_key")))
        : [...attempts.values()].find(a => a.id === filters.get("id"));
      const row = table === "orders" ? order : table === "payments" ? payment
        : table === "payment_attempts" ? attempt : { resource_id: orderId };
      if (table === "orders" && filters.get("customer_id") !== order.customer_id) return { data: null, error: null };
      if (patch && row) Object.assign(row, patch);
      return { data: table === "payment_attempts" && filters.has("idempotency_key") && attempt
        ? { ...attempt, request_fingerprint: attempt.fingerprint } : row, error: null };
    };
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => { filters.set(column, value); return query; },
      is: (column: string, value: unknown) => { filters.set(column, value); return query; },
      update: (values: Record<string, unknown>) => { patch = values; return query; },
      maybeSingle: () => Promise.resolve(result()),
      then: (resolveResult: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(result()).then(resolveResult, reject)
    };
    return query;
  }
  const rpc = vi.fn((name: string, args: Record<string, unknown>): Promise<QueryResult> => {
    if (name === "get_customer_checkout_identity") return Promise.resolve({ data: identity, error: null });
    if (name === "confirm_professional_checkout_order") {
      if (failures.creation) return Promise.resolve({ data: null, error: { code: "22023", message: failures.creation } });
      creationKeys.add(args.p_idempotency_key);
      return Promise.resolve({ data: { orderId }, error: null });
    }
    if (name === "begin_mercadopago_payment_attempt") {
      if (failures.attempt) return Promise.resolve({ data: null, error: { code: "P0001", message: failures.attempt } });
      const key = String(args.p_idempotency_key);
      let attempt = attempts.get(key);
      if (attempt && (attempt.fingerprint !== args.p_request_fingerprint || attempt.payment_method !== args.p_payment_method)) {
        return Promise.resolve({ data: null, error: { code: "22023", message: "idempotency_conflict" } });
      }
      if (!attempt && [...attempts.values()].some(a => a.status !== "rejected")) {
        return Promise.resolve({ data: null, error: { code: "P0001", message: "payment_in_progress" } });
      }
      if (!attempt) {
        attempt = { id: `attempt-${attempts.size + 1}`, provider_payment_id: "", status: "pending",
          payment_method: String(args.p_payment_method), fingerprint: args.p_request_fingerprint };
        attempts.set(key, attempt);
      }
      return Promise.resolve({ data: { id: attempt.id, providerPaymentId: attempt.provider_payment_id, status: attempt.status }, error: null });
    }
    if (name === "finalize_mercadopago_payment") {
      if (failures.finalize) return Promise.resolve({ data: null, error: { code: "XX000", message: "failed" } });
      payment.status = String(args.p_status);
      if (payment.status === "approved") order.status = "payment_approved";
      for (const attempt of attempts.values()) if (attempt.provider_payment_id === args.p_provider_payment_id) attempt.status = payment.status;
      return Promise.resolve({ data: "processed", error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
  vi.mocked(createServerSupabaseClient).mockResolvedValue({ auth: { getUser: () => Promise.resolve({ data: { user: { id: "customer-id" } }, error: null }) } } as never);
  vi.mocked(createServiceSupabaseClient).mockReturnValue({ from, rpc } as never);
  return { order, payment, attempts, creationKeys, failures, rpc, identity };
}

describe("confirmação de pagamento", () => {
  beforeEach(() => {
    vi.clearAllMocks(); state.checkoutEnabled = true;
    vi.stubEnv("MERCADO_PAGO_ACCESS_TOKEN", "TEST-access-token");
    vi.stubEnv("NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY", "TEST-public-key");
    vi.stubEnv("PII_ENCRYPTION_KEY", "isolated-payment-cpf-secret-32-bytes");
    state.createPayment.mockReset().mockResolvedValue(providerPayment());
    state.getPayment.mockReset().mockResolvedValue(providerPayment());
    state.getPaymentMethodIds.mockReset().mockResolvedValue(["visa"]);
    vi.mocked(validateSavedCardPayer).mockReset();
    vi.mocked(validateSavedCardCustomer).mockReset().mockResolvedValue("customer-owned");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("não inicia pagamento com CHECKOUT_ENABLED desligado", async () => {
    state.checkoutEnabled = false;
    expect((await POST(request())).status).toBe(503);
    expect(createServerSupabaseClient).not.toHaveBeenCalled();
  });
  it("envia documento TEST e armazena exclusivamente o CPF real", async () => {
    const db = database();
    expect((await POST(request())).status).toBe(200);
    const calls = db.rpc.mock.calls as Array<[string, Record<string, unknown>]>;
    const creationArgs = calls.find(call => call[0] === "confirm_professional_checkout_order")?.[1];
    expect(creationArgs).toMatchObject({ p_idempotency_key: checkoutKey, p_cpf_last_four: "4725" });
    const ciphertext = creationArgs?.p_cpf_ciphertext;
    expect(ciphertext).toMatch(/^v1\./u);
    if (typeof ciphertext !== "string") throw new Error("Expected encrypted checkout identity");
    expect(decryptPII(ciphertext)).toBe(body.checkout.customer.cpf);
    expect(state.createPayment).toHaveBeenCalledWith(expect.objectContaining({ customerDocument: "12345678909", idempotencyKey: firstKey }));
    expect(db.order.cpf_last_four).toBe("4725");
  });
  it("envia Pix ao provider mesmo quando o diagnóstico de meios não contém pix", async () => {
    const db = database();
    const result = await POST(request({ ...body, payment: {
      payment_method_id: "pix", payer: { entity_type: "individual", identification: { type: "CPF", number: "12345678909" } }
    } }));
    expect(result.status).toBe(200);
    expect(state.getPaymentMethodIds).not.toHaveBeenCalled();
    expect(state.createPayment).toHaveBeenCalledWith(expect.objectContaining({ paymentMethodId: "pix" }));
    expect(db.attempts.get(firstKey)?.payment_method).toBe("pix");
  });
  it("aceita o boleto bolbradesco devolvido pelo Brick", async () => {
    const db = database();
    const result = await POST(request({ ...body, payment: {
      payment_method_id: "bolbradesco", payer: { entity_type: "individual", identification: { type: "CPF", number: "12345678909" } }
    } }));
    expect(result.status).toBe(200);
    expect(state.createPayment).toHaveBeenCalledWith(expect.objectContaining({ paymentMethodId: "bolbradesco" }));
    expect(db.attempts.get(firstKey)?.payment_method).toBe("bolbradesco");
  });
  it("aceita cartão conhecido somente com token gerado pelo Brick", async () => {
    database();
    expect((await POST(request())).status).toBe(200);
    expect(state.createPayment).toHaveBeenCalledWith(expect.objectContaining({
      paymentMethodId: "visa", token: "first-card-token"
    }));
  });
  it("recusa cartão sem token antes de criar pedido", async () => {
    const db = database();
    const result = await POST(request({ ...body, payment: {
      payment_method_id: "visa", payer: body.payment.payer
    } }));
    expect(result.status).toBe(400);
    expect(await result.json()).toMatchObject({ code: "INVALID_CARD_TOKEN", recovery: "new_attempt" });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(state.createPayment).not.toHaveBeenCalled();
  });
  it("paga cartão salvo com Customer verificado no servidor e token novo", async () => {
    database();
    vi.mocked(validateSavedCardCustomer).mockResolvedValue("customer-owned");
    expect((await POST(request({ ...body, payment: { ...body.payment,
      payer: { entity_type: "individual", type: "customer", id: "customer-owned" } } }))).status).toBe(200);
    expect(state.createPayment).toHaveBeenCalledWith(expect.objectContaining({ providerCustomerId: "customer-owned", token: "first-card-token" }));
  });
  it("rejeita Customer arbitrário antes de criar pedido ou cobrança", async () => {
    const db = database();
    vi.mocked(validateSavedCardCustomer).mockRejectedValue(new Error("not_owned"));
    expect((await POST(request({ ...body, payment: { ...body.payment,
      payer: { entity_type: "individual", type: "customer", id: "customer-other" } } }))).status).toBe(503);
    expect(db.rpc).not.toHaveBeenCalled(); expect(state.createPayment).not.toHaveBeenCalled();
  });
  it("reutiliza a identidade privada quando o CPF real já está salvo", async () => {
    const db = database();
    expect((await POST(request({ ...body, checkout: { ...body.checkout, customer: { ...body.checkout.customer, cpf: "" } } }))).status).toBe(200);
    expect(db.rpc).toHaveBeenCalledWith("confirm_professional_checkout_order", expect.objectContaining({ p_cpf_ciphertext: "", p_cpf_last_four: "" }));
    expect(db.rpc).not.toHaveBeenCalledWith("get_customer_checkout_identity", expect.anything());
    expect(decryptPII(db.identity.cpfCiphertext)).toBe(body.checkout.customer.cpf);
  });
  it.each(["pix", "bolbradesco", "visa"])("CPF salvo e cpf vazio permitem %s sem documento do Brick", async method => {
    const db = database();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await POST(request({ ...body,
      checkout: { ...body.checkout, customer: { ...body.checkout.customer, cpf: "" } },
      payment: { ...body.payment, payment_method_id: method, payer: { entity_type: "individual" } }
    }));
    expect(result.status).toBe(200);
    expect(db.rpc).toHaveBeenCalledWith("get_customer_checkout_identity", { p_customer_id: "customer-id" });
    expect(state.createPayment).toHaveBeenCalledWith(expect.objectContaining({ customerDocument: body.checkout.customer.cpf }));
    const output = await result.text();
    expect(output).not.toContain(body.checkout.customer.cpf);
    expect(output).not.toContain(db.identity.cpfCiphertext);
    expect(JSON.stringify(log.mock.calls)).not.toContain(body.checkout.customer.cpf);
    log.mockRestore();
  });
  it("falha fechado se a identidade criptografada estiver inválida", async () => {
    const db = database(); db.identity.cpfCiphertext = "invalid-ciphertext";
    const result = await POST(request({ orderId, idempotencyKey: firstKey,
      payment: { payment_method_id: "pix", payer: { entity_type: "individual", identification: { number: "" } } } }));
    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({ code: "CUSTOMER_IDENTITY_UNAVAILABLE" });
    expect(state.createPayment).not.toHaveBeenCalled(); expect(db.attempts.size).toBe(0);
  });
  it("não recupera CPF nem cobra pedido de outro cliente", async () => {
    const db = database(); db.order.customer_id = "customer-other";
    const result = await POST(request({ orderId, idempotencyKey: firstKey,
      payment: { payment_method_id: "pix", payer: { entity_type: "individual" } } }));
    expect(result.status).toBe(404);
    expect(db.rpc).not.toHaveBeenCalled(); expect(state.createPayment).not.toHaveBeenCalled();
  });
  it("retry do cartão salvo com cobrança conhecida não revalida token consumido", async () => {
    database();
    state.createPayment.mockResolvedValue(providerPayment("pending"));
    state.getPayment.mockResolvedValue(providerPayment("pending"));
    const payload = { ...body, payment: { ...body.payment, payer: { entity_type: "individual", type: "customer", id: "customer-owned" } } };
    expect((await POST(request(payload))).status).toBe(200);
    vi.mocked(validateSavedCardPayer).mockRejectedValue(new Error("token_consumed"));
    expect((await POST(request(payload))).status).toBe(200);
    expect(validateSavedCardPayer).toHaveBeenCalledTimes(1);
    expect(state.createPayment).toHaveBeenCalledTimes(1);
    expect(state.getPayment).toHaveBeenCalledTimes(1);
  });
  it("falha antes de enviar a cobrança libera uma tentativa limpa de cartão salvo", async () => {
    const db = database();
    vi.mocked(validateSavedCardPayer).mockRejectedValue(new Error("token_lookup_failed"));
    const payload = { ...body, payment: { ...body.payment, payer: { entity_type: "individual", type: "customer", id: "customer-owned" } } };
    expect((await POST(request(payload))).status).toBe(503);
    expect(db.attempts.has(firstKey)).toBe(false);
    expect(state.createPayment).not.toHaveBeenCalled();
    vi.mocked(validateSavedCardPayer).mockResolvedValue("customer-owned");
    expect((await POST(request({ ...payload, idempotencyKey: secondKey }))).status).toBe(200);
    expect(state.createPayment).toHaveBeenCalledTimes(1);
  });
  it("cartão salvo com resposta perdida repete somente a mesma chave sem revalidar token consumido", async () => {
    const db = database();
    const payload = { ...body, payment: { ...body.payment, payer: { entity_type: "individual", type: "customer", id: "customer-owned" } } };
    state.createPayment.mockRejectedValueOnce(new MercadoPagoProviderError("provider_unavailable", 500));
    expect((await POST(request(payload))).status).toBe(502);
    vi.mocked(validateSavedCardPayer).mockRejectedValue(new Error("token_consumed"));
    expect((await POST(request(payload))).status).toBe(200);
    expect(validateSavedCardPayer).toHaveBeenCalledTimes(1);
    expect(db.attempts.size).toBe(1);
    expect(state.createPayment).toHaveBeenCalledTimes(2);
    expect(state.createPayment).toHaveBeenNthCalledWith(1, expect.objectContaining({ idempotencyKey: firstKey }));
    expect(state.createPayment).toHaveBeenNthCalledWith(2, expect.objectContaining({ idempotencyKey: firstKey }));
  });
  it.each(["11111111111", "123456789012", "abc12345678909"])("CPF de pagador inválido não cria tentativa: %s", async number => {
    const db = database();
    const result = await POST(request({ ...body, payment: { ...body.payment, payer: { ...body.payment.payer, identification: { number } } } }));
    expect(result.status).toBe(400);
    expect(await result.json()).toMatchObject({ code: "INVALID_PAYER_DOCUMENT", recovery: "new_attempt" });
    expect(db.rpc).not.toHaveBeenCalled(); expect(state.createPayment).not.toHaveBeenCalled();
  });
  it("não relaxa CPF real do checkout em TEST", async () => {
    const db = database();
    const result = await POST(request({ ...body, checkout: { ...body.checkout, customer: { ...body.checkout.customer, cpf: "52998224724" } } }));
    expect(result.status).toBe(400);
    expect(await result.json()).toMatchObject({ code: "INVALID_CUSTOMER_CPF" }); expect(db.rpc).not.toHaveBeenCalled();
  });
  it("não ativa TEST pelo payload com credencial de produção", async () => {
    database(); vi.stubEnv("MERCADO_PAGO_ACCESS_TOKEN", "APP_USR-production");
    expect((await POST(request({ ...body, paymentMode: "test" }))).status).toBe(503);
    expect(state.createPayment).not.toHaveBeenCalled();
  });
  it.each(["", "forged_method"])("recusa método inválido antes de criar pedido: %s", async payment_method_id => {
    const db = database();
    const result = await POST(request({ ...body, payment: { ...body.payment, payment_method_id } }));
    expect(result.status).toBe(400);
    expect(await result.json()).toMatchObject({
      code: payment_method_id ? "INVALID_PAYMENT_METHOD" : "INVALID_PAYMENT_REQUEST"
    });
    expect(db.rpc).not.toHaveBeenCalled(); expect(state.createPayment).not.toHaveBeenCalled();
  });
  it.each([400, 422])("recusa %s do /v1/payments não é mascarada nem envenena nova tentativa", async providerStatus => {
    const db = database();
    state.createPayment.mockRejectedValueOnce(new MercadoPagoProviderError("payment_rejected", providerStatus));
    const first = await POST(request()); expect(first.status).toBe(422);
    expect(await first.json()).toMatchObject({ code: "PROVIDER_PAYMENT_REJECTED", recovery: "new_attempt", orderId });
    expect((await POST(request({ ...body, idempotencyKey: secondKey, payment: { ...body.payment, token: "corrected-token" } }))).status).toBe(200);
    expect(db.creationKeys.size).toBe(1); expect(db.attempts.size).toBe(2);
    expect(state.createPayment.mock.calls.map(([input]) => (input as MercadoPagoPaymentInput).idempotencyKey)).toEqual([firstKey, secondKey]);
  });
  it("retry após rejected usa nova tentativa; replay antigo não cobra", async () => {
    const db = database(); state.createPayment.mockResolvedValueOnce(providerPayment("rejected"));
    expect(await (await POST(request())).json()).toMatchObject({ status: "rejected", recovery: "new_attempt" });
    expect(await (await POST(request())).json()).toMatchObject({ status: "rejected" });
    expect(state.createPayment).toHaveBeenCalledTimes(1);
    expect((await POST(request({ ...body, orderId, idempotencyKey: secondKey, payment: { ...body.payment, token: "new-token" } }))).status).toBe(200);
    expect(db.creationKeys.size).toBe(1); expect(db.attempts.size).toBe(2);
  });
  it("mesma tentativa repetida após sucesso não duplica cobrança", async () => {
    database(); expect((await POST(request())).status).toBe(200);
    expect(await (await POST(request())).json()).toMatchObject({ status: "approved" });
    expect(state.createPayment).toHaveBeenCalledTimes(1);
  });
  it("retry de pagamento pendente consulta a cobrança existente", async () => {
    database(); state.createPayment.mockResolvedValueOnce(providerPayment("pending"));
    expect(await (await POST(request())).json()).toMatchObject({ status: "pending" });
    expect(await (await POST(request())).json()).toMatchObject({ status: "approved" });
    expect(state.createPayment).toHaveBeenCalledTimes(1);
    expect(state.getPayment).toHaveBeenCalledWith("provider-1");
  });
  it("falha na finalização retenta a cobrança existente, sem criar outra", async () => {
    const db = database(); db.failures.finalize = "failed";
    expect((await POST(request())).status).toBe(503);
    expect(db.attempts.get(firstKey)?.status).toBe("pending");
    db.failures.finalize = "";
    expect(await (await POST(request())).json()).toMatchObject({ status: "approved" });
    expect(state.createPayment).toHaveBeenCalledTimes(1);
    expect(state.getPayment).toHaveBeenCalledTimes(1);
  });
  it("corrigir CPF após HTTP 400 usa tentativa nova sem pedido duplicado", async () => {
    const db = database();
    const invalid = { ...body, payment: { ...body.payment, payer: { ...body.payment.payer,
      identification: { type: "CPF", number: "11111111111" } } } };
    expect((await POST(request(invalid))).status).toBe(400);
    expect(db.attempts.size).toBe(0);
    expect((await POST(request({ ...body, idempotencyKey: secondKey }))).status).toBe(200);
    expect(db.creationKeys.size).toBe(1);
    expect(state.createPayment).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: secondKey }));
  });
  it("duas requisições rápidas com chaves diferentes não iniciam duas cobranças", async () => {
    database();
    let finish: ((value: MercadoPagoPayment) => void) | undefined;
    state.createPayment.mockImplementationOnce(() => new Promise<MercadoPagoPayment>(resolve => { finish = resolve; }));
    const first = POST(request());
    await vi.waitFor(() => expect(state.createPayment).toHaveBeenCalledTimes(1));
    const second = await POST(request({ ...body, orderId, idempotencyKey: secondKey }));
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: "PAYMENT_IN_PROGRESS" });
    expect(state.createPayment).toHaveBeenCalledTimes(1);
    finish?.(providerPayment());
    expect((await first).status).toBe(200);
  });
  it("erro HTTP 409 do provider não libera uma nova cobrança", async () => {
    const db = database();
    state.createPayment.mockRejectedValueOnce(new MercadoPagoProviderError("provider_unavailable", 409));
    const result = await POST(request());
    expect(result.status).toBe(502);
    expect(await result.json()).toMatchObject({ code: "PAYMENT_RESULT_UNCERTAIN", recovery: "retry_attempt" });
    expect(db.attempts.get(firstKey)?.status).toBe("pending");
  });
  it("resultado incerto conserva a tentativa e bloqueia chave nova", async () => {
    const db = database(); state.createPayment.mockRejectedValueOnce(new MercadoPagoProviderError("provider_unavailable", 500));
    expect(await (await POST(request())).json()).toMatchObject({ code: "PAYMENT_RESULT_UNCERTAIN", recovery: "retry_attempt" });
    expect(db.attempts.get(firstKey)?.status).toBe("pending");
    expect(await (await POST(request({ ...body, orderId, idempotencyKey: secondKey }))).json()).toMatchObject({ code: "PAYMENT_IN_PROGRESS" });
    expect((await POST(request())).status).toBe(200);
    expect(state.createPayment.mock.calls.map(([input]) => (input as MercadoPagoPaymentInput).idempotencyKey)).toEqual([firstKey, firstKey]);
  });
  it("não reutiliza chave ativa com token ou pagador alterado", async () => {
    database(); state.createPayment.mockRejectedValueOnce(new MercadoPagoProviderError("provider_unavailable", 500)); await POST(request());
    const result = await POST(request({ ...body, orderId, payment: { ...body.payment, token: "other-token" } }));
    expect(result.status).toBe(409); expect(await result.json()).toMatchObject({ code: "PAYMENT_ATTEMPT_CONFLICT", recovery: "view_order" });
    expect(state.createPayment).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["idempotency_conflict", "CHECKOUT_IDEMPOTENCY_CONFLICT", "view_order"],
    ["invalid_coupon", "INVALID_COUPON", "review_checkout"],
    ["insufficient stock", "CHECKOUT_STOCK_CHANGED", "review_checkout"],
    ["customer_identity_required", "CUSTOMER_IDENTITY_REQUIRED", "review_checkout"],
    ["checkout_line_unavailable", "CHECKOUT_LINE_UNAVAILABLE", "review_checkout"],
    ["coupon_limit_reached", "COUPON_LIMIT_REACHED", "review_checkout"],
    ["invalid_coupon_lines", "INVALID_COUPON", "review_checkout"],
    ["invalid quantity", "CHECKOUT_INVALID_QUANTITY", "review_checkout"],
    ["invalid_checkout_lines", "CHECKOUT_INVALID_ITEMS", "review_checkout"],
    ["duplicate_checkout_line", "CHECKOUT_INVALID_ITEMS", "review_checkout"],
    ["invalid_checkout_payload", "CHECKOUT_INVALID_DATA", "review_checkout"],
    ["order_not_eligible", "ORDER_NOT_PAYABLE", "view_order"],
    ["invalid_payment_method", "INVALID_PAYMENT_METHOD", "new_attempt"]
  ])("explica conflito de criação %s", async (reason, code, recovery) => {
    const db = database(); db.failures.creation = reason;
    const result = await POST(request()); expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ code, recovery }); expect(state.createPayment).not.toHaveBeenCalled();
  });
  it.each([["payment_in_progress", "PAYMENT_IN_PROGRESS"], ["idempotency_conflict", "PAYMENT_ATTEMPT_CONFLICT"], ["payment_not_eligible", "ORDER_NOT_PAYABLE"]])(
    "explica conflito de tentativa %s", async (reason, code) => {
      const db = database(); db.failures.attempt = reason;
      const result = await POST(request()); expect(result.status).toBe(409); expect(await result.json()).toMatchObject({ code, orderId });
    });
  it("explica pedido inelegível e divergência do provider", async () => {
    const db = database(); db.order.status = "cancelled";
    expect(await (await POST(request())).json()).toMatchObject({ code: "ORDER_NOT_PAYABLE" });
    db.order.status = "pending_payment"; state.createPayment.mockResolvedValueOnce({ ...providerPayment(), amountInCents: 1 });
    const result = await POST(request()); expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ code: "PAYMENT_PROVIDER_MISMATCH", recovery: "view_order" });
  });
});
