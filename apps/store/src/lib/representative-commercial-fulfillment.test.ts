import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  jobs: [] as Record<string, unknown>[],
  calls: [] as { name: string; args: Record<string, unknown> }[],
  claimed: new Set<string>(),
  saleId: null as number | null,
  contactExists: true,
  paymentKind: "pix" as "pix" | "credit_card" | "debit_card",
  paymentStatus: "approved", paymentAmount: 10000, paymentRefunds: [] as unknown[],
  natureActive: true, natureSeries: 3, draftSeries: 3, draftAmount: 100, methodTypeOverride: null as number | null,
  requests: [] as { path: string; method: string; body?: unknown }[],
  buyer: Object.fromEntries([] as [string, unknown][])
}));

vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: vi.fn() }) }));
vi.mock("@curtiz/config", () => ({ getMelhorEnvioEnvironment: () => "production" }));
vi.mock("@curtiz/security", () => ({ logServerEvent: vi.fn() }));
vi.mock("@curtiz/integrations", () => {
  class BlingError extends Error {
    constructor(readonly code: string, readonly status: number, readonly retryable = false, readonly uncertainWrite = false) {
      super(code);
    }
  }
  return {
    BlingError,
    blingExternalSku: (sku: string) => sku,
    blingFiscalMirrorHash: async () => "a".repeat(64),
    // The fiscal mirror itself is covered in @curtiz/integrations; here only the worker flow matters.
    commercialKitFiscalMirror: async (_read: unknown, job: Record<string, unknown>) => {
      const item = { sku: String(job.sku), variantId: String(job.variantId), description: String(job.productName), quantity: Number(job.quantity),
        unit: "PR", pairsPerSku: 2, fiscalUnitApproved: true, unitPriceInCents: Number(job.unitPriceInCents), ncm: "64022000", origin: 0, cest: "" };
      return { issuer: "68267385000191", natureId: 15111975260, rule: { series: 3, external_nature_id: 15111975260, cfop: "5102", csosn: "102" },
        commercial: [item], mirror: { taxConfiguration: true, icmsCredit: undefined, totalInCents: item.quantity * item.unitPriceInCents, items: [item] },
        allocations: [0], freight: 0 };
    },
    createBlingClient: () => ({
      request: async (path: string, options?: { method?: string; body?: unknown }) => {
        const method = options?.method ?? "GET";
        state.requests.push({ path, method, body: options?.body });
        if (path.startsWith("/naturezas-operacoes?")) return { data: state.natureActive ? [{ id: 15111975260, situacao: 1, serie: state.natureSeries }] : [] };
        if (path.startsWith("/formas-pagamentos/")) { const id = Number(path.split("/").pop()); return { data: { id, situacao: 1, finalidade: 2, tipoPagamento: state.methodTypeOverride ?? ({ 11: 17, 22: 1, 33: 3, 44: 4 } as Record<number, number>)[id] } }; }
        if (path === "/empresas/me/dados-basicos") return { data: { id: 7, cnpj: "68.267.385/0001-91" } };
        if (path === "/contatos" && method === "POST") { state.contactExists = true; return { data: { id: 55 } }; }
        if (path.startsWith("/contatos/")) return { data: { id: 55, tipo: "J", numeroDocumento: "11222333000181", ie: "0012345678900",
          endereco: { geral: { uf: "MG", cep: "30110100" } } } };
        if (path === "/pedidos/vendas" && method === "POST") { state.saleId = 900; return { data: { id: 900 } }; }
        if (path === "/pedidos/vendas/900/gerar-nfe") return { idNotaFiscal: 77 };
        if (path === "/pedidos/vendas/900") return { data: { id: 900, contato: { id: 55 }, notaFiscal: { id: state.claimed.has("bling_invoice_draft") ? 77 : 0 },
          itens: [{ naturezaOperacao: { id: 15111975260 } }] } };
        if (path === "/nfe/77/enviar?enviarEmail=false") return {};
        if (path === "/nfe/77") return { data: { id: 77, situacao: 1, tipo: 1, serie: state.draftSeries, valorNota: state.draftAmount, valorFrete: 0, naturezaOperacao: { id: 15111975260 }, transporte: { fretePorConta: 3 } } };
        throw new Error(`unexpected ${method} ${path}`);
      }
    }),
    verifyCommercialKitInvoice: vi.fn()
  };
});
vi.mock("./bling-jobs", () => ({
  assertBlingExternalOrder: vi.fn(), blingOrderPayload: vi.fn((input: { paymentMethodId: number }) => ({ method: input.paymentMethodId })),
  findBlingContact: async () => state.contactExists ? 55 : null,
  findBlingOrder: async () => state.saleId
}));
vi.mock("./bling-invoice-draft", () => ({
  assertBlingInvoicePaymentTerms: vi.fn(), blingInvoicePaymentTerms: () => [], invoiceMatchesFiscalLines: () => true, prepareBlingFiscalDraft: vi.fn()
}));
vi.mock("./representative-commercial-payments", () => ({
  commercialKitCollector: () => "collector", kitPaymentMethodAllowed: () => true,
  commercialKitPaymentProvider: () => ({ findRepresentativeKitPayment: async (reference: string) => ({
    externalReference: reference, collectorId: "collector", currency: "BRL", amountInCents: state.paymentAmount,
    status: state.paymentStatus, dateApproved: "2026-11-23T12:00:00Z", refunds: state.paymentRefunds,
    paymentMethodId: state.paymentKind === "pix" ? "pix" : "visa", paymentTypeId: state.paymentKind
  }) })
}));
vi.mock("./melhor-envio-server", () => ({ createMelhorEnvioProvider: vi.fn() }));
vi.mock("./representative-commercial-shipping", () => ({ advanceRepresentativeKitShipping: vi.fn() }));
vi.mock("./representative-commercial-returns", () => ({ verifyDueRepresentativeKitReturns: vi.fn() }));
vi.mock("./representative-test-transactions", () => {
  const call = async (_db: unknown, name: string, args: Record<string, unknown>) => {
    state.calls.push({ name, args });
    if (name === "due_representative_kit_fulfillment") return state.jobs;
    if (name === "read_bling_account") return { companyId: 7 };
    if (name === "read_bling_catalog_variant") return {
      variant: { sku: "KIT-1" }, kit_components: [],
      metadata: { production_type: "T", fiscal_unit_approved: true, pairs_per_sku: 2, commercial_unit: "PR", ncm: "64022000", origin: 0, cest: "" }
    };
    if (name === "read_representative_kit_bling_order") return { saleId: state.saleId, invoiceId: null, ...state.buyer,
      fiscalAddress: { state: "MG", postal_code: "30110100", street: "Rua A", number: "1", district: "Centro", city: "Belo Horizonte" },
      address: { state: "MG", postal_code: "30110100", street: "Rua B", number: "2", district: "Centro", city: "Belo Horizonte" } };
    if (name === "read_bling_product_links") return [];
    if (name.startsWith("claim_representative_kit_bling_write")) {
      const operation = String(args.p_operation);
      if (state.claimed.has(operation)) return false;
      state.claimed.add(operation);
      return true;
    }
    if (name === "link_representative_kit_bling_sale" || name === "record_representative_kit_bling_draft"
      || name === "auto_approve_representative_kit_bling_draft") return true;
    return null;
  };
  return { kitCall: call, kitRecord: async (db: unknown, name: string, args: Record<string, unknown>) => (await call(db, name, args)) as Record<string, unknown> };
});

