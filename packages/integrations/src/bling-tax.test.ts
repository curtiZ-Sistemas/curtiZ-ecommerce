import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { buildBlingTaxXml, readBlingTaxConfiguration } from "./bling-tax";
import { blingFiscalMirrorHash, buildBlingFiscalMirror, selectBlingFiscalRule } from "./bling-fiscal-preview";
const taxes = { pis_cst: "49", cofins_cst: "49", ipi_cst: "99", pis_rate: 0, cofins_rate: 0, ipi_rate: 0, ipi_cenq: "999" };
const bases = { pisInCents: 4337, cofinsInCents: 4337, ipiInCents: 4337 };
describe("explicit fiscal tax configuration and XML groups", () => {
  it("preserves nonzero bases with zero tax rates and the approved cEnq", () => {
    const result = buildBlingTaxXml(taxes, bases);
    expect(result).toMatchObject({ consumesInvoiceNumber: false, transmittable: false, bases, amountsInCents: { pis: 0, cofins: 0, ipi: 0 } });
    expect(result.xml).toBe('<imposto><IPI><cEnq>999</cEnq><IPITrib><CST>99</CST><vBC>43.37</vBC><pIPI>0.0000</pIPI><vIPI>0.00</vIPI></IPITrib></IPI><PIS><PISOutr><CST>49</CST><vBC>43.37</vBC><pPIS>0.0000</pPIS><vPIS>0.00</vPIS></PISOutr></PIS><COFINS><COFINSOutr><CST>49</CST><vBC>43.37</vBC><pCOFINS>0.0000</pCOFINS><vCOFINS>0.00</vCOFINS></COFINSOutr></COFINS></imposto>');
  });
  it.each(['pis_rate', 'cofins_rate', 'ipi_rate', 'ipi_cenq'] as const)("never defaults missing %s to an approved value", key => {
    expect(() => readBlingTaxConfiguration({ ...taxes, [key]: null })).toThrow("fiscal_tax_parameters_required");
  });
  it.each([NaN, Infinity, -1, 101, 0.12345])("rejects invalid rate %s", rate => {
    expect(() => readBlingTaxConfiguration({ ...taxes, pis_rate: rate })).toThrow();
  });
  it.each(["", "000", "99", "999</cEnq>"])("rejects invalid or injected cEnq %s", ipi_cenq => {
    expect(() => readBlingTaxConfiguration({ ...taxes, ipi_cenq })).toThrow();
  });
  it.each([NaN, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])("rejects missing/unsafe calculation base %s", ipiInCents => {
    expect(() => buildBlingTaxXml(taxes, { ...bases, ipiInCents })).toThrow("fiscal_tax_base_required");
  });
  it("uses exact integer rounding, not a floating point monetary total", () => {
    expect(buildBlingTaxXml({ ...taxes, pis_rate: 0.07 }, { ...bases, pisInCents: 10000 }).amountsInCents.pis).toBe(7);
    expect(buildBlingTaxXml({ ...taxes, pis_rate: 50 }, { ...bases, pisInCents: 1 }).amountsInCents.pis).toBe(1);
  });
  it.each([null, "", " ", false])("does not normalize absent/malformed stored rate %s into zero", pis_rate => {
    const rule = selectBlingFiscalRule([{ ...taxes, pis_rate, scenario: "sale_in_state", issuer_state: "MG", cfop: "5102",
      csosn: "102", icms_rate: 0, document_model: 55, series: 2 }], { destinationState: "MG", icmsTaxpayer: false, operation: "sale" });
    expect(() => readBlingTaxConfiguration(rule)).toThrow("fiscal_tax_parameters_required");
  });
  it("invalidates mirror hashes when a rate or cEnq changes, and blocks missing parameters", async () => {
    const rule = { ...taxes, scenario: "sale_in_state", issuer_state: "MG", cfop: "5102", csosn: "102", icms_rate: 0, document_model: 55, series: 2, external_nature_id: 10 };
    const items = [{ sku: "PAIR", description: "Test pair", unit: "PR", pairsPerSku: 1, fiscalUnitApproved: true, quantity: 1, unitPriceInCents: 4337, ncm: "64022000", origin: 0, cest: "" }];
    const mirror = buildBlingFiscalMirror(rule, items);
    expect(mirror.taxConfiguration).toMatchObject({ pisRate: 0, ipiCenq: "999" });
    expect(mirror.blockers).not.toContain("fiscal_tax_parameters_required");
    expect(buildBlingFiscalMirror({ ...rule, ipi_cenq: null }, items).blockers).toContain("fiscal_tax_parameters_required");
    expect(await blingFiscalMirrorHash(buildBlingFiscalMirror({ ...rule, pis_rate: 1 }, items))).not.toBe(await blingFiscalMirrorHash(mirror));
    expect(await blingFiscalMirrorHash(buildBlingFiscalMirror({ ...rule, ipi_cenq: "101" }, items))).not.toBe(await blingFiscalMirrorHash(mirror));
  });
});
