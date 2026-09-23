import type { Product } from "@curtiz/domain";

export function availableCatalogRecommendations(products: readonly Product[], limit = 8) {
  const seen = new Set<string>();
  const result: Product[] = [];
  for (const product of products) {
    const image = product.image.split(/[?#]/u, 1)[0] ?? "";
    if (!product.id || product.stock <= 0 || !image || image.startsWith("/images/")
      || /(?:logo|placeholder|demo)/iu.test(image) || /\.svg$/iu.test(image) || seen.has(product.id)) continue;
    seen.add(product.id);
    result.push(product);
    if (result.length >= Math.max(1, Math.min(8, limit))) break;
  }
  return result;
}
