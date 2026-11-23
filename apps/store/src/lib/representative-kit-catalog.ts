import { isUnknownRecord } from "./unknown-data";

export type RepresentativeCatalogVariant = {
  variantId: string;
  color: string;
  size: string;
  unitPriceInCents: number;
  pairsPerSku: number;
  available: number | null;
  imageUrl: string;
  imageAlt: string;
};

export type RepresentativeCatalogKit = {
  productId: string;
  name: string;
  variants: RepresentativeCatalogVariant[];
};

export type RepresentativeKitPage = {
  items: RepresentativeCatalogKit[];
  total: number;
  nextOffset: number | null;
  colors: string[];
  sizes: string[];
  orderHistoryAvailable?: true;
  checkoutConfigured?: true;
};

function readOptions(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(option => typeof option !== "string")) {
    throw new Error("Filtros do catálogo inválidos.");
  }
  return value.filter((option): option is string => typeof option === "string");
}

function nameKey(name: string): string {
  return name.normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Garante um único card por produto: une entradas repetidas do mesmo produto (ou de produtos com o mesmo nome
 * sem variações em conflito) e descarta variações repetidas pelo mesmo id. Cada variação mantém seus dados reais.
 */
export function groupRepresentativeKitProducts(products: RepresentativeCatalogKit[]): RepresentativeCatalogKit[] {
  const groups: RepresentativeCatalogKit[] = [];
  const optionKey = (variant: RepresentativeCatalogVariant) => `${variant.color.toLowerCase()}|${variant.size.toLowerCase()}`;
  for (const product of products) {
    const target = groups.find(group => group.productId === product.productId)
      ?? groups.find(group => nameKey(group.name) === nameKey(product.name)
        && !product.variants.some(variant => group.variants.some(known => known.variantId !== variant.variantId
          && optionKey(known) === optionKey(variant))));
    if (!target) { groups.push({ ...product, variants: dedupeVariants(product.variants) }); continue; }
    target.variants = dedupeVariants([...target.variants, ...product.variants]);
  }
  return groups;
}

function dedupeVariants(variants: RepresentativeCatalogVariant[]): RepresentativeCatalogVariant[] {
  const seen = new Set<string>();
  return variants.filter(variant => !seen.has(variant.variantId) && Boolean(seen.add(variant.variantId)));
}

export function representativeKitPriceRange(variants: RepresentativeCatalogVariant[]): { min: number; max: number } {
  const prices = variants.map(variant => variant.unitPriceInCents);
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

export function readRepresentativeKitPage(value: unknown): RepresentativeKitPage {
  if (!isUnknownRecord(value) || !Array.isArray(value.items)
    || !(value.nextOffset === null || Number.isSafeInteger(value.nextOffset) && Number(value.nextOffset) >= 0)
    || !Number.isSafeInteger(value.total) || Number(value.total) < 0) {
    throw new Error("Catálogo de kits inválido.");
  }
  const items = value.items.map((item: unknown): RepresentativeCatalogKit => {
    if (!isUnknownRecord(item) || typeof item.productId !== "string" || typeof item.name !== "string"
      || !Array.isArray(item.variants) || item.variants.length === 0) {
      throw new Error("Dados do produto indisponíveis.");
    }
    const variants = item.variants.map((variant: unknown): RepresentativeCatalogVariant => {
      if (!isUnknownRecord(variant)
        || ["variantId", "color", "size", "imageUrl", "imageAlt"].some(key => typeof variant[key] !== "string")
        || !Number.isSafeInteger(variant.unitPriceInCents) || Number(variant.unitPriceInCents) < 0
        || !Number.isInteger(variant.pairsPerSku) || Number(variant.pairsPerSku) < 2
        || !(variant.available === null || Number.isInteger(variant.available) && Number(variant.available) >= 0)) {
        throw new Error("Dados da variação indisponíveis.");
      }
      return {
        variantId: String(variant.variantId), color: String(variant.color), size: String(variant.size),
        unitPriceInCents: Number(variant.unitPriceInCents), pairsPerSku: Number(variant.pairsPerSku),
        available: variant.available === null ? null : Number(variant.available),
        imageUrl: String(variant.imageUrl), imageAlt: String(variant.imageAlt)
      };
    });
    return { productId: String(item.productId), name: String(item.name), variants };
  });
  return {
    items: groupRepresentativeKitProducts(items),
    total: Number(value.total),
    nextOffset: value.nextOffset === null ? null : Number(value.nextOffset),
    colors: readOptions(value.colors),
    sizes: readOptions(value.sizes),
    ...(value.orderHistoryAvailable === true ? { orderHistoryAvailable: true } : {}),
    ...(value.checkoutConfigured === true ? { checkoutConfigured: true } : {})
  };
}
