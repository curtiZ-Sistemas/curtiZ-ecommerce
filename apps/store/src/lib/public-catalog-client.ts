import type { Product } from "@curtiz/domain";

function isProduct(value: unknown): value is Product {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const product = value as Record<string, unknown>;
  return (
    typeof product.id === "string" &&
    typeof product.slug === "string" &&
    typeof product.name === "string" &&
    typeof product.category === "string" &&
    typeof product.image === "string" &&
    Number.isInteger(product.priceInCents) &&
    Number.isInteger(product.stock) &&
    Number(product.stock) > 0 &&
    typeof product.rating === "number" &&
    Number.isInteger(product.reviews) &&
    Array.isArray(product.colors) &&
    Array.isArray(product.sizes)
  );
}

function readCatalogProducts(value: unknown): Product[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const products = (value as Record<string, unknown>).products;
  return Array.isArray(products) ? products.filter(isProduct) : [];
}

export function publicCatalogUrl(parameters: Record<string, string>) {
  return `/api/catalog?${new URLSearchParams({ estoque: "1", compacto: "1", ...parameters }).toString()}`;
}

export async function fetchPublicCatalog(url: string, signal: AbortSignal): Promise<Product[]> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("catalog_unavailable");
  return readCatalogProducts(await response.json());
}
