import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { buildBlingArchivedReturnMirror, type BlingReturnOrderLine } from "./bling-return-context";
import { readBlingReturnOriginalXml } from "./bling-return-xml";
import { returnTestKey as key, returnTestXml } from "./bling-return-test-fixture";

const rules = [{ scenario: "return_interstate", issuer_state: "MG", cfop: "2202", csosn: "102", icms_rate: 0,
  document_model: 55, series: 3, external_nature_id: null, pis_cst: "98", cofins_cst: "98", ipi_cst: "49",
  pis_rate: 0, cofins_rate: 0, ipi_rate: 0, ipi_cenq: "999" }];
const line: BlingReturnOrderLine = { id: "test-line", variantId: "test-variant", sku: "TEST-PAIR", quantity: 2,
  unitPriceInCents: 1000, requestedQuantity: 1, otherReturnsQuantity: 1 };
const totals = { totalInCents: 1200, shippingInCents: 200, discountInCents: 1000, additionalInCents: 0 };
const original = () => readBlingReturnOriginalXml(returnTestXml(), key);

describe("archived return mirror with canonical cumulative quantities", () => {
  it("returns the original net share, reserving completed and open earlier requests", () => {
    const mirror = buildBlingArchivedReturnMirror(rules, original(), [line], totals);
    expect(mirror).toMatchObject({ totalInCents: 600, shippingInCents: 100, discountInCents: 500,
      originalInvoiceKey: key, returnKind: "partial", transmittable: false, consumesInvoiceNumber: false,
      taxConfiguration: { pisCst: "98", cofinsCst: "98", ipiCst: "49" }, rule: { series: 3, cfop: "2202" },
      balance: [{ originalLine: 0, originalQuantity: 2, requestedQuantity: 1, otherReturnsQuantity: 1, remainingQuantity: 0 }] });
  });
  it("keeps full returns identical to the authorized original", () => {
    expect(buildBlingArchivedReturnMirror(rules, original(), [{ ...line, requestedQuantity: 2, otherReturnsQuantity: 0 }], totals))
      .toMatchObject({ returnKind: "total", totalInCents: 1200, balance: [{ remainingQuantity: 0 }] });
  });
  it.each([
    { requestedQuantity: 2 }, { otherReturnsQuantity: 2 }, { requestedQuantity: 0 },
    { otherReturnsQuantity: -1 }, { quantity: 0 }, { otherReturnsQuantity: 0.5 }, { unitPriceInCents: 2000 }, { sku: "CURRENT-CATALOG-SKU" }
  ])("rejects excess or mismatched original context %j", patch => {
    expect(() => buildBlingArchivedReturnMirror(rules, original(), [{ ...line, ...patch }], totals)).toThrow();
  });
  it("rejects a source line without a unique original order association", () => {
    expect(() => buildBlingArchivedReturnMirror(rules, original(), [line, { ...line, id: "duplicate-sku" }], totals)).toThrow();
    expect(() => buildBlingArchivedReturnMirror(rules, original(), [line, line], totals)).toThrow();
    expect(() => buildBlingArchivedReturnMirror(rules, original(), [line, { ...line, id: "missing", sku: "MISSING" }], totals)).toThrow();
  });
  it("never guesses a subcent allocation", () => {
    const prior = original(); prior.shippingInCents = 1; prior.totalInCents = 1001;
    prior.itemAllocationsInCents[0]!.shippingInCents = 1;
    expect(() => buildBlingArchivedReturnMirror(rules, prior, [line], { ...totals, totalInCents: 1001, shippingInCents: 1 }))
      .toThrow("partial_return_rounding_review_required");
  });
  it("uses the archived kit links and prices without current composition", () => {
    const prior = original(); const item = prior.items[0]!;
    prior.items = [{ ...item, sku: "TEST-COMPONENT-A", quantity: 1, sourceCommercialSku: "TEST-KIT" },
      { ...item, sku: "TEST-COMPONENT-B", quantity: 1, sourceCommercialSku: "TEST-KIT" }];
    prior.itemAllocationsInCents = [0, 1].map(() => ({ shippingInCents: 100, discountInCents: 500, additionalInCents: 0 }));
    expect(buildBlingArchivedReturnMirror(rules, prior,
      [{ ...line, sku: "TEST-KIT", quantity: 1, unitPriceInCents: 2000, requestedQuantity: 1, otherReturnsQuantity: 0 }], totals))
      .toMatchObject({ totalInCents: 1200, returnKind: "total", items: [{ sku: "TEST-COMPONENT-A" }, { sku: "TEST-COMPONENT-B" }] });
  });
  it("blocks original totals inconsistent with the order snapshot", () => {
    expect(() => buildBlingArchivedReturnMirror(rules, original(), [line], { ...totals, totalInCents: 1201 })).toThrow();
  });
});
