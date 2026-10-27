import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { blingFiscalMirrorHash, buildBlingFiscalMirror, selectBlingFiscalRule } from "./bling-fiscal-preview";

const tax = { pis_cst: "49", cofins_cst: "49", ipi_cst: "99", pis_rate: 0, cofins_rate: 0, ipi_rate: 0, ipi_cenq: "999" };
const period = { application_month: "2026-10-01", reference_month: "2026-09-01", rate: 1.25, revision: 1,
  evidence_reference: "Synthetic isolated accounting fixture", approved_by: "10000000-0000-4000-8000-000000000001", approved_at: "2026-10-01T12:00:00Z" };
const rules = ["in_state", "interstate"].flatMap(region => [false, true].map(credit => ({
  ...tax, scenario: `resale_${region}_${credit ? "credit" : "no_credit"}`, issuer_state: "MG",
  cfop: region === "in_state" ? "5102" : "6102", csosn: credit ? "101" : "102", icms_rate: 0,
  document_model: 55, series: 2, icms_credit_rate: credit ? 1.25 : null,
  credit_periods: credit ? [period] : [],
  natures: [{ final_consumer: false, external_nature_id: credit ? 102 : 101 }]
})));
const recipient = { destinationState: "SP", operation: "sale" as const, finalConsumer: false,
  icmsTaxpayer: false, recipientIsCompany: false };
const pair = { sku: "TEST-PAIR", description: "Synthetic pair", unit: "PR", pairsPerSku: 1,
  fiscalUnitApproved: true, quantity: 1, unitPriceInCents: 2173, ncm: "64022000", origin: 0, cest: "" };

