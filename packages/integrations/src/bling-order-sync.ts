import "server-only";
import { BlingError, type BlingClient } from "./bling";
import { blingExternalSku } from "./bling-catalog";
import { isUnknownRecord, readNumber, readString } from "./record-readers";

const row = (value: unknown): Record<string, unknown> | null => isUnknownRecord(value) ? value : null;
const array = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter(isUnknownRecord) : [];
const idNumber = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};
const date = (value: unknown) => {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new BlingError("missing_paid_date", 409);
  return new Date(value).toISOString().slice(0, 10);
};
const cents = (value: unknown) => Math.round(Number(value) * 100);
const validAmount = (value: unknown) => Number.isFinite(Number(value)) && Number(value) >= 0;
const data = (value: unknown) => row(value)?.data;

export function assertBlingPaidOrder(order: Record<string, unknown>): void {
  if (order.payment_status !== "approved" || ["pending_payment", "cancelled", "refunded", "manual_review", "cancellation_requested", "refund_pending"].includes(readString(order, "status")))
    throw new BlingError("order_not_eligible", 409);
}

export async function findBlingContact(provider: BlingClient, document: string): Promise<number | null> {
  const result = await provider.request(`/contatos?numeroDocumento=${encodeURIComponent(document)}&pagina=1&limite=100`);
  const matches = array(data(result)).filter((item) => readString(item, "numeroDocumento").replace(/\D/gu, "") === document);
  if (matches.length > 1) throw new BlingError("duplicate_contact", 409);
  return matches.length ? idNumber(matches[0]?.id) : null;
}

export async function findBlingOrder(provider: BlingClient, code: string): Promise<number | null> {
  const query = new URLSearchParams({ "numerosLojas[]": code, pagina: "1", limite: "100" });
  const result = await provider.request(`/pedidos/vendas?${query.toString()}`);
  const matches = array(data(result)).filter((item) => readString(item, "numeroLoja") === code);
  if (matches.length > 1) throw new BlingError("duplicate_external_order", 409);
  return matches.length ? idNumber(matches[0]?.id) : null;
}

export function blingOrderPayload(input: { order: Record<string, unknown>; items: Record<string, unknown>[];
  productLinks: Record<string, unknown>[]; contactId: number; paymentMethodId: number; natureId?: number;
  collectionDueDate?: string }) {
  const { order, items, productLinks, contactId, paymentMethodId } = input;
  if (input.collectionDueDate) {
    if (order.status !== "awaiting_receipt" || order.payment_status !== "pending"
      || !/^(?:KITMG|ATACADO)-[a-f0-9-]{36}$/u.test(readString(order, "public_code"))
      || !/^\d{4}-\d{2}-\d{2}$/u.test(input.collectionDueDate)) {
      throw new BlingError("order_not_eligible", 409);
    }
  } else {
    assertBlingPaidOrder(order);
  }
  const code = readString(order, "public_code");
  const money = ["subtotal", "discount_total", "shipping_total", "fee_total", "grand_total"];
  if (!code || !items.length || money.some((key) => !validAmount(order[key])) || cents(order.fee_total) !== 0)
    throw new BlingError("invalid_order_snapshot", 409);
  const lineSum = items.reduce((sum, item) => sum + cents(item.unit_price) * readNumber(item, "quantity"), 0);
  const subtotal = cents(order.subtotal);
  const discount = cents(order.discount_total);
  const shipping = cents(order.shipping_total);
  const total = cents(order.grand_total);
  if (lineSum !== subtotal || total !== subtotal - discount + shipping || !contactId || !paymentMethodId)
    throw new BlingError("invalid_order_totals", 409);
  const products = items.map((item) => {
    const variantId = readString(item, "variant_id");
    const sku = readString(item, "sku_snapshot");
    const link = productLinks.find((candidate) => readString(candidate, "variantId") === variantId);
    const externalId = idNumber(link?.externalProductId);
    const unit = readString(link ?? {}, "commercialUnit");
    const quantity = readNumber(item, "quantity");
    if (!externalId || readString(link ?? {}, "sku").toLowerCase() !== sku.toLowerCase() || !sku || !validAmount(item.unit_price)
      || !Number.isSafeInteger(quantity) || quantity <= 0 || cents(item.total) !== cents(item.unit_price) * quantity
      || cents(item.discount_amount) !== 0 || !["PR", "UN", "KIT"].includes(unit))
      throw new BlingError("product_mapping_required", 409);
    return { codigo: blingExternalSku(sku, variantId), unidade: unit, quantidade: quantity, valor: Number(item.unit_price),
      descricao: readString(item, "product_name_snapshot"), produto: { id: externalId },
      ...(input.natureId ? { naturezaOperacao: { id: input.natureId } } : {}) };
  });
  const paidDate = date(order.placed_at);
  const address = row(order.shipping_address_snapshot);
  if (!address || !readString(address, "street") || !readString(address, "city")
    || !/^\d{8}$/u.test(readString(address, "postal_code").replace(/\D/gu, "")))
    throw new BlingError("shipping_address_required", 409);
  return { numeroLoja: code, data: paidDate, contato: { id: contactId }, itens: products,
    parcelas: [{ dataVencimento: input.collectionDueDate ?? paidDate, valor: total / 100, formaPagamento: { id: paymentMethodId } }],
    ...(discount > 0 ? { desconto: { valor: discount / 100, unidade: "REAL" } } : {}),
    transporte: { ...(code.startsWith("ATACADO-") ? { fretePorConta: 3 } : {}), frete: shipping / 100, etiqueta: {
      nome: readString(order, "customer_name_snapshot"), endereco: readString(address, "street"),
      numero: readString(address, "number"), complemento: readString(address, "complement"),
      bairro: readString(address, "district"), municipio: readString(address, "city"),
      uf: readString(address, "state"), cep: readString(address, "postal_code").replace(/\D/gu, "")
    } } };
}

export function assertBlingExternalOrder(order: Record<string, unknown>, items: Record<string, unknown>[], external: Record<string, unknown> | null): void {
  const externalItems = array(external?.itens);
  const localLines = items.map((item) => JSON.stringify([blingExternalSku(readString(item, "sku_snapshot"), readString(item, "variant_id")).toLowerCase(), Number(item.quantity), cents(item.unit_price)])).sort();
  const externalLines = externalItems.map((item) => JSON.stringify([readString(item, "codigo").toLowerCase(), Number(item.quantidade), cents(item.valor)])).sort();
  if (!external || !items.length || readString(external, "numeroLoja") !== readString(order, "public_code")
    || !validAmount(external.total) || cents(external.total) !== cents(order.grand_total)
    || JSON.stringify(localLines) !== JSON.stringify(externalLines))
    throw new BlingError("external_order_mismatch", 409, false, true);
}

