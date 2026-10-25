import "server-only";
import { BlingError, blingExternalSku, type BlingClient, type BlingFiscalItem } from "@curtiz/integrations";
import { isUnknownRecord, readString } from "./unknown-data";
const row = (v: unknown): Record<string, unknown> => isUnknownRecord(v) ? v : {};
const array = (v: unknown): Record<string, unknown>[] => Array.isArray(v) ? v.filter(isUnknownRecord) : [];
const cents = (v: unknown) => Math.round(Number(v) * 100);
type CommercialLine = { sku: string; unit: string; quantity: number; unitPriceInCents: number };
const signature = (items: CommercialLine[]) => items.map(i => JSON.stringify([i.sku, i.unit, i.quantity, i.unitPriceInCents])).sort().join("|");
export function invoiceMatchesFiscalLines(invoice: Record<string, unknown>, items: CommercialLine[]) {
  return signature(array(invoice.itens).map(i => ({ sku: readString(i, "codigo"), unit: readString(i, "unidade"),
    quantity: Number(i.quantidade), unitPriceInCents: cents(i.valor) }))) === signature(items);
}

export function blingFiscalDraftBody(invoice: Record<string, unknown>, fiscalItems: BlingFiscalItem[],
  commercialItems: CommercialLine[], input: { document: string; icmsTaxpayer: boolean; natureId: number;
    totalInCents: number; shippingInCents: number; discountInCents: number; additionalInCents: number }) {
  // Only the exact, untransmitted commercial draft may be transformed. Never repair
  // an arbitrary/partially edited provider note by overwriting it.
  if (Number(invoice.situacao) !== 1 || readString(invoice, "chaveAcesso") || Number(invoice.tipo) !== 1
    || Number(row(invoice.naturezaOperacao).id) !== input.natureId
    || !readString(invoice, "numero") || !readString(invoice, "dataOperacao")
    || cents(invoice.valorNota) !== input.totalInCents || cents(invoice.valorFrete) !== input.shippingInCents
    || !invoiceMatchesFiscalLines(invoice, commercialItems)) throw new BlingError("invoice_draft_decomposition_conflict", 409);
  const contact = row(invoice.contato);
  if (readString(contact, "numeroDocumento").replace(/\D/gu, "") !== input.document
    || !/^\d{11}$/u.test(input.document) || input.icmsTaxpayer && !readString(contact, "ie"))
    throw new BlingError("invoice_recipient_mismatch", 409);
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
  return { tipo: 1, numero: readString(invoice, "numero"), dataOperacao: readString(invoice, "dataOperacao"),
    finalidade: 1, naturezaOperacao: { id: input.natureId },
    contato: { nome: contact.nome, numeroDocumento: input.document, tipoPessoa: "F", contribuinte: input.icmsTaxpayer ? 1 : 9,
      ie: contact.ie, rg: contact.rg, telefone: contact.telefone, email: contact.email, endereco: contact.endereco },
    itens: fiscalItems.map(i => ({ codigo: i.sourceCommercialSku ? i.sku : blingExternalSku(i.sku, i.variantId ?? ""),
      descricao: i.description, unidade: "PR", quantidade: i.quantity, valor: i.unitPriceInCents / 100,
      classificacaoFiscal: i.ncm, origem: i.origin, cest: i.cest, tipo: "P",
      ...(i.sourceCommercialSku ? { informacoesAdicionais: `SKU comercial: ${i.sourceCommercialSku}` } : {}) })),
    desconto: input.discountInCents / 100, despesas: input.additionalInCents / 100,
    transporte: { fretePorConta: Number(transport.fretePorConta), frete: input.shippingInCents / 100,
      ...(hasCarrier ? { transportador: carrier } : {}), etiqueta: transport.etiqueta },
    parcelas: array(invoice.parcelas).map(p => ({ data: p.data, valor: p.valor, observacoes: p.observacoes,
      caut: p.caut, formaPagamento: p.formaPagamento })) };
}

export async function prepareBlingFiscalDraft(provider: BlingClient, invoiceId: number,
  fiscalItems: BlingFiscalItem[], commercialItems: CommercialLine[], input: Parameters<typeof blingFiscalDraftBody>[3],
  stockAutomationDisabled: boolean, authorizeMutation: () => Promise<boolean> = async () => false) {
  const response = await provider.request(`/nfe/${invoiceId}`);
  const invoice = row(row(response).data);
  const expected = fiscalItems.map(i => ({ ...i, sku: i.sourceCommercialSku ? i.sku : blingExternalSku(i.sku, i.variantId ?? "") }));
  if (invoiceMatchesFiscalLines(invoice, expected)) return;
  if (!fiscalItems.some(i => i.sourceCommercialSku)) throw new BlingError("invoice_items_mismatch", 409);
  if (!stockAutomationDisabled) throw new BlingError("invoice_stock_automation_must_be_disabled", 409);
  const body = blingFiscalDraftBody(invoice, fiscalItems, commercialItems, input);
  if (!await authorizeMutation()) throw new BlingError("order_not_eligible", 409);
  await provider.request(`/nfe/${invoiceId}`, { method: "PUT", body });
  const saved = row(row(await provider.request(`/nfe/${invoiceId}`)).data);
  if (!invoiceMatchesFiscalLines(saved, expected)) throw new BlingError("invoice_items_mismatch", 409);
}
