import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { previewRepresentativeResale } from "./representative-resale";
const kitId = "a0100000-0000-4000-8000-000000000001";
const variantId = "a0200000-0000-4000-8000-000000000001";
const item = () => ({ variantId, sku: "OWN-KIT", description: "Synthetic commercial kit", active: true,
  quantity: 1, available: 4, allocationWeight: null as number | null,
  metadata: { commercial_unit: "UN", pairs_per_sku: 2, ncm: "64022000", origin: 0, cest: "" },
  composition: [1, 2].map(position => ({ sku: `FISCAL-PAIR-${position}`, description: `Synthetic pair ${position}`,
    unit: "PR", quantity_pairs: 1, allocation_weight: 1, source_current: true, ncm: "64022000", origin: 0, cest: "" })) });
const context = () => ({ kitId, name: "Synthetic resale offer", merchandiseTotalInCents: 4345, items: [item()] });
describe("representative resale preview, independent of B2C checkout", () => {
  it("preserves own stock SKU, fiscal pairs and exact cents without mutating its context", () => {
    const data = context(), before = structuredClone(data), result = previewRepresentativeResale(data, false);
    expect(result.commercialItems).toEqual([{ variantId, sku: "OWN-KIT", quantity: 1, unitPriceInCents: 4345, unit: "UN" }]);
    expect(result.fiscalItems.map(i => i.unitPriceInCents)).toEqual([2173, 2172]);
    expect(result.fiscalItems.every(i => i.unit === "PR" && i.sourceCommercialSku === "OWN-KIT")).toBe(true);
    expect(data).toEqual(before);
    expect(result).toMatchObject({ purpose: "resale", finalConsumer: false, canPurchase: false, taxes: null,
      shippingInCents: null, grandTotalInCents: null, icmsTaxpayer: false });
  });
  it.each([undefined, false, true])("never approves resale and never infers taxpayer status (%s)", declaration => {
    const result = previewRepresentativeResale(context(), declaration);
    expect(result.canPurchase).toBe(false);
    expect(result.icmsTaxpayer).toBe(declaration ?? null);
    expect(result.blockers.includes("recipient_taxpayer_declaration_required")).toBe(declaration === undefined);
    expect(result.blockers).toContain("resale_homologation_required");
    expect(result.blockers).toContain("resale_fiscal_validation_required");
  });
  it("preserves odd totals across repeated commercial kits and fiscal pairs", () => {
    const data = context(); data.items[0]!.quantity = 3;
    const result = previewRepresentativeResale(data);
    expect(result.commercialItems.reduce((s, i) => s + i.quantity * i.unitPriceInCents, 0)).toBe(4345);
    expect(result.fiscalItems.reduce((s, i) => s + i.quantity * i.unitPriceInCents, 0)).toBe(4345);
    expect(result.fiscalItems.reduce((s, i) => s + i.quantity, 0)).toBe(6);
  });
  it("requires explicit allocation across distinct SKUs, then applies only supplied weights", () => {
    const data = context(); data.items.push({ ...item(), variantId: "a0200000-0000-4000-8000-000000000002", sku: "SECOND-KIT" });
    expect(previewRepresentativeResale(data).blockers).toContain("commercial_allocation_required");
    expect(previewRepresentativeResale(data).fiscalItems).toEqual([]);
    data.items[0]!.allocationWeight = 1; data.items[1]!.allocationWeight = 2;
    const result = previewRepresentativeResale(data);
    expect(result.commercialItems.map(i => i.unitPriceInCents)).toEqual([1448, 2897]);
    expect(result.fiscalItems.reduce((s, i) => s + i.quantity * i.unitPriceInCents, 0)).toBe(4345);
  });
  it.each(["missing", "stale"])("rejects %s fiscal composition without guessing pairs", mode => {
    const data = context();
    if (mode === "missing") data.items[0]!.composition = [];
    else data.items[0]!.composition[0]!.source_current = false;
    const result = previewRepresentativeResale(data);
    expect(result.blockers).toContain("kit_fiscal_composition_required"); expect(result.fiscalItems).toEqual([]);
  });
  it("checks commercial stock alone and rejects missing metadata or empty offers", () => {
    const data = context(); data.items[0]!.available = 0; data.items[0]!.active = false;
    expect(previewRepresentativeResale(data).blockers).toEqual(expect.arrayContaining(["commercial_stock_unavailable", "commercial_variant_unavailable"]));
    expect(previewRepresentativeResale({ ...data, items: [{ ...item(), metadata: null }] }).blockers).toContain("product_fiscal_data_required");
    expect(previewRepresentativeResale({ ...data, items: [] }).blockers).toContain("commercial_composition_required");
  });
  it("fails closed on duplicate variants, invalid totals and malformed quantities", () => {
    const data = context();
    expect(() => previewRepresentativeResale({ ...data, items: [item(), item()] })).toThrow("duplicate_commercial_variant");
    expect(() => previewRepresentativeResale({ ...data, merchandiseTotalInCents: 1.5 })).toThrow();
    expect(() => previewRepresentativeResale({ ...data, items: [{ ...item(), quantity: -1 }] })).toThrow();
  });
  it("does not treat legacy individual-pair components as an own-stock kit", () => {
    const data = context(); data.items[0]!.metadata.pairs_per_sku = 1;
    const result = previewRepresentativeResale(data);
    expect(result.blockers).toContain("commercial_kit_mapping_required");
    expect(result.fiscalItems).toEqual([]); expect(result.commercialItems).toEqual([]);
  });
});
