import "server-only";
import { BlingError } from "./bling";

export type BlingFiscalRule = {
  scenario: string; issuer_state: string; cfop: string; csosn: string; icms_rate: number;
  document_model: number; series: number; external_nature_id: number | null;
};
const text = (value: unknown) => typeof value === "string" ? value : "";
const states = new Set("AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" "));

export function selectBlingFiscalRule(value: unknown, input: { destinationState: string; icmsTaxpayer: boolean; operation: "sale" | "return"; finalConsumer?: boolean }): BlingFiscalRule {
  if (!states.has(input.destinationState) || typeof input.icmsTaxpayer !== "boolean" || !["sale", "return"].includes(input.operation))
    throw new BlingError("fiscal_recipient_required", 409);
  const rules = Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v)) : [];
  const issuerStates = new Set(rules.map((rule) => rule.issuer_state));
  if (issuerStates.size !== 1 || !states.has(String(rules[0]?.issuer_state))) throw new BlingError("fiscal_rules_required", 409);
  const sameState = rules[0]?.issuer_state === input.destinationState;
  const scenario = input.operation === "return" ? sameState ? "return_in_state" : "return_interstate"
    : sameState ? "sale_in_state" : input.icmsTaxpayer ? "sale_interstate_taxpayer" : "sale_interstate_non_taxpayer";
  const matching = rules.filter((rule) => rule.scenario === scenario);
  const rule = matching[0];
  if (matching.length !== 1 || !rule || !/^\d{4}$/u.test(String(rule.cfop)) || !/^\d{3}$/u.test(String(rule.csosn))
    || !Number.isFinite(Number(rule.icms_rate)) || Number(rule.icms_rate) < 0 || Number(rule.icms_rate) > 100
    || Number(rule.document_model) !== 55 || !Number.isSafeInteger(Number(rule.series)) || Number(rule.series) < 1 || Number(rule.series) > 999
    || rule.external_nature_id != null && (!Number.isSafeInteger(Number(rule.external_nature_id)) || Number(rule.external_nature_id) <= 0))
    throw new BlingError("fiscal_rules_required", 409);
  const natures = Array.isArray(rule.natures) ? rule.natures.filter((v): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v)) : [];
  const matchingNatures = typeof input.finalConsumer === "boolean" ? natures.filter((n) => n.final_consumer === input.finalConsumer) : [];
  if (matchingNatures.length > 1 || matchingNatures.some((n) => !Number.isSafeInteger(Number(n.external_nature_id)) || Number(n.external_nature_id) <= 0))
    throw new BlingError("fiscal_rules_required", 409);
  return { scenario, issuer_state: String(rule.issuer_state), cfop: String(rule.cfop), csosn: String(rule.csosn),
    icms_rate: Number(rule.icms_rate), document_model: 55, series: Number(rule.series),
    external_nature_id: matchingNatures[0] ? Number(matchingNatures[0].external_nature_id) : null };
}

export function buildBlingFiscalMirror(rule: BlingFiscalRule, items: Array<{ sku: string; description: string; unit: string;
  pairsPerSku: number; fiscalUnitApproved: boolean; quantity: number; unitPriceInCents: number; ncm: string; origin: number; cest: string }>,
  options: { originalInvoiceKey?: string; shippingInCents?: number; discountInCents?: number; additionalInCents?: number } = {}) {
  const shippingInCents = options.shippingInCents ?? 0, discountInCents = options.discountInCents ?? 0, additionalInCents = options.additionalInCents ?? 0;
  if (!items.length || items.some((item) => !item.sku || !item.description || !Number.isSafeInteger(item.quantity) || item.quantity < 1
    || !Number.isSafeInteger(item.unitPriceInCents) || item.unitPriceInCents < 0 || !Number.isSafeInteger(item.pairsPerSku) || item.pairsPerSku < 1
    || !["PR", "UN", "KIT"].includes(item.unit) || !/^\d{8}$/u.test(item.ncm) || !Number.isInteger(item.origin) || item.origin < 0 || item.origin > 8)
    || [shippingInCents, discountInCents, additionalInCents].some((amount) => !Number.isSafeInteger(amount) || amount < 0))
    throw new BlingError("invalid_fiscal_mirror_items", 409);
  const blockers: string[] = ["accountant_mirror_approval_required", "certificate_and_provider_homologation_required"];
  if (!rule.external_nature_id) blockers.push("nature_configuration_required");
  if (items.some((item) => !item.fiscalUnitApproved)) blockers.push("kit_fiscal_unit_confirmation_required");
  if (rule.scenario.startsWith("return_") && !/^\d{44}$/u.test(options.originalInvoiceKey ?? "")) blockers.push("original_invoice_key_required");
  const totalInCents = items.reduce((sum, item) => sum + item.quantity * item.unitPriceInCents, 0) + shippingInCents + additionalInCents - discountInCents;
  if (!Number.isSafeInteger(totalInCents) || totalInCents < 0) throw new BlingError("invalid_fiscal_mirror_total", 409);
  return { kind: "fiscal_preview", transmittable: false, consumesInvoiceNumber: false, number: null, rule,
    internetPresence: 2, originalInvoiceKey: options.originalInvoiceKey ?? null, items: items.map((item) => ({ ...item,
    totalInCents: item.quantity * item.unitPriceInCents })), shippingInCents, discountInCents, additionalInCents,
    totalInCents, blockers };
}

