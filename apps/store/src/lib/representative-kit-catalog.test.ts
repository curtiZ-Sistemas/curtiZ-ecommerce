import { describe, expect, it } from "vitest";
import { readRepresentativeKitPage } from "./representative-kit-catalog";
const item = { variantId: "existing-variant", name: "Existing kit", sku: "EXISTING-SKU", color: "White", size: "39",
  unitPriceInCents: 4345, pairsPerSku: 2, available: 49 };
describe("existing representative kit catalog", () => {
  it("preserves saved SKU, price, pairs and available stock", () => {
    expect(readRepresentativeKitPage({ items: [item], nextOffset: 24 })).toEqual({ items: [item], nextOffset: 24 });
    expect(readRepresentativeKitPage({ items: [{ ...item, available: null }], nextOffset: null }).items[0]!.available).toBeNull();
  });
  it.each([{}, { items: null, nextOffset: null }, { items: [{ ...item, unitPriceInCents: "4345" }], nextOffset: null },
    { items: [{ ...item, available: -1 }], nextOffset: null }, { items: [{ ...item, pairsPerSku: 1 }], nextOffset: null }])("does not mask invalid catalog/stock as an empty successful response", value => {
    expect(() => readRepresentativeKitPage(value)).toThrow();
  });
});
