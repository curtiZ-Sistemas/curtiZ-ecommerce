import { isUnknownRecord } from "./unknown-data";

export type RepresentativeCatalogKit = { variantId: string; name: string; sku: string; color: string; size: string;
  unitPriceInCents: number; pairsPerSku: number; available: number | null };
export type RepresentativeKitPage = { items: RepresentativeCatalogKit[]; nextOffset: number | null };
export function readRepresentativeKitPage(value: unknown): RepresentativeKitPage {
  if (!isUnknownRecord(value) || !Array.isArray(value.items)
    || !(value.nextOffset === null || Number.isSafeInteger(value.nextOffset) && Number(value.nextOffset) >= 0))
    throw new Error("Catálogo de kits inválido.");
  const items = value.items.map((item: unknown): RepresentativeCatalogKit => {
    if (!isUnknownRecord(item) || ["variantId", "name", "sku", "color", "size"].some(key => typeof item[key] !== "string")
      || !Number.isSafeInteger(item.unitPriceInCents) || Number(item.unitPriceInCents) < 0
      || !Number.isInteger(item.pairsPerSku) || Number(item.pairsPerSku) < 2
      || !(item.available === null || Number.isInteger(item.available) && Number(item.available) >= 0))
      throw new Error("Dados do kit indisponíveis.");
    return { variantId: String(item.variantId), name: String(item.name), sku: String(item.sku), color: String(item.color),
      size: String(item.size), unitPriceInCents: Number(item.unitPriceInCents), pairsPerSku: Number(item.pairsPerSku),
      available: item.available === null ? null : Number(item.available) };
  });
  return { items, nextOffset: value.nextOffset === null ? null : Number(value.nextOffset) };
}