export async function blingFiscalMirrorHash(value: unknown): Promise<string> {
  const canonical = (input: unknown): unknown => Array.isArray(input) ? input.map(canonical)
    : input !== null && typeof input === "object" ? Object.fromEntries(Object.entries(input).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, value]) => [key, canonical(value)])) : input;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonical(value)))));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildBlingOrderFiscalMirror(input: { rules: unknown; order: Record<string, unknown>; items: Record<string, unknown>[];
  snapshots: Record<string, unknown>[]; icmsTaxpayer: boolean; finalConsumer: boolean }) {
  const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const address = record(input.order.shipping_address_snapshot);
  const destinationState = text(address.state);
  if (typeof input.finalConsumer !== "boolean") throw new BlingError("fiscal_recipient_required", 409);
  const rule = selectBlingFiscalRule(input.rules, { destinationState, icmsTaxpayer: input.icmsTaxpayer, finalConsumer: input.finalConsumer, operation: "sale" });
  const orderedItems = [...input.items].sort((a, b) => text(a.variant_id) < text(b.variant_id) ? -1 : text(a.variant_id) > text(b.variant_id) ? 1 : 0);
  const mirror = buildBlingFiscalMirror(rule, orderedItems.map((item) => {
    const snapshot = input.snapshots.find((value) => record(value.variant).id === item.variant_id);
    const variant = record(snapshot?.variant), metadata = record(snapshot?.metadata);
    if (text(variant.sku) !== text(item.sku_snapshot)) throw new BlingError("fiscal_sku_changed", 409);
    return { sku: text(item.sku_snapshot), description: text(item.product_name_snapshot), quantity: Number(item.quantity),
      unitPriceInCents: Math.round(Number(item.unit_price) * 100), unit: text(metadata.commercial_unit),
      pairsPerSku: Number(metadata.pairs_per_sku), fiscalUnitApproved: metadata.fiscal_unit_approved === true,
      ncm: text(metadata.ncm), origin: Number(metadata.origin), cest: text(metadata.cest) };
  }), { shippingInCents: Math.round(Number(input.order.shipping_total ?? 0) * 100), discountInCents: Math.round(Number(input.order.discount_total ?? 0) * 100),
    additionalInCents: Math.round(Number(input.order.fee_total ?? 0) * 100) });
  if (mirror.totalInCents < 0 || mirror.totalInCents !== Math.round(Number(input.order.grand_total) * 100)) throw new BlingError("fiscal_total_mismatch", 409);
  const contextHash = await blingFiscalMirrorHash({ id: input.order.id, customerId: input.order.customer_id,
    customerName: input.order.customer_name_snapshot, customerEmail: input.order.customer_email_snapshot,
    customerDocument: input.order.cpf_ciphertext, shippingAddress: address });
  return { ...mirror, orderId: input.order.id, contextHash, destinationState, icmsTaxpayer: input.icmsTaxpayer, finalConsumer: input.finalConsumer };
}
