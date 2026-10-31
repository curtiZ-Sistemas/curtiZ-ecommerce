import "server-only";
import { BlingError, blingExternalSku, type BlingClient, type BlingFiscalItem } from "@curtiz/integrations";
import { logServerEvent } from "@curtiz/security";
import { isUnknownRecord, readString } from "./unknown-data";
const row = (v: unknown): Record<string, unknown> => isUnknownRecord(v) ? v : {};
const array = (v: unknown): Record<string, unknown>[] => Array.isArray(v) ? v.filter(isUnknownRecord) : [];
const cents = (v: unknown) => Math.round(Number(v) * 100);

function draftOperationDate(invoice: Record<string, unknown>) {
  const value = readString(invoice, "dataOperacao");
  // Bling represents an unfilled departure date as a zero datetime on GET.
  // The provider rejects both this sentinel and an omitted date on PUT.
  // Require an actual reviewed timestamp instead of inventing a departure.
  if (!value || value === "0000-00-00 00:00:00") throw new BlingError("invoice_operation_date_required", 409);
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):(\d{2})$/u.exec(value);
  const parsed = new Date(`${value.replace(" ", "T")}Z`);
  if (!match || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 19) !== value.replace(" ", "T"))
    throw new BlingError("invoice_operation_date_invalid", 409);
  return value;
}

export async function requestBlingFiscalResource(provider: BlingClient, path: string,
  stage: "company_read" | "nature_read" | "product_read" | "order_read" | "draft_read" | "draft_update" | "draft_verify",
  input?: Parameters<BlingClient["request"]>[1]) {
  try { return input === undefined ? await provider.request(path) : await provider.request(path, input); }
  catch (error) {
    if (error instanceof BlingError && error.code === "validation_error") logServerEvent("error", "bling_fiscal_validation_failed", {
      stage, validationCodes: error.validationCodes, validationFields: error.validationFields, validationTopics: error.validationHints
    });
    throw error;
  }
}

function reviewedRecipientAddress(snapshot: Record<string, unknown>) {
  const address = { endereco: readString(snapshot, "street").trim(), numero: readString(snapshot, "number").trim(),
    complemento: readString(snapshot, "complement").trim(), bairro: readString(snapshot, "district").trim(),
    municipio: readString(snapshot, "city").trim(), uf: readString(snapshot, "state").trim().toUpperCase(),
    cep: readString(snapshot, "postal_code").replace(/\D/gu, "") };
  if (!address.endereco || !address.numero || !address.bairro || !address.municipio
    || !/^[A-Z]{2}$/u.test(address.uf) || !/^\d{8}$/u.test(address.cep))
    throw new BlingError("invoice_recipient_address_required", 409);
  return address;
}

function assertReviewedAddress(invoice: Record<string, unknown>, expected: ReturnType<typeof reviewedRecipientAddress>) {
  const actual = row(row(invoice.contato).endereco);
  if (Object.entries(expected).some(([key, value]) => {
    const observed = key === "cep" ? readString(actual, key).replace(/\D/gu, "") : readString(actual, key).trim();
    return observed.normalize("NFC").toUpperCase() !== value.normalize("NFC").toUpperCase();
  })) throw new BlingError("invoice_recipient_mismatch", 409);
}

