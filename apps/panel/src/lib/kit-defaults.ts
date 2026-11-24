// Single place to tune the suggested kit price and stock. The admin can still edit every value before saving.
export const kitDefaults = {
  // Price per sheet (ficha), in cents.
  plainPriceCents: 18_000,
  strassPriceCents: 20_400,
  // Stock of complete kits per sheet.
  stockPerSheet: 100,
  // Product names containing one of these words (without accents, any case) use the strass price.
  strassKeywords: ["strass", "stress"]
} as const;

const normalizeProductName = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/gu, "").toLowerCase();

export function isStrassProduct(productName: string): boolean {
  const name = normalizeProductName(productName);
  return kitDefaults.strassKeywords.some(keyword => name.includes(keyword));
}

export function kitSuggestedValues(productName: string) {
  const priceCents = isStrassProduct(productName) ? kitDefaults.strassPriceCents : kitDefaults.plainPriceCents;
  return {
    grade_standard_price_cents: priceCents,
    grade_lower_restock_price_cents: priceCents,
    grade_upper_restock_price_cents: priceCents,
    grade_standard_stock: kitDefaults.stockPerSheet,
    grade_lower_restock_stock: kitDefaults.stockPerSheet,
    grade_upper_restock_stock: kitDefaults.stockPerSheet
  };
}

export function kitNameFor(productName: string, color: string): string {
  return `${productName.trim()} – ${color.trim()}`;
}