import { automaticFailureReason, runRepresentativeCommercialFulfillment } from "./representative-commercial-fulfillment";

const environment = {
  APP_ENV: "production", REPRESENTATIVE_KIT_FULFILLMENT_ENABLED: "true", BLING_FISCAL_READY: "true",
  SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "secret",
  BLING_ORDER_SYNC_ENABLED: "true", BLING_INVOICE_SYNC_ENABLED: "true", BLING_INVOICE_STOCK_AUTOMATION_DISABLED: "true",
  BLING_INVOICE_SEND_ENABLED: "true", BLING_INVOICE_TRANSMISSION_MODE: "production", BLING_LIVE_INVOICE_SEND_AUTHORIZED: "true",
  BLING_PAYMENT_METHOD_ID: "11", BLING_CASH_PAYMENT_METHOD_ID: "22",
  BLING_REPRESENTATIVE_CREDIT_CARD_PAYMENT_METHOD_ID: "33", BLING_REPRESENTATIVE_DEBIT_CARD_PAYMENT_METHOD_ID: "44"
};
const orderId = "11111111-1111-4111-8111-111111111111";
const baseJob = {
  orderId, saleId: null, invoiceId: null, variantId: "v1", sku: "KIT-1", productName: "Kit MG", quantity: 1,
  unitPriceInCents: 10_000, shippingInCents: 0, amountInCents: 10_000, ownDelivery: true, collectionMethod: null,
  collectionBlingMethod: null, paidAt: "2026-11-23T12:00:00Z", createdAt: "2026-11-23T11:00:00Z", originPostalCode: "35524168", postalCode: "30110100",
  buyerProfile: "MG02", buyerDocument: "11222333000181", buyerStateRegistration: "0012345678900", invoiceMode: "automatic", autoInvoiceFailed: false,
  fiscalParameters: { issuerDocument: "68267385000191", classification: "third_party_no_st", creditEligible: false, blingRule: {} }
};
const names = () => state.calls.map(call => call.name);
const posts = (suffix: string) => state.requests.filter(request => request.method === "POST" && request.path.endsWith(suffix));
const run = () => runRepresentativeCommercialFulfillment(environment);

