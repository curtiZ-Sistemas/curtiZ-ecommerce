import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { buildBlingReturnFiscalMirror } from "./bling-fiscal-preview";
const rule = { scenario: "return_in_state", issuer_state: "MG", cfop: "1202", csosn: "102", icms_rate: 0,
  document_model: 55, series: 3, external_nature_id: null, pis_cst: "98", cofins_cst: "98", ipi_cst: "49",
  pis_rate: 0, cofins_rate: 0, ipi_rate: 0, ipi_cenq: "999" };
const original = { invoiceKey: "1".repeat(44), shippingInCents: 2449, discountInCents: 0, additionalInCents: 0,
  items: [2173, 2172, 2390].map((unitPriceInCents, i) => ({ sku: `SYNTHETIC-${i}`, description: "Synthetic fiscal pair",
    unit: "PR", quantity: 1, unitPriceInCents, pairsPerSku: 1, fiscalUnitApproved: true, ncm: "64022000", origin: 0, cest: "" })) };
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
});