describe("accountant resale and individual return policy", () => {
  it.each(["MG", "SP"])("uses resale CFOP for non-contributors in %s without B2C fallback", destinationState => {
    const rule = selectBlingFiscalRule(rules, { ...recipient, destinationState });
    expect(rule).toMatchObject({ cfop: destinationState === "MG" ? "5102" : "6102", csosn: "102", icms_rate: 0 });
    expect(() => selectBlingFiscalRule([], { ...recipient, destinationState })).toThrow("fiscal_rules_required");
    expect(buildBlingFiscalMirror(rule, [pair])).toMatchObject({ transmittable: false, consumesInvoiceNumber: false, internetPresence: 2 });
  });
  it("requires an explicit credit classification for contributors; company status alone is insufficient", () => {
    expect(() => selectBlingFiscalRule(rules, { ...recipient, icmsTaxpayer: true, recipientIsCompany: true }))
      .toThrow("fiscal_credit_eligibility_required");
    expect(selectBlingFiscalRule(rules, { ...recipient, icmsTaxpayer: true, creditEligible: false }).csosn).toBe("102");
    expect(() => selectBlingFiscalRule(rules, { ...recipient, creditEligible: true })).toThrow("fiscal_credit_recipient_required");
    expect(() => selectBlingFiscalRule(rules, { ...recipient, icmsTaxpayer: true, creditEligible: true }))
      .toThrow("fiscal_credit_recipient_required");
  });
  it("selects 101 only with company, contributor, eligibility and an explicit credit rate", () => {
    const input = { ...recipient, icmsTaxpayer: true, recipientIsCompany: true, creditEligible: true,
      saleDate: "2026-10-24", stateRegistrationActive: true, recipientTaxRegime: "normal" as const, goodsPurpose: "resale" as const };
    expect(selectBlingFiscalRule(rules, input)).toMatchObject({ csosn: "101", icms_credit_rate: 1.25 });
    expect(selectBlingFiscalRule(rules.map(rule => ({ ...rule, icms_credit_rate: null })), input))
      .toMatchObject({ csosn: "101", icms_credit_rate: 1.25, monthlyCredit: { revision: 1 } });
    for (const rate of [0, null, undefined, "", " ", false, -1, 101, 0.12345])
      expect(() => selectBlingFiscalRule(rules.map(rule => ({ ...rule, credit_periods: [{ ...period, rate }] })), input))
        .toThrow("fiscal_monthly_credit_required");
    expect(() => selectBlingFiscalRule(rules.map(rule => ({ ...rule, credit_periods: [] })), input)).toThrow("fiscal_monthly_credit_required");
    expect(() => selectBlingFiscalRule(rules, { ...input, saleDate: "2026-11-01" })).toThrow("fiscal_monthly_credit_required");
    for (const change of [{ stateRegistrationActive: false }, { recipientTaxRegime: "simples" as const }, { goodsPurpose: "other" as const }])
      expect(() => selectBlingFiscalRule(rules, { ...input, ...change })).toThrow("fiscal_credit_recipient_required");
  });
  it("binds credit parameters to mirror approval hashes", async () => {
    const input = { ...recipient, icmsTaxpayer: true, recipientIsCompany: true, creditEligible: true,
      saleDate: "2026-10-24", stateRegistrationActive: true, recipientTaxRegime: "normal" as const, goodsPurpose: "resale" as const };
    const first = buildBlingFiscalMirror(selectBlingFiscalRule(rules, input), [pair]);
    const changed = buildBlingFiscalMirror(selectBlingFiscalRule(rules.map(rule => ({ ...rule, credit_periods: [{ ...period, rate: 2, revision: 2 }] })), input), [pair]);
    expect(await blingFiscalMirrorHash(first)).not.toBe(await blingFiscalMirrorHash(changed));
    expect(first.blockers).toContain("accountant_mirror_approval_required");
  });
  it("rejects an interstate B2C CFOP, nonzero main taxes and wrong pair classification for resale", () => {
    expect(() => selectBlingFiscalRule(rules.map(rule => ({ ...rule, cfop: "6108" })), recipient))
      .toThrow("resale_fiscal_parameters_required");
    expect(() => selectBlingFiscalRule(rules.map(rule => ({ ...rule, pis_rate: 1 })), recipient))
      .toThrow("resale_fiscal_parameters_required");
    const rule = selectBlingFiscalRule(rules, recipient);
    expect(buildBlingFiscalMirror(rule, [{ ...pair, ncm: "00000000" }]).blockers).toContain("resale_pair_classification_required");
    expect(buildBlingFiscalMirror(rule, [{ ...pair, origin: 1 }]).blockers).toContain("resale_pair_classification_required");
  });
  it("keeps channel classification and reviewed credit bases explicit", () => {
    const input = { ...recipient, icmsTaxpayer: true, recipientIsCompany: true, creditEligible: true,
      saleDate: "2026-10-24", stateRegistrationActive: true, recipientTaxRegime: "normal" as const, goodsPurpose: "resale" as const };
    const rule = selectBlingFiscalRule(rules, input);
    expect(buildBlingFiscalMirror(rule, [pair]).blockers).toContain("fiscal_credit_base_required");
    const mirror = buildBlingFiscalMirror(rule, [pair], { channel: "other_non_presential", icmsCreditBasesInCents: [2173] });
    expect(mirror.internetPresence).toBe(9);
    expect(mirror.icmsCredit?.totalInCents).toBe(27);
    expect(mirror.transmittable).toBe(false);
    expect(mirror.blockers).toContain("accountant_mirror_approval_required");
    expect(mirror.blockers).toContain("fiscal_credit_recipient_evidence_required");
    expect(mirror.blockers).toContain("fiscal_credit_operation_date_evidence_required");
  });
  it("does not apply credit-specific evidence blockers to resale without credit", () => {
    const mirror = buildBlingFiscalMirror(selectBlingFiscalRule(rules, recipient), [pair]);
    expect(mirror.rule.csosn).toBe("102");
    expect(mirror.blockers).not.toContain("fiscal_credit_recipient_evidence_required");
    expect(mirror.blockers).not.toContain("fiscal_credit_operation_date_evidence_required");
  });
  it("does not extend the approved PF return treatment to company or undeclared recipients", () => {
    const entry = { ...tax, scenario: "return_interstate", issuer_state: "MG", cfop: "2202", csosn: "102",
      icms_rate: 0, document_model: 55, series: 3, ipi_cst: "49", pis_cst: "98", cofins_cst: "98", natures: [] };
    const input = { ...recipient, operation: "return" as const, finalConsumer: true };
    const rule = selectBlingFiscalRule([entry], input);
    expect(buildBlingFiscalMirror(rule, [pair], { originalInvoiceKey: "1".repeat(44) }).blockers)
      .not.toContain("return_entry_tax_treatment_required");
    for (const change of [{ recipientIsCompany: true }, { recipientIsCompany: undefined }, { finalConsumer: false }, { icmsTaxpayer: true }])
      expect(() => selectBlingFiscalRule([entry], { ...input, ...change })).toThrow("return_recipient_policy_required");
  });
});