describe("automatic MG02 kit invoice", () => {
  beforeEach(() => {
    state.calls = []; state.requests = []; state.claimed = new Set(); state.saleId = null; state.contactExists = true; state.jobs = [{ ...baseJob }];
    state.paymentKind = "pix"; state.paymentStatus = "approved"; state.paymentAmount = 10000; state.paymentRefunds = [];
    state.natureActive = true; state.natureSeries = 3; state.draftSeries = 3; state.draftAmount = 100; state.methodTypeOverride = null;
    state.buyer = { buyerName: "Loja Teste LTDA", buyerDocument: "11222333000181", buyerRegistration: "0012345678900" };
  });

  it("issues the NF-e of a paid Pix order: sale, draft, automatic draft approval and send", async () => {
    await run();
    expect(posts("/pedidos/vendas")).toHaveLength(1);
    expect(posts("/gerar-nfe")).toHaveLength(1);
    expect(posts("/enviar?enviarEmail=false")).toHaveLength(1);
    expect(state.calls.find(call => call.name === "auto_approve_representative_kit_bling_draft")?.args).toEqual({ p_order: orderId, p_hash: "a".repeat(64) });
    expect(names().indexOf("auto_approve_representative_kit_bling_draft")).toBeLessThan(names().lastIndexOf("claim_representative_kit_bling_write"));
    expect(state.requests.find(request => request.path === "/pedidos/vendas" && request.method === "POST")?.body).toEqual({ method: 11 });
    expect(names()).not.toContain("record_representative_kit_auto_invoice_error");
  });

  it.each([["credit_card", 33], ["debit_card", 44]] as const)("uses the real %s fiscal method, never Pix", async (kind, method) => {
    state.paymentKind = kind;
    await run();
    expect(posts("/pedidos/vendas")[0]?.body).toEqual({ method });
    expect(posts("/enviar?enviarEmail=false")).toHaveLength(1);
  });
  it("does not issue a paid card order as Pix when its fiscal method is missing", async () => {
    state.paymentKind = "credit_card";
    await runRepresentativeCommercialFulfillment({ ...environment, BLING_REPRESENTATIVE_CREDIT_CARD_PAYMENT_METHOD_ID: "" });
    expect(posts("/pedidos/vendas")).toHaveLength(0);
    expect(state.calls.find(call => call.name === "record_representative_kit_auto_invoice_error")?.args).toMatchObject({ p_reason: "payment_method_required" });
  });
  it.each(["pending", "refunded"])("does not issue when the provider payment is %s", async status => {
    state.paymentStatus = status;
    await run();
    expect(posts("/pedidos/vendas")).toHaveLength(0);
    expect(state.calls.find(call => call.name === "record_representative_kit_auto_invoice_error")?.args).toMatchObject({ p_reason: "kit_payment_unconfirmed" });
  });
  it.each([
    ["nature_not_active", () => { state.natureActive = false; }],
    ["invoice_series_mismatch", () => { state.natureSeries = 2; }],
    ["invoice_fiscal_payment_method_invalid", () => { state.methodTypeOverride = 90; }]
  ] as const)("blocks sale creation on %s", async (reason, configure) => {
    configure();
    await run();
    expect(posts("/pedidos/vendas")).toHaveLength(0);
    expect(state.calls.find(call => call.name === "record_representative_kit_auto_invoice_error")?.args).toMatchObject({ p_reason: reason });
  });
  it.each([
    ["invoice_series_mismatch", () => { state.draftSeries = 2; }],
    ["invoice_draft_total_mismatch", () => { state.draftAmount = 101; }]
  ] as const)("blocks automatic approval and send on %s", async (reason, configure) => {
    configure();
    await run();
    expect(names()).not.toContain("auto_approve_representative_kit_bling_draft");
    expect(posts("/enviar?enviarEmail=false")).toHaveLength(0);
    expect(state.calls.find(call => call.name === "record_representative_kit_auto_invoice_error")?.args).toMatchObject({ p_reason: reason });
  });

  it("does not duplicate the sale, the draft or the transmission when the check runs again", async () => {
    await run();
    await run();
    expect(posts("/pedidos/vendas")).toHaveLength(1);
    expect(posts("/gerar-nfe")).toHaveLength(1);
    expect(posts("/enviar?enviarEmail=false")).toHaveLength(1);
    expect(posts("/contatos")).toHaveLength(0);
  });

  it("issues the NF-e of a cash order on receipt with the configured cash method and the delivery date", async () => {
    state.jobs = [{ ...baseJob, collectionMethod: "cash", collectionDueOn: "2026-11-25", createdAt: "2026-11-23T11:00:00Z" }];
    await run();
    expect(state.requests.find(request => request.path === "/pedidos/vendas" && request.method === "POST")?.body).toEqual({ method: 22 });
    expect(posts("/enviar?enviarEmail=false")).toHaveLength(1);
    expect(state.calls.find(call => call.name === "claim_representative_kit_bling_write_for_delivery")?.args)
      .toMatchObject({ p_collection_due_on: "2026-11-25" });
  });

  it("creates the buyer's company contact in Bling once when it does not exist", async () => {
    state.contactExists = false;
    await run();
    const created = posts("/contatos");
    expect(created).toHaveLength(1);
    expect(created[0]?.body).toMatchObject({ tipo: "J", numeroDocumento: "11222333000181", ie: "0012345678900", contribuinte: 1 });
  });

  it.each([
    ["buyer_cnpj_required", { buyerDocument: null }],
    ["buyer_registration_required", { buyerRegistration: null }]
  ])("records a final error and writes nothing to Bling when %s", async (code, buyer) => {
    state.buyer = { ...state.buyer, ...buyer };
    await run();
    expect(state.requests.filter(request => request.method === "POST")).toHaveLength(0);
    expect(state.calls.find(call => call.name === "record_representative_kit_auto_invoice_error")?.args)
      .toEqual({ p_order: orderId, p_reason: code, p_final: true });
    expect(names()).toContain("finish_representative_kit_fulfillment_check");
  });

  it("records an error when the cash payment method is not configured", async () => {
    state.jobs = [{ ...baseJob, collectionMethod: "cash", collectionDueOn: "2026-11-25" }];
    await runRepresentativeCommercialFulfillment({ ...environment, BLING_CASH_PAYMENT_METHOD_ID: "" });
    expect(state.calls.find(call => call.name === "record_representative_kit_auto_invoice_error")?.args)
      .toMatchObject({ p_reason: "payment_method_required", p_final: true });
  });

  it("keeps manual orders away from the automatic path and skips them without the manual flag", async () => {
    state.jobs = [{ ...baseJob, invoiceMode: "manual" }];
    await run();
    expect(state.requests).toHaveLength(0);
    expect(names()).not.toContain("read_representative_kit_manual_invoice");
  });

  it("reads a manual fallback NF-e even without the manual flag after the automatic failure", async () => {
    state.jobs = [{ ...baseJob, invoiceMode: "manual", autoInvoiceFailed: true }];
    await run();
    expect(names()).toContain("read_representative_kit_manual_invoice");
    expect(names()).not.toContain("record_representative_kit_auto_invoice_error");
  });

  it("classifies provider failures: only non-retryable ones are final", async () => {
    const { BlingError } = await import("@curtiz/integrations");
    expect(automaticFailureReason(new BlingError("invoice_recipient_mismatch", 409))).toEqual({ code: "invoice_recipient_mismatch", final: true });
    expect(automaticFailureReason(new BlingError("rate_limited", 429, true))).toEqual({ code: "rate_limited", final: false });
    expect(automaticFailureReason(new BlingError("uncertain_write", 503, false, true))).toEqual({ code: "uncertain_write", final: false });
    expect(automaticFailureReason(new BlingError("Texto Livre Com Espaço", 400))).toEqual({ code: "bling_error", final: true });
    expect(automaticFailureReason(new Error("boom"))).toEqual({ code: "unexpected_error", final: false });
  });
});

