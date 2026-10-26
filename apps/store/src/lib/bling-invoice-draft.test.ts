import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@curtiz/security", () => ({ logServerEvent: vi.fn() }));
import { logServerEvent } from "@curtiz/security";
import { BlingError, expandBlingFiscalKit, type BlingClient } from "@curtiz/integrations";
import { blingFiscalDraftBody, blingInvoicePaymentTerms, prepareBlingFiscalDraft } from "./bling-invoice-draft";
const input = { document: "12345678909", icmsTaxpayer: false, natureId: 10, totalInCents: 5594, shippingInCents: 0, discountInCents: 0, additionalInCents: 0,
  recipientAddress: { street: "Rua Teste", number: "1", complement: "", district: "Centro", city: "Belo Horizonte", state: "MG", postal_code: "30000000" },
  paymentTerms: [{ data: "2026-10-17", valor: 55.94, formaPagamento: { id: 100 } }] };
const commercial = [{ sku: "KIT", unit: "UN", quantity: 1, unitPriceInCents: 5594 }];
const items = expandBlingFiscalKit({ sku: "KIT", description: "Kit", unit: "UN", quantity: 1, unitPriceInCents: 5594,
  pairsPerSku: 3, fiscalUnitApproved: false, ncm: "64022000", origin: 0, cest: "" }, [1, 2, 3].map(i => ({
  sku: `FISCAL-${i}`, description: `Pair ${i}`, unit: "PR", quantity_pairs: 1, allocation_weight: 1, source_current: true,
  ncm: "64022000", origin: 0, cest: "" })));
const invoice = () => ({ tipo: 1, situacao: 1, numero: "existing-number", dataOperacao: "2026-10-17 12:00:00", naturezaOperacao: { id: 10 },
  valorNota: 55.94, valorFrete: 0, contato: { nome: "Test", numeroDocumento: input.document,
    endereco: { endereco: "Rua Teste", numero: "1", complemento: "", bairro: "Centro", municipio: "Belo Horizonte", uf: "MG", cep: "30000000" } },
  transporte: { fretePorConta: 0 }, itens: [{ codigo: "KIT", unidade: "UN", quantidade: 1, valor: 55.94 }] });
