import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { blingFiscalMirrorHash, buildBlingFiscalMirror, type BlingFiscalRule } from "./bling-fiscal-preview";

const rule: BlingFiscalRule = { scenario: "resale_in_state_credit", issuer_state: "MG", cfop: "5102", csosn: "101", icms_rate: 0,
  document_model: 55, series: 2, external_nature_id: 123, pis_cst: "49", cofins_cst: "49", ipi_cst: "99",
  pis_rate: 0, cofins_rate: 0, ipi_rate: 0, ipi_cenq: "999",
  monthlyCredit: { applicationMonth: "2026-10-01", referenceMonth: "2026-09-01", rate: 1.36, revision: 1,
    evidenceReference: "Synthetic reviewed fixture", approvedBy: "10000000-0000-4000-8000-000000000001", approvedAt: "2026-10-01T12:00:00Z" } };
const pair = { sku: "TEST-PAIR", description: "Synthetic pair", unit: "PR", pairsPerSku: 1,
  fiscalUnitApproved: true, quantity: 1, unitPriceInCents: 1000, ncm: "64022000", origin: 0, cest: "" };

describe("credit bases remain bounded by represented fiscal values", () => {
  it("rejects credit bases that exceed the gross operation and represented adjustments", () => {
    expect(() => buildBlingFiscalMirror(rule, [pair], { icmsCreditBasesInCents: [1001] }))
      .toThrow("fiscal_credit_base_exceeds_transaction");
    expect(() => buildBlingFiscalMirror(rule, [pair, pair], { shippingInCents: 300, additionalInCents: 200,
      icmsCreditBasesInCents: [1250, 1251] })).toThrow("fiscal_credit_base_exceeds_transaction");
  });
  it("rejects an individual base larger than the item plus all represented adjustments", () => {
    expect(() => buildBlingFiscalMirror(rule, [pair, pair], { shippingInCents: 100,
      icmsCreditBasesInCents: [1101, 0] })).toThrow("fiscal_credit_base_exceeds_transaction");
  });
  it("allows reviewed bases within gross values, freight and additional charges", () => {
    const mirror = buildBlingFiscalMirror(rule, [pair, pair], { shippingInCents: 300, additionalInCents: 200,
      discountInCents: 500, icmsCreditBasesInCents: [1250, 1250] });
    expect(mirror.icmsCredit?.itemsInCents).toEqual([17, 17]);
    expect(mirror.transmittable).toBe(false);
    expect(mirror.blockers).toContain("fiscal_credit_recipient_evidence_required");
  });
  it("continues to reject invalid numeric bases", () => {
    expect(() => buildBlingFiscalMirror(rule, [pair], { icmsCreditBasesInCents: [-1] }))
      .toThrow("fiscal_credit_base_required");
  });
  it("binds the exact item bases to the mirror even when rounding produces the same credit", async () => {
    const bases = [998];
    const first = buildBlingFiscalMirror(rule, [pair], { icmsCreditBasesInCents: bases });
    const second = buildBlingFiscalMirror(rule, [pair], { icmsCreditBasesInCents: [999] });
    expect(first.icmsCredit?.totalInCents).toBe(second.icmsCredit?.totalInCents);
    expect(first.icmsCredit).toMatchObject({ basesInCents: [998] });
    expect(await blingFiscalMirrorHash(first)).not.toBe(await blingFiscalMirrorHash(second));
    bases[0] = 1000;
    expect(first.icmsCredit).toMatchObject({ basesInCents: [998] });
  });
});
