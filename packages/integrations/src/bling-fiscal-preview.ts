import "server-only";
import { BlingError } from "./bling";
import { expandBlingFiscalKit, type BlingFiscalItem } from "./bling-kit-fiscal";
import { readBlingTaxConfiguration, type BlingTaxConfiguration } from "./bling-tax";

export type BlingFiscalRule = {
  scenario: string; issuer_state: string; cfop: string; csosn: string; icms_rate: number;
  document_model: number; series: number; external_nature_id: number | null;
  pis_cst?: string | null; cofins_cst?: string | null; ipi_cst?: string | null;
  pis_rate?: number | null; cofins_rate?: number | null; ipi_rate?: number | null; ipi_cenq?: string | null;
  icms_credit_rate?: number | null;
};
const text = (value: unknown) => typeof value === "string" ? value : "";
const rate = (value: unknown): number | null => typeof value === "number" ? value
  : typeof value === "string" && /^\d+(?:\.\d{1,4})?$/u.test(value) ? Number(value) : null;
const states = new Set("AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" "));

export function selectBlingFiscalRule(value: unknown, input: { destinationState: string; icmsTaxpayer: boolean; operation: "sale" | "return"; finalConsumer?: boolean;
  creditEligible?: boolean; recipientIsCompany?: boolean }): BlingFiscalRule {
  if (!states.has(input.destinationState) || typeof input.icmsTaxpayer !== "boolean" || !["sale", "return"].includes(input.operation))
    throw new BlingError("fiscal_recipient_required", 409);
  if (input.operation === "return" && (input.icmsTaxpayer || input.finalConsumer !== true || input.recipientIsCompany !== false))
    throw new BlingError("return_recipient_policy_required", 409);
  const rules = Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v)) : [];
  const issuerStates = new Set(rules.map((rule) => rule.issuer_state));
  if (issuerStates.size !== 1 || !states.has(String(rules[0]?.issuer_state))) throw new BlingError("fiscal_rules_required", 409);
  const sameState = rules[0]?.issuer_state === input.destinationState;
  const resale = input.operation === "sale" && input.finalConsumer === false;
  if (resale && input.icmsTaxpayer && typeof input.creditEligible !== "boolean")
    throw new BlingError("fiscal_credit_eligibility_required", 409);
  if (resale && input.creditEligible === true && (!input.icmsTaxpayer || input.recipientIsCompany !== true))
    throw new BlingError("fiscal_credit_recipient_required", 409);
  const scenario = input.operation === "return" ? sameState ? "return_in_state" : "return_interstate"
    : resale ? `resale_${sameState ? "in_state" : "interstate"}_${input.creditEligible === true ? "credit" : "no_credit"}`
    : sameState ? "sale_in_state" : input.icmsTaxpayer ? "sale_interstate_taxpayer" : "sale_interstate_non_taxpayer";
  const matching = rules.filter((rule) => rule.scenario === scenario);
  const rule = matching[0];
  if (matching.length !== 1 || !rule || !/^\d{4}$/u.test(String(rule.cfop)) || !/^\d{3}$/u.test(String(rule.csosn))
    || !Number.isFinite(Number(rule.icms_rate)) || Number(rule.icms_rate) < 0 || Number(rule.icms_rate) > 100
    || Number(rule.document_model) !== 55 || !Number.isSafeInteger(Number(rule.series)) || Number(rule.series) < 1 || Number(rule.series) > 999
    || rule.external_nature_id != null && (!Number.isSafeInteger(Number(rule.external_nature_id)) || Number(rule.external_nature_id) <= 0))
    throw new BlingError("fiscal_rules_required", 409);
  if (resale && (String(rule.cfop) !== (sameState ? "5102" : "6102")
    || String(rule.csosn) !== (input.creditEligible === true ? "101" : "102") || rate(rule.icms_rate) !== 0
    || [rule.pis_rate, rule.cofins_rate, rule.ipi_rate].some(value => rate(value) !== 0)
    || rule.pis_cst !== "49" || rule.cofins_cst !== "49" || rule.ipi_cst !== "99" || rule.ipi_cenq !== "999"))
    throw new BlingError("resale_fiscal_parameters_required", 409);
  const creditRate = rate(rule.icms_credit_rate);
  if (resale && input.creditEligible === true && (creditRate === null || !Number.isFinite(creditRate)
    || creditRate < 0 || creditRate > 100 || Number(creditRate.toFixed(4)) !== creditRate))
    throw new BlingError("fiscal_credit_rate_required", 409);
  const natures = Array.isArray(rule.natures) ? rule.natures.filter((v): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v)) : [];
  const matchingNatures = typeof input.finalConsumer === "boolean" ? natures.filter((n) => n.final_consumer === input.finalConsumer) : [];
  if (matchingNatures.length > 1 || matchingNatures.some((n) => !Number.isSafeInteger(Number(n.external_nature_id)) || Number(n.external_nature_id) <= 0))
    throw new BlingError("fiscal_rules_required", 409);
  return { scenario, issuer_state: String(rule.issuer_state), cfop: String(rule.cfop), csosn: String(rule.csosn),
    icms_rate: Number(rule.icms_rate), document_model: 55, series: Number(rule.series),
    external_nature_id: matchingNatures[0] ? Number(matchingNatures[0].external_nature_id) : null,
    pis_cst: /^\d{2}$/u.test(text(rule.pis_cst)) ? text(rule.pis_cst) : null,
    cofins_cst: /^\d{2}$/u.test(text(rule.cofins_cst)) ? text(rule.cofins_cst) : null,
    ipi_cst: /^\d{2}$/u.test(text(rule.ipi_cst)) ? text(rule.ipi_cst) : null,
    pis_rate: rate(rule.pis_rate), cofins_rate: rate(rule.cofins_rate), ipi_rate: rate(rule.ipi_rate),
    ipi_cenq: /^\d{3}$/u.test(text(rule.ipi_cenq)) ? text(rule.ipi_cenq) : null,
    ...(String(rule.csosn) === "101" ? { icms_credit_rate: creditRate } : {}) };
}

