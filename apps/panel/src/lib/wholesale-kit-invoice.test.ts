import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  job: undefined as unknown as Record<string, unknown>, calls: [] as { name: string; args: Record<string, unknown> }[], claimed: new Set<string>(),
  requests: [] as { path: string; method: string }[], contactExists: true, saleInBling: null as number | null, invoiceSituation: 5,
  failSale: false, draftResponseLost: false, draftLinked: false, send: vi.fn()
}));
vi.mock("server-only", () => ({}));
vi.mock("@curtiz/security", () => ({ logServerEvent: vi.fn() }));
vi.mock("@curtiz/integrations", () => {
  class BlingError extends Error {
    constructor(readonly code: string, readonly status: number, readonly retryable = false, readonly uncertainWrite = false) { super(code); }
  }
  const line = { sku: "SKU", variantId: "v1", description: "Ficha", quantity: 2, unit: "PR", unitPriceInCents: 36001, ncm: "64022000", origin: 0, cest: "" };
  return {
    BlingError,
    assertBlingExternalOrder: vi.fn(),
    blingExternalSku: (sku: string) => sku,
    blingFiscalMirrorHash: async () => "a".repeat(64),
    blingInvoicePaymentTerms: () => [],
    blingOrderPayload: vi.fn(() => ({ numeroLoja: "ATACADO" })),
    commercialKitFiscalMirror: async () => ({ issuer: "12345678000195", natureId: 123, rule: { series: 3 }, commercial: [line],
      mirror: { totalInCents: 72002, items: [line] }, allocations: [0], freight: 0 }),
    findBlingContact: async () => state.contactExists ? 55 : null,
    findBlingOrder: async () => state.saleInBling,
    invoiceMatchesFiscalLines: () => true,
    prepareBlingFiscalDraft: vi.fn(),
    verifyCommercialKitInvoice: async () => ({ key: "3".repeat(44), protocol: "123456789012345", hash: "b".repeat(64) })
  };
});
import { BlingError } from "@curtiz/integrations";
import { issueWholesaleKitInvoice, cancelWholesaleKitInvoice, wholesaleFailureCode } from "./wholesale-kit-invoice";

const id = "33333333-3333-4333-8333-333333333333";
const environment = {
  APP_ENV: "production", BLING_ORDER_SYNC_ENABLED: "true", BLING_INVOICE_SYNC_ENABLED: "true", BLING_INVOICE_STOCK_AUTOMATION_DISABLED: "true",
  BLING_INVOICE_SEND_ENABLED: "true", BLING_INVOICE_TRANSMISSION_MODE: "production", BLING_LIVE_INVOICE_SEND_AUTHORIZED: "true",
  BLING_PAYMENT_METHOD_ID: "11", BLING_CASH_PAYMENT_METHOD_ID: "22"
};
const baseJob = () => ({
  wholesaleId: id, status: "issuing", saleId: null, invoiceId: null, fiscalCurrent: true, paymentMethod: "pix", createdAt: "2026-11-24T12:00:00Z",
  buyerName: "Loja Teste LTDA", buyerDocument: "11222333000181", buyerStateRegistration: "", originPostalCode: "35524168",
  fiscalAddress: { state: "MG", postal_code: "30110100", street: "Rua A", number: "1", district: "Centro", city: "Belo Horizonte", complement: "" }
});
const db = { rpc: async (name: string, args: Record<string, unknown>) => {
  state.calls.push({ name, args });
  if (name === "begin_wholesale_kit_invoice_issue") return { data: state.job.wholesaleId ? state.job : null, error: null };
  if (name === "read_bling_account") return { data: { companyId: 7 }, error: null };
  if (name === "read_bling_catalog_variant") return { data: {}, error: null };
  if (name === "read_bling_product_links") return { data: [], error: null };
  if (name === "read_wholesale_kit_invoice_job") return { data: { status: "issuing" }, error: null };
  if (name === "claim_wholesale_kit_invoice_write") {
    const operation = String(args.p_operation);
    if (state.claimed.has(operation)) return { data: false, error: null };
    state.claimed.add(operation);
    return { data: true, error: null };
  }
  return { data: true, error: null };
} };
const provider = { request: async (path: string, options?: { method?: string }) => {
  const method = options?.method ?? "GET";
  state.requests.push({ path, method });
  if (path === "/empresas/me/dados-basicos") return { data: { id: 7, cnpj: "12.345.678/0001-95" } };
  if (path === "/contatos" && method === "POST") { state.contactExists = true; return { data: { id: 55 } }; }
  if (path.startsWith("/contatos/")) return { data: { id: 55, tipo: "J", numeroDocumento: "11222333000181", ie: "", endereco: { geral: { uf: "MG", cep: "30110100" } } } };
  if (path === "/pedidos/vendas" && method === "POST") { if (state.failSale) throw new BlingError("validation_error", 422); return { data: { id: 900 } }; }
  if (path === "/pedidos/vendas/900/gerar-nfe") { if (state.draftResponseLost) { state.draftLinked = true; throw new BlingError("uncertain_write", 503, false, true); } state.draftLinked = true; return { idNotaFiscal: 77 }; }
  if (path === "/pedidos/vendas/900") return { data: { id: 900, contato: { id: 55 }, notaFiscal: { id: state.draftLinked ? 77 : 0 }, itens: [{ naturezaOperacao: { id: 123 } }] } };
  if (path === "/nfe/77/enviar?enviarEmail=false") { state.send(); return {}; }
  if (path === "/nfe/77") return { data: { id: 77, numero: "56", situacao: state.claimed.has("bling_invoice_send") ? state.invoiceSituation : 1, serie: 3,
    naturezaOperacao: { id: 123 }, transporte: { fretePorConta: 3 } } };
  throw new Error(`unexpected ${method} ${path}`);
} };
const run = (overrides: Record<string, string> = {}) => issueWholesaleKitInvoice({
  db: db as never, provider: provider as never, environment: { ...environment, ...overrides }, invoiceId: id, sleep: async () => undefined
});
const names = () => state.calls.map(call => call.name);
const posts = (suffix: string) => state.requests.filter(request => request.method === "POST" && request.path.endsWith(suffix));

