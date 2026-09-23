import { diversifyStorefrontItems, type Product } from "@curtiz/domain";
import { z } from "zod";
import { demoProducts } from "./catalog";
import { isPresentationCatalogEnabled } from "./presentation-catalog";
import type { CatalogResult } from "./catalog-query";

export const rpcProductSchema = z.object({
  id: z.string(),
  storefrontKey: z.string().optional(),
  variantId: z.string().nullable().optional(),
  sku: z.string().nullable().optional(),
  variantColor: z.string().nullable().optional(),
  variantSize: z.string().nullable().optional(),
  slug: z.string(),
  name: z.string(),
  category: z.string(),
  categorySlug: z.string().optional(),
  description: z.string(),
  priceInCents: z.coerce.number().int().nonnegative(),
  compareAtPriceInCents: z.coerce.number().int().positive().nullable().optional(),
  rating: z.coerce.number().min(0).max(5),
  reviews: z.coerce.number().int().nonnegative(),
  colors: z.array(z.string()),
  sizes: z.array(z.string()),
  imagePath: z.string().nullable().optional(),
  featured: z.boolean(),
  stock: z.coerce.number().int().nonnegative()
});

export const facetSchema = z.object({
  categories: z.array(z.object({ value: z.string(), label: z.string(), count: z.coerce.number() })),
  collections: z.array(
    z.object({ value: z.string(), label: z.string(), count: z.coerce.number() })
  ),
  colors: z.array(
    z.object({
      value: z.string(),
      label: z.string(),
      count: z.coerce.number(),
      hex: z.string().optional(),
      secondaryHex: z.string().optional()
    })
  ),
  sizes: z.array(z.object({ value: z.string(), label: z.string(), count: z.coerce.number() })),
  price: z.object({ min: z.coerce.number(), max: z.coerce.number() }),
  promotionCount: z.coerce.number(),
  inStockCount: z.coerce.number(),
  newestCount: z.coerce.number()
});

export const rpcResultSchema = z.object({
  products: z.array(rpcProductSchema),
  facets: facetSchema,
  total: z.coerce.number().int().nonnegative()
});

export const rpcProductListSchema = z.array(rpcProductSchema);

export const productCategory = (value: string): Product["category"] => {
  const category = value.normalize("NFKC").trim().replace(/\s+/gu, " ").slice(0, 120);
  return category || "Produtos";
};

export const publicCatalogImage = (path: string | null | undefined, slug?: string) => {
  if (!path) return isPresentationCatalogEnabled()
    ? demoProducts.find((product) => product.slug === slug)?.image ?? ""
    : "";
  if (path.startsWith("/images/")) return isPresentationCatalogEnabled() ? path.replace(/\.png$/iu, ".webp") : "";
  if (path.startsWith("/") || path.startsWith("https://")) return "";
  const url = process.env.SUPABASE_URL;
  return url
    ? `${url}/storage/v1/object/public/catalog-public/${path.replace(/^catalog-public\//u, "")}`
    : "";
};

export function commercialProductName(product: {
  name: string;
  variantColor?: string | null;
  variantSize?: string | null;
}) {
  const suffixes = [
    product.variantColor && product.variantSize
      ? ` — ${product.variantColor} — ${product.variantSize}`
      : "",
    product.variantColor ? ` — ${product.variantColor}` : ""
  ].filter(Boolean);
  const suffix = suffixes.find((candidate) => product.name.endsWith(candidate));
  return suffix ? product.name.slice(0, -suffix.length) : product.name;
}

export function mapRpcProduct(product: z.infer<typeof rpcProductSchema>): Product {
  return {
    id: product.id,
    ...(product.storefrontKey ? { storefrontKey: product.storefrontKey } : {}),
    ...(product.variantId ? { variantId: product.variantId } : {}),
    ...(product.sku ? { sku: product.sku } : {}),
    ...(product.variantColor ? { variantColor: product.variantColor } : {}),
    ...(product.variantSize ? { variantSize: product.variantSize } : {}),
    slug: product.slug,
    name: commercialProductName(product),
    category: productCategory(product.category),
    ...(product.categorySlug ? { categorySlug: product.categorySlug } : {}),
    description: product.description,
    priceInCents: product.priceInCents,
    ...(product.compareAtPriceInCents
      ? { compareAtPriceInCents: product.compareAtPriceInCents }
      : {}),
    rating: product.rating,
    reviews: product.reviews,
    colors: product.colors,
    sizes: product.sizes,
    image: publicCatalogImage(product.imagePath, product.slug),
    featured: product.featured,
    stock: product.stock
  };
}

export function parseRpcProductList(data: unknown): Product[] | null {
  const parsed = rpcProductListSchema.safeParse(data);
  return parsed.success ? diversifyStorefrontItems(parsed.data.map(mapRpcProduct).filter((product) => Boolean(product.image))) : null;
}

export function parseCatalogRpcResult(
  data: unknown,
  options: { page: number; pageSize: number; sort?: string }
): CatalogResult | null {
  const parsed = rpcResultSchema.safeParse(data);
  if (!parsed.success) return null;
  return {
    products: options.sort === "best_sellers"
      ? parsed.data.products.map(mapRpcProduct).filter((product) => Boolean(product.image))
      : diversifyStorefrontItems(parsed.data.products.map(mapRpcProduct).filter((product) => Boolean(product.image))),
    facets: parsed.data.facets,
    total: parsed.data.total,
    page: options.page,
    pageSize: options.pageSize,
    source: "supabase"
  };
}
