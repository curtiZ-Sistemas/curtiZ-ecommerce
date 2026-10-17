import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { blingFiscalMirrorHash, buildBlingFiscalMirror, buildBlingOrderFiscalMirror, selectBlingFiscalRule } from "./bling-fiscal-preview";

const rules = [
  ["sale_in_state", "5102", 2], ["sale_interstate_taxpayer", "6102", 2], ["sale_interstate_non_taxpayer", "6108", 2],
  ["return_in_state", "1202", 3], ["return_interstate", "2202", 3]
].map(([scenario, cfop, series]) => ({ scenario, cfop, series, issuer_state: "MG", csosn: "102", icms_rate: 0, document_model: 55, external_nature_id: null }));
const item = () => ({ sku: "SKU-37", description: "Test pair", unit: "PR", quantity: 1, unitPriceInCents: 2390,
  pairsPerSku: 1, fiscalUnitApproved: true, ncm: "64022000", origin: 0, cest: "" });
describe("private fiscal scenarios and unnumbered mirrors", () => {
  it("selects the nature independently from the ICMS taxpayer classification", () => {
    const configured = rules.map((rule) => ({ ...rule, external_nature_id: 999,
      natures: [{ final_consumer: true, external_nature_id: 101 }, { final_consumer: false, external_nature_id: 102 }] }));
    const input = { destinationState: "SP", icmsTaxpayer: true, operation: "sale" as const };
    expect(selectBlingFiscalRule(configured, { ...input, finalConsumer: true })).toMatchObject({ cfop: "6102", external_nature_id: 101 });
    expect(selectBlingFiscalRule(configured, { ...input, finalConsumer: false })).toMatchObject({ cfop: "6102", external_nature_id: 102 });
    expect(selectBlingFiscalRule(configured, input).external_nature_id).toBeNull();
    expect(selectBlingFiscalRule(rules.map((rule) => ({ ...rule, external_nature_id: 999 })), { ...input, finalConsumer: true }).external_nature_id).toBeNull();
    expect(() => selectBlingFiscalRule(configured.map((r) => ({ ...r, natures: [r.natures[0], r.natures[0]] })),
      { ...input, finalConsumer: true })).toThrow("fiscal_rules_required");
  });
  it("hashes equivalent JSON consistently regardless of property insertion order", async () => {
    expect(await blingFiscalMirrorHash({ a: 1, b: { c: 2, d: 3 } })).toBe(await blingFiscalMirrorHash({ b: { d: 3, c: 2 }, a: 1 }));
  });
  it.each([
    ["MG", false, "sale", "5102", 2], ["MG", true, "sale", "5102", 2], ["SP", false, "sale", "6108", 2],
    ["SP", true, "sale", "6102", 2], ["MG", false, "return", "1202", 3], ["SP", false, "return", "2202", 3]
  ] as const)("selects %s / taxpayer %s / %s without arbitrary fallback", (destinationState, icmsTaxpayer, operation, cfop, series) => {
    expect(selectBlingFiscalRule(rules, { destinationState, icmsTaxpayer, operation })).toMatchObject({ cfop, series });
  });
  it("rejects missing rules, duplicate scenarios and unknown recipient state", () => {
    const input = { destinationState: "SP", icmsTaxpayer: false, operation: "sale" as const };
    expect(() => selectBlingFiscalRule([], input)).toThrow("fiscal_rules_required");
    expect(() => selectBlingFiscalRule([...rules, rules[2]], input)).toThrow("fiscal_rules_required");
    expect(() => selectBlingFiscalRule(rules, { ...input, destinationState: "??" })).toThrow("fiscal_recipient_required");
  });
  it("makes a preview without provider calls, invoice numbering or transmission", () => {
    const mirror = buildBlingFiscalMirror(selectBlingFiscalRule(rules, { destinationState: "MG", icmsTaxpayer: false, operation: "sale" }), [item()]);
    expect(mirror).toMatchObject({ number: null, transmittable: false, consumesInvoiceNumber: false, totalInCents: 2390, internetPresence: 2 });
    expect(mirror.blockers).toContain("nature_configuration_required");
  });
  it("preserves kit quantity and price and requires explicit kit fiscal approval", () => {
    const mirror = buildBlingFiscalMirror(selectBlingFiscalRule(rules, { destinationState: "SP", icmsTaxpayer: false, operation: "sale" }),
      [{ ...item(), unit: "UN", pairsPerSku: 3, unitPriceInCents: 5594, fiscalUnitApproved: false }]);
    expect(mirror.totalInCents).toBe(5594);
    expect(mirror.items[0]?.quantity).toBe(1);
    expect(mirror.blockers).toContain("kit_fiscal_unit_confirmation_required");
  });
  it("requires the original invoice reference for returns", () => {
    const rule = selectBlingFiscalRule(rules, { destinationState: "SP", icmsTaxpayer: false, operation: "return" });
    expect(buildBlingFiscalMirror(rule, [item()]).blockers).toContain("original_invoice_key_required");
    expect(buildBlingFiscalMirror(rule, [item()], { originalInvoiceKey: "1".repeat(44) }).blockers).not.toContain("original_invoice_key_required");
    expect(buildBlingFiscalMirror({ ...rule, ipi_cst: "99" }, [item()], { originalInvoiceKey: "1".repeat(44) }).blockers)
      .toContain("return_entry_tax_treatment_required");
  });
  it("binds order approval to immutable prices, recipient, freight and fiscal metadata", async () => {
    const input = { rules, order: { id: "order-test", customer_id: "customer-test", customer_name_snapshot: "Fictitious buyer", cpf_ciphertext: "test-ciphertext",
      shipping_address_snapshot: { state: "SP", city: "Test" }, shipping_total: 16.9, discount_total: 1, grand_total: 39.8 },
    items: [{ variant_id: "variant-test", sku_snapshot: "SKU-37", product_name_snapshot: "Test pair", quantity: 1, unit_price: 23.9 }],
    snapshots: [{ variant: { id: "variant-test", sku: "SKU-37" }, metadata: { commercial_unit: "PR", pairs_per_sku: 1, fiscal_unit_approved: true, ncm: "64022000", origin: 0, cest: "" } }],
    icmsTaxpayer: false, finalConsumer: true };
    const original = await buildBlingOrderFiscalMirror(input), hash = await blingFiscalMirrorHash(original);
    expect(original.totalInCents).toBe(3980);
    expect(JSON.stringify(original)).not.toContain("test-ciphertext");
    const changed = await buildBlingOrderFiscalMirror({ ...input, order: { ...input.order, customer_name_snapshot: "Another fictitious buyer" } });
    expect(await blingFiscalMirrorHash(changed)).not.toBe(hash);
    await expect(buildBlingOrderFiscalMirror({ ...input, order: { ...input.order, grand_total: 1 } })).rejects.toThrow("fiscal_total_mismatch");
  });
  it("binds the mirror to actual kit components, individual taxes, freight and discount", async () => {
    const input = { rules: rules.map(r => ({ ...r, pis_cst: "49", cofins_cst: "49", ipi_cst: "99" })),
      order: { id: "order", shipping_address_snapshot: { state: "MG" }, grand_total: 58.94, shipping_total: 5, discount_total: 2 },
      items: [{ variant_id: "kit", sku_snapshot: "KIT", product_name_snapshot: "Actual kit", quantity: 1, unit_price: 55.94 }],
      snapshots: [{ variant: { id: "kit", sku: "KIT" }, metadata: { commercial_unit: "UN", pairs_per_sku: 3,
        fiscal_unit_approved: false, ncm: "64022000", origin: 0, cest: "" }, kit_components: [1, 2, 3].map(i => ({
          sku: `PAIR-${i}`, description: `Actual pair ${i}`, unit: "PR", quantity_pairs: 1, allocation_weight: 1,
          source_current: true, ncm: "64022000", origin: 0, cest: "" })) }], icmsTaxpayer: false, finalConsumer: true };
    const mirror = await buildBlingOrderFiscalMirror(input);
    expect(mirror.totalInCents).toBe(5894);
    expect(mirror.items.map(i => i.unit)).toEqual(["PR", "PR", "PR"]);
    expect(mirror.rule).toMatchObject({ pis_cst: "49", cofins_cst: "49", ipi_cst: "99" });
    expect(mirror.blockers).not.toContain("kit_fiscal_unit_confirmation_required");
    expect(mirror.blockers).not.toContain("fiscal_tax_codes_required");
    const changed = structuredClone(input); changed.snapshots[0]!.kit_components[0]!.ncm = "12345678";
    expect(await blingFiscalMirrorHash(await buildBlingOrderFiscalMirror(changed))).not.toBe(await blingFiscalMirrorHash(mirror));
  });
});