export function buildBlingFiscalMirror(rule: BlingFiscalRule, items: BlingFiscalItem[],
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
  if (items.some((item) => item.pairsPerSku > 1)) blockers.push("kit_fiscal_composition_required");
  if (rule.scenario.startsWith("resale_") && items.some(item => item.unit !== "PR" || item.ncm !== "64022000"))
    blockers.push("resale_pair_classification_required");
  if (!rule.pis_cst || !rule.cofins_cst || !rule.ipi_cst) blockers.push("fiscal_tax_codes_required");
  let taxConfiguration: BlingTaxConfiguration | null = null;
  try { taxConfiguration = readBlingTaxConfiguration(rule); }
  catch { blockers.push("fiscal_tax_parameters_required"); }
  if (rule.scenario.startsWith("return_") && !/^\d{44}$/u.test(options.originalInvoiceKey ?? "")) blockers.push("original_invoice_key_required");
  if (rule.scenario.startsWith("return_") && rule.ipi_cst === "99") blockers.push("return_entry_tax_treatment_required");
  const totalInCents = items.reduce((sum, item) => sum + item.quantity * item.unitPriceInCents, 0) + shippingInCents + additionalInCents - discountInCents;
  if (!Number.isSafeInteger(totalInCents) || totalInCents < 0) throw new BlingError("invalid_fiscal_mirror_total", 409);
  return { kind: "fiscal_preview", transmittable: false, consumesInvoiceNumber: false, number: null, rule,
    internetPresence: 2, taxConfiguration, taxBases: "provider_calculation_requires_xml_verification",
    originalInvoiceKey: options.originalInvoiceKey ?? null, items: items.map((item) => ({ ...item,
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
  snapshots: Record<string, unknown>[]; icmsTaxpayer: boolean; finalConsumer: boolean; creditEligible?: boolean; recipientIsCompany?: boolean }) {
  const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const address = record(input.order.shipping_address_snapshot);
  const destinationState = text(address.state);
  if (typeof input.finalConsumer !== "boolean") throw new BlingError("fiscal_recipient_required", 409);
  const rule = selectBlingFiscalRule(input.rules, { destinationState, icmsTaxpayer: input.icmsTaxpayer, finalConsumer: input.finalConsumer,
    creditEligible: input.creditEligible, recipientIsCompany: input.recipientIsCompany, operation: "sale" });
  const orderedItems = [...input.items].sort((a, b) => text(a.variant_id) < text(b.variant_id) ? -1 : text(a.variant_id) > text(b.variant_id) ? 1 : 0);
  const mirror = buildBlingFiscalMirror(rule, orderedItems.flatMap((item) => {
    const snapshot = input.snapshots.find((value) => record(value.variant).id === item.variant_id);
    const variant = record(snapshot?.variant), metadata = record(snapshot?.metadata);
    if (text(variant.sku) !== text(item.sku_snapshot)) throw new BlingError("fiscal_sku_changed", 409);
    return expandBlingFiscalKit({ sku: text(item.sku_snapshot), description: text(item.product_name_snapshot), quantity: Number(item.quantity),
      unitPriceInCents: Math.round(Number(item.unit_price) * 100), unit: text(metadata.commercial_unit),
      pairsPerSku: Number(metadata.pairs_per_sku), fiscalUnitApproved: metadata.fiscal_unit_approved === true,
      ncm: text(metadata.ncm), origin: Number(metadata.origin), cest: text(metadata.cest), variantId: text(item.variant_id) }, snapshot?.kit_components);
  }), { shippingInCents: Math.round(Number(input.order.shipping_total ?? 0) * 100), discountInCents: Math.round(Number(input.order.discount_total ?? 0) * 100),
    additionalInCents: Math.round(Number(input.order.fee_total ?? 0) * 100) });
  if (mirror.totalInCents < 0 || mirror.totalInCents !== Math.round(Number(input.order.grand_total) * 100)) throw new BlingError("fiscal_total_mismatch", 409);
  const contextHash = await blingFiscalMirrorHash({ id: input.order.id, customerId: input.order.customer_id,
    customerName: input.order.customer_name_snapshot, customerEmail: input.order.customer_email_snapshot,
    customerDocument: input.order.cpf_ciphertext, shippingAddress: address });
  return { ...mirror, orderId: input.order.id, contextHash, destinationState, icmsTaxpayer: input.icmsTaxpayer, finalConsumer: input.finalConsumer };
}