describe("safe fiscal decomposition of an existing untransmitted draft", () => {
  const sourceTerm = { dataVencimento: "2026-10-17", valor: 55.94, formaPagamento: { id: 100 }, valorPago: 0 };
  it("inherits verified original order terms without settling accounts or inventing a payment", () => {
    const paymentTerms = blingInvoicePaymentTerms({ parcelas: [sourceTerm] }, { totalInCents: 5594, paymentMethodId: 100 });
    const body = blingFiscalDraftBody(invoice(), items, commercial, { ...input, paymentTerms });
    expect(body.parcelas).toEqual([{ data: "2026-10-17", valor: 55.94, formaPagamento: { id: 100 } }]);
    expect(body.parcelas[0]).not.toHaveProperty("valorPago");
    expect(sourceTerm.valorPago).toBe(0);
  });
  it.each([
    { parcelas: [] }, { parcelas: [{}] }, { parcelas: [null] },
    { parcelas: [{ ...sourceTerm, valor: 50 }] }, { parcelas: [{ ...sourceTerm, valor: 55.941 }] },
    { parcelas: [{ ...sourceTerm, dataVencimento: "2026-02-30" }] }, { parcelas: [{ ...sourceTerm, formaPagamento: { id: 101 } }] }
  ])("blocks missing or incompatible original payment conditions", ({ parcelas }) => {
    expect(() => blingInvoicePaymentTerms({ parcelas }, { totalInCents: 5594, paymentMethodId: 100 })).toThrow();
  });
  it.each([0, Number.NaN, 1.5])("blocks invalid configured payment method %s", paymentMethodId => {
    expect(() => blingInvoicePaymentTerms({ parcelas: [sourceTerm] }, { totalInCents: 5594, paymentMethodId })).toThrow("invoice_payment_terms_required");
  });
  it.each([50, 55.941])("does not overwrite incompatible invoice installment amount %s", valor => {
    const prior = { ...invoice(), parcelas: [{ ...input.paymentTerms[0]!, valor }] };
    expect(() => blingFiscalDraftBody(prior, items, commercial, input)).toThrow("invoice_payment_terms_mismatch");
  });
  it("blocks a decomposed draft with missing payment conditions without rewriting it", async () => {
    const body = blingFiscalDraftBody(invoice(), items, commercial, input);
    const request = vi.fn().mockResolvedValue({ data: { ...invoice(), itens: body.itens, parcelas: [] } });
    await expect(prepareBlingFiscalDraft({ request } as unknown as BlingClient, 1, items, commercial, input, true, async () => true))
      .rejects.toThrow("invoice_payment_terms_mismatch");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("requires payment conditions to persist after the update", async () => {
    const body = blingFiscalDraftBody(invoice(), items, commercial, input);
    const request = vi.fn().mockResolvedValueOnce({ data: invoice() }).mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({ data: { ...invoice(), itens: body.itens, parcelas: [] } });
    await expect(prepareBlingFiscalDraft({ request } as unknown as BlingClient, 1, items, commercial, input, true, async () => true))
      .rejects.toThrow("invoice_payment_terms_mismatch");
    expect(request.mock.calls.map(c => (c[1] as { method?: string } | undefined)?.method ?? "GET")).toEqual(["GET", "PUT", "GET"]);
  });
  it("preserves number, recipient and totals, without product or stock references", () => {
    const body = blingFiscalDraftBody(invoice(), items, commercial, input);
    expect(body.numero).toBe("existing-number");
    expect(body.itens.map(i => i.valor)).toEqual([18.65, 18.65, 18.64]);
    expect(body.itens.every(i => i.unidade === "PR")).toBe(true);
    expect(body.itens.every(i => !("produto" in i))).toBe(true);
    expect(body.itens.every(i => i.informacoesAdicionais === "SKU comercial: KIT")).toBe(true);
  });
  it.each([2, 3, 4, 5, 6, 8])("never edits fiscal situation %s", situacao => {
    expect(() => blingFiscalDraftBody({ ...invoice(), situacao }, items, commercial, input)).toThrow();
  });
  it("uses the reviewed order address instead of the provider contact address", () => {
    const original = invoice();
    const destination = { ...input, recipientAddress: { ...input.recipientAddress, street: "Rua Entrega", city: "Sao Paulo", state: "SP", postal_code: "01001-000" } };
    const body = blingFiscalDraftBody(original, items, commercial, destination);
    expect(body.contato.endereco).toEqual({ endereco: "Rua Entrega", numero: "1", complemento: "", bairro: "Centro", municipio: "Sao Paulo", uf: "SP", cep: "01001000" });
    expect(body.contato.numeroDocumento).toBe(input.document);
    expect(original.contato.endereco.uf).toBe("MG");
    expect(body.contato).not.toHaveProperty("id");
  });
  it.each(["street", "number", "district", "city", "state", "postal_code"])("blocks an incomplete reviewed address: %s", field => {
    expect(() => blingFiscalDraftBody(invoice(), items, commercial, { ...input, recipientAddress: { ...input.recipientAddress, [field]: "" } }))
      .toThrow("invoice_recipient_address_required");
  });
  it("requires the provider to persist the reviewed address before completing preparation", async () => {
    const body = blingFiscalDraftBody(invoice(), items, commercial, input);
    const saved = { ...invoice(), itens: body.itens, contato: { ...invoice().contato, endereco: { ...invoice().contato.endereco, uf: "SP" } } };
    const request = vi.fn().mockResolvedValueOnce({ data: invoice() }).mockResolvedValueOnce({ data: {} }).mockResolvedValueOnce({ data: saved });
    await expect(prepareBlingFiscalDraft({ request } as unknown as BlingClient, 1, items, commercial, input, true, async () => true))
      .rejects.toThrow("invoice_recipient_mismatch");
    expect(request.mock.calls.map(c => (c[1] as { method?: string } | undefined)?.method ?? "GET")).toEqual(["GET", "PUT", "GET"]);
  });
  it("does not rewrite a decomposed draft whose address differs from the review", async () => {
    const body = blingFiscalDraftBody(invoice(), items, commercial, input);
    const request = vi.fn().mockResolvedValue({ data: { ...invoice(), itens: body.itens } });
    await expect(prepareBlingFiscalDraft({ request } as unknown as BlingClient, 1, items, commercial,
      { ...input, recipientAddress: { ...input.recipientAddress, state: "SP" } }, true, async () => true))
      .rejects.toThrow("invoice_recipient_mismatch");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, null, {}, { nome: "", numeroDocumento: "" }, { nome: "  ", id: 0 }])(
    "omits an empty optional carrier without changing freight", transportador => {
      const body = blingFiscalDraftBody({ ...invoice(), transporte: { fretePorConta: 1, transportador } }, items, commercial, input);
      expect(body.transporte).not.toHaveProperty("transportador");
      expect(body.transporte.fretePorConta).toBe(1);
      expect(body.transporte.frete).toBe(0);
    });
  it("preserves a populated carrier and blocks an incomplete one", () => {
    const carrier = { nome: "Transportadora teste", numeroDocumento: "00000000000000" };
    const draft = (transportador: unknown) => ({ ...invoice(), transporte: { fretePorConta: 1, transportador } });
    expect(blingFiscalDraftBody(draft(carrier), items, commercial, input).transporte.transportador).toEqual(carrier);
    expect(() => blingFiscalDraftBody(draft({ numeroDocumento: carrier.numeroDocumento }), items, commercial, input))
      .toThrow("invoice_carrier_mapping_required");
  });
  it("does not retry a rejected write or proceed to transmission", async () => {
    const request = vi.fn().mockResolvedValueOnce({ data: invoice() }).mockRejectedValueOnce(new Error("validation_error"));
    await expect(prepareBlingFiscalDraft({ request } as unknown as BlingClient, 1, items, commercial, input, true, async () => true))
      .rejects.toThrow("validation_error");
    expect(request.mock.calls.map(c => (c[1] as { method?: string } | undefined)?.method ?? "GET")).toEqual(["GET", "PUT"]);
  });
  it("reports only the fixed stage and sanitized provider codes when an update is rejected", async () => {
    const request = vi.fn().mockResolvedValueOnce({ data: invoice() })
      .mockRejectedValueOnce(new BlingError("validation_error", 400, false, false, 0, [0], ["contato"]));
    await expect(prepareBlingFiscalDraft({ request } as unknown as BlingClient, 1, items, commercial, input, true, async () => true))
      .rejects.toThrow("validation_error");
    expect(logServerEvent).toHaveBeenLastCalledWith("error", "bling_fiscal_validation_failed", {
      stage: "draft_update", validationCodes: [0], validationFields: ["contato"]
    });
    expect(request.mock.calls.map(c => (c[1] as { method?: string } | undefined)?.method ?? "GET")).toEqual(["GET", "PUT"]);
  });
  it("blocks duplicate or modified commercial draft lines", () => {
    const value = invoice(); value.itens.push({ ...value.itens[0]! });
    expect(() => blingFiscalDraftBody(value, items, commercial, input)).toThrow("invoice_draft_decomposition_conflict");
    expect(() => blingFiscalDraftBody({ ...invoice(), valorNota: 56 }, items, commercial, input)).toThrow();
  });
  it("never edits with unverified provider stock automation; replay of the exact decomposition is read-only", async () => {
    const request = vi.fn().mockResolvedValue({ data: invoice() });
    const provider = { request } as unknown as BlingClient;
    await expect(prepareBlingFiscalDraft(provider, 1, items, commercial, input, false)).rejects.toThrow("invoice_stock_automation_must_be_disabled");
    const body = blingFiscalDraftBody(invoice(), items, commercial, input);
    request.mockResolvedValue({ data: { ...invoice(), itens: body.itens, parcelas: body.parcelas } });
    await prepareBlingFiscalDraft(provider, 1, items, commercial, input, false);
    expect(request.mock.calls.every(call => call.length === 1)).toBe(true);
  });
  it("updates once and re-reads before allowing transmission", async () => {
    const body = blingFiscalDraftBody(invoice(), items, commercial, input);
    const request = vi.fn().mockResolvedValueOnce({ data: invoice() }).mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({ data: { ...invoice(), itens: body.itens, parcelas: body.parcelas } });
    await prepareBlingFiscalDraft({ request } as unknown as BlingClient, 1, items, commercial, input, true, async () => true);
    expect(request.mock.calls.map(c => (c[1] as { method?: string } | undefined)?.method ?? "GET")).toEqual(["GET", "PUT", "GET"]);
  });
});
