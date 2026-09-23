import { storefrontItemKey } from "@curtiz/domain";
import type { CatalogResult } from "./catalog-query";

export function catalogFilterKey(search: string) {
  const params = new URLSearchParams(search);
  params.delete("pagina");
  return params.toString();
}

export function appendCatalogPage(current: CatalogResult | null, next: CatalogResult) {
  const products = current && next.page !== 1 ? [...current.products] : [];
  const existing = new Set(products.map(storefrontItemKey));
  for (const product of next.products) {
    const key = storefrontItemKey(product);
    if (existing.has(key)) continue;
    existing.add(key);
    products.push(product);
  }
  return { ...next, facets: current && next.page !== 1 ? current.facets : next.facets, products };
}
