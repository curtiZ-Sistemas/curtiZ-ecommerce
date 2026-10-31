import "server-only";
import { BlingError } from "./bling";

export type BlingFiscalItem = {
  sku: string; description: string; unit: string; pairsPerSku: number; fiscalUnitApproved: boolean;
  quantity: number; unitPriceInCents: number; ncm: string; origin: number; cest: string;
  sourceCommercialSku?: string; variantId?: string;
};
const row = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown) => typeof v === "string" ? v : "";

// Largest remainder with integer arithmetic and a stable positional tie break.
export function allocateBlingFiscalCents(total: number, weights: number[]): number[] {
  if (!Number.isSafeInteger(total) || total < 0 || !weights.length
    || weights.some(w => !Number.isSafeInteger(w) || w <= 0)) throw new BlingError("invalid_fiscal_allocation", 409);
  const sum = weights.reduce((s, w) => s + BigInt(w), 0n), amount = BigInt(total);
  const parts = weights.map((w, index) => ({ index, base: amount * BigInt(w) / sum, remainder: amount * BigInt(w) % sum }));
  let remaining = amount - parts.reduce((s, p) => s + p.base, 0n);
  for (const part of [...parts].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1)) {
    if (remaining === 0n) break;
    part.base += 1n; remaining -= 1n;
  }
  return parts.map(p => Number(p.base));
}

export function expandBlingFiscalKit(item: BlingFiscalItem, composition: unknown): BlingFiscalItem[] {
  if (item.pairsPerSku === 1) return [item];
  const entries = Array.isArray(composition) ? composition.map(row) : [];
  if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || !Number.isSafeInteger(item.pairsPerSku) || item.pairsPerSku < 2
    || !entries.length || entries.some(c => c.source_current !== true || !text(c.sku) || text(c.sku).length > 60
      || !text(c.description) || c.unit !== "PR" || !Number.isSafeInteger(c.quantity_pairs) || Number(c.quantity_pairs) < 1
      || !Number.isSafeInteger(c.allocation_weight) || Number(c.allocation_weight) < 1
      || !/^\d{8}$/u.test(text(c.ncm)) || !Number.isInteger(c.origin) || Number(c.origin) < 0 || Number(c.origin) > 8
      || !/^(?:|\d{7})$/u.test(text(c.cest)))
    || new Set(entries.map(c => c.sku)).size !== entries.length
    || entries.reduce((s, c) => s + Number(c.quantity_pairs), 0) !== item.pairsPerSku)
    throw new BlingError("kit_fiscal_composition_required", 409);
  const total = item.unitPriceInCents * item.quantity;
  const amounts = allocateBlingFiscalCents(total, entries.map(c => Number(c.allocation_weight)));
  return entries.flatMap((c, i) => {
    const quantity = Number(c.quantity_pairs) * item.quantity, allocated = amounts[i]!;
    if (!Number.isSafeInteger(quantity) || quantity < 1) throw new BlingError("invalid_fiscal_allocation", 409);
    const base = Math.floor(allocated / quantity), higher = allocated % quantity;
    const component: BlingFiscalItem = { sku: text(c.sku), description: text(c.description), unit: "PR", pairsPerSku: 1,
      fiscalUnitApproved: true, quantity, unitPriceInCents: base, ncm: text(c.ncm), origin: Number(c.origin), cest: text(c.cest),
      sourceCommercialSku: item.sku };
    // Two bounded price groups preserve every cent even for repeated identical pairs.
    return [...(higher ? [{ ...component, quantity: higher, unitPriceInCents: base + 1 }] : []),
      ...(quantity > higher ? [{ ...component, quantity: quantity - higher }] : [])];
  });
}
