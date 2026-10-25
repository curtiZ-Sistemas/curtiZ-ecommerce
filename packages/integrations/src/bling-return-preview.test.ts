import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { buildBlingReturnFiscalMirror } from "./bling-fiscal-preview";
const rule = { scenario: "return_in_state", issuer_state: "MG", cfop: "1202", csosn: "102", icms_rate: 0,
  document_model: 55, series: 3, external_nature_id: null, pis_cst: "98", cofins_cst: "98", ipi_cst: "49",
  pis_rate: 0, cofins_rate: 0, ipi_rate: 0, ipi_cenq: "999" };
const original = { invoiceKey: "1".repeat(44), shippingInCents: 2449, discountInCents: 0, additionalInCents: 0,
  items: [2173, 2172, 2390].map((unitPriceInCents, i) => ({ sku: `SYNTHETIC-${i}`, description: "Synthetic fiscal pair",
    unit: "PR", quantity: 1, unitPriceInCents, pairsPerSku: 1, fiscalUnitApproved: true, ncm: "64022000", origin: 0, cest: "" })),
  itemAllocationsInCents: [2449, 0, 0].map(shippingInCents => ({ shippingInCents, discountInCents: 0, additionalInCents: 0 })) };
describe("total and partial entry previews linked to original fiscal lines", () => {
  it("preserves the total, original reference, entry tax codes and series", () => {
    const result = buildBlingReturnFiscalMirror(rule, original, [0, 1, 2].map(originalLine => ({ originalLine, quantity: 1 })));
    expect(result).toMatchObject({ returnKind: "total", totalInCents: 9184, originalInvoiceKey: original.invoiceKey,
      transmittable: false, consumesInvoiceNumber: false, rule: { series: 3 }, taxConfiguration: { pisCst: "98", cofinsCst: "98", ipiCst: "49" } });
  });
  it("preserves a returned pair's original cents and requires explicit partial allocations", () => {
    const lines = [{ originalLine: 1, quantity: 1 }];
    expect(() => buildBlingReturnFiscalMirror(rule, original, lines)).toThrow("partial_return_allocation_required");
    const result = buildBlingReturnFiscalMirror(rule, original, lines, { shippingInCents: 0, discountInCents: 0, additionalInCents: 0 });
    expect(result).toMatchObject({ returnKind: "partial", totalInCents: 2172, originalLines: lines });
    expect(result.items[0]?.sku).toBe("SYNTHETIC-1");
  });
  it("rejects over-returns, unknown lines, duplicate lines, missing keys and excess allocations", () => {
    for (const lines of [[{ originalLine: 0, quantity: 2 }], [{ originalLine: 5, quantity: 1 }]])
      expect(() => buildBlingReturnFiscalMirror(rule, original, lines)).toThrow("return_exceeds_original_items");
    expect(() => buildBlingReturnFiscalMirror(rule, original, [{ originalLine: 0, quantity: 1 }, { originalLine: 0, quantity: 1 }])).toThrow("original_invoice_reference_required");
    expect(() => buildBlingReturnFiscalMirror(rule, { ...original, invoiceKey: "" }, [{ originalLine: 0, quantity: 1 }])).toThrow();
    expect(() => buildBlingReturnFiscalMirror(rule, original, [{ originalLine: 0, quantity: 1 }], { shippingInCents: 2450, discountInCents: 0, additionalInCents: 0 })).toThrow("return_exceeds_original_amounts");
    expect(() => buildBlingReturnFiscalMirror(rule, { ...original, discountInCents: 8000 }, [{ originalLine: 0, quantity: 1 }],
      { shippingInCents: 0, discountInCents: 0, additionalInCents: 0 })).toThrow("return_exceeds_original_amounts");
  });
  const zero = { shippingInCents: 0, discountInCents: 0, additionalInCents: 0 };
  const discounted = { ...original, items: [{ ...original.items[0]!, quantity: 2, unitPriceInCents: 1000 }],
    ...zero, discountInCents: 1000, itemAllocationsInCents: [{ ...zero, discountInCents: 1000 }] };
  const onePair = [{ originalLine: 0, quantity: 1 }];
  it("rejects a partial that omits its original discount share", () => {
    expect(() => buildBlingReturnFiscalMirror(rule, discounted, onePair, zero))
      .toThrow("partial_return_allocation_mismatch");
    expect(buildBlingReturnFiscalMirror(rule, discounted, onePair, { ...zero, discountInCents: 500 }))
      .toMatchObject({ returnKind: "partial", totalInCents: 500, discountInCents: 500, transmittable: false });
  });
  it("requires archived line allocations, without guessing from the global discount", () => {
    const withoutArchive = { ...discounted, itemAllocationsInCents: undefined };
    expect(() => buildBlingReturnFiscalMirror(rule, withoutArchive, onePair, { ...zero, discountInCents: 500 }))
      .toThrow("original_invoice_allocation_required");
    expect(buildBlingReturnFiscalMirror(rule, withoutArchive, [{ originalLine: 0, quantity: 2 }]))
      .toMatchObject({ returnKind: "total", totalInCents: 1000 });
  });
  it("allows an adjustment-free partial without an allocation archive", () => {
    const withoutArchive = { ...discounted, itemAllocationsInCents: undefined };
    expect(buildBlingReturnFiscalMirror(rule, { ...withoutArchive, discountInCents: 0 }, onePair, zero).totalInCents).toBe(1000);
  });
  it("matches freight and additional amounts to the returned lines too", () => {
    const adjusted = { ...discounted, shippingInCents: 200, additionalInCents: 100,
      itemAllocationsInCents: [{ shippingInCents: 200, discountInCents: 1000, additionalInCents: 100 }] };
    const expected = { shippingInCents: 100, discountInCents: 500, additionalInCents: 50 };
    expect(buildBlingReturnFiscalMirror(rule, adjusted, onePair, expected).totalInCents).toBe(650);
    for (const field of ["shippingInCents", "discountInCents", "additionalInCents"] as const)
      expect(() => buildBlingReturnFiscalMirror(rule, adjusted, onePair, { ...expected, [field]: 0 }))
        .toThrow("partial_return_allocation_mismatch");
  });
  it("rejects missing, inconsistent, unsafe and negative original line allocations", () => {
    for (const itemAllocationsInCents of [[], [{ ...zero, discountInCents: 999 }],
      [{ ...zero, discountInCents: -1 }], [{ ...zero, discountInCents: 0.5 }],
      [{ ...zero, discountInCents: Number.MAX_SAFE_INTEGER + 1 }]])
      expect(() => buildBlingReturnFiscalMirror(rule, { ...discounted, itemAllocationsInCents }, onePair, zero))
        .toThrow("original_invoice_allocation_required");
  });
  it("uses the archived per-line discount rather than a new global redistribution", () => {
    const unequal = { ...discounted, items: [discounted.items[0]!, { ...discounted.items[0]!, sku: "SECOND" }],
      itemAllocationsInCents: [{ ...zero, discountInCents: 1000 }, zero] };
    const result = buildBlingReturnFiscalMirror(rule, unequal, [{ originalLine: 1, quantity: 1 }], zero);
    expect(result.totalInCents).toBe(1000);
  });
  it("blocks subcent partial allocations until the original unit split is reviewed", () => {
    const odd = { ...discounted, discountInCents: 1001, itemAllocationsInCents: [{ ...zero, discountInCents: 1001 }] };
    for (const discountInCents of [500, 501])
      expect(() => buildBlingReturnFiscalMirror(rule, odd, onePair, { ...zero, discountInCents }))
        .toThrow("partial_return_rounding_review_required");
    expect(buildBlingReturnFiscalMirror(rule, odd, [{ originalLine: 0, quantity: 2 }]).totalInCents).toBe(999);
  });
});
