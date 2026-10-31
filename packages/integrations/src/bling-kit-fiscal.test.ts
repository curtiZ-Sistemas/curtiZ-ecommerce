import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { allocateBlingFiscalCents, expandBlingFiscalKit } from "./bling-kit-fiscal";
const item = { sku: "KIT-COMMERCIAL", description: "Commercial kit", unit: "UN", quantity: 1, unitPriceInCents: 5594,
  pairsPerSku: 3, fiscalUnitApproved: false, ncm: "64022000", origin: 0, cest: "" };
const components = () => ["A", "B", "C"].map(sku => ({ sku, description: `Real pair ${sku}`, unit: "PR", quantity_pairs: 1,
  allocation_weight: 1, ncm: "64022000", origin: 0, cest: "", source_current: true }));
describe("fiscal kit decomposition independent from stock", () => {
  it("splits three pairs preserving the exact commercial total and origin", () => {
    const lines = expandBlingFiscalKit(item, components());
    expect(lines.map(l => l.unitPriceInCents)).toEqual([1865, 1865, 1864]);
    expect(lines.reduce((s, l) => s + l.quantity * l.unitPriceInCents, 0)).toBe(5594);
    expect(lines.every(l => l.unit === "PR" && l.sourceCommercialSku === "KIT-COMMERCIAL")).toBe(true);
    expect(lines.map(l => l.sku)).toEqual(["A", "B", "C"]);
  });
  it.each([1, 2, 3, 7, 10, 99])("conserves every cent for %s kits, including repeated pairs", quantity => {
    const lines = expandBlingFiscalKit({ ...item, quantity }, [{ ...components()[0]!, quantity_pairs: 3 }]);
    expect(lines.reduce((s, l) => s + l.quantity, 0)).toBe(3 * quantity);
    expect(lines.reduce((s, l) => s + l.quantity * l.unitPriceInCents, 0)).toBe(5594 * quantity);
    expect(lines.length).toBeLessThanOrEqual(2);
  });
  it.each([[], components().slice(0, 2), [...components(), components()[0]!],
    components().map(c => ({ ...c, source_current: false })), components().map(c => ({ ...c, unit: "UN" })),
    components().map(c => ({ ...c, allocation_weight: 0 }))])("rejects missing, duplicate, stale or incomplete composition", composition => {
    expect(() => expandBlingFiscalKit(item, composition)).toThrow("kit_fiscal_composition_required");
  });
  it("allocates proportionally with stable remainder and rejects unsafe inputs", () => {
    expect(allocateBlingFiscalCents(4345, [1, 1])).toEqual([2173, 2172]);
    expect(allocateBlingFiscalCents(101, [1, 3])).toEqual([25, 76]);
    expect(() => allocateBlingFiscalCents(Number.MAX_SAFE_INTEGER + 1, [1])).toThrow();
    expect(() => allocateBlingFiscalCents(100, [0])).toThrow();
  });
  it("does not turn an individual pair into a kit or use component stock", () => {
    const single = { ...item, unit: "PR", pairsPerSku: 1 };
    expect(expandBlingFiscalKit(single, undefined)).toEqual([single]);
  });
});
