import type { Product } from "./types";

export function storefrontItemKey(product: Pick<Product, "id" | "storefrontKey" | "variantId">) {
  return product.storefrontKey ?? `${product.id}:${product.variantId ?? "product"}`;
}

export function storefrontProductHref(
  product: Pick<Product, "slug" | "variantId">
): string {
  const base = `/produto/${encodeURIComponent(product.slug)}`;
  return product.variantId
    ? `${base}?variant=${encodeURIComponent(product.variantId)}`
    : base;
}

/**
 * Reordena apenas dentro de uma pequena janela para evitar cards consecutivos do
 * mesmo produto sem destruir o ranking original. O custo é O(n * lookahead),
 * limitado mesmo em lotes de milhares de candidatos.
 */
export function diversifyStorefrontItems<T extends Pick<Product, "id">>(
  items: readonly T[],
  minimumGap = 3,
  lookahead = 12
): T[] {
  const result = [...items];
  const gap = Math.max(1, Math.min(8, Math.floor(minimumGap)));
  const window = Math.max(gap, Math.min(48, Math.floor(lookahead)));

  for (let index = 1; index < result.length; index += 1) {
    const recentIds = new Set(
      result.slice(Math.max(0, index - gap), index).map((item) => item.id)
    );
    const current = result[index];
    if (!current || !recentIds.has(current.id)) continue;

    const replacement = result.findIndex(
      (candidate, candidateIndex) =>
        candidateIndex > index &&
        candidateIndex <= index + window &&
        !recentIds.has(candidate.id)
    );
    if (replacement > index) {
      [result[index], result[replacement]] = [result[replacement]!, result[index]!];
    }
  }

  return result;
}
