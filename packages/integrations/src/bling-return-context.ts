import "server-only";
import { BlingError } from "./bling";
import { blingExternalSku } from "./bling-catalog";
import { buildBlingReturnFiscalMirror, selectBlingFiscalRule } from "./bling-fiscal-preview";
import type { readBlingReturnOriginalXml } from "./bling-return-xml";

export type BlingReturnOrderLine = { id: string; variantId: string; sku: string; quantity: number; unitPriceInCents: number;
  requestedQuantity: number; otherReturnsQuantity: number };
const fail = (): never => { throw new BlingError("return_original_balance_mismatch", 409); };
const proportional = (amount: number, quantity: number, original: number) => {
  const numerator = BigInt(amount) * BigInt(quantity), denominator = BigInt(original);
  if (numerator % denominator !== 0n) throw new BlingError("partial_return_rounding_review_required", 409);
  const result = Number(numerator / denominator);
  return Number.isSafeInteger(result) ? result : fail();
};

// Quantities from every other active/completed return reserve the original
// commercial units. Current catalog prices/compositions are never consulted.
export function buildBlingArchivedReturnMirror(rules: unknown, original: ReturnType<typeof readBlingReturnOriginalXml>,
  orderLines: BlingReturnOrderLine[], totals: { totalInCents: number; shippingInCents: number; discountInCents: number; additionalInCents: number }) {
  if (!orderLines.length || new Set(orderLines.map(line => line.id)).size !== orderLines.length
    || orderLines.some(line => !line.id || !line.sku || !line.variantId || !Number.isSafeInteger(line.quantity) || line.quantity < 1
      || [line.unitPriceInCents, line.requestedQuantity, line.otherReturnsQuantity].some(n => !Number.isSafeInteger(n) || n < 0)
      || BigInt(line.requestedQuantity) + BigInt(line.otherReturnsQuantity) > BigInt(line.quantity))
    || Object.keys(totals).some(key => {
      const field = key as keyof typeof totals;
      return !Number.isSafeInteger(totals[field]) || totals[field] < 0 || totals[field] !== original[field];
    })) return fail();
  const mapped = original.items.map(item => {
    const matches = orderLines.filter(line => item.sourceCommercialSku ? item.sourceCommercialSku === line.sku
      : item.sku === blingExternalSku(line.sku, line.variantId));
    return matches.length === 1 ? matches[0]! : fail();
  });
  for (const line of orderLines) {
    const indices = mapped.flatMap((match, index) => match.id === line.id ? [index] : []);
    if (!indices.length || indices.reduce((sum, i) => sum + BigInt(original.items[i]!.quantity)
      * BigInt(original.items[i]!.unitPriceInCents), 0n) !== BigInt(line.quantity) * BigInt(line.unitPriceInCents)) return fail();
  }
  const lines: { originalLine: number; quantity: number }[] = [];
  const balance = original.items.map((item, originalLine) => {
    const line = mapped[originalLine]!;
    const requestedQuantity = proportional(item.quantity, line.requestedQuantity, line.quantity);
    const otherReturnsQuantity = proportional(item.quantity, line.otherReturnsQuantity, line.quantity);
    if (requestedQuantity + otherReturnsQuantity > item.quantity) return fail();
    if (requestedQuantity) lines.push({ originalLine, quantity: requestedQuantity });
    return { originalLine, originalQuantity: item.quantity, requestedQuantity, otherReturnsQuantity,
      remainingQuantity: item.quantity - requestedQuantity - otherReturnsQuantity };
  });
  if (!lines.length) return fail();
  const allocation = { shippingInCents: 0, discountInCents: 0, additionalInCents: 0 };
  for (const line of lines) for (const field of ["shippingInCents", "discountInCents", "additionalInCents"] as const) {
    const amount = proportional(original.itemAllocationsInCents[line.originalLine]![field], line.quantity, original.items[line.originalLine]!.quantity);
    allocation[field] += amount;
    if (!Number.isSafeInteger(allocation[field])) return fail();
  }
  const rule = selectBlingFiscalRule(rules, { operation: "return", destinationState: original.destinationState,
    icmsTaxpayer: false, finalConsumer: true, recipientIsCompany: false });
  const mirror = buildBlingReturnFiscalMirror(rule, original, lines, allocation);
  return { ...mirror, balance, source: "authorized_invoice_archive" as const, originalEnvironment: original.environment,
    // A preview is an observation, not an emission reservation or stock event.
    balanceScope: "recorded_return_requests" as const };
}
