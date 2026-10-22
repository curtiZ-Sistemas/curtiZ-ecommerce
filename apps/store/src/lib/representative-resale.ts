import "server-only";
import { allocateBlingFiscalCents, expandBlingFiscalKit, type BlingFiscalItem } from "@curtiz/integrations";
import { z } from "zod";

const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const metadataSchema = z.object({
  commercial_unit: z.enum(["PR", "UN", "KIT"]), pairs_per_sku: z.number().int().min(1).max(100),
  ncm: z.string().regex(/^\d{8}$/u), origin: z.number().int().min(0).max(8),
  cest: z.string().regex(/^(?:|\d{7})$/u)
});
const contextSchema = z.object({
  kitId: z.string().uuid().nullable(), source: z.enum(["offer", "catalog"]).default("offer"),
  variantId: z.string().uuid().optional(), name: z.string().min(1), merchandiseTotalInCents: integer,
  items: z.array(z.object({
    variantId: z.string().uuid(), sku: z.string().min(1), description: z.string().min(1), active: z.boolean(),
    quantity: z.number().int().min(1).max(10000), available: integer.nullable(),
    allocationWeight: z.number().int().min(1).max(1000000).nullable(),
    metadata: z.unknown(), composition: z.unknown()
  })).max(100)
}).refine(value => value.source === "catalog" ? value.kitId === null && Boolean(value.variantId) : value.kitId !== null);

// A read-only merchandise preview. It neither approves taxation nor reserves
// inventory. Fiscal pairs never become inventory/BOM deductions.
export function previewRepresentativeResale(context: unknown, icmsTaxpayer?: boolean) {
  const input = contextSchema.parse(context);
  const blockers = new Set<string>(["resale_homologation_required", "resale_fiscal_validation_required", "shipping_quote_required"]);
  if (typeof icmsTaxpayer !== "boolean") blockers.add("recipient_taxpayer_declaration_required");
  if (!input.items.length) blockers.add("commercial_composition_required");
  if (new Set(input.items.map(i => i.variantId)).size !== input.items.length) throw new Error("duplicate_commercial_variant");
  const weights = input.items.map(i => i.allocationWeight ?? (input.items.length === 1 ? 1 : 0));
  if (weights.some(w => w === 0)) blockers.add("commercial_allocation_required");
  const amounts = input.items.length && weights.every(w => w > 0)
    ? allocateBlingFiscalCents(input.merchandiseTotalInCents, weights) : [];
  const commercialItems: Array<{ variantId: string; sku: string; quantity: number; unitPriceInCents: number; unit: string }> = [];
  const fiscalItems: BlingFiscalItem[] = [];
  for (const [index, item] of input.items.entries()) {
    if (!item.active) blockers.add("commercial_variant_unavailable");
    if (item.available === null || item.available < item.quantity) blockers.add("commercial_stock_unavailable");
    const metadata = metadataSchema.safeParse(item.metadata);
    if (!metadata.success) { blockers.add("product_fiscal_data_required"); continue; }
    if (metadata.data.pairs_per_sku < 2) { blockers.add("commercial_kit_mapping_required"); continue; }
    if (!amounts.length) continue;
    const base = Math.floor(amounts[index]! / item.quantity), higher = amounts[index]! % item.quantity;
    const groups = [...(higher ? [{ quantity: higher, price: base + 1 }] : []),
      ...(item.quantity > higher ? [{ quantity: item.quantity - higher, price: base }] : [])];
    for (const group of groups) {
      const m = metadata.data;
      commercialItems.push({ variantId: item.variantId, sku: item.sku, quantity: group.quantity,
        unitPriceInCents: group.price, unit: m.commercial_unit });
      try {
        if (m.pairs_per_sku === 1 && m.commercial_unit !== "PR") throw new Error("fiscal_unit_required");
        fiscalItems.push(...expandBlingFiscalKit({ variantId: item.variantId, sku: item.sku, description: item.description,
          quantity: group.quantity, unitPriceInCents: group.price, unit: m.commercial_unit, pairsPerSku: m.pairs_per_sku,
          fiscalUnitApproved: false, ncm: m.ncm, origin: m.origin, cest: m.cest }, item.composition));
      } catch { blockers.add("kit_fiscal_composition_required"); }
    }
  }
  const commercialTotal = commercialItems.reduce((sum, i) => sum + i.quantity * i.unitPriceInCents, 0);
  const fiscalTotal = fiscalItems.reduce((sum, i) => sum + i.quantity * i.unitPriceInCents, 0);
  const compositionReady = input.items.length > 0 && amounts.length > 0
    && !["product_fiscal_data_required", "kit_fiscal_composition_required", "commercial_kit_mapping_required"].some(b => blockers.has(b));
  if (compositionReady && (commercialTotal !== input.merchandiseTotalInCents || fiscalTotal !== commercialTotal))
    throw new Error("resale_total_mismatch");
  return { kitId: input.kitId, source: input.source, variantId: input.variantId ?? null,
    name: input.name, purpose: "resale" as const, finalConsumer: false as const,
    icmsTaxpayer: icmsTaxpayer ?? null, canPurchase: false as const, merchandiseTotalInCents: input.merchandiseTotalInCents,
    shippingInCents: null, grandTotalInCents: null, taxes: null, commercialItems,
    fiscalItems: compositionReady ? fiscalItems : [], blockers: [...blockers] };
}