beforeEach(() => {
  state.job = baseJob(); state.calls = []; state.requests = []; state.claimed = new Set(); state.contactExists = true;
  state.saleInBling = null; state.invoiceSituation = 5; state.failSale = false; state.draftResponseLost = false; state.draftLinked = false; state.send.mockClear();
});

describe("emissão da nota de atacado", () => {
  it("cria uma venda e uma nota, envia e confirma a autorização", async () => {
    const steps: string[] = [];
    const result = await issueWholesaleKitInvoice({ db: db as never, provider: provider as never, environment, invoiceId: id,
      onStep: step => steps.push(step), sleep: async () => undefined });
    expect(result).toEqual({ status: "authorized" });
    expect(steps).toEqual(["contact", "sale", "draft", "send", "authorization"]);
    expect(posts("/pedidos/vendas")).toHaveLength(1);
    expect(posts("/gerar-nfe")).toHaveLength(1);
    expect(posts("/enviar?enviarEmail=false")).toHaveLength(1);
    expect(state.calls.find(call => call.name === "record_wholesale_kit_invoice_authorized")?.args).toMatchObject({
      p_sale: 900, p_invoice: 77, p_number: "56", p_protocol: "123456789012345"
    });
  });

  it("cria o contato da empresa no Bling só quando ele não existe", async () => {
    state.contactExists = false;
    await run();
    expect(posts("/contatos")).toHaveLength(1);
  });

  it("recupera a nota vinculada à venda quando a resposta do POST se perde", async () => {
    state.draftResponseLost = true;
    expect(await run()).toEqual({ status: "authorized" });
    expect(posts("/gerar-nfe")).toHaveLength(1);
    expect(posts("/enviar?enviarEmail=false")).toHaveLength(1);
  });

  it("não repete a geração quando a tentativa anterior já foi registrada", async () => {
    state.job = { ...baseJob(), saleId: 900 };
    state.claimed.add("bling_invoice_draft");
    state.draftLinked = true;
    expect(await run()).toEqual({ status: "authorized" });
    expect(posts("/gerar-nfe")).toHaveLength(0);
  });

  it("é idempotente: reexecutar com a venda e a nota já gravadas não escreve de novo", async () => {
    state.job = { ...baseJob(), saleId: 900, invoiceId: 77 };
    state.claimed = new Set(["bling_sale", "bling_invoice_draft", "bling_invoice_send"]);
    expect(await run()).toEqual({ status: "authorized" });
    expect(posts("/pedidos/vendas")).toHaveLength(0);
    expect(posts("/gerar-nfe")).toHaveLength(0);
    expect(posts("/enviar?enviarEmail=false")).toHaveLength(0);
  });

  it("não cria uma segunda venda quando o Bling já tem o pedido ATACADO", async () => {
    state.saleInBling = 900;
    await run();
    expect(posts("/pedidos/vendas")).toHaveLength(0);
    expect(names()).not.toContain("claim_wholesale_kit_invoice_write:bling_sale");
    expect(state.calls.some(call => call.name === "claim_wholesale_kit_invoice_write" && call.args.p_operation === "bling_sale")).toBe(false);
  });

  it("responde ocupado quando já há uma tentativa rodando", async () => {
    state.job = {};
    expect(await run()).toEqual({ status: "busy" });
    expect(state.requests).toHaveLength(0);
  });

  it("grava um erro com motivo fixo quando o Bling recusa e não envia nada", async () => {
    state.failSale = true;
    expect(await run()).toEqual({ status: "error", code: "validation_error" });
    expect(state.calls.find(call => call.name === "record_wholesale_kit_invoice_progress")?.args)
      .toEqual({ p_id: id, p_status: "error", p_code: "validation_error" });
    expect(posts("/gerar-nfe")).toHaveLength(0);
    expect(state.send).not.toHaveBeenCalled();
  });

  it("deixa a nota em rascunho, com motivo claro, quando o envio está desligado", async () => {
    expect(await run({ BLING_INVOICE_SEND_ENABLED: "false" })).toEqual({ status: "waiting", code: "bling_send_disabled" });
    expect(state.calls.find(call => call.name === "record_wholesale_kit_invoice_progress")?.args)
      .toEqual({ p_id: id, p_status: "draft", p_code: "bling_send_disabled" });
    expect(posts("/gerar-nfe")).toHaveLength(1);
    expect(state.send).not.toHaveBeenCalled();
  });

  it("não escreve no Bling com o pedido desligado nem fora de produção", async () => {
    expect(await run({ BLING_ORDER_SYNC_ENABLED: "false" })).toEqual({ status: "waiting", code: "bling_order_sync_disabled" });
    expect(await run({ APP_ENV: "development" })).toEqual({ status: "waiting", code: "bling_not_production" });
    expect(state.requests.filter(request => request.method === "POST")).toHaveLength(0);
  });

  it("usa a forma de pagamento do dinheiro e exige que ela esteja configurada", async () => {
    state.job = { ...baseJob(), paymentMethod: "cash" };
    expect(await run({ BLING_CASH_PAYMENT_METHOD_ID: "" })).toEqual({ status: "error", code: "payment_method_required" });
  });

  it("espera a SEFAZ sem duplicar o envio quando a autorização ainda não saiu", async () => {
    state.invoiceSituation = 3;
    expect(await run()).toEqual({ status: "waiting", code: "awaiting_authorization" });
    expect(posts("/enviar?enviarEmail=false")).toHaveLength(1);
    expect(state.calls.some(call => call.name === "record_wholesale_kit_invoice_authorized")).toBe(false);
  });

  it("recusa uma ficha cujo cadastro fiscal mudou depois da venda", async () => {
    state.job = { ...baseJob(), fiscalCurrent: false };
    expect(await run()).toEqual({ status: "error", code: "wholesale_grade_changed" });
  });

  it("guarda só códigos fixos como motivo", () => {
    expect(wholesaleFailureCode(new BlingError("Texto com dados pessoais!", 500))).toBe("bling_error");
    expect(wholesaleFailureCode(new Error("boom"))).toBe("unexpected_error");
    expect(wholesaleFailureCode(new BlingError("uncertain_write", 503))).toBe("uncertain_write");
  });
});

