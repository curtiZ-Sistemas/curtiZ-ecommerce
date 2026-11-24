import { kitGradePriceFields, kitGradeStockFields } from "./admin-resources";
import { postgresUuidSchema } from "./postgres-uuid";
import { z } from "zod";

export const normalizedSlug = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");

// The reference product line gives NCM, weight and dimensions for freight and the invoice.
// It never provides stock, but the kit is only offered with it.
export function normalizeKitGradeSource(values: Record<string, unknown>, source: unknown): string | null {
  const separator = typeof source === "string" ? source.indexOf("|") : -1;
  if (typeof source !== "string" || separator < 0) return "Selecione o produto de referência para frete e NF-e.";
  const product = postgresUuidSchema.safeParse(source.slice(0, separator));
  const color = source.slice(separator + 1);
  if (!product.success || color.length > 150 || color.trim().length === 0) {
    return "Selecione o produto de referência para frete e NF-e.";
  }
  values.grade_product_id = product.data;
  values.grade_color = color;
  return null;
}

const kitGradePrice = z.number().int().min(12).max(9_999_999_999);
const kitGradeStock = z.number().int().min(0).max(1_000_000);

// Each of the three sheets needs a price and a stock of complete kits, plus the reference product.
// Returns field errors, or null when the values were normalized (or nothing had to change).
export function normalizeKitGradePrices(
  values: Record<string, unknown>,
  input: Record<string, unknown>,
  creating: boolean
): Record<string, string> | null {
  const fields = [...kitGradePriceFields, ...kitGradeStockFields];
  if (!creating && !fields.some(field => field.key in input) && !("gradeSource" in input)) return null;
  const errors: Record<string, string> = {};
  const sourceError = normalizeKitGradeSource(values, input.gradeSource);
  if (sourceError) errors.gradeSource = sourceError;
  for (const field of kitGradePriceFields) {
    const price = kitGradePrice.safeParse(input[field.key]);
    if (price.success) {
      values[field.key] = price.data;
    } else {
      errors[field.key] = "Informe um preço entre R$ 0,12 e R$ 99.999.999,99.";
    }
  }
  for (const field of kitGradeStockFields) {
    const raw = input[field.key];
    const stock = kitGradeStock.safeParse(typeof raw === "string" && /^[0-9]{1,7}$/u.test(raw.trim()) ? Number(raw) : raw);
    if (stock.success) {
      values[field.key] = stock.data;
    } else {
      errors[field.key] = "Informe um número inteiro de kits, a partir de 0.";
    }
  }
  if (Object.keys(errors).length > 0) return errors;
  // Keep the kit legacy price available to consumers that do not read sheet prices.
  values.price_in_cents = values.grade_standard_price_cents;
  return null;
}
