import "server-only";
import { allocateBlingFiscalCents } from "@curtiz/integrations";
import { readNumber, readRows, readString } from "./unknown-data";

export function priceRepresentativeGradeItems(snapshot: unknown, unitPriceInCents: number, gradeQuantity: number) {
  const components = readRows(snapshot).map(item => ({
    variantId: readString(item, "variantId"),
    productId: readString(item, "productId"),
    sku: readString(item, "sku"),
    name: readString(item, "name"),
    size: readString(item, "size"),
    pairs: readNumber(item, "pairs"),
    weight: readNumber(item, "priceCents")
  }));
  if (!Array.isArray(snapshot) || components.length !== snapshot.length
    || new Set(components.map(item => item.variantId)).size !== components.length
    || new Set(components.map(item => item.size)).size !== components.length
    || !Number.isSafeInteger(gradeQuantity) || gradeQuantity < 1 || gradeQuantity > 99
    || !Number.isSafeInteger(unitPriceInCents * gradeQuantity) || unitPriceInCents < 12
    || components.reduce((total, item) => total + item.pairs, 0) !== 12
    || components.some(item => !item.variantId || !item.productId || !item.sku || !item.name
      || !/^3[4-9]$/u.test(item.size) || !Number.isSafeInteger(item.pairs) || item.pairs < 1 || item.pairs > 4
      || !Number.isSafeInteger(item.weight) || item.weight < 1)) {
    throw new Error("Composição da ficha indisponível.");
  }

  // Allocate the price of one sheet before multiplying so every returned sheet
  // has exactly the same item quantities and cent values as the original sale.
  const weights = components.flatMap(item => Array<number>(item.pairs).fill(item.weight));
  const prices = allocateBlingFiscalCents(unitPriceInCents - 12, weights);
  let offset = 0;
  return components.flatMap(component => {
    const unitPrices = prices.slice(offset, offset + component.pairs).map(cents => cents + 1);
    offset += component.pairs;
    return [...new Set(unitPrices)].map(unitPrice => ({
      ...component,
      unitPriceInCents: unitPrice,
      quantity: unitPrices.filter(cents => cents === unitPrice).length * gradeQuantity
    }));
  });
}