export type BlingInvoicePaymentTerm = { data: string; valor: number; formaPagamento: { id: number }; observacoes?: string; caut?: string };
const paymentDateValid = (date: string) => {
  const parsed = new Date(`${date}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/u.test(date) && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
};
const paymentAmount = (value: unknown) => {
  const amount = cents(value);
  if (!Number.isSafeInteger(amount) || amount < 1 || Math.abs(Number(value) * 100 - amount) > 0.000001)
    throw new BlingError("invoice_payment_terms_mismatch", 409);
  return amount;
};
const paymentSignature = (terms: Record<string, unknown>[]) => terms.map(p => {
  const methodId = Number(row(p.formaPagamento).id), date = readString(p, "data");
  if (!paymentDateValid(date) || !Number.isSafeInteger(methodId) || methodId < 1)
    throw new BlingError("invoice_payment_terms_mismatch", 409);
  return JSON.stringify([date, paymentAmount(p.valor), methodId, readString(p, "caut")]);
}).sort().join("|");

export function blingInvoicePaymentTerms(order: Record<string, unknown>, expected: { totalInCents: number; paymentMethodId: number }): BlingInvoicePaymentTerm[] {
  const values = order.parcelas;
  if (!Number.isSafeInteger(expected.totalInCents) || expected.totalInCents < 1
    || !Number.isSafeInteger(expected.paymentMethodId) || expected.paymentMethodId < 1
    || !Array.isArray(values) || !values.length || values.some(p => !isUnknownRecord(p)))
    throw new BlingError("invoice_payment_terms_required", 409);
  const terms = array(values).map(p => {
    const date = readString(p, "dataVencimento"), amount = paymentAmount(p.valor);
    if (!paymentDateValid(date) || Number(row(p.formaPagamento).id) !== expected.paymentMethodId)
      throw new BlingError("invoice_payment_terms_mismatch", 409);
    return { data: date, valor: amount / 100, formaPagamento: { id: expected.paymentMethodId },
      ...(readString(p, "observacoes") ? { observacoes: readString(p, "observacoes") } : {}),
      ...(readString(p, "caut") ? { caut: readString(p, "caut") } : {}) };
  });
  if (terms.reduce((sum, p) => sum + cents(p.valor), 0) !== expected.totalInCents)
    throw new BlingError("invoice_payment_terms_mismatch", 409);
  return terms;
}

export function assertBlingInvoicePaymentTerms(invoice: Record<string, unknown>, expected: BlingInvoicePaymentTerm[]) {
  const actual = array(invoice.parcelas);
  if (!expected.length || !Array.isArray(invoice.parcelas) || actual.length !== invoice.parcelas.length
    || paymentSignature(actual) !== paymentSignature(expected)) throw new BlingError("invoice_payment_terms_mismatch", 409);
}
type CommercialLine = { sku: string; unit: string; quantity: number; unitPriceInCents: number };
const signature = (items: CommercialLine[]) => items.map(i => JSON.stringify([i.sku, i.unit, i.quantity, i.unitPriceInCents])).sort().join("|");
export function invoiceMatchesFiscalLines(invoice: Record<string, unknown>, items: CommercialLine[]) {
  return signature(array(invoice.itens).map(i => ({ sku: readString(i, "codigo"), unit: readString(i, "unidade"),
    quantity: Number(i.quantidade), unitPriceInCents: cents(i.valor) }))) === signature(items);
}

export function blingFiscalDraftBody(invoice: Record<string, unknown>, fiscalItems: BlingFiscalItem[],
  commercialItems: CommercialLine[], input: { document: string; icmsTaxpayer: boolean; natureId: number; recipientAddress: Record<string, unknown>;
    paymentTerms: BlingInvoicePaymentTerm[];
    totalInCents: number; shippingInCents: number; discountInCents: number; additionalInCents: number }) {
  // Only the exact, untransmitted commercial draft may be transformed. Never repair
  // an arbitrary/partially edited provider note by overwriting it.
  if (Number(invoice.situacao) !== 1 || readString(invoice, "chaveAcesso") || Number(invoice.tipo) !== 1
    || Number(row(invoice.naturezaOperacao).id) !== input.natureId
    || !readString(invoice, "numero")
    || cents(invoice.valorNota) !== input.totalInCents || cents(invoice.valorFrete) !== input.shippingInCents
    || !invoiceMatchesFiscalLines(invoice, commercialItems)) throw new BlingError("invoice_draft_decomposition_conflict", 409);
  const contact = row(invoice.contato);
  if (readString(contact, "numeroDocumento").replace(/\D/gu, "") !== input.document
    || !/^\d{11}$/u.test(input.document) || input.icmsTaxpayer && !readString(contact, "ie"))
    throw new BlingError("invoice_recipient_mismatch", 409);
  // The reviewed order snapshot binds the fiscal destination. The provider's
  // contact record can carry a different address, including a different state.
  const address = reviewedRecipientAddress(input.recipientAddress);
  if (!input.paymentTerms.length || input.paymentTerms.reduce((sum, p) => sum + cents(p.valor), 0) !== input.totalInCents)
    throw new BlingError("invoice_payment_terms_required", 409);
  if (invoice.parcelas != null && !Array.isArray(invoice.parcelas)) throw new BlingError("invoice_payment_terms_mismatch", 409);
  // A generated draft can omit the original order's payment conditions. Never
  // invent a payment method or silently replace different existing conditions.
  if (Array.isArray(invoice.parcelas) && invoice.parcelas.length) assertBlingInvoicePaymentTerms(invoice, input.paymentTerms);
  const gross = fiscalItems.reduce((s, i) => s + i.quantity * i.unitPriceInCents, 0);
  if (!Number.isSafeInteger(gross) || gross + input.shippingInCents + input.additionalInCents - input.discountInCents !== input.totalInCents)
    throw new BlingError("fiscal_total_mismatch", 409);
  const transport = row(invoice.transporte);
  if (![0, 1, 2, 3, 4, 9].includes(Number(transport.fretePorConta))) throw new BlingError("invoice_freight_mapping_required", 409);
  // GET can return an empty carrier; PUT requires a name whenever it is supplied.
  const carrier = row(transport.transportador);
  const hasCarrier = Object.values(carrier).some(value => typeof value === "string"
    ? value.trim().length > 0 : value != null && value !== 0 && value !== false);
  if (hasCarrier && !readString(carrier, "nome").trim()) throw new BlingError("invoice_carrier_mapping_required", 409);
  const operationDate = draftOperationDate(invoice);
  return { tipo: 1, numero: readString(invoice, "numero"), dataOperacao: operationDate,
    finalidade: 1, naturezaOperacao: { id: input.natureId },
    contato: { nome: contact.nome, numeroDocumento: input.document, tipoPessoa: "F", contribuinte: input.icmsTaxpayer ? 1 : 9,
      ie: contact.ie, rg: contact.rg, telefone: contact.telefone, email: contact.email, endereco: address },
    itens: fiscalItems.map(i => ({ codigo: i.sourceCommercialSku ? i.sku : blingExternalSku(i.sku, i.variantId ?? ""),
      descricao: i.description, unidade: "PR", quantidade: i.quantity, valor: i.unitPriceInCents / 100,
      classificacaoFiscal: i.ncm, origem: i.origin, cest: i.cest, tipo: "P",
      ...(i.sourceCommercialSku ? { informacoesAdicionais: `SKU comercial: ${i.sourceCommercialSku}` } : {}) })),
    desconto: input.discountInCents / 100, despesas: input.additionalInCents / 100,
    transporte: { fretePorConta: Number(transport.fretePorConta), frete: input.shippingInCents / 100,
      ...(hasCarrier ? { transportador: carrier } : {}), etiqueta: transport.etiqueta },
    parcelas: Array.isArray(invoice.parcelas) && invoice.parcelas.length
      ? array(invoice.parcelas).map(p => ({ data: p.data, valor: p.valor, observacoes: p.observacoes,
        caut: p.caut, formaPagamento: p.formaPagamento })) : input.paymentTerms };
}

export async function prepareBlingFiscalDraft(provider: BlingClient, invoiceId: number,
  fiscalItems: BlingFiscalItem[], commercialItems: CommercialLine[], input: Parameters<typeof blingFiscalDraftBody>[3],
  stockAutomationDisabled: boolean, authorizeMutation: () => Promise<boolean> = async () => false) {
  const response = await requestBlingFiscalResource(provider, `/nfe/${invoiceId}`, "draft_read");
  const invoice = row(row(response).data);
  const expected = fiscalItems.map(i => ({ ...i, sku: i.sourceCommercialSku ? i.sku : blingExternalSku(i.sku, i.variantId ?? "") }));
  if (invoiceMatchesFiscalLines(invoice, expected)) {
    assertReviewedAddress(invoice, reviewedRecipientAddress(input.recipientAddress));
    assertBlingInvoicePaymentTerms(invoice, input.paymentTerms);
    return;
  }
  if (!fiscalItems.some(i => i.sourceCommercialSku)) throw new BlingError("invoice_items_mismatch", 409);
  if (!stockAutomationDisabled) throw new BlingError("invoice_stock_automation_must_be_disabled", 409);
  const body = blingFiscalDraftBody(invoice, fiscalItems, commercialItems, input);
  if (!await authorizeMutation()) throw new BlingError("order_not_eligible", 409);
  await requestBlingFiscalResource(provider, `/nfe/${invoiceId}`, "draft_update", { method: "PUT", body });
  const saved = row(row(await requestBlingFiscalResource(provider, `/nfe/${invoiceId}`, "draft_verify")).data);
  if (!invoiceMatchesFiscalLines(saved, expected)) throw new BlingError("invoice_items_mismatch", 409);
  assertReviewedAddress(saved, body.contato.endereco);
  assertBlingInvoicePaymentTerms(saved, input.paymentTerms);
}