describe("cancelamento conciliado", () => {
  const cancelJob = () => ({ ...baseJob(), saleId: 900, invoiceId: 77, saleClaimed: true, draftClaimed: true,
    amountInCents: 72002, fiscalParameters: { issuerDocument: "12345678000195" } });
  it("remove somente o rascunho e a venda correspondentes antes de liberar o estoque", async () => {
    let saleExists = true; let draftExists = true;
    const remote = { request: async (path: string, options?: { method?: string }) => {
      const method = options?.method ?? "GET";
      state.requests.push({ path, method });
      if (method === "DELETE") {
        if (path === "/nfe?idsNotas%5B%5D=77") draftExists = false;
        else if (path === "/pedidos/vendas/900") saleExists = false;
        else throw new Error("unexpected deletion");
        return {};
      }
      if (path === "/empresas/me/dados-basicos") return { data: { id: 7, cnpj: "12345678000195" } };
      if (path === "/contatos/55") return { data: { id: 55, numeroDocumento: "11222333000181" } };
      if (path === "/pedidos/vendas/900" && saleExists) return { data: { id: 900, numeroLoja: `ATACADO-${id}`,
        total: 720.02, contato: { id: 55 }, notaFiscal: { id: draftExists ? 77 : 0 } } };
      if (path === "/nfe/77" && draftExists) return { data: { id: 77, situacao: 1, contato: { numeroDocumento: "11222333000181" } } };
      throw new BlingError("provider_error", 404);
    } };
    expect(await cancelWholesaleKitInvoice({ db: db as never, provider: remote as never, environment, invoiceId: id, job: cancelJob() })).toBe(true);
    expect(state.requests.filter(r => r.method === "DELETE").map(r => r.path)).toEqual(["/nfe?idsNotas%5B%5D=77", "/pedidos/vendas/900"]);
    expect(names()).toContain("finish_wholesale_kit_invoice_cancel");
  });
  it("não exclui nota já enviada", async () => {
    expect(await cancelWholesaleKitInvoice({ db: db as never, provider: provider as never, environment, invoiceId: id,
      job: { ...cancelJob(), sendClaimed: true } })).toBe(false);
    expect(state.requests).toHaveLength(0);
    expect(names()).not.toContain("finish_wholesale_kit_invoice_cancel");
    expect(names()).toContain("record_wholesale_cancel_pending");
  });
});
