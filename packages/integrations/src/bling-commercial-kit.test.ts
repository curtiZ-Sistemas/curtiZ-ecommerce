import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { BlingError } from "./bling";
import { commercialKitFiscalMirror } from "./bling-commercial-kit";

const grade = [1, 2, 3, 3, 2, 1].map((pairs, index) => ({
  variantId: `variant-${index}`, productId: "product", sku: `sku-${index}`, name: "Tênis", size: String(34 + index), pairs, priceCents: 4_999
}));
const rule = { scenario: "resale_in_state_no_credit", issuer_state: "MG", series: 3, document_model: 55, cfop: "5102", csosn: "102",
  icms_rate: 0, pis_cst: "49", cofins_cst: "49", ipi_cst: "99", ipi_cenq: "999", pis_rate: 0, cofins_rate: 0, ipi_rate: 0,
  natures: [{ final_consumer: false, external_nature_id: 123 }] };
const job = (overrides: Record<string, unknown> = {}) => ({
  gradeLines: grade, quantity: 2, unitPriceInCents: 36_001, shippingInCents: 0, amountInCents: 72_002, buyerProfile: "MG02",
  fiscalParameters: { issuerDocument: "12345678000195", classification: "third_party_no_st", creditEligible: false, blingRule: rule },
  ...overrides
});
const catalog = async (variantId: string) => ({
  variant: { sku: `sku-${variantId.split("-")[1]}` },
  metadata: { production_type: "T", fiscal_unit_approved: true, pairs_per_sku: 1, commercial_unit: "PR", ncm: "64022000", origin: 0, cest: "" }
});

describe("fiscal mirror of a kit sheet sold to a company in MG", () => {
  it("builds CFOP 5102, CSOSN 102, series 3 and the approved nature with the exact total", async () => {
    const result = await commercialKitFiscalMirror(catalog, job(), "2026-11-24");
    expect(result.rule).toMatchObject({ cfop: "5102", csosn: "102", series: 3, external_nature_id: 123 });
    expect(result.natureId).toBe(123);
    expect(result.mirror.totalInCents).toBe(72_002);
    expect(result.commercial.reduce((sum, line) => sum + line.quantity, 0)).toBe(24);
    expect(result.mirror.items.every(item => item.unit === "PR" && item.ncm === "64022000")).toBe(true);
  });

  it("refuses a total that differs from the sold amount, freight in series 3 and unapproved catalog data", async () => {
    await expect(commercialKitFiscalMirror(catalog, job({ amountInCents: 72_003 }), "2026-11-24")).rejects.toBeInstanceOf(BlingError);
    await expect(commercialKitFiscalMirror(catalog, job({ shippingInCents: 100, amountInCents: 72_102 }), "2026-11-24")).rejects.toBeInstanceOf(BlingError);
    const unapproved = async (id: string) => ({ ...await catalog(id), metadata: { production_type: "T", fiscal_unit_approved: false, pairs_per_sku: 1, commercial_unit: "PR" } });
    await expect(commercialKitFiscalMirror(unapproved, job(), "2026-11-24")).rejects.toBeInstanceOf(BlingError);
  });
});
